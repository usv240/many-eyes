import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { isDeepStrictEqual } from "node:util";
import { verify, type LedgerEvent } from "./ledger/ledger.js";
import { LedgerReplay } from "./ledger/replay.js";
import { compareMetrics, type DecidedGold } from "./consensus/metrics.js";

const integrity = verify();
const replay = new LedgerReplay();
if (integrity.lines) {
  const lines = createInterface({ input: createReadStream("data/ledger.jsonl"), crlfDelay: Infinity });
  for await (const line of lines) replay.accept(JSON.parse(line) as LedgerEvent);
}
if (existsSync("reports/latest.json")) {
  type Comparison = ReturnType<typeof compareMetrics>;
  const report = JSON.parse(readFileSync("reports/latest.json", "utf8")) as {
    rows: (Comparison & { runs: (Comparison & { runId: string })[] })[];
  };
  for (const row of report.rows) {
    const tiles: DecidedGold[] = [];
    for (const run of row.runs) {
      const gold = replay.gold(run.runId);
      const recomputed = compareMetrics(gold);
      if (!isDeepStrictEqual(recomputed, { weighted: run.weighted, unweighted: run.unweighted }))
        throw new Error("Report numbers differ from ledger replay for " + run.runId);
      tiles.push(...gold);
    }
    if (!isDeepStrictEqual(compareMetrics(tiles), { weighted: row.weighted, unweighted: row.unweighted }))
      throw new Error("Report aggregate differs from ledger replay.");
  }
}
console.log("Verified " + integrity.lines + " ledger events; published metrics match replay.");
