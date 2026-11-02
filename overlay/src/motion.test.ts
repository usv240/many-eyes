import { expect, it } from "vitest";
import { motionPlan } from "./motion.js";
import { fixtureSnapshot } from "./fixtures.js";

it("uses the remaining server-clock time and does not restart for vote bursts", () => {
  const snapshot = fixtureSnapshot("voting", 1000);
  const plan = motionPlan(snapshot, 5000, false);
  expect(plan.countdown).toBe(11000); expect(plan.wipe).toBe(true);
  snapshot.state!.live.voters++;
  expect(motionPlan(snapshot, 5100, false).key).toBe(plan.key);
  expect(motionPlan(snapshot, 17000, false).countdown).toBe(0);
});
it("parks result wipes and drops blur and travel with reduced motion", () => {
  expect(motionPlan(fixtureSnapshot("validated"), 0, false).wipe).toBe(false);
  expect(motionPlan(fixtureSnapshot("voting"), 0, true)).toMatchObject({ wipe: false, blur: "none" });
});

it("uses the shortened video voting window for the countdown scale", () => {
  const snapshot = fixtureSnapshot("voting", 1000);
  snapshot.state!.tile!.closesAt = snapshot.state!.tile!.openedAt + 8000;
  expect(motionPlan(snapshot, 5000, false)).toMatchObject({ countdown: 4000, duration: 8000 });
});
