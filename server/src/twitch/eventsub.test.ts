import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventSubClient } from "./eventsub.js";

class FakeSocket extends EventTarget {
  closed = false;
  close() { this.closed = true; }
  message(type: string, payload: unknown, id = type) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
      metadata: { message_id: id, message_type: type, message_timestamp: "2026-10-30T00:00:00Z",
        subscription_type: "channel.chat.message" }, payload,
    }) }));
  }
  welcome(id = "session") {
    this.message("session_welcome", { session: { id, keepalive_timeout_seconds: 10 } });
  }
  notification(id = "notification") {
    this.message("notification", { event: { chatter_user_id: "viewer", chatter_user_login: "viewer_login",
      message: { text: "!1" } } }, id);
  }
}
let client: EventSubClient;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function setup() {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    Response.json(String(url).endsWith("validate")
      ? { client_id: "test-client", user_id: "test-bot", expires_in: 3600 } : { data: [] }));
  client = new EventSubClient({ clientId: "test-client", botUserId: "test-bot",
    broadcasterUserId: "test-channel", userToken: "test-only", refreshToken: "test-only" }, {
    fetcher, socketFactory: (url) => { const socket = new FakeSocket(); sockets.push(socket); urls.push(url); return socket; },
  });
  const started = client.start();
  await flush();
  sockets[0].welcome();
  await started;
  return { sockets, urls, fetcher };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { client?.stop(); vi.useRealTimers(); });

it("validates before connecting and subscribes immediately after welcome", async () => {
  const { fetcher } = await setup();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Authorization: "OAuth test-only" });
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    type: "channel.chat.message", version: "1", condition: { broadcaster_user_id: "test-channel", user_id: "test-bot" },
    transport: { method: "websocket", session_id: "session" },
  });
  expect(fetcher.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
});
it("emits typed chat once per notification ID", async () => {
  const { sockets } = await setup();
  const listener = vi.fn(); client.on("chatMessage", listener);
  sockets[0].notification(); sockets[0].notification();
  expect(listener).toHaveBeenCalledExactlyOnceWith({ messageId: "notification", userId: "viewer",
    userLogin: "viewer_login", text: "!1", timestamp: "2026-10-30T00:00:00Z" });
});
it("hands over unchanged reconnect URL and transfers subscriptions without resubscribing", async () => {
  const { sockets, urls, fetcher } = await setup();
  const listener = vi.fn(); client.on("chatMessage", listener);
  const url = "wss://eventsub.wss.twitch.tv/ws?reconnect=opaque%2Bvalue";
  sockets[0].message("session_reconnect", { session: { id: "session", reconnect_url: url } });
  expect(urls[1]).toBe(url); expect(sockets[0].closed).toBe(false);
  sockets[0].notification();
  sockets[1].welcome("replacement"); sockets[1].notification();
  expect(sockets[0].closed).toBe(true); expect(listener).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("resets watchdog on keepalive and reconnects and resubscribes after silence", async () => {
  const { sockets, fetcher } = await setup();
  await vi.advanceTimersByTimeAsync(9000);
  sockets[0].message("session_keepalive", {});
  await vi.advanceTimersByTimeAsync(9000); expect(sockets).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2000); expect(sockets).toHaveLength(2);
  sockets[1].welcome("fresh"); await flush();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(sockets[0].closed).toBe(true);
});
it.each([4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007])("handles close code %i", async (code) => {
  const { sockets } = await setup(); const fault = vi.fn(); client.on("fault", fault);
  sockets[0].dispatchEvent(Object.assign(new Event("close"), { code }));
  await vi.advanceTimersByTimeAsync(1000);
  if (code === 4001 || code === 4002) expect(fault).toHaveBeenCalledTimes(1);
  else expect(sockets).toHaveLength(2);
});
it("bounds the LRU to 10k and refreshes duplicate recency", async () => {
  const { sockets } = await setup(); const listener = vi.fn(); client.on("chatMessage", listener);
  for (let i = 0; i < 10000; i++) sockets[0].notification(String(i));
  sockets[0].notification("0"); sockets[0].notification("10000");
  sockets[0].notification("0"); sockets[0].notification("1");
  expect(listener).toHaveBeenCalledTimes(10002);
});
it("times out a socket that never welcomes", async () => {
  const { sockets } = await setup();
  sockets[0].message("session_reconnect", { session: { id: "session", reconnect_url: "wss://example.test" } });
  await vi.advanceTimersByTimeAsync(11000);
  expect(sockets).toHaveLength(3);
  expect(sockets[1].closed).toBe(true);
});
