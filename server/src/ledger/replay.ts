import { isDeepStrictEqual } from "node:util";
import { openSession, closeSession, collectVote, decide, decideUnweighted, updateGoldWeights, type TileSession } from "../consensus/engine.js";
import type { DecidedGold } from "../consensus/metrics.js";
import type { VoteLabel } from "../votes/parse.js";
import { goldTruth, getMission } from "../missions/mission.js";
import { liveScenario } from "../runner/scenario.js";
import { createCrowd, createTileScenario, type TileDifficulty } from "../../../sim/src/crowd.js";
import type { LedgerEvent } from "./ledger.js";

interface Run {
  missionId: string; weights: Map<string, number>; seen: Set<string>; gold: DecidedGold[];
  session?: TileSession; buildingId?: string;
  seed: number; source: string; crowd: Record<string, unknown>; tileNumber: number;
  simulationPolicy?: string;
  individual: { correct: number; classified: number; total: number };
  voterScores: Map<string, { correct: number; classified: number; total: number }>;
}
/** Rebuild decisions from accepted vote events and gold updates, never trust recorded scores. */
export class LedgerReplay {
  private runs = new Map<string, Run>();
  accept(event: LedgerEvent) {
    const data = event.data;
    const runId = String(data.runId);
    if (event.type === "export_written") return;
    if (event.type === "mission_started") {
      if (this.runs.has(runId)) throw new Error("Duplicate run ID in ledger.");
      this.runs.set(runId, { missionId: String(data.missionId), weights: new Map(), seen: new Set(), gold: [],
        seed: Number(data.seed ?? 1), source: String(data.source), crowd: (data.crowd ?? {}) as Record<string, unknown>,
        simulationPolicy: data.simulationPolicy as string | undefined,
        tileNumber: 0, individual: { correct: 0, classified: 0, total: 0 }, voterScores: new Map() });
      return;
    }
    const run = this.runs.get(runId);
    if (!run) throw new Error("Ledger event has no mission_started.");
    if (event.type === "tile_opened") {
      if (run.session && !run.session.closed) throw new Error("Previous tile was not decided.");
      run.session = openSession(String(data.id), Number(data.openedAt), Number(data.closesAt) - Number(data.openedAt));
      run.buildingId = String(data.buildingId);
      run.tileNumber = Number(data.number);
    } else if (event.type === "vote") {
      const messageId = String(data.messageId); const userId = String(data.userId);
      const weight = run.weights.get(userId) ?? 1;
      if (!run.session || run.session.id !== data.tileId || run.seen.has(messageId) || data.weight !== weight)
        throw new Error("Invalid or duplicate ledger vote.");
      run.seen.add(messageId);
      const next = collectVote(run.session, { userId, label: data.label as VoteLabel, weight }, Number(data.receivedAt));
      if (next === run.session) throw new Error("Out-of-window ledger vote.");
      run.session = next;
    } else if (event.type === "tile_decided") {
      if (!run.session || run.session.closed || run.session.id !== data.tileId || run.buildingId !== data.buildingId)
        throw new Error("Decision does not match an open tile.");
      run.session = closeSession(run.session, event.timestamp);
      const weighted = decide(run.session); const unweighted = decideUnweighted(run.session);
      if (!isDeepStrictEqual(data.session, run.session) || !isDeepStrictEqual(data.weighted, weighted) ||
          !isDeepStrictEqual(data.unweighted, unweighted)) throw new Error("Recorded decision does not match replay.");
      const truth = goldTruth(run.buildingId!, run.missionId);
      if ((data.truth ?? null) !== truth) throw new Error("Recorded gold truth does not match the mission.");
      let difficulty: TileDifficulty | undefined;
      if (run.source === "sim" && data.difficulty !== undefined) {
        if (!truth) {
          const seed = run.seed ^ Math.imul(run.tileNumber, 0x9e3779b1);
          const grade = getMission(run.missionId).buildings.find((b) => b.id === run.buildingId)!.expert_grade;
          const scenario = run.simulationPolicy === "graded-work-v1"
            ? liveScenario(seed, null, grade, Number(run.crowd.raidProbability ?? 0.25))
            : createTileScenario(seed, "possibly damaged", Number(run.crowd.raidProbability ?? 0.25));
          difficulty = scenario.difficulty;
        } else {
          difficulty = createTileScenario(run.seed ^ Math.imul(run.tileNumber, 0x9e3779b1), truth,
            Number(run.crowd.raidProbability ?? 0.25)).difficulty;
        }
        if (data.difficulty !== difficulty) throw new Error("Recorded tile difficulty does not match replay.");
      }
      if (truth) {
        run.gold.push({ truth, weighted, unweighted, ...(difficulty ? { difficulty } : {}) });
        const voterCount = Number(run.crowd.voters ?? 10);
        const voterConfig = { ...run.crowd, seed: run.seed, voters: voterCount } as Parameters<typeof createCrowd>[0];
        const honest = createCrowd(voterConfig).filter((voter) => !voter.troll).map((voter) => voter.userId);
        run.individual.total += honest.length;
        for (const userId of honest) {
          let score = run.voterScores.get(userId);
          if (!score) { score = { correct: 0, classified: 0, total: 0 }; run.voterScores.set(userId, score); }
          score.total++;
        }
        for (const vote of run.session.votes) {
          if (!honest.includes(vote.userId) || vote.label === "unsure") continue;
          run.individual.classified++;
          const score = run.voterScores.get(vote.userId);
          if (!score) throw new Error("Honest voter score was not initialized.");
          score.classified++;
          if (vote.label === truth) { run.individual.correct++; score.correct++; }
        }
        run.weights = updateGoldWeights(run.weights, run.session, truth);
      }
    } else if (event.type === "weight_updated") {
      if (run.weights.get(String(data.userId)) !== data.weight) throw new Error("Recorded weight does not match replay.");
    }
  }
  gold(runId: string): readonly DecidedGold[] {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Report references an unknown run.");
    return run.gold;
  }
  individual(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Report references an unknown run.");
    const voters = [...run.voterScores].map(([userId, score]) => ({ userId, ...score,
      accuracy: score.classified ? score.correct / score.classified : null })).sort((a, b) => a.userId.localeCompare(b.userId));
    return { ...run.individual, voters,
      accuracy: run.individual.classified ? run.individual.correct / run.individual.classified : null,
      coverage: run.individual.total ? run.individual.classified / run.individual.total : null };
  }
}
