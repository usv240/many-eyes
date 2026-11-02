import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { MissionRunner, type Clock, type PublicState } from "./mission-runner.js";
import { MemoryLedger } from "../ledger/ledger.js";
import type { ChatMessage } from "../twitch/eventsub.js";
import { getMission, goldTruth } from "../missions/mission.js";

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
  // One result per tile, then one mission summary.
  expect(sendChat).toHaveBeenCalledTimes(3);
  expect(sendChat.mock.calls[0]![0]).toBe("Tile 1: validated intact (100% agreement, 3 voters)");
  expect(sendChat.mock.calls[2]![0]).toBe("Mission complete: 1 validated, 1 sent to expert review. Thank you, crew.");
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
it("mixes real chat votes with the simulated crowd through the same vote path", async () => {
  let now = 5000;
  const clock: Clock = { now: () => now, wait: async (ms) => { now += ms; } };
  const twitch = new FakeTwitch(); const ledger = new MemoryLedger(); const sendChat = vi.fn().mockResolvedValue(undefined);
  const seen: { message: ChatMessage; accepted: boolean }[] = [];
  const runner = new MissionRunner({ missionId: "nepal-flood-2026", source: "sim", liveChat: true, twitch, clock, ledger,
    sendChat, maxTiles: 1, crowd: { voters: 5 }, onChat: (message, accepted) => { seen.push({ message, accepted }); } });
  const states: PublicState[] = [];
  let sent = false;
  runner.on("state", (state) => {
    states.push(state);
    if (state.phase !== "voting" || sent) return;
    sent = true;
    const emit = (messageId: string, text: string) => twitch.emit("chatMessage",
      { messageId, userId: "1599553311", userLogin: "viewer", text, timestamp: new Date(now).toISOString() });
    emit("m1", "1"); emit("m2", "2"); emit("m2", "1"); emit("m3", "!why");
  });
  await runner.run();
  const votes = ledger.events.filter((event) => event.type === "vote");
  const real = votes.filter((event) => event.data.userId === "1599553311");
  expect(real.map((event) => event.data.label)).toEqual(["destroyed", "intact"]);
  expect(votes.some((event) => String(event.data.userId).startsWith("sim_"))).toBe(true);
  const decided = ledger.events.find((event) => event.type === "tile_decided")!;
  const session = decided.data.session as { votes: { userId: string; label: string }[] };
  expect(session.votes.filter((vote) => vote.userId === "1599553311")).toEqual([expect.objectContaining({ label: "intact" })]);
  expect(seen.map((item) => [item.message.text, item.accepted])).toEqual([["1", true], ["2", true], ["!why", false]]);
  expect(states.some((state) => state.liveChat && state.liveVote?.login === "viewer")).toBe(true);
  expect(sendChat).toHaveBeenCalledTimes(2);
  expect(sendChat.mock.calls[1]![0]).toMatch(/^Mission complete: /);
  expect(twitch.listenerCount("chatMessage")).toBe(0);
});
it("credits real viewers who matched the experts on a hidden check, after it is decided", async () => {
  let now = 5000;
  const clock: Clock = { now: () => now, wait: async (ms) => { now += ms; } };
  const twitch = new FakeTwitch(); const ledger = new MemoryLedger(); const sendChat = vi.fn().mockResolvedValue(undefined);
  const runner = new MissionRunner({ missionId: "nepal-flood-2026", source: "sim", liveChat: true, twitch, clock, ledger,
    sendChat, maxTiles: 1, goldOnly: true, crowd: { voters: 5 } });
  const truth = goldTruth(getMission("nepal-flood-2026").gold[0]!.building_id, "nepal-flood-2026")!;
  const states: PublicState[] = [];
  runner.on("state", (state) => {
    states.push(state);
    if (state.phase !== "voting" || states.filter((item) => item.phase === "voting").length > 1) return;
    twitch.emit("chatMessage", { messageId: "c1", userId: "42", userLogin: "ana_maps",
      text: truth === "destroyed" ? "1" : "2", timestamp: new Date(now).toISOString() });
  });
  await runner.run();
  expect(states.filter((state) => state.phase === "voting").every((state) => !state.crew)).toBe(true);
  const decided = states.find((state) => state.phase === "decided")!;
  expect(decided.crew).toEqual(expect.arrayContaining([{ name: "ana_maps", matched: 1, checked: 1, live: true }]));
  expect(sendChat.mock.calls[0]![0]).toContain("matched the experts: ana_maps");
  expect(sendChat.mock.calls[1]![0]).toMatch(/hidden checks\. Thank you, crew\.$/);
});
it("refuses live chat mixing in virtual time or with a Twitch-only source", () => {
  expect(() => new MissionRunner({ missionId: "nepal-flood-2026", source: "sim", liveChat: true, virtual: true,
    ledger: new MemoryLedger() })).toThrow(/real-time simulated crowd/);
  expect(() => new MissionRunner({ missionId: "nepal-flood-2026", source: "twitch", liveChat: true,
    ledger: new MemoryLedger() })).toThrow(/real-time simulated crowd/);
});
