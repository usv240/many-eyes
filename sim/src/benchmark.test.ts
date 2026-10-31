import { expect, it } from "vitest";
import { runGoldSimulation } from "./benchmark.js";
import { createCrowd, DIFFICULTY } from "./crowd.js";
import { compareMetrics } from "../../server/src/consensus/metrics.js";

it.each([5, 10, 15, 25])("simulates realistic crowds of %i viewers", async (voters) => {
  const trolls = voters === 10 ? 3 : Math.round(voters * 0.3);
  const result = await runGoldSimulation({ seed: 83, voters, trollFraction: trolls / voters,
    lurkerFraction: 0, unsureRate: 0.05, hardAccuracyMultiplier: 0.5, raidProbability: 0.25 });
  expect(result.gold).toHaveLength(80);
  expect(result.gold.some((tile) => tile.difficulty === "misleading")).toBe(true);
  expect(result.metrics.weighted.total).toBe(80);
  expect(result.metrics.unweighted.total).toBe(80);
  expect(result.individual.total).toBe((voters - trolls) * 80);
  expect(result.metrics.weighted.votesPerTile).toBeLessThanOrEqual(voters);
  expect(DIFFICULTY).toEqual({ easy: 0.65, hard: 0.25, misleading: 0.1 });
  expect(result.gold.every((tile) => ["easy", "hard", "misleading"].includes(tile.difficulty!))).toBe(true);
}, 20000);

it("excludes trolls from honest raw-vote accuracy", async () => {
  const result = await runGoldSimulation({ seed: 83, voters: 10, trollFraction: 0.3 });
  const trolls = createCrowd({ seed: 83, voters: 10, trollFraction: 0.3 })
    .filter((voter) => voter.troll).map((voter) => voter.userId);
  expect(result.individual.voters.length).toBe(7);
  expect(result.individual.voters.every(({ userId }) => !trolls.includes(userId))).toBe(true);
});

it("repeats identical benchmark output for the same seed", async () => {
  const config = { seed: 14, voters: 10, trollFraction: 0.3 };
  const first = await runGoldSimulation(config, "same-seed");
  const second = await runGoldSimulation(config, "same-seed");
  expect(second).toEqual(first);
}, 20000);

it("does not give a no-troll crowd perfect accuracy on every validated tile", async () => {
  const result = await runGoldSimulation({ seed: 17, voters: 25, trollFraction: 0 });
  expect(result.metrics.weighted.accuracy! < 1 || result.metrics.weighted.refusalRate! > 0).toBe(true);
}, 20000);

it("averaged over the fixed seeds, weighted 10-viewer accuracy is at least unweighted", async () => {
  const tiles = [];
  for (let seed = 1; seed <= 20; seed++) {
    const result = await runGoldSimulation({ seed, voters: 10, trollFraction: 0.3 }, "weighted-check-" + seed);
    expect(result.gold.some((tile) => tile.difficulty === "misleading")).toBe(true);
    tiles.push(...result.gold);
  }
  const average = compareMetrics(tiles);
  expect(average.weighted.accuracy).toBeGreaterThanOrEqual(average.unweighted.accuracy!);
}, 120000);

it("records gold decisions before applying that tile's weight updates", async () => {
  const { events } = await runGoldSimulation({ seed: 8, voters: 10, trollFraction: 0.3 }, "weight-order");
  for (const event of events.filter((item) => item.type === "weight_updated")) {
    const decided = events.findIndex((item) => item.type === "tile_decided" && item.data.tileId === event.data.tileId);
    const updated = events.indexOf(event);
    expect(decided).toBeGreaterThanOrEqual(0);
    expect(updated).toBeGreaterThan(decided);
  }
}, 20000);
