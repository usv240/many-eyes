import { readFileSync } from "node:fs";
import { z } from "zod";
import { createLive } from "../live.js";
import { Ledger } from "../ledger/ledger.js";
import { writeMissionReport, VIDEO_LEDGER_PATH } from "../exports/report.js";

export function readVideoPlan() {
  return z.object({ missionId: z.string(), seed: z.number().int(), voters: z.number().int().positive(),
    votingMs: z.literal(8000), pauseMs: z.literal(3000),
    tiles: z.array(z.object({ buildingId: z.string(), reason: z.string().min(1) })).length(6),
  }).parse(JSON.parse(readFileSync("scripts/video-plan.json", "utf8")));
}
export function createVideoLive() {
  const plan = readVideoPlan();
  return createLive({ env: { MANY_EYES_SOURCE: "sim", MANY_EYES_SEED: String(plan.seed) },
    ledger: new Ledger(VIDEO_LEDGER_PATH), runnerOptions: { missionId: plan.missionId,
      crowd: { voters: plan.voters }, fixedTiles: plan.tiles.map((tile) => tile.buildingId),
      votingMs: plan.votingMs, pauseMs: plan.pauseMs, pauseAfterLast: true, gradedWork: true, video: true },
    onComplete: (runId) => { writeMissionReport(runId); console.log("Video complete; ledger-derived GeoJSON and mission report written."); } });
}
