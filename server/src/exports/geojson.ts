import { z } from "zod";
import { getMission } from "../missions/mission.js";
import { LedgerReplay } from "../ledger/replay.js";
import type { LedgerEvent } from "../ledger/ledger.js";
import type { Decision } from "../consensus/engine.js";

const point = z.object({ type: z.literal("Point"), coordinates: z.tuple([
  z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90),
]) });
export const geojsonSchema = z.object({ type: z.literal("FeatureCollection"), attribution: z.string(),
  source: z.literal("simulated crowd"), runId: z.string(),
  features: z.array(z.object({ type: z.literal("Feature"), geometry: point,
    properties: z.object({ building_id: z.string(), label: z.enum(["destroyed", "intact"]).nullable(),
      agreement: z.number().min(0).max(1), voters: z.number().int().min(0), decided_at: z.string().datetime(),
      gold: z.boolean(), ai_label: z.enum(["destroyed", "intact"]).nullable(),
      reason: z.enum(["low_agreement", "too_few_voters"]).optional() }) })) });

/** Replay all accepted votes before exporting any recorded decision. No cache labels become crowd labels. */
export function exportMission(events: readonly LedgerEvent[], runId: string) {
  const replay = new LedgerReplay();
  for (const event of events) replay.accept(event);
  const start = events.find((event) => event.type === "mission_started" && event.data.runId === runId);
  if (!start || start.data.source !== "sim") throw new Error("Expected a recorded simulated mission.");
  const mission = getMission(String(start.data.missionId));
  const decisions = events.filter((event) => event.type === "tile_decided" && event.data.runId === runId);
  const expected = start.data.fixedTiles as string[] | undefined;
  if (expected && (decisions.length !== expected.length || decisions.some((e, i) => e.data.buildingId !== expected[i])))
    throw new Error("Cannot export an incomplete scripted mission.");
  // One point per building, using its latest replay-checked decision in this run.
  const latest = new Map(decisions.map((event) => [String(event.data.buildingId), event]));
  const groups = { validated: [] as unknown[], refused: [] as unknown[] };
  for (const [buildingId, event] of latest) {
    const building = mission.buildings.find((item) => item.id === buildingId);
    if (!building) throw new Error("Unknown export building.");
    const result = event.data.weighted as Decision;
    groups[result.status].push({ type: "Feature", geometry: { type: "Point", coordinates: [building.lon, building.lat] },
      properties: { building_id: buildingId, label: result.label, agreement: result.agreement, voters: result.voters,
        decided_at: new Date(event.timestamp).toISOString(), gold: !!event.data.truth, ai_label: event.data.model_label ?? null,
        ...(result.reason ? { reason: result.reason } : {}) } });
  }
  const collection = (features: unknown[]) => geojsonSchema.parse({ type: "FeatureCollection", attribution: mission.attribution,
    source: "simulated crowd", runId, features });
  return { validated: collection(groups.validated), refused: collection(groups.refused) };
}
