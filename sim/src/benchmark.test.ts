import { expect, it } from "vitest";
import { runGoldSimulation } from "./benchmark.js";

it.each([1, 2, 3, 4, 5])("200 voters with no trolls exceed accuracy and refusal targets, seed %i", async (seed) => {
  const result = await runGoldSimulation({ seed, voters: 200, trollFraction: 0 });
  expect(result.gold).toHaveLength(80);
  expect(result.metrics.weighted.accuracy).toBeGreaterThanOrEqual(0.95);
  expect(result.metrics.weighted.refusalRate).toBeLessThanOrEqual(0.05);
}, 20000);
it.each([1, 2, 3, 4, 5])("200 voters with 30% trolls meet accuracy and baseline targets, seed %i", async (seed) => {
  const result = await runGoldSimulation({ seed, voters: 200, trollFraction: 0.3 });
  expect(result.metrics.weighted.accuracy).toBeGreaterThanOrEqual(0.90);
  expect(result.metrics.weighted.accuracy).toBeGreaterThanOrEqual(result.metrics.unweighted.accuracy!);
}, 20000);
it("refuses every gold tile with too_few_voters when only two people vote", async () => {
  const result = await runGoldSimulation({ seed: 1, voters: 2 });
  expect(result.gold.every((tile) => tile.weighted.status === "refused" &&
    tile.weighted.reason === "too_few_voters" && tile.unweighted.reason === "too_few_voters")).toBe(true);
  expect(result.metrics.weighted.refusalRate).toBe(1);
});
