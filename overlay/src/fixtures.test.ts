import { expect, it } from "vitest";
import { FIXTURE_NAMES, fixtureSnapshot, isFixtureName } from "./fixtures.js";
import { view } from "./view.js";

it.each(FIXTURE_NAMES)("maps %s to a complete public state without a server", (name) => {
  expect(isFixtureName(name)).toBe(true);
  const snapshot = fixtureSnapshot(name, 10000); const state = snapshot.state!;
  expect(["voting", "decided", "complete"]).toContain(state.phase);
  expect(state.stats.validated + state.stats.refused + state.stats.remaining).toBe(state.stats.total);
  expect(view(state, { ...snapshot, now: 10000, localNow: 10000 }).text.attribution).toBe(state.mission.attribution);
  if (state.phase !== "decided") expect(JSON.stringify(state)).not.toMatch(/"gold"|"truth"|expert_grade/);
});
it("rejects unknown fixture names", () => { expect(isFixtureName("unknown")).toBe(false); });
