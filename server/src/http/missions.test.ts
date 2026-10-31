import Fastify from "fastify";
import { expect, it } from "vitest";
import { getMission } from "../missions/mission.js";
import { registerMissionRoutes } from "./missions.js";
import type { BuildingCrops } from "../tiles/crop.js";

async function appForTest() {
  const app = Fastify();
  await registerMissionRoutes(app, async (missionId, buildingId) => {
    const mission = getMission(missionId);
    const selected = mission.buildings.find(({ id }) => id === buildingId)!;
    const crop = (scene: typeof mission.pre_scene) => ({ image: Buffer.from("recorded-jpeg"),
      scene, usedFallback: false });
    void selected;
    return { pre: crop(mission.pre_scene), post: crop(mission.post_scene) } satisfies BuildingCrops;
  });
  return app;
}
it("lists and loads missions without grading or gold information", async () => {
  const app = await appForTest();
  try {
    const list = await app.inject("/api/missions");
    const detail = await app.inject("/api/missions/nepal-flood-2026");
    for (const response of [list, detail]) {
      const body = response.json();
      expect(JSON.stringify(body)).not.toMatch(/expert_grade|gold|truth|source|Destroyed|Possibly damaged/);
    }
    expect(detail.json().buildings).toHaveLength(190);
  } finally { await app.close(); }
});
it("returns tile data URLs and imagery attribution without expert fields or gold labels", async () => {
  const app = await appForTest();
  try {
    const response = await app.inject("/api/missions/nepal-flood-2026/tiles/cems-0003");
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.pre).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.post).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.attribution).toContain("Copernicus Emergency Management Service");
    expect(JSON.stringify(body)).not.toMatch(/expert_grade|gold|truth|Destroyed/);
  } finally { await app.close(); }
});
