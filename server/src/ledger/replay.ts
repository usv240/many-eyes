import { isDeepStrictEqual } from "node:util";
import { openSession, closeSession, collectVote, decide, decideUnweighted, updateGoldWeights, type TileSession } from "../consensus/engine.js";
import type { DecidedGold } from "../consensus/metrics.js";
import type { VoteLabel } from "../votes/parse.js";
import { goldTruth } from "../missions/mission.js";
import type { LedgerEvent } from "./ledger.js";

interface Run {
  missionId: string; weights: Map<string, number>; seen: Set<string>; gold: DecidedGold[];
  session?: TileSession; buildingId?: string;
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
      this.runs.set(runId, { missionId: String(data.missionId), weights: new Map(), seen: new Set(), gold: [] });
      return;
    }
    const run = this.runs.get(runId);
    if (!run) throw new Error("Ledger event has no mission_started.");
    if (event.type === "tile_opened") {
      if (run.session && !run.session.closed) throw new Error("Previous tile was not decided.");
      run.session = openSession(String(data.id), Number(data.openedAt));
      run.buildingId = String(data.buildingId);
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
      if (truth) {
        run.gold.push({ truth, weighted, unweighted });
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
}
