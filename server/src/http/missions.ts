import type { FastifyInstance } from "fastify";
import { getMission, listMissions } from "../missions/mission.js";
import { cropMissionBuilding } from "../tiles/crop.js";

type Cropper = typeof cropMissionBuilding;
function sceneSummary(scene: { title: string; acquired: string }) {
  return { title: scene.title, date: scene.acquired };
}
function missionSummary(id: string, includeBuildings: boolean) {
  const mission = getMission(id);
  return {
    id: mission.id, name: mission.name, event_date: mission.event_date,
    attribution: mission.attribution,
    pre_scene: sceneSummary(mission.pre_scene), post_scene: sceneSummary(mission.post_scene),
    ...(includeBuildings ? { buildings: mission.buildings.map(({ id: buildingId, lon, lat, building_type }) =>
      ({ id: buildingId, lon, lat, building_type })) } : {}),
  };
}

export async function registerMissionRoutes(app: FastifyInstance, cropper: Cropper = cropMissionBuilding) {
  app.get("/api/missions", async (_request, reply) => {
    return reply.send(listMissions().map((mission) => missionSummary(mission.id, false)));
  });
  app.get<{ Params: { id: string } }>("/api/missions/:id", async (request, reply) => {
    try { return reply.send(missionSummary(request.params.id, true)); }
    catch { return reply.code(404).send({ error: "Mission not found." }); }
  });
  app.get<{ Params: { id: string; buildingId: string } }>(
    "/api/missions/:id/tiles/:buildingId", async (request, reply) => {
      let mission: ReturnType<typeof getMission>;
      try {
        mission = getMission(request.params.id);
      } catch { return reply.code(404).send({ error: "Mission not found." }); }
      if (!mission.buildings.some(({ id }) => id === request.params.buildingId))
        return reply.code(404).send({ error: "Building not found." });
      try {
        const crops = await cropper(request.params.id, request.params.buildingId);
        return reply.send({
          pre: "data:image/jpeg;base64," + crops.pre.image.toString("base64"),
          post: "data:image/jpeg;base64," + crops.post.image.toString("base64"),
          attribution: mission.attribution,
          zoom: crops.zoom, sizePx: crops.sizePx, lat: crops.lat,
          scenes: { pre: sceneSummary(crops.pre.scene), post: sceneSummary(crops.post.scene) },
        });
      } catch {
        return reply.code(502).send({ error: "Imagery is currently unavailable." });
      }
    });
}
