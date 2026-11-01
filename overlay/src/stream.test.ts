import { expect, it, vi } from "vitest";
import { connectStream, type Snapshot } from "./stream.js";
import { fixture, imagery } from "./test-fixtures.js";

class FakeEvents {
  onopen: (() => void) | null = null; onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();
}
it("aborts unavailable photos after eight seconds while continuing to receive votes", async () => {
  vi.useFakeTimers();
  const events = new FakeEvents(); const updates: Snapshot[] = [];
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn<typeof fetch>((_url, init) => { signal = init!.signal!; return new Promise(() => {}); });
  const close = connectStream((snapshot) => updates.push(snapshot), { events: () => events, fetcher });
  try {
    const state = fixture(); events.onmessage!({ data: JSON.stringify(state) });
    await vi.advanceTimersByTimeAsync(8000);
    expect(signal!.aborted).toBe(true);
    expect(updates.at(-1)!.imageryStatus).toBe("error");
    state.live.voters = 12; events.onmessage!({ data: JSON.stringify(state) });
    expect(updates.at(-1)!.state!.live.voters).toBe(12);
    expect(fetcher).toHaveBeenCalledOnce();
  } finally { close(); vi.useRealTimers(); }
});
it("ignores stale imagery after a tile switch and aborts work on close", async () => {
  const events = new FakeEvents(); const updates: Snapshot[] = [];
  const requests: { resolve: (response: Response) => void; signal: AbortSignal }[] = [];
  const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((resolve) => requests.push({ resolve, signal: init!.signal! })));
  const close = connectStream((snapshot) => updates.push(snapshot), { events: () => events, fetcher, now: () => 123 });
  try {
    events.onopen!();
    const state = fixture(); events.onmessage!({ data: JSON.stringify(state) });
    expect(updates.at(-1)!.receivedAt).toBe(123);
    state.tile!.token = "012345abcdef"; state.tile!.imageryUrl = "/api/tiles/012345abcdef?crop=current";
    events.onmessage!({ data: JSON.stringify(state) });
    expect(requests[0]!.signal.aborted).toBe(true);
    requests[0]!.resolve(new Response(JSON.stringify(imagery)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates.at(-1)!.imagery).toBeUndefined();
    requests[1]!.resolve(new Response(JSON.stringify(imagery)));
    await vi.waitFor(() => expect(updates.at(-1)!.imageryStatus).toBe("ready"));
    expect(fetcher.mock.calls[1]![0]).toBe(state.tile!.imageryUrl);
  } finally { close(); }
  expect(events.close).toHaveBeenCalledOnce(); expect(requests[1]!.signal.aborted).toBe(true);
});
it("leaves reconnects to EventSource and retains the snapshot for the three-second notice", () => {
  vi.useFakeTimers();
  const events = new FakeEvents(); const updates: Snapshot[] = [];
  const factory = vi.fn(() => events);
  const close = connectStream((snapshot) => updates.push(snapshot), { events: factory,
    fetcher: vi.fn<typeof fetch>(() => new Promise(() => {})), now: () => Date.now() });
  try {
    events.onmessage!({ data: JSON.stringify(fixture()) });
    events.onerror!(); const offline = updates.at(-1)!.offlineSince;
    vi.advanceTimersByTime(2000); events.onerror!();
    expect(updates.at(-1)!.offlineSince).toBe(offline);
    vi.advanceTimersByTime(1000);
    expect(updates.at(-1)!.state!.tile!.token).toBe("abcdef123456");
    expect(factory).toHaveBeenCalledOnce(); expect(events.close).not.toHaveBeenCalled();
    events.onopen!(); expect(updates.at(-1)!.offlineSince).toBeUndefined();
    close(); expect(vi.getTimerCount()).toBe(0);
  } finally { close(); vi.useRealTimers(); }
});
