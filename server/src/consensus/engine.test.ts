import { expect, it } from "vitest";
import { collectVote, openSession, closeSession, decide, decideUnweighted, updateGoldWeights, type Vote } from "./engine.js";
import { seededRng } from "../missions/mission.js";

it("replaces a user's vote and ignores votes at or after the deadline", () => {
  const opened = openSession("tile", 100);
  const first = collectVote(opened, { userId: "a", label: "destroyed", weight: 1 }, 101);
  const second = collectVote(first, { userId: "a", label: "intact", weight: 1 }, 102);
  expect(second.votes).toEqual([{ userId: "a", label: "intact", weight: 1 }]);
  expect(first.votes[0]!.label).toBe("destroyed");
  expect(collectVote(second, { userId: "b", label: "intact", weight: 1 }, 15100)).toBe(second);
  expect(() => decide(second)).toThrow("Close");
  expect(() => closeSession(second, 15099)).toThrow("still open");
  const closed = closeSession(second, 15100);
  expect(collectVote(closed, { userId: "c", label: "intact", weight: 1 }, 102)).toBe(closed);
});
it("excludes unsure voters and prioritizes too_few_voters", () => {
  let session = openSession("tile", 0);
  for (let index = 0; index < 10; index++) session = collectVote(session,
    { userId: String(index), label: index < 2 ? "intact" : "unsure", weight: 1 }, 1);
  expect(decide(closeSession(session, 15000))).toMatchObject({
    status: "refused", reason: "too_few_voters", voters: 2, totalVotes: 10, agreement: 1,
  });
});
it("cannot manufacture three voters from duplicate user IDs in a deserialized session", () => {
  const vote: Vote = { userId: "one", label: "destroyed", weight: 1 };
  const session = { ...closeSession(openSession("tile", 0), 15000), votes: [vote, vote, vote] };
  expect(decide(session)).toMatchObject({ voters: 1, totalVotes: 1, reason: "too_few_voters" });
});
it("applies the 0.66 threshold inclusively and keeps the baseline unweighted", () => {
  let session = openSession("tile", 0);
  for (const [userId, label, weight] of [
    ["a", "destroyed", 0.33], ["b", "destroyed", 0.33], ["c", "intact", 0.34],
  ] as const) session = collectVote(session, { userId, label, weight }, 1);
  const closed = closeSession(session, 15000);
  expect(decide(closed)).toMatchObject({ status: "validated", agreement: 0.66 });
  expect(decideUnweighted(closed).agreement).toBe(2 / 3);
});
it("updates only final non-unsure votes and clamps weights without mutating inputs", () => {
  let session = openSession("tile", 0);
  const weights = new Map([["a", 1.9], ["b", 0.3], ["c", 1.5]]);
  for (const [userId, label] of [["a", "intact"], ["b", "destroyed"], ["c", "unsure"]] as const)
    session = collectVote(session, { userId, label, weight: weights.get(userId)! }, 1);
  const updated = updateGoldWeights(weights, closeSession(session, 15000), "intact");
  expect([...updated]).toEqual([["a", 2], ["b", 0.2], ["c", 1.5]]);
  expect(weights.get("a")).toBe(1.9);
});
it.each([1, 7, 29, 137, 999])("matches an independent per-user map on random replacements and late votes, seed %i", (seed) => {
  const rng = seededRng(seed);
  let session = openSession("tile", 0);
  const expected = new Map<string, Vote>();
  for (let index = 0; index < 500; index++) {
    const vote: Vote = { userId: "user_" + Math.floor(rng() * 30),
      label: (["destroyed", "intact", "unsure"] as const)[Math.floor(rng() * 3)]!, weight: 0.2 + rng() * 1.8 };
    const at = Math.floor(rng() * 18000);
    session = collectVote(session, vote, at);
    if (at < 15000) expected.set(vote.userId, vote);
  }
  expect(new Map(session.votes.map((vote) => [vote.userId, vote]))).toEqual(expected);
  const result = decide(closeSession(session, 15000));
  const counted = [...expected.values()].filter(({ label }) => label !== "unsure");
  const destroyed = counted.filter(({ label }) => label === "destroyed").reduce((sum, vote) => sum + vote.weight, 0);
  const intact = counted.filter(({ label }) => label === "intact").reduce((sum, vote) => sum + vote.weight, 0);
  expect(result.voters).toBe(counted.length);
  expect(result.agreement).toBeCloseTo(Math.max(destroyed, intact) / (destroyed + intact), 12);
});
