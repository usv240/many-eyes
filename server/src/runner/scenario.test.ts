import { expect, it } from "vitest";
import { createTileScenario } from "../../../sim/src/crowd.js";
import { liveScenario } from "./scenario.js";

it("makes Damaged work privately destroyed/hard and preserves the Possibly damaged coin flip", () => {
  const outcomes = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    expect(liveScenario(seed, null, "Damaged")).toMatchObject({ actual: "destroyed", difficulty: "hard" });
    const ambiguous = liveScenario(seed, null, "Possibly damaged");
    expect(ambiguous.difficulty).toBe("hard");
    expect(ambiguous.actual).toBe(createTileScenario(seed, "possibly damaged").actual);
    outcomes.add(ambiguous.actual);
    expect(liveScenario(seed, "intact", "Damaged")).toEqual(createTileScenario(seed, "intact"));
  }
  expect(outcomes.size).toBe(2);
});
