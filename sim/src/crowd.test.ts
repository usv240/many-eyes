import { expect, it } from "vitest";
import { createCrowd, simulateVotes } from "./crowd.js";

it("reproduces profiles and vote delays, with exact configured troll and lurker counts", () => {
  const config = { seed: 13, voters: 200, trollFraction: 0.3, lurkerFraction: 0.2 };
  const crowd = createCrowd(config);
  expect(crowd).toEqual(createCrowd(config));
  expect(crowd.filter((voter) => voter.troll)).toHaveLength(60);
  expect(crowd.filter((voter) => voter.lurker)).toHaveLength(40);
  expect(crowd.every((voter) => voter.sensitivity >= 0.5 && voter.sensitivity <= 0.99 &&
    voter.specificity >= 0.5 && voter.specificity <= 0.99)).toBe(true);
  const votes = simulateVotes(crowd, "damaged", 25, "tile");
  expect(votes).toHaveLength(160);
  expect(votes).toEqual(simulateVotes(crowd, "damaged", 25, "tile"));
  expect(votes.every((vote) => vote.delayMs >= 0 && vote.delayMs < 15000)).toBe(true);
  expect(new Set(votes.map((vote) => vote.userId)).size).toBe(160);
});
it("allows all three troll votes without biasing them by truth", () => {
  const crowd = createCrowd({ seed: 21, voters: 3000, trollFraction: 1 });
  const votes = simulateVotes(crowd, "intact", 77, "tile");
  for (const label of ["destroyed", "intact", "unsure"])
    expect(votes.filter((vote) => vote.label === label).length).toBeGreaterThan(850);
});
