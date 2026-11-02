import { verifyMissionReport } from "./exports/report.js";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { verify, LIVE_LEDGER_PATH, BENCH_LEDGER_PATH, type LedgerEvent } from "./ledger/ledger.js";
import { LedgerReplay } from "./ledger/replay.js";
import { compareMetrics, type DecidedGold } from "./consensus/metrics.js";
import { DIFFICULTY, type TileDifficulty } from "../../sim/src/crowd.js";

const difficulties: TileDifficulty[] = ["easy", "hard", "misleading"];
function distribution(values: number[]) {
  if (!values.length) return { n: 0, mean: null, median: null, p10: null, p90: null };
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q: number) => {
    const position = (sorted.length - 1) * q; const low = Math.floor(position); const high = Math.ceil(position);
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
  };
  return { n: sorted.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: quantile(0.5), p10: quantile(0.1), p90: quantile(0.9) };
}

const liveIntegrity = verify(LIVE_LEDGER_PATH);
const integrity = verify(BENCH_LEDGER_PATH);
const replay = new LedgerReplay();
const exports: { batchId?: string; sha256?: string; path?: string }[] = [];
for (const [path, count, target] of [[LIVE_LEDGER_PATH, liveIntegrity.lines, new LedgerReplay()],
  [BENCH_LEDGER_PATH, integrity.lines, replay]] as const) {
  if (!count) continue;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    const event = JSON.parse(line) as LedgerEvent;
    target.accept(event);
    if (path === BENCH_LEDGER_PATH && event.type === "export_written") exports.push(event.data as { batchId?: string; sha256?: string; path?: string });
  }
}
if (existsSync("reports/latest.json")) {
  type Comparison = ReturnType<typeof compareMetrics>;
  const report = JSON.parse(readFileSync("reports/latest.json", "utf8")) as {
    batchId: string;
    rows: (Comparison & { voters: number;
      runs: (Comparison & { runId: string; individual: { correct: number; classified: number; total: number;
        accuracy: number | null; coverage: number | null; voters: { userId: string; correct: number; classified: number; total: number;
          accuracy: number | null }[] } })[]; individual: { correct: number; classified: number; total: number;
        accuracy: number | null; coverage: number | null; voterAccuracy: ReturnType<typeof distribution> };
      byDifficulty: Record<TileDifficulty, Comparison>; difficultyCounts: Record<TileDifficulty, number> })[];
    learningCurve: { tiles: string }[]; model: { difficulty: typeof DIFFICULTY };
  };
  const reportHash = createHash("sha256").update(readFileSync("reports/latest.json")).digest("hex");
  const recordedExport = [...exports].reverse().find((item) =>
    item.batchId === report.batchId && item.path === "reports/bench.json");
  if (!recordedExport || recordedExport.sha256 !== reportHash)
    throw new Error("Published benchmark report does not match its ledger export event.");
  for (const row of report.rows) {
    const tiles: DecidedGold[] = [];
    let individualCorrect = 0; let individualClassified = 0; let individualTotal = 0;
    const honestVoters: { accuracy: number | null }[] = [];
    for (const run of row.runs) {
      const gold = replay.gold(run.runId);
      const recomputed = compareMetrics(gold);
      if (!isDeepStrictEqual(recomputed, { weighted: run.weighted, unweighted: run.unweighted }))
        throw new Error("Report numbers differ from ledger replay for " + run.runId);
      if (!isDeepStrictEqual(replay.individual(run.runId), run.individual))
        throw new Error("Individual report numbers differ from ledger replay for " + run.runId);
      individualCorrect += run.individual.correct;
      individualClassified += run.individual.classified;
      individualTotal += run.individual.total;
      honestVoters.push(...run.individual.voters);
      tiles.push(...gold);
    }
    if (!isDeepStrictEqual(compareMetrics(tiles), { weighted: row.weighted, unweighted: row.unweighted }))
      throw new Error("Report aggregate differs from ledger replay.");
    const individual = { correct: individualCorrect, classified: individualClassified, total: individualTotal,
      accuracy: individualClassified ? individualCorrect / individualClassified : null,
      coverage: individualTotal ? individualClassified / individualTotal : null,
      voterAccuracy: distribution(honestVoters.flatMap((voter) => voter.accuracy === null ? [] : [voter.accuracy])) };
    if (!isDeepStrictEqual(individual, row.individual))
      throw new Error("Individual report aggregate differs from ledger replay.");
    const byDifficulty = Object.fromEntries(difficulties.map((difficulty) => [difficulty,
      compareMetrics(tiles.filter((tile) => tile.difficulty === difficulty))]));
    if (!isDeepStrictEqual(byDifficulty, row.byDifficulty)) throw new Error("Difficulty report differs from ledger replay.");
    const counts = Object.fromEntries(difficulties.map((difficulty) => [difficulty,
      tiles.filter((tile) => tile.difficulty === difficulty).length]));
    if (!isDeepStrictEqual(counts, row.difficultyCounts)) throw new Error("Difficulty counts differ from ledger replay.");
  }
  const ten = report.rows.find((row) => row.voters === 10);
  const curve = [0, 20, 40, 60].map((start) => {
    const tiles = ten!.runs.flatMap((run) => replay.gold(run.runId).slice(start, start + 20));
    return { tiles: (start + 1) + "–" + (start + 20), ...compareMetrics(tiles) };
  });
  if (!isDeepStrictEqual(curve, report.learningCurve)) throw new Error("Learning curve differs from ledger replay.");
  if (!isDeepStrictEqual(report.model.difficulty, DIFFICULTY)) throw new Error("Difficulty assumptions differ from the benchmark model.");
}
console.log("Verified " + liveIntegrity.lines + " live and " + integrity.lines + " benchmark ledger events; published metrics match benchmark replay.");

console.log("Verified " + verifyMissionReport() + " video events and all mission exports/report artifacts.");
