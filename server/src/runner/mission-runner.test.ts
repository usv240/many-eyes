import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { MissionRunner, type Clock, type PublicState } from "./mission-runner.js";
import { MemoryLedger } from "../ledger/ledger.js";
import type { ChatMessage } from "../twitch/eventsub.js";
import { getMission } from "../missions/mission.js";

class FakeTwitch extends EventEmitter<{ chatMessage: [ChatMessage]; fault: [Error]; ready: []; status: [string] }> {
  async start() {}
  stop() {}
}
it("uses different opaque tokens across runs and resolves only tokens it issued", async () => {
  const make = (runId: string) => new MissionRunner({ missionId: "nepal-flood-2026", source: "sim", runId,
    virtual: true, goldOnly: true, maxTiles: 1, crowd: { voters: 0 }, ledger: new MemoryLedger() });
  const first = make("token-test-a"); const second = make("token-test-b");
  await first.run(); await second.run();
  const a = first.getState().tile!.token; const b = second.getState().tile!.token;
  expect(a).not.toBe(b);
  expect(first.resolveTile(a)).toEqual(second.resolveTile(b));
  expect(first.resolveTile(b)).toBeUndefined();
});
it("dedupes IDs across tiles, replaces per-user votes, and sends one result per tile", async () => {
  let now = 1000;
  const clock: Clock = { now: () => now, wait: async (ms) => { now += ms; } };
  const twitch = new FakeTwitch(); const ledger = new MemoryLedger(); const sendChat = vi.fn().mockResolvedValue(undefined);
  const runner = new MissionRunner({ missionId: "nepal-flood-2026", source: "twitch", twitch, clock, ledger, sendChat, maxTiles: 2 });
  const opened = new Set<number>();
  runner.on("state", (state) => {
    if (state.phase !== "voting" || opened.has(state.tile!.number)) return;
    opened.add(state.tile!.number);
    const emit = (messageId: string, userId: string, text: string) =>
      twitch.emit("chatMessage", { messageId, userId, userLogin: userId, text, timestamp: new Date(now).toISOString() });
    if (state.tile!.number === 1) {
      emit("same", "one", "1"); emit("same", "two", "1");
      emit("replacement", "one", "2"); emit("third", "two", "2"); emit("fourth", "three", "2");
    } else {
      emit("same", "one", "1"); emit("new", "four", "2");
    }
  });
  await runner.run();
  const votes = ledger.events.filter((event) => event.type === "vote");
  expect(votes).toHaveLength(5);
  const decisions = ledger.events.filter((event) => event.type === "tile_decided");
  expect(decisions[0]!.data.weighted).toMatchObject({ status: "validated", label: "intact", voters: 3 });
  expect(decisions[1]!.data.weighted).toMatchObject({ status: "refused", reason: "too_few_voters", voters: 1 });
  expect(sendChat).toHaveBeenCalledTimes(2);
  expect(sendChat.mock.calls[0]![0]).toBe("Tile 1: VALIDATED intact (agreement 1.00, 3 voters)");
  expect(runner.getRefusedQueue()).toHaveLength(1);
  expect(twitch.listenerCount("chatMessage")).toBe(0);
});
it("never exposes gold or expert information before deciding and persists weights across tiles", async () => {
  const ledger = new MemoryLedger(); const states: PublicState[] = [];
  const runner = new MissionRunner({ missionId: "nepal-flood-2026", source: "sim", virtual: true,
    goldOnly: true, maxTiles: 5, crowd: { voters: 20 }, ledger });
  runner.on("state", (state) => { states.push(state); });
  await runner.run();
  for (const state of states.filter((state) => state.phase === "voting" || state.phase === "idle"))
    expect(JSON.stringify(state)).not.toMatch(/"(gold|truth|expert_grade|reveal)":/);
  expect(states.some((state) => state.phase === "decided" && state.reveal?.gold)).toBe(true);
  const secondTile = ledger.events.filter((event) => event.type === "tile_opened")[1]!.data.id;
  expect(ledger.events.some((event) => event.type === "vote" && event.data.tileId === secondTile && event.data.weight !== 1)).toBe(true);
  expect([...runner.getWeights().values()].every((weight) => weight >= 0.2 && weight <= 2)).toBe(true);
});
it("stops without deciding a partially collected tile", async () => {
  const ledger = new MemoryLedger();
  const runner = new MissionRunner({ missionId: "nepal-flood-2026", source: "sim", virtual: true, ledger });
  runner.on("state", (state) => { if (state.phase === "voting") runner.stop(); });
  await runner.run();
  expect(ledger.events.some((event) => event.type === "tile_decided")).toBe(false);
  expect(runner.getState().phase).toBe("stopped");
});

it.each(["complete", "stopped"] as const)("keeps stats consistent and hidden fields private across every phase ending in %s", async (terminal) => {
  const ledger = new MemoryLedger();
  const mission = getMission("nepal-flood-2026");
  const runner = new MissionRunner({ missionId: mission.id, source: "sim", virtual: true, seed: 7,
    goldOnly: true, maxTiles: 3, ledger });
  const phases = new Set<string>();
  const check = (state: PublicState) => {
    phases.add(state.phase);
    const decisions = ledger.events.filter((event) => event.type === "tile_decided");
    const currentWasDecided = !!state.tile && decisions.length >= state.tile.number;
    expect(JSON.stringify(state)).not.toContain('"expert_grade"');
    if (!currentWasDecided) {
      const serialized = JSON.stringify(state);
      expect(serialized).not.toMatch(/"(gold|truth|reveal)":|osm-|cems-/);
      for (const building of mission.buildings) expect(serialized).not.toContain(building.id);
    }
    if (state.tile) {
      expect(state.tile.token).toMatch(/^[a-f0-9]{12}$/);
      expect(state.tile.imageryUrl).toBe("/api/tiles/" + state.tile.token);
      const privateTile = runner.resolveTile(state.tile.token)!;
      const building = mission.buildings.find(({ id }) => id === privateTile.buildingId)!;
      expect(state.tile.lon).toBe(Number(building.lon.toFixed(4)));
      expect(state.tile.lat).toBe(Number(building.lat.toFixed(4)));
    }
    if (state.lastResult?.gold) {
      expect(currentWasDecided).toBe(true);
      const latest = decisions.at(-1)!;
      expect(state.lastResult.gold.truth).toBe(latest.data.truth);
    }
    const { validated, refused, remaining, total, goldChecked, goldCorrect } = state.stats;
    expect(validated + refused + remaining).toBe(total);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(validated + refused).toBe(decisions.length);
    expect(goldChecked).toBe(decisions.filter((event) => event.data.truth).length);
    expect(goldCorrect).toBe(decisions.filter((event) => {
      const result = event.data.weighted as { status: string; label: string | null };
      return !!event.data.truth && result.status === "validated" && result.label === event.data.truth;
    }).length);
    expect(state.mission).toEqual({ name: mission.name, place: "Syaphru Besi, Rasuwa, Nepal",
      eventDate: mission.event_date, preDate: mission.pre_scene.acquired, postDate: mission.post_scene.acquired,
      attribution: mission.attribution });
    expect(Number.isFinite(state.serverNow)).toBe(true);
    expect(state.live.voters + state.live.unsure).toBe(state.votes.total);
    if (terminal === "stopped" && state.phase === "voting" && state.tile!.number === 3) runner.stop();
  };
  check(runner.getState());
  runner.on("state", check);
  await runner.run();
  expect(phases).toEqual(new Set(["idle", "voting", "decided", terminal]));
  expect(runner.getState().stats.remaining).toBe(terminal === "complete" ? 0 : 1);
});
