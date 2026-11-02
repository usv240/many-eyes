import { createTileScenario } from "../../../sim/src/crowd.js";
import type { Truth } from "../consensus/engine.js";

/** Presentation-only assumption; never a reference label or an input to decide(). */
export function liveScenario(seed: number, truth: Truth | null, expertGrade: string, raidProbability?: number) {
  const scenario = createTileScenario(seed, truth ?? "possibly damaged", raidProbability);
  if (!truth) {
    scenario.difficulty = "hard";
    if (expertGrade === "Damaged") scenario.actual = "destroyed";
  }
  return scenario;
}
