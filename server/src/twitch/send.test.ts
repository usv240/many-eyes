import { afterEach, expect, it, vi } from "vitest";
import { createChatSender } from "./send.js";

const config = { clientId: "test-client", userToken: "test-access", refreshToken: "test-refresh",
  botUserId: "test-bot", broadcasterUserId: "test-channel" };
afterEach(() => vi.useRealTimers());
it("serializes concurrent messages at one per second with a timeout", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [{ is_sent: true }] }));
  const send = createChatSender(config, fetcher);
  const pending = Promise.all([send("one"), send("two"), send("three")]);
  await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(999); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000); await pending;
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ broadcaster_id: "test-channel", sender_id: "test-bot", message: "one" });
});
it("reports dropped messages without logging the response", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ is_sent: false }] }));
  await expect(createChatSender(config, fetcher)("hello")).rejects.toThrow("did not deliver");
});
