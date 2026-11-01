import { expect, it } from "vitest";
import { MissionRunner, type PublicState } from "../runner/mission-runner.js";
import { MemoryLedger } from "../ledger/ledger.js";
import { CacheSchema, cropHashes } from "./cache.js";
import { PROMPT_VERSION } from "./agents.js";

it.each([1, 7, 21])("debates cannot change decide(), votes or weights, seed %i", async (seed) => {
  const cached = CacheSchema.parse({ model: "fixture-model", requestedModel: "fixture-model", promptVersion: PROMPT_VERSION,
    createdAt: "2026-11-01T00:00:00.000Z", cropHashes: cropHashes(Buffer.alloc(1), Buffer.alloc(1)),
    debate: { advocate: { claim: "Sediment replaces the roof.", box: [100, 100, 80, 80] },
      skeptic: { claim: "The roof remains in shadow.", box: [100, 100, 80, 80] }, model_label: "destroyed", confidence: 1 } });
  const ledgers = [new MemoryLedger(), new MemoryLedger()]; const states: PublicState[] = [];
  const runners = ledgers.map((ledger, index) => new MissionRunner({ missionId: "nepal-flood-2026", source: "sim",
    virtual: true, goldOnly: true, maxTiles: 3, seed, runId: "debate-test", ledger,
    loadDebate: () => index ? cached : null }));
  runners[1]!.on("state", (state) => { states.push(state); });
  expect(await runners[0]!.run()).toEqual(await runners[1]!.run());
  expect(runners[0]!.getWeights()).toEqual(runners[1]!.getWeights());
  expect(ledgers[0]!.events.filter((e) => e.type === "vote")).toEqual(ledgers[1]!.events.filter((e) => e.type === "vote"));
  for (const state of states.filter((s) => s.phase === "voting")) {
    expect(state.debate).toBeDefined();
    expect(JSON.stringify(state)).not.toMatch(/model_label|confidence|agreedWithChat|"ai":/);
  }
  for (const state of states.filter((s) => s.phase === "decided"))
    expect(state.lastResult!.ai).toEqual({ label: "destroyed", agreedWithChat: state.lastResult!.label === "destroyed" });
  expect(ledgers[1]!.events.filter((e) => e.type === "tile_decided").every((e) => e.data.model_label === "destroyed")).toBe(true);
});
