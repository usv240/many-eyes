import type { FastifyInstance } from "fastify";
import { getMission, listMissions } from "../missions/mission.js";
import { cropMissionBuilding } from "../tiles/crop.js";

type Resolver = { resolveTile(token: string): { missionId: string; buildingId: string } | undefined };
function sceneSummary(scene: { title: string; acquired: string }) {
  return { title: scene.title, date: scene.acquired };
}
function missionSummary(id: string) {
  const mission = getMission(id);
  return { id: mission.id, name: mission.name, event_date: mission.event_date, attribution: mission.attribution,
    total: mission.buildings.length, pre_scene: sceneSummary(mission.pre_scene), post_scene: sceneSummary(mission.post_scene) };
}
export async function registerMissionRoutes(app: FastifyInstance, tiles: Resolver,
  cropper: typeof cropMissionBuilding = cropMissionBuilding) {
  app.get("/api/missions", async () => listMissions().map((mission) => missionSummary(mission.id)));
  app.get<{ Params: { id: string } }>("/api/missions/:id", async (request, reply) => {
    try { return reply.send(missionSummary(request.params.id)); }
    catch { return reply.code(404).send({ error: "Mission not found." }); }
  });
  // Raw building IDs and inventory coordinates are deliberately not exposed by any HTTP route.
  app.get<{ Params: { token: string } }>("/api/tiles/:token", async (request, reply) => {
    const tile = /^[a-f0-9]{12}$/.test(request.params.token) ? tiles.resolveTile(request.params.token) : undefined;
    if (!tile) return reply.code(404).send({ error: "Tile not found." });
    try {
      const mission = getMission(tile.missionId);
      const crops = await cropper(tile.missionId, tile.buildingId);
      return reply.send({ pre: "data:image/jpeg;base64," + crops.pre.image.toString("base64"),
        post: "data:image/jpeg;base64," + crops.post.image.toString("base64"), attribution: mission.attribution,
        zoom: crops.zoom, sizePx: crops.sizePx, lat: crops.lat,
        scenes: { pre: sceneSummary(crops.pre.scene), post: sceneSummary(crops.post.scene) } });
    } catch { return reply.code(502).send({ error: "Imagery is currently unavailable." }); }
  });
}
