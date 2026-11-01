import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { runGoldSimulation } from "../sim/src/benchmark.js";
import { DIFFICULTY, type TileDifficulty } from "../sim/src/crowd.js";
import { compareMetrics, type DecidedGold } from "../server/src/consensus/metrics.js";
import { Ledger, BENCH_LEDGER_PATH } from "../server/src/ledger/ledger.js";

const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
const missionId = "nepal-flood-2026";
const ledger = new Ledger(BENCH_LEDGER_PATH);
const batchId = randomUUID();
const cohorts = [
  { voters: 1, trolls: 0 }, { voters: 5, trolls: 2 }, { voters: 10, trolls: 3 },
  { voters: 15, trolls: 5 }, { voters: 25, trolls: 8 },
];
const difficulties: TileDifficulty[] = ["easy", "hard", "misleading"];
const percent = (value: number | null) => value === null ? "n/a" : (100 * value).toFixed(1) + "%";
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
function aggregateIndividual(runs: Awaited<ReturnType<typeof runGoldSimulation>>[]) {
  const voters = runs.flatMap((run) => run.individual.voters);
  const correct = runs.reduce((sum, run) => sum + run.individual.correct, 0);
  const classified = runs.reduce((sum, run) => sum + run.individual.classified, 0);
  const total = runs.reduce((sum, run) => sum + run.individual.total, 0);
  return { correct, classified, total, accuracy: classified ? correct / classified : null,
    coverage: total ? classified / total : null,
    voterAccuracy: distribution(voters.flatMap((voter) => voter.accuracy === null ? [] : [voter.accuracy])) };
}

const rows = [];
const runResults = new Map<number, Awaited<ReturnType<typeof runGoldSimulation>>[]>();
for (const cohort of cohorts) {
  const gold: DecidedGold[] = [];
  const runs: (Awaited<ReturnType<typeof runGoldSimulation>> & { seed: number; runId: string })[] = [];
  for (const seed of seeds) {
    const runId = batchId + ":" + cohort.voters + ":" + seed;
    const result = await runGoldSimulation({ seed, voters: cohort.voters, trollFraction: cohort.trolls / cohort.voters,
      lurkerFraction: 0, unsureRate: 0.05, hardAccuracyMultiplier: 0.5, raidProbability: 0.25 }, runId, missionId);
    const counts = Object.fromEntries(difficulties.map((difficulty) => [difficulty,
      result.gold.filter((tile) => tile.difficulty === difficulty).length])) as Record<TileDifficulty, number>;
    if (counts.misleading === 0) throw new Error("Seed " + seed + " produced no misleading tiles.");
    ledger.appendBatch(result.events);
    gold.push(...result.gold);
    runs.push({ seed, runId, ...result });
  }
  runResults.set(cohort.voters, runs);
  const byDifficulty = Object.fromEntries(difficulties.map((difficulty) => [difficulty,
    compareMetrics(gold.filter((tile) => tile.difficulty === difficulty))]));
  rows.push({ ...cohort, trollsAlwaysWrong: Math.ceil(cohort.trolls / 3), trollsRaid: cohort.trolls - Math.ceil(cohort.trolls / 3),
    ...compareMetrics(gold), individual: aggregateIndividual(runs), byDifficulty,
    difficultyCounts: Object.fromEntries(difficulties.map((difficulty) => [difficulty,
      gold.filter((tile) => tile.difficulty === difficulty).length])),
    runs: runs.map(({ seed, runId, metrics, individual, gold: tileResults }) => ({ seed, runId, ...metrics, individual,
      difficultyCounts: Object.fromEntries(difficulties.map((difficulty) => [difficulty,
        tileResults.filter((tile) => tile.difficulty === difficulty).length])) })) });
}

const tenRuns = runResults.get(10)!;
const learningCurve = [0, 20, 40, 60].map((start) => {
  const tiles = tenRuns.flatMap((run) => run.gold.slice(start, start + 20));
  return { tiles: (start + 1) + "–" + (start + 20), ...compareMetrics(tiles) };
});
const solo = rows[0]!.individual.voterAccuracy;
const ten = rows[2]!;
const headline = "One viewer alone: " + percent(solo.mean) + ". Ten viewers including three trolls, weighted by hidden checks: " +
  percent(ten.weighted.accuracy) + " correct on the " + percent(ten.weighted.coverage) +
  " of tiles they validated; the rest were refused and sent to experts.";
const report = {
  missionId, batchId, seeds,
  model: { voterCounts: cohorts.map(({ voters }) => voters),
    sensitivity: { mean: 0.78, sd: 0.08 }, specificity: { mean: 0.97, sd: 0.03 }, clamp: [0.5, 0.99],
    trollMix: "one third always votes opposite the hidden truth; remaining trolls synchronize on destroyed during raids",
    lurkerFraction: 0, unsureRate: 0.05, difficulty: DIFFICULTY,
    hardAccuracyMultiplier: 0.5, raidProbabilityPerTile: 0.25,
    note: "Scenario assumptions are fixed before scoring; consensus parameters are unchanged. Results are simulations, not observed crowd measurements." },
  definitions: { individualAccuracy: "per honest voter's correct non-unsure votes / that voter's non-unsure votes; mean, median and 10th–90th percentiles across voter-run scores",
    accuracy: "correct / validated gold", falseDestroyedRate: "validated destroyed on intact gold / all intact gold",
    falseIntactRate: "validated intact on destroyed gold / all destroyed gold", refusalRate: "refused / all gold",
    coverage: "validated / all gold", votesPerTile: "distinct final votes including unsure / all gold" },
  headline, individualBaseline: solo, learningCurve, rows,
};
mkdirSync("reports", { recursive: true });
const json = JSON.stringify(report, null, 2) + "\n";
const cohortTable = ["| viewers | trolls (wrong / raid) | honest-voter mean (median; p10–p90) | weighted acc. | unweighted acc. | weighted coverage | unweighted coverage |",
  "|---:|---:|---:|---:|---:|---:|---:|", ...rows.map((row) => "| " + row.voters + " | " + row.trollsAlwaysWrong + " / " + row.trollsRaid +
    " | " + percent(row.individual.voterAccuracy.mean) + " (" + percent(row.individual.voterAccuracy.median) + "; " +
    percent(row.individual.voterAccuracy.p10) + "–" + percent(row.individual.voterAccuracy.p90) + ") | " +
    percent(row.weighted.accuracy) + " | " + percent(row.unweighted.accuracy) + " | " + percent(row.weighted.coverage) + " | " +
    percent(row.unweighted.coverage) + " |")].join("\n");
const difficultyTable = ["| difficulty | mix | weighted accuracy | unweighted accuracy | weighted coverage | unweighted coverage |",
  "|---|---:|---:|---:|---:|---:|", ...difficulties.map((difficulty) => {
    const stats = ten.byDifficulty[difficulty];
    return "| " + difficulty + " | " + percent(DIFFICULTY[difficulty]) + " | " + percent(stats.weighted.accuracy) +
      " | " + percent(stats.unweighted.accuracy) + " | " + percent(stats.weighted.coverage) + " | " +
      percent(stats.unweighted.coverage) + " |";
  })].join("\n");
const learningTable = ["| gold tiles | weighted accuracy | unweighted accuracy | weighted coverage | unweighted coverage |",
  "|---|---:|---:|---:|---:|", ...learningCurve.map((row) => "| " + row.tiles + " | " +
    percent(row.weighted.accuracy) + " | " + percent(row.unweighted.accuracy) + " | " +
    percent(row.weighted.coverage) + " | " + percent(row.unweighted.coverage) + " |")].join("\n");
const markdown = [headline, "", "## Cohorts", "", cohortTable, "", "Accuracy is calculated over validated gold tiles; coverage is validated tiles divided by all gold tiles. Honest-voter accuracy uses each non-troll voter's raw non-unsure votes.",
  "", "## Ten-viewer accuracy by difficulty", "", difficultyTable, "", "## Ten-viewer learning curve", "", learningTable,
  "", "## Limits", "", "Voter sensitivity and specificity are based on Herfort et al. 2019 (MapSwipe).",
  "The 65% easy, 25% hard, 10% misleading mix and both troll tactics are simulation assumptions.",
  "Intact gold is inferred from OSM buildings more than 40 m from any Copernicus damage point.",
  "The crowd is simulated; these results do not measure real Twitch viewers.", ""].join("\n");
writeFileSync("reports/bench.json", json);
writeFileSync("reports/latest.json", json);
const aiSection = existsSync("reports/bench.md") ? readFileSync("reports/bench.md", "utf8").match(/<!-- AI-ALONE:START -->[\s\S]*?<!-- AI-ALONE:END -->/)?.[0] : undefined;
writeFileSync("reports/bench.md", markdown + (aiSection ? "\n" + aiSection + "\n" : ""));
ledger.append("export_written", { path: "reports/bench.json", batchId,
  sha256: createHash("sha256").update(json).digest("hex") }, Date.now());
console.log(headline);
console.log(cohortTable);
console.log("\nTen-viewer accuracy by difficulty:\n" + difficultyTable);
console.log("\nTen-viewer learning curve:\n" + learningTable);
console.log("20 fixed seeds × 80 gold tiles per cohort. Baseline excludes troll votes.");
