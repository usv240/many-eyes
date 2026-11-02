import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Ledger, verify, type LedgerEvent } from "../ledger/ledger.js";
import { getMission } from "../missions/mission.js";
import type { Metrics } from "../consensus/metrics.js";
import { exportMission } from "./geojson.js";

export const VIDEO_LEDGER_PATH = "data/video-ledger.jsonl";
const base = "reports/nepal-flood-2026";
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const pct = (value: number | null) => value === null ? "n/a" : (value * 100).toFixed(1) + "%";
function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T; }
export function readVideoEvents() {
  verify(VIDEO_LEDGER_PATH);
  return readFileSync(VIDEO_LEDGER_PATH, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LedgerEvent);
}

export function headlineTable() {
  const bench = readJson<{ rows: { voters: number; weighted: Metrics; individual: { voterAccuracy: { mean: number } };
    byDifficulty: { misleading: { weighted: Metrics } } }[] }>("reports/latest.json");
  const ai = readJson<{ models: string[]; dates: string[];
    entries: { buildingId: string; model_label: string }[] }>("reports/ai-alone.json");
  const gold = getMission("nepal-flood-2026").gold;
  const labels = new Map(ai.entries.map((entry) => [entry.buildingId, entry.model_label]));
  const counts = (truth: string) => {
    const tiles = gold.filter((tile) => tile.truth === truth);
    if (tiles.some((tile) => !labels.has(tile.building_id))) throw new Error("Missing AI measurement.");
    return { total: tiles.length, correct: tiles.filter((tile) => labels.get(tile.building_id) === truth).length };
  };
  const destroyed = counts("destroyed"), intact = counts("intact");
  const one = bench.rows.find((row) => row.voters === 1)!;
  const ten = bench.rows.find((row) => row.voters === 10)!;
  const table = ["| Measurement | Result | Source |", "|---|---|---|",
    "| One viewer alone (simulated, Herfort 2019 rates) | " + pct(one.individual.voterAccuracy.mean) + " | Honest-voter raw accuracy; [benchmark](reports/bench.md), bench ledger replay |",
    "| Ten viewers with three trolls, weighted by hidden checks (simulated) | " + pct(ten.weighted.accuracy) + " on " + pct(ten.weighted.coverage) + " validated | [Benchmark](reports/bench.md), bench ledger replay |",
    "| AI alone (real API measurement) | " + pct((destroyed.correct + intact.correct) / gold.length) + " (destroyed " + pct(destroyed.correct / destroyed.total) + ", intact " + pct(intact.correct / intact.total) + ") | " + ai.models.join(", ") + "; " + ai.dates.join(", ") + "; [cached predictions](reports/ai-alone.json) |",
    "| AI false alarms on intact buildings | " + pct(1 - intact.correct / intact.total) + " | " + (intact.total - intact.correct) + "/" + intact.total + " intact hidden checks; same API measurement |"].join("\n");
  return { table, ten };
}
export function renderArtifacts(events: readonly LedgerEvent[], runId: string) {
  const collections = exportMission(events, runId);
  const { table, ten } = headlineTable();
  const offset = readJson<{ summary: { median_m: number } }>("reports/overlay/offset-measurement.json");
  const validated = collections.validated.features.length, refused = collections.refused.features.length;
  const manifest = { missionId: "nepal-flood-2026", runId, ledger: VIDEO_LEDGER_PATH, source: "simulated crowd",
    scripted: true, validated, refused,
    sources: Object.fromEntries(["reports/latest.json", "reports/ai-alone.json", "reports/overlay/offset-measurement.json"].map((path) => [path, hash(readFileSync(path))])) };
  const markdown = table.replaceAll("(reports/", "(") + "\n\n" + [
    "# Nepal flood mission report", "",
    "The AI's false alarms are the reason chat checks the AI rather than the reverse. AI arguments never enter consensus.decide().",
    "", "## Recorded demo and exports", "",
    "Run `" + runId + "` in `" + VIDEO_LEDGER_PATH + "` is a deliberately selected six-tile recording with a simulated crowd, not a benchmark sample.",
    "All export labels are recomputed from accepted ledger votes through consensus.decide(). This run has **" + validated + " validated** buildings and **" + refused + " refused** buildings, queued for expert review.",
    "The ten-viewer benchmark separately refused " + ten.weighted.refused + " of " + ten.weighted.total + " gold presentations across seeds.",
    "", "[Validated GeoJSON](nepal-flood-2026-validated.geojson) and [refused GeoJSON](nepal-flood-2026-refused.geojson) contain WGS84 longitude/latitude Points for humanitarian mappers to inspect and reconcile with HOT Tasking Manager work. They are demonstration review inputs, not an operational damage inventory or automatic HOT upload. Gold checks remain identified in exports; refused points carry their review reason.",
    "", "## Limits", "",
    "- The crowd is simulated. Sensitivity and specificity use Herfort et al. 2019 (MapSwipe) rates. The difficulty mix and troll tactics are assumptions, not measured Twitch behaviour.",
    "- Intact gold is inferred from OSM buildings more than 40 m from any Copernicus damage point; it is not an expert intact survey.",
    "- On misleading tiles, ten-viewer weighted accuracy is " + pct(ten.byDifficulty.misleading.weighted.accuracy) + ". These are 10% of the assumed benchmark mix; shared mistakes can produce confident consensus.",
    "- Typical pre/post photo offset is " + offset.summary.median_m.toFixed(1) + " m (median over 40 intact gold pairs; grayscale Hann-window phase correlation). See [measurement and spread](overlay/offset-measurement.json).",
    "- Live simulation only: Damaged work tiles use private destroyed truth at hard difficulty. Possibly damaged work tiles keep a shared 50/50 private truth at hard difficulty. This assumption generates votes only; it does not supply ledger labels, change decide(), or enter published benchmark metrics.",
    "- The video seed and six buildings were searched for illustrative outcomes. Its counts must not be used as an accuracy estimate. The benchmark remains gold-only and unchanged.",
    "- Work grades Damaged and Possibly damaged cannot establish binary destroyed/intact accuracy or agreement. AI labels by expert grade are descriptive only.",
    "", "## Provenance and regeneration", "",
    "`npm run report` replays the recorded video ledger and regenerates this report, its JSON manifest, both GeoJSON files and the README table. `npm run verify` checks live, benchmark and video hash chains, replays votes and compares published artifacts. `reports/latest.json` remains the independently verified benchmark; `reports/latest.md` is this human-readable mission companion. AI numbers are recomputed from the recorded API predictions against mission gold, not from the simulation.",
    "", "Attribution: " + collections.validated.attribution, "",
  ].join("\n");
  return { files: { [base + "-validated.geojson"]: json(collections.validated), [base + "-refused.geojson"]: json(collections.refused),
    [base + ".json"]: json(manifest), [base + ".md"]: markdown, "reports/latest.md": markdown }, table };
}
const start = "<!-- MISSION-NUMBERS:START -->", end = "<!-- MISSION-NUMBERS:END -->";
export function writeMissionReport(runId: string) {
  const result = renderArtifacts(readVideoEvents(), runId);
  mkdirSync("reports", { recursive: true });
  for (const [path, content] of Object.entries(result.files)) writeFileSync(path, content);
  const readme = readFileSync("README.md", "utf8");
  const section = start + "\n" + result.table + "\n" + end;
  writeFileSync("README.md", readme.includes(start) ? readme.replace(/<!-- MISSION-NUMBERS:START -->[\s\S]*?<!-- MISSION-NUMBERS:END -->/, section) : readme + "\n\n" + section + "\n");
  new Ledger(VIDEO_LEDGER_PATH).append("export_written", { runId,
    files: Object.fromEntries(Object.entries(result.files).map(([path, content]) => [path, hash(content)])) }, Date.now());
}
export function verifyMissionReport() {
  if (!existsSync(base + ".json")) throw new Error("Mission report missing; complete demo:video first.");
  const manifest = readJson<{ runId: string }>(base + ".json");
  const events = readVideoEvents();
  const result = renderArtifacts(events, manifest.runId);
  const exported = [...events].reverse().find((event) => event.type === "export_written" && event.data.runId === manifest.runId);
  const hashes = exported?.data.files as Record<string, string> | undefined;
  for (const [path, content] of Object.entries(result.files)) {
    if (readFileSync(path, "utf8") !== content || hashes?.[path] !== hash(content)) throw new Error("Mission artifact differs from ledger replay: " + path);
  }
  if (!readFileSync("README.md", "utf8").includes(start + "\n" + result.table + "\n" + end)) throw new Error("README headline differs from measurements.");
  return events.length;
}
