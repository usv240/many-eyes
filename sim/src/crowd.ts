import { seededRng } from "../../server/src/missions/mission.js";
import type { Truth } from "../../server/src/consensus/engine.js";
import type { VoteLabel } from "../../server/src/votes/parse.js";

export interface CrowdConfig {
  seed: number; voters: number; trollFraction?: number; lurkerFraction?: number; unsureRate?: number;
}
export interface Voter {
  userId: string; sensitivity: number; specificity: number; troll: boolean; lurker: boolean; unsureRate: number;
}
export interface SimVote { messageId: string; userId: string; label: VoteLabel; delayMs: number }
function probability(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Fraction must be between zero and one.");
  return value;
}
function normal(rng: () => number, mean: number, deviation: number) {
  const draw = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return Math.max(0.5, Math.min(0.99, mean + deviation * draw));
}
export function createCrowd(config: CrowdConfig): Voter[] {
  if (!Number.isInteger(config.voters) || config.voters < 0) throw new Error("Invalid voter count.");
  const trolls = Math.round(probability(config.trollFraction ?? 0) * config.voters);
  const lurkers = Math.round(probability(config.lurkerFraction ?? 0) * config.voters);
  const unsureRate = probability(config.unsureRate ?? 0.05);
  const rng = seededRng(config.seed);
  const order = Array.from({ length: config.voters }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(rng() * (index + 1));
    [order[index], order[other]] = [order[other]!, order[index]!];
  }
  const trollIds = new Set(order.slice(0, trolls));
  // Lurkers are sampled independently of troll assignment.
  const lurkerIds = new Set<number>();
  const available = Array.from({ length: config.voters }, (_, index) => index);
  for (let count = 0; count < lurkers; count++) {
    const index = Math.floor(rng() * available.length);
    lurkerIds.add(available.splice(index, 1)[0]!);
  }
  return Array.from({ length: config.voters }, (_, index) => ({
    userId: "sim_" + String(index + 1).padStart(4, "0"),
    sensitivity: normal(rng, 0.78, 0.08), specificity: normal(rng, 0.97, 0.03),
    troll: trollIds.has(index), lurker: lurkerIds.has(index), unsureRate,
  }));
}

/** Work-tile truth is a private, single Bernoulli draw shared by the crowd, never expert ground truth. */
export function simulateVotes(crowd: readonly Voter[], truth: Truth | "damaged" | "possibly damaged",
  seed: number, tileId: string): SimVote[] {
  const rng = seededRng(seed);
  const actual: Truth = truth === "destroyed" || truth === "intact" ? truth : rng() < 0.5 ? "destroyed" : "intact";
  const votes: SimVote[] = [];
  for (const voter of crowd) {
    if (voter.lurker) continue;
    let label: VoteLabel;
    if (voter.troll) label = (["destroyed", "intact", "unsure"] as const)[Math.floor(rng() * 3)]!;
    else if (rng() < voter.unsureRate) label = "unsure";
    else {
      const correct = rng() < (actual === "destroyed" ? voter.sensitivity : voter.specificity);
      label = correct ? actual : actual === "destroyed" ? "intact" : "destroyed";
    }
    votes.push({ messageId: tileId + ":" + voter.userId, userId: voter.userId, label, delayMs: Math.floor(rng() * 15000) });
  }
  return votes.sort((left, right) => left.delayMs - right.delayMs || left.userId.localeCompare(right.userId));
}
