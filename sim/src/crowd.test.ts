import { expect, it } from "vitest";
import { createCrowd, simulateVotes, type Voter } from "./crowd.js";

it("reproduces profiles and delays, with configured troll and lurker counts", () => {
  const config = { seed: 13, voters: 25, trollFraction: 0.32, lurkerFraction: 0.2 };
  const crowd = createCrowd(config);
  expect(crowd).toEqual(createCrowd(config));
  expect(crowd.filter((voter) => voter.troll)).toHaveLength(8);
  expect(crowd.filter((voter) => voter.lurker)).toHaveLength(5);
  expect(crowd.filter((voter) => voter.trollStrategy === "always_wrong")).toHaveLength(3);
  expect(crowd.filter((voter) => voter.trollStrategy === "raid")).toHaveLength(5);
  expect(crowd.every((voter) => voter.sensitivity >= 0.5 && voter.sensitivity <= 0.99 &&
    voter.specificity >= 0.5 && voter.specificity <= 0.99)).toBe(true);
  const votes = simulateVotes(crowd, "damaged", 25, "tile");
  expect(votes).toHaveLength(20);
  expect(votes).toEqual(simulateVotes(crowd, "damaged", 25, "tile"));
  expect(votes.every((vote) => vote.delayMs >= 0 && vote.delayMs < 15000)).toBe(true);
  expect(new Set(votes.map((vote) => vote.userId)).size).toBe(20);
});

it("makes hard imagery a shared tile condition that lowers accuracy for the whole crowd", () => {
  const crowd = createCrowd({ seed: 3, voters: 5000, trollFraction: 0 });
  const votes = (difficulty: "easy" | "hard") =>
    simulateVotes(crowd, "destroyed", 87, "tile", { scenario: { actual: "destroyed", difficulty,
      raid: false, raidDelay: 0 }, raidProbability: 0 });
  const accuracy = (labels: ReturnType<typeof votes>) => {
    const classified = labels.filter(({ label }) => label !== "unsure");
    return classified.filter(({ label }) => label === "destroyed").length / classified.length;
  };
  const ordinary = accuracy(votes("easy"));
  const hard = accuracy(votes("hard"));
  expect(ordinary).toBeGreaterThan(0.75);
  expect(ordinary).toBeLessThan(0.81);
  expect(hard).toBeGreaterThan(0.61);
  expect(hard).toBeLessThan(0.68);
});

it("makes always-wrong trolls oppose truth and raid trolls coordinate one destroyed vote", () => {
  const voters = ([
    ["wrong_a", "always_wrong"], ["raid_a", "raid"], ["raid_b", "raid"],
  ] as const).map(([userId, trollStrategy]) => ({
    userId, troll: true, trollStrategy, lurker: false, sensitivity: 0.8, specificity: 0.97, unsureRate: 0.05,
  })) satisfies Voter[];
  const votes = simulateVotes(voters, "intact", 19, "raid-tile", {
    raidProbability: 1, scenario: { actual: "intact", difficulty: "easy", raid: true, raidDelay: 900 },
  });
  expect(votes.find((vote) => vote.userId === "wrong_a")?.label).toBe("destroyed");
  const raidVotes = votes.filter((vote) => vote.userId.startsWith("raid_"));
  expect(raidVotes.map(({ label }) => label)).toEqual(["destroyed", "destroyed"]);
  expect(raidVotes[0]!.delayMs).toBe(raidVotes[1]!.delayMs);
});
