import { expect, it } from "vitest";
import { compareMetrics, type DecidedGold } from "./metrics.js";
import type { Decision } from "./engine.js";

const intact: Decision = { status: "validated", label: "intact", reason: null, agreement: 1, voters: 3, totalVotes: 4 };
const destroyed: Decision = { ...intact, label: "destroyed" };
const refused: Decision = { ...intact, status: "refused", label: null, reason: "too_few_voters", voters: 2 };
it("reports class denominators, refusal, coverage and accuracy separately", () => {
  const tiles: DecidedGold[] = [
    { truth: "intact", weighted: destroyed, unweighted: refused },
    { truth: "intact", weighted: refused, unweighted: refused },
    { truth: "destroyed", weighted: destroyed, unweighted: intact },
  ];
  const result = compareMetrics(tiles);
  expect(result.weighted).toMatchObject({ accuracy: 0.5, falseDestroyedRate: 0.5, falseIntactRate: 0,
    refusalRate: 1 / 3, coverage: 2 / 3, votesPerTile: 4 });
  expect(result.unweighted).toMatchObject({ accuracy: 0, falseDestroyedRate: 0, falseIntactRate: 1 });
});
it("uses null for undefined denominators", () => {
  expect(compareMetrics([]).weighted).toMatchObject({ total: 0, accuracy: null, coverage: null, votesPerTile: null });
});
