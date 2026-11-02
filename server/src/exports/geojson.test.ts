import { expect, it } from "vitest";
import { MemoryLedger } from "../ledger/ledger.js";
import { MissionRunner } from "../runner/mission-runner.js";
import { readVideoPlan } from "../runner/video.js";
import { getMission } from "../missions/mission.js";
import { exportMission, geojsonSchema } from "./geojson.js";

it("exports replayed decisions as RFC 7946 Point FeatureCollections in longitude/latitude order", async () => {
  const plan = readVideoPlan(), ledger = new MemoryLedger();
  const runner = new MissionRunner({ missionId: plan.missionId, source: "sim", seed: plan.seed, virtual: true,
    ledger, fixedTiles: plan.tiles.map((tile) => tile.buildingId), gradedWork: true, video: true });
  await runner.run();
  const result = exportMission(ledger.events, runner.runId);
  expect(result.validated.features).toHaveLength(5); expect(result.refused.features).toHaveLength(1);
  for (const collection of Object.values(result)) {
    expect(geojsonSchema.safeParse(collection).success).toBe(true);
    expect(collection.type).toBe("FeatureCollection");
    for (const feature of collection.features) {
      const building = getMission(plan.missionId).buildings.find((item) => item.id === feature.properties.building_id)!;
      expect(feature.geometry.coordinates).toEqual([building.lon, building.lat]);
      expect(feature.geometry.coordinates.every(Number.isFinite)).toBe(true);
    }
  }
  const broken = structuredClone(ledger.events);
  const decision = broken.find((event) => event.type === "tile_decided")!;
  (decision.data.weighted as { label: string }).label = "intact";
  expect(() => exportMission(broken, runner.runId)).toThrow(/replay/);
  expect(() => exportMission(ledger.events.slice(0, 4), runner.runId)).toThrow(/incomplete/);
  expect(result.refused.features[0]!.properties.reason).toBe("low_agreement");
});
