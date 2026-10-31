import { mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { runGoldSimulation } from "../sim/src/benchmark.js";
import { compareMetrics, type DecidedGold } from "../server/src/consensus/metrics.js";
import { Ledger } from "../server/src/ledger/ledger.js";

const seeds = [1, 2, 3, 4, 5];
const missionId = "nepal-flood-2026";
const ledger = new Ledger();
const batchId = randomUUID();
const rows = [];
for (const trollFraction of [0, 0.1, 0.3, 0.5]) {
  const gold: DecidedGold[] = [];
  const runs = [];
  for (const seed of seeds) {
    const runId = batchId + ":" + trollFraction + ":" + seed;
    const result = await runGoldSimulation({ seed, voters: 200, trollFraction, lurkerFraction: 0, unsureRate: 0.05 }, runId, missionId);
    ledger.appendBatch(result.events);
    gold.push(...result.gold);
    runs.push({ seed, runId, ...result.metrics });
  }
  rows.push({ trollFraction, ...compareMetrics(gold), runs });
}
const report = {
  missionId, batchId, voters: 200, seeds,
  model: { sensitivity: { mean: 0.78, sd: 0.08 }, specificity: { mean: 0.97, sd: 0.03 },
    clamp: [0.5, 0.99], lurkerFraction: 0, unsureRate: 0.05,
    note: "User-specified synthetic crowd assumptions; these are simulation results, not measured crowd accuracy." },
  definitions: { accuracy: "correct / validated gold", falseDestroyedRate: "validated destroyed on intact gold / all intact gold",
    falseIntactRate: "validated intact on destroyed gold / all destroyed gold", refusalRate: "refused / all gold",
    coverage: "validated / all gold", votesPerTile: "distinct final votes including unsure / all gold" },
  rows,
};
mkdirSync("reports", { recursive: true });
const text = JSON.stringify(report, null, 2) + "\n";
writeFileSync("reports/bench.json", text);
writeFileSync("reports/latest.json", text);
ledger.append("export_written", { path: "reports/bench.json", batchId, sha256: createHash("sha256").update(text).digest("hex") }, Date.now());
const percent = (value: number | null) => value === null ? "n/a" : (100 * value).toFixed(2) + "%";
console.log("| troll % | weighted acc | unweighted acc | false-destroyed | refusal rate |");
console.log("|---:|---:|---:|---:|---:|");
for (const row of rows) console.log("| " + (row.trollFraction * 100) + "% | " + percent(row.weighted.accuracy) +
  " | " + percent(row.unweighted.accuracy) + " | " + percent(row.weighted.falseDestroyedRate) +
  " | " + percent(row.weighted.refusalRate) + " |");
console.log("400 gold decisions per row (80 tiles x 5 seeds). Final two columns use weighted scoring.");
