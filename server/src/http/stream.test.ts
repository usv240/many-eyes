import { expect, it, vi } from "vitest";
import { createApp } from "../index.js";
import { MissionRunner, type PublicState } from "../runner/mission-runner.js";
import { MemoryLedger } from "../ledger/ledger.js";

function fixture() {
  const runner = new MissionRunner({ missionId: "nepal-flood-2026", source: "sim", seed: 7,
    virtual: true, maxTiles: 1, crowd: { voters: 0 }, ledger: new MemoryLedger() });
  const app = createApp({ live: { runner, start: async () => {}, stop: async () => { runner.stop(); } } });
  return { app, runner };
}
async function connect(url: string) {
  const controller = new AbortController();
  const response = await fetch(url + "/api/stream", {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  return {
    response, close: () => controller.abort(),
    async next(): Promise<string> {
      while (!pending.includes("\n\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE closed before the next event.");
        pending += decoder.decode(value, { stream: true });
      }
      const end = pending.indexOf("\n\n");
      const frame = pending.slice(0, end);
      pending = pending.slice(end + 2);
      return frame;
    },
  };
}
const stateFrom = (frame: string) => JSON.parse(frame.slice("data: ".length)) as PublicState;

it("serves the latest snapshot on connection and a new event when the runner emits", async () => {
  const { app, runner } = fixture();
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  const stream = await connect(url);
  try {
    expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.response.headers.get("cache-control")).toContain("no-cache");
    expect(stateFrom(await stream.next())).toEqual(runner.getState());
    await runner.run();
    const opened = stateFrom(await stream.next());
    expect(opened.phase).toBe("voting");
    expect(opened.tile!.number).toBe(1);
    expect(stateFrom(await stream.next()).phase).toBe("decided");
    expect(stateFrom(await stream.next()).phase).toBe("complete");
    // A reconnect receives the current completed snapshot, without replaying earlier votes.
    const again = await connect(url);
    try { expect(stateFrom(await again.next())).toEqual(runner.getState()); }
    finally { again.close(); }
  } finally { stream.close(); await app.close(); }
  expect(runner.listenerCount("state")).toBe(0);
}, 10000);

it("pings every 15 seconds and removes timers and listeners on disconnect and shutdown", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const { app, runner } = fixture();
  try {
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const stream = await connect(url);
    await stream.next();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(15000);
    expect(await stream.next()).toBe(": ping");
    stream.close();
    await vi.waitFor(() => expect(runner.listenerCount("state")).toBe(0), { timeout: 1000 });
    expect(vi.getTimerCount()).toBe(0);
    const active = await connect(url);
    await active.next();
    await app.close();
    expect(runner.listenerCount("state")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(active.next()).rejects.toThrow("SSE closed");
    active.close();
  } finally { await app.close(); vi.useRealTimers(); }
}, 10000);
