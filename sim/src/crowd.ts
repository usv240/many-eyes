import { seededRng } from "../../server/src/missions/mission.js";
import type { Truth } from "../../server/src/consensus/engine.js";
import type { VoteLabel } from "../../server/src/votes/parse.js";

export interface CrowdConfig {
  seed: number; voters: number; trollFraction?: number; lurkerFraction?: number; unsureRate?: number;
  hardAccuracyMultiplier?: number; raidProbability?: number;
}
export const DIFFICULTY = { easy: 0.65, hard: 0.25, misleading: 0.1 } as const;
export type TileDifficulty = keyof typeof DIFFICULTY;
export type TrollStrategy = "always_wrong" | "raid";
export interface Voter {
  userId: string; sensitivity: number; specificity: number; troll: boolean; trollStrategy: TrollStrategy | null;
  lurker: boolean; unsureRate: number;
}
export interface SimVote { messageId: string; userId: string; label: VoteLabel; delayMs: number }
export interface TileScenario { actual: Truth; difficulty: TileDifficulty; raid: boolean; raidDelay: number }
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
  const alwaysWrong = new Set(order.slice(0, Math.ceil(trolls / 3)));
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
    troll: trollIds.has(index), trollStrategy: !trollIds.has(index) ? null :
      alwaysWrong.has(index) ? "always_wrong" : "raid",
    lurker: lurkerIds.has(index), unsureRate,
  }));
}

export function createTileScenario(seed: number, truth: Truth | "damaged" | "possibly damaged",
  raidProbability = 0.25): TileScenario {
  const rng = seededRng(seed);
  const actual = truth === "destroyed" || truth === "intact" ? truth : rng() < 0.5 ? "destroyed" : "intact";
  const draw = rng();
  const difficulty: TileDifficulty = draw < DIFFICULTY.easy ? "easy" :
    draw < DIFFICULTY.easy + DIFFICULTY.hard ? "hard" : "misleading";
  const raid = rng() < probability(raidProbability);
  return { actual, difficulty, raid, raidDelay: Math.floor(rng() * 15000) };
}

/** Work-tile truth is a private, single Bernoulli draw shared by the crowd, never expert ground truth. */
export function simulateVotes(crowd: readonly Voter[], truth: Truth | "damaged" | "possibly damaged",
  seed: number, tileId: string, options: Pick<CrowdConfig,
    "hardAccuracyMultiplier" | "raidProbability"> & { scenario?: TileScenario } = {}): SimVote[] {
  const rng = seededRng(seed);
  const scenario = options.scenario ?? createTileScenario(seed, truth, options.raidProbability);
  const { actual, difficulty, raid, raidDelay } = scenario;
  const accuracyMultiplier = probability(options.hardAccuracyMultiplier ?? 0.5);
  // Consume the same tile-level draws before voter draws, keeping the stream deterministic.
  if (truth !== "destroyed" && truth !== "intact") rng();
  rng(); rng(); rng();
  const votes: SimVote[] = [];
  for (const voter of crowd) {
    if (voter.lurker) continue;
    let label: VoteLabel;
    if (raid && voter.trollStrategy === "raid") {
      label = "destroyed";
      votes.push({ messageId: tileId + ":" + voter.userId, userId: voter.userId, label, delayMs: raidDelay });
      continue;
    } else if (voter.trollStrategy === "always_wrong") {
      label = actual === "destroyed" ? "intact" : "destroyed";
    } else if (rng() < voter.unsureRate) label = "unsure";
    else {
      let correctChance = actual === "destroyed" ? voter.sensitivity : voter.specificity;
      if (difficulty === "hard") correctChance = 0.5 + (correctChance - 0.5) * accuracyMultiplier;
      if (difficulty === "misleading") correctChance = 1 - correctChance;
      const correct = rng() < correctChance;
      label = correct ? actual : actual === "destroyed" ? "intact" : "destroyed";
    }
    votes.push({ messageId: tileId + ":" + voter.userId, userId: voter.userId, label, delayMs: Math.floor(rng() * 15000) });
  }
  return votes.sort((left, right) => left.delayMs - right.delayMs || left.userId.localeCompare(right.userId));
}
