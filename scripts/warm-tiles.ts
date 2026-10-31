import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cropMissionBuilding } from "../server/src/tiles/crop.js";
import { getMission } from "../server/src/missions/mission.js";

const missionId = process.argv[2];
if (!missionId) throw new Error("Usage: npm run tiles:warm -- <mission-id>");
const mission = getMission(missionId);
const outputRoot = join(process.cwd(), "data", "cache", "crops", missionId);
let failures = 0;
for (let index = 0; index < mission.buildings.length; index++) {
  const buildingId = mission.buildings[index]!.id;
  try {
    const crop = await cropMissionBuilding(missionId, buildingId);
    const directory = join(outputRoot, buildingId);
    await mkdir(directory, { recursive: true });
    await Promise.all([writeFile(join(directory, "pre.jpg"), crop.pre.image),
      writeFile(join(directory, "post.jpg"), crop.post.image)]);
  } catch {
    failures++;
    console.log("[" + (index + 1) + "/" + mission.buildings.length + "] failed " + buildingId);
    continue;
  }
  console.log("[" + (index + 1) + "/" + mission.buildings.length + "] cached " + buildingId);
}
console.log("Finished " + mission.buildings.length + " buildings; failures: " + failures + ".");
if (failures) process.exitCode = 1;
