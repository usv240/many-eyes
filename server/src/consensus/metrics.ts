import type { Decision, Truth } from "./engine.js";

export interface DecidedGold { truth: Truth; weighted: Decision; unweighted: Decision }
export interface Metrics {
  total: number; validated: number; correct: number; refused: number;
  intactGold: number; destroyedGold: number; falseDestroyed: number; falseIntact: number;
  votes: number; accuracy: number | null; falseDestroyedRate: number | null;
  falseIntactRate: number | null; refusalRate: number | null; coverage: number | null; votesPerTile: number | null;
}
const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
export function metrics(tiles: readonly DecidedGold[], method: "weighted" | "unweighted"): Metrics {
  let validated = 0; let correct = 0; let falseDestroyed = 0; let falseIntact = 0;
  let intactGold = 0; let destroyedGold = 0; let votes = 0;
  for (const tile of tiles) {
    const decision = tile[method];
    votes += decision.totalVotes;
    if (tile.truth === "intact") intactGold++; else destroyedGold++;
    if (decision.status === "refused") continue;
    validated++;
    if (decision.label === tile.truth) correct++;
    else if (tile.truth === "intact") falseDestroyed++;
    else falseIntact++;
  }
  const total = tiles.length; const refused = total - validated;
  return { total, validated, correct, refused, intactGold, destroyedGold, falseDestroyed, falseIntact, votes,
    accuracy: ratio(correct, validated), falseDestroyedRate: ratio(falseDestroyed, intactGold),
    falseIntactRate: ratio(falseIntact, destroyedGold), refusalRate: ratio(refused, total),
    coverage: ratio(validated, total), votesPerTile: ratio(votes, total) };
}
export function compareMetrics(tiles: readonly DecidedGold[]) {
  return { weighted: metrics(tiles, "weighted"), unweighted: metrics(tiles, "unweighted") };
}
