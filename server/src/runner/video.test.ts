import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryLedger } from "../ledger/ledger.js";
import { LedgerReplay } from "../ledger/replay.js";
import { MissionRunner } from "./mission-runner.js";
import { readVideoPlan } from "./video.js";

describe("searched recording plan", () => {
  it("reproduces six illustrative outcomes through decide, with replay and the requested timing", async () => {
    const plan = readVideoPlan();
    const ai = JSON.parse(readFileSync("reports/ai-alone.json", "utf8")) as { entries: { buildingId: string; model_label: string }[] };
    const ledger = new MemoryLedger();
    const runner = new MissionRunner({ missionId: plan.missionId, source: "sim", seed: plan.seed, ledger,
      virtual: true, gradedWork: true, video: true, fixedTiles: plan.tiles.map((tile) => tile.buildingId),
      crowd: { voters: plan.voters }, votingMs: plan.votingMs, pauseMs: plan.pauseMs, pauseAfterLast: true });
    await runner.run();
    const replay = new LedgerReplay();
    for (const event of ledger.events) replay.accept(event);
    const decisions = ledger.events.filter((event) => event.type === "tile_decided");
    expect(decisions.map((event) => event.data.weighted)).toMatchObject([
      { label: "destroyed", status: "validated" }, { label: "intact", status: "validated" },
      { label: "intact", status: "validated" }, { status: "refused", reason: "low_agreement" },
      { label: "destroyed", status: "validated" }, { label: "intact", status: "validated" },
    ]);
    expect(decisions[0]!.data.truth).toBe("destroyed"); expect(decisions[1]!.data.truth).toBe("intact");
    expect(ai.entries.find((entry) => entry.buildingId === plan.tiles[2]!.buildingId)?.model_label).toBe("destroyed");
    expect(runner.getState()).toMatchObject({ phase: "complete", serverNow: 66000,
      stats: { total: 6, validated: 5, refused: 1, remaining: 0 } });
    for (const event of ledger.events.filter((event) => event.type === "tile_opened"))
      expect(Number(event.data.closesAt) - Number(event.data.openedAt)).toBe(8000);
  });
});
