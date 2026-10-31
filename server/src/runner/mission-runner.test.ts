import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { MissionRunner, type Clock, type PublicState } from "./mission-runner.js";
import { MemoryLedger } from "../ledger/ledger.js";
import type { ChatMessage } from "../twitch/eventsub.js";

class FakeTwitch extends EventEmitter<{ chatMessage: [ChatMessage]; fault: [Error]; ready: []; status: [string] }> {
  async start() {}
  stop() {}
}
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
    expect(JSON.stringify(state)).not.toMatch(/gold|truth|expert_grade/);
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
