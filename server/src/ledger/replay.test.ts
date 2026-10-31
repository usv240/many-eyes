import { expect, it } from "vitest";
import { runGoldSimulation } from "../../../sim/src/benchmark.js";
import { LedgerReplay } from "./replay.js";
import { compareMetrics } from "../consensus/metrics.js";

it("reconstructs metrics and weights from vote events", async () => {
  const result = await runGoldSimulation({ seed: 5, voters: 8, trollFraction: 0.3 }, "replay");
  const replay = new LedgerReplay();
  for (const event of result.events) replay.accept(event);
  expect(compareMetrics(replay.gold("replay"))).toEqual(result.metrics);
});
it("refuses scores that disagree with the recorded votes", async () => {
  const result = await runGoldSimulation({ seed: 5, voters: 2 }, "tampered");
  const event = result.events.find((event) => event.type === "tile_decided")!;
  event.data.weighted = { status: "validated", label: "destroyed" };
  const replay = new LedgerReplay();
  expect(() => { for (const event of result.events) replay.accept(event); }).toThrow("does not match replay");
});
