/**
 * Builds the website's data from the repo's own artifacts: six real hidden-check tiles for the
 * "judge it yourself" section, three downloadable vote datasets, report downloads and overlay
 * screenshots. Run with: npm run site:data
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { getMission } from "../server/src/missions/mission.js";
import { createCrowd, createTileScenario, simulateVotes } from "../sim/src/crowd.js";
import { openApiDocument } from "../server/src/api/openapi.js";

const missionId = "nepal-flood-2026";
const mission = getMission(missionId);
const out = "site/public";
for (const dir of ["tiles", "downloads", "img"]) mkdirSync(join(out, dir), { recursive: true });
mkdirSync(join(out, "data"), { recursive: true });

const truthOf = new Map(mission.gold.map((gold) => [gold.building_id, gold.truth as "destroyed" | "intact"]));
const building = (id: string) => mission.buildings.find((item) => item.id === id)!;
const voteDigit = { destroyed: "1", intact: "2", unsure: "3" } as const;

// Six hidden checks: three destroyed, three standing, including one the AI got wrong.
const picks = ["cems-0052", "osm-w850782564", "cems-0121", "osm-w1554274567", "cems-0016", "osm-w854385662"];
const toPercent = (box: number[]) => box.map((value) => Math.round(value / 384 * 1000) / 10);
const tiles = picks.map((id) => {
  const truth = truthOf.get(id);
  if (!truth) throw new Error(id + " is not a hidden check");
  const cached = JSON.parse(readFileSync(`data/cache/debate/${id}.json`, "utf8")) as {
    debate: { advocate: { claim: string; box: number[] }; skeptic: { claim: string; box: number[] }; model_label: string; confidence: number }; model: string };
  for (const kind of ["pre", "post"]) copyFileSync(`data/cache/crops/${missionId}/${id}/${kind}.jpg`, join(out, "tiles", `${id}-${kind}.jpg`));
  const b = building(id);
  return { id, truth, lat: Number(b.lat.toFixed(4)), lon: Number(b.lon.toFixed(4)), grade: b.expert_grade,
    ai: { label: cached.debate.model_label, confidence: cached.debate.confidence, model: cached.model },
    advocate: { claim: cached.debate.advocate.claim, box: toPercent(cached.debate.advocate.box) },
    skeptic: { claim: cached.debate.skeptic.claim, box: toPercent(cached.debate.skeptic.box) } };
});
writeFileSync(join(out, "data", "tiles.json"), JSON.stringify(tiles, null, 2) + "\n");

// Dataset 1: the recorded six-tile run from data/video-ledger.jsonl, exactly as the engine saw it.
const csvHeader = "tile_id,user_id,vote,truth,lon,lat";
const rows: string[] = [csvHeader];
const opened = new Map<string, string>();
for (const line of readFileSync("data/video-ledger.jsonl", "utf8").split("\n").filter(Boolean)) {
  const event = JSON.parse(line) as { type: string; data: Record<string, unknown> };
  if (event.type === "tile_opened") opened.set(String(event.data.id), String(event.data.buildingId));
  if (event.type === "vote") {
    const id = opened.get(String(event.data.tileId))!; const b = building(id);
    rows.push([id, event.data.userId, voteDigit[event.data.label as keyof typeof voteDigit], truthOf.get(id) ?? "", b.lon, b.lat].join(","));
  }
}
writeFileSync(join(out, "downloads", "recorded-run.csv"), rows.join("\n") + "\n");

// Datasets 2 and 3: seeded simulations. Truth is filled only for the hidden checks; the rest are work tiles.
function simulated(file: string, seed: number, voters: number, trollFraction: number, tileCount: number, checks: number) {
  const crowd = createCrowd({ seed, voters, trollFraction });
  const gold = mission.gold.slice(0, tileCount);
  const lines = [csvHeader];
  gold.forEach((item, index) => {
    const truth = item.truth as "destroyed" | "intact";
    const tileSeed = seed * 1000 + index;
    const votes = simulateVotes(crowd, truth, tileSeed, item.building_id, { scenario: createTileScenario(tileSeed, truth) });
    const b = building(item.building_id);
    for (const vote of votes) lines.push([item.building_id, vote.userId, voteDigit[vote.label], index < checks ? truth : "", b.lon, b.lat].join(","));
  });
  writeFileSync(join(out, "downloads", file), lines.join("\n") + "\n");
}
simulated("troll-raid.csv", 11, 10, 0.3, 24, 16);
simulated("small-stream.csv", 5, 5, 0.2, 12, 6);

for (const [from, to] of [["reports/nepal-flood-2026-validated.geojson", "nepal-flood-2026-validated.geojson"],
  ["reports/nepal-flood-2026-refused.geojson", "nepal-flood-2026-refused.geojson"], ["reports/nepal-flood-2026.md", "mission-report.md"],
  ["reports/bench.md", "benchmark.md"], ["reports/ai-alone.json", "ai-alone.json"]] as const) copyFileSync(from, join(out, "downloads", to));
writeFileSync(join(out, "downloads", "openapi.json"), JSON.stringify(openApiDocument, null, 2) + "\n");

const shots: [string, string, number][] = [["reports/overlay/phase5-live.png", "overlay-live.jpg", 1600],
  ["reports/overlay/video-10s.png", "overlay-result.jpg", 1600], ["reports/overlay/crop-sheet.png", "crop-sheet.jpg", 1400]];
for (const [from, to, width] of shots) await sharp(from).resize({ width }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(out, "img", to));
console.log("Site data written: " + tiles.length + " tiles, 3 datasets, " + shots.length + " screenshots.");
