import { readFileSync, writeFileSync } from "node:fs";
import { getMission } from "../server/src/missions/mission.js";
import { readCachedDebate, type CachedDebate } from "../server/src/debate/cache.js";
import { scoreDebates } from "../server/src/debate/score.js";

const mission = getMission("nepal-flood-2026");
const entries = new Map<string, CachedDebate>();
for (const building of mission.buildings) {
  const entry = readCachedDebate(building.id);
  if (entry) entries.set(building.id, entry);
}
const score = scoreDebates(mission, entries);
if (score.missing.length) throw new Error("Missing or stale debates for " + score.missing.length + " buildings. Run npm run debates:warm.");
const models = [...new Set([...entries.values()].map((entry) => entry.model))];
const dates = [...new Set([...entries.values()].map((entry) => entry.createdAt.slice(0, 10)))].sort();
const percentage = (correct: number, total: number) => (100 * correct / total).toFixed(1) + "%";
const headline = `AI alone: ${percentage(score.gold.correct, score.gold.total)} on ${score.gold.total} hidden checks (destroyed ${percentage(score.gold.destroyed.correct, score.gold.destroyed.total)}, intact ${percentage(score.gold.intact.correct, score.gold.intact.total)}).`;
const section = ["<!-- AI-ALONE:START -->", "## AI alone (real cached imagery measurement)", "", headline, "",
  "Model: " + models.join(", ") + ". API measurement dates (UTC): " + dates.join(", ") + ". Scored: " + new Date().toISOString() + ".",
  "", "One binary model prediction per building from the two centred crops; no gold membership, expert grade, building ID or coordinates were provided to the model.",
  "This is a real API measurement, not a simulated crowd. Intact gold is inferred from OSM distance to damage points, not a field survey.",
  "", "### Agreement with experts on the 110 work-queue tiles", "",
  "Binary agreement with experts: **not measurable (0/110 have comparable binary expert labels)**. Damaged and Possibly damaged are neither destroyed nor intact; no mapping has been invented. The cross-tab below reports AI labels by the original expert grade, not accuracy.",
  "", "| Expert grade | AI destroyed | AI intact | Total |", "|---|---:|---:|---:|",
  ...Object.entries(score.work).map(([grade, row]) => `| ${grade} | ${row.destroyed} | ${row.intact} | ${row.total} |`),
  "", "Per-building labels, confidence, crop hashes and timestamps are recorded in reports/ai-alone.json. Reproduce with npm run debates:score against the matching debate/crop caches.",
  "<!-- AI-ALONE:END -->", ""].join("\n");
const report = { headline, models, dates, ...score, entries: [...entries].map(([buildingId, entry]) => ({
  buildingId, model: entry.model, createdAt: entry.createdAt, cropHashes: entry.cropHashes,
  model_label: entry.debate.model_label, confidence: entry.debate.confidence,
})) };
writeFileSync("reports/ai-alone.json", JSON.stringify(report, null, 2) + "\n");
const original = readFileSync("reports/bench.md", "utf8").replace(/\n?<!-- AI-ALONE:START -->[\s\S]*?<!-- AI-ALONE:END -->\n?/g, "");
writeFileSync("reports/bench.md", original.trimEnd() + "\n\n" + section);
console.log(headline);
console.log("Model: " + models.join(", ") + "; measured " + dates.join(", "));
console.log("Work-queue expert agreement: not measurable; expert grades are not binary. Cross-tab:", score.work);
