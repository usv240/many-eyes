import { expect, it, vi } from "vitest";
import { createLive, readLiveConfig } from "./live.js";
import { MemoryLedger } from "./ledger/ledger.js";

it("starts one real-time simulation with empty configuration and stops its timer", async () => {
  const ledger = new MemoryLedger();
  const live = createLive({ env: {}, ledger });
  expect(readLiveConfig({})).toEqual({ source: "sim", seed: 7 });
  const before = Date.now();
  try {
    await Promise.all([live.start(), live.start()]);
    const state = live.runner.getState();
    expect(state.phase).toBe("voting");
    expect(state.tile!.openedAt).toBeGreaterThanOrEqual(before);
    expect(state.tile!.closesAt - state.tile!.openedAt).toBe(15000);
    expect(state.serverNow).toBeGreaterThanOrEqual(before);
    expect(state.serverNow).toBeLessThanOrEqual(Date.now());
    expect(ledger.events.filter((event) => event.type === "mission_started")).toHaveLength(1);
    expect(ledger.events[0]!.data).toMatchObject({ seed: 7, source: "sim" });
  } finally { await live.stop(); }
  expect(live.runner.getState().phase).toBe("stopped");
  expect(live.runner.listenerCount("state")).toBe(0);
});

it("requires Twitch credentials only in twitch mode and rejects invalid live options", () => {
  expect(() => createLive({ env: { MANY_EYES_SOURCE: "twitch" }, ledger: new MemoryLedger() }))
    .toThrow("Missing required environment variable: TWITCH_CLIENT_ID");
  expect(() => readLiveConfig({ MANY_EYES_SOURCE: "invalid" })).toThrow("MANY_EYES_SOURCE");
  expect(() => readLiveConfig({ MANY_EYES_SEED: "NaN" })).toThrow("MANY_EYES_SEED");
  expect(() => readLiveConfig({ MANY_EYES_SEED: "1.5" })).toThrow("MANY_EYES_SEED");
  expect(readLiveConfig({ MANY_EYES_SEED: "21" }).seed).toBe(21);
});

it("reports startup failures and releases the readiness listener", async () => {
  const live = createLive({ env: {}, ledger: new MemoryLedger() });
  vi.spyOn(live.runner, "run").mockRejectedValue(new Error("private implementation detail"));
  await expect(live.start()).rejects.toThrow("Live mission failed to start");
  expect(live.runner.listenerCount("state")).toBe(0);
  await live.stop();
});
