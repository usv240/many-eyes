import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getMission } from "../server/src/missions/mission.js";
import { DEFAULT_MODEL, PROMPT_VERSION, generateDebate } from "../server/src/debate/agents.js";
import { cropHashes, readCachedDebate, publicDebate } from "../server/src/debate/cache.js";

const mission = getMission("nepal-flood-2026");
const requestedModel = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("Missing required environment variable: OPENAI_API_KEY");
const selected = process.argv[2];
const buildings = selected ? mission.buildings.filter((b) => b.id === selected) : mission.buildings;
if (!buildings.length) throw new Error("Unknown building for debate warmup.");
await mkdir("data/cache/debate", { recursive: true });
let cursor = 0; let failures = 0; let skipped = 0; let generated = 0;
async function worker() {
  while (cursor < buildings.length) {
    const building = buildings[cursor++]!;
    const cached = readCachedDebate(building.id);
    if (cached && cached.requestedModel === requestedModel) { skipped++; continue; }
    const directory = join("data/cache/crops", mission.id, building.id);
    try {
      const [pre, post] = await Promise.all([readFile(join(directory, "pre.jpg")), readFile(join(directory, "post.jpg"))]);
      const result = await generateDebate(pre, post, { model: requestedModel,
        onFailure: (reason) => console.log(building.id + ": " + reason) });
      if (!result) { failures++; continue; }
      await writeFile(join("data/cache/debate", building.id + ".json"), JSON.stringify({
        ...result, requestedModel, promptVersion: PROMPT_VERSION, createdAt: new Date().toISOString(), cropHashes: cropHashes(pre, post),
      }, null, 2) + "\n");
      generated++; console.log("[" + (generated + skipped + failures) + "/" + buildings.length + "] cached " + building.id + " (" + result.model + ")");
    } catch { failures++; console.log(building.id + ": could not read crops or write cache"); }
  }
}
await Promise.all(Array.from({ length: Math.min(4, buildings.length) }, worker));
const fixture = readCachedDebate("cems-0052");
if (fixture) await writeFile("overlay/src/debate-fixture.ts",
  "// Public claims/boxes from the real cems-0052 cache; no baseline label or confidence.\nexport const debateFixture = " +
  JSON.stringify(publicDebate(fixture.debate), null, 2) + ";\n");
console.log(`Debates: generated ${generated}, skipped ${skipped}, failures ${failures}.`);
if (failures) process.exitCode = 1;
