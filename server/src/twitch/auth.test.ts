import { expect, it, vi } from "vitest";
import { readConfig, rewriteTokens, validateToken, requestJson, retryDelay } from "./auth.js";

const config = () => ({ clientId: "test-client", userToken: "test-access", refreshToken: "test-refresh",
  botUserId: "test-bot", broadcasterUserId: "test-channel", clientSecret: "test-secret" });
it("fails fast with a variable name, never a credential", () => {
  expect(() => readConfig({})).toThrow("TWITCH_CLIENT_ID");
});
it("rewrites only token entries, including exported entries", () => {
  expect(rewriteTokens("PORT=8787\nTWITCH_USER_TOKEN=old\nexport TWITCH_REFRESH_TOKEN=old\n# keep\n", "new-test", "refresh-test"))
    .toBe('PORT=8787\nTWITCH_USER_TOKEN="new-test"\nTWITCH_REFRESH_TOKEN="refresh-test"\n# keep\n');
});
it.each([401, 200])("refreshes expired or nearly expired credentials (%i)", async (status) => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ client_id: "test-client", user_id: "test-bot", expires_in: 599 }, { status }))
    .mockResolvedValueOnce(Response.json({ access_token: "new-test", refresh_token: "new-refresh-test" }))
    .mockResolvedValueOnce(Response.json({ client_id: "test-client", user_id: "test-bot", expires_in: 3600 }));
  const save = vi.fn().mockResolvedValue(undefined); const settings = config();
  await validateToken(settings, fetcher, save);
  expect(save).toHaveBeenCalledWith("new-test", "new-refresh-test");
  expect(settings.userToken).toBe("new-test");
  expect(String(fetcher.mock.calls[1][1]?.body)).toContain("grant_type=refresh_token");
});
it("instructs manual refresh without exposing actual tokens", async () => {
  const settings = { ...config(), clientSecret: undefined };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
  await expect(validateToken(settings, fetcher)).rejects.toThrow("twitch token -R <refresh token>");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not refresh a healthy token", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ client_id: "test-client", user_id: "test-bot", expires_in: 3600 }));
  await validateToken(config(), fetcher); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("sanitizes network failures", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("sensitive response"));
  await expect(requestJson("https://example.test", {}, fetcher)).rejects.toThrow("Twitch request failed or exceeded its 5 second timeout.");
});
it("retries once after 429 (waiting for Ratelimit-Reset) and after 503", async () => {
  const now = Date.now();
  expect(retryDelay(new Response(null, { status: 429, headers: { "Ratelimit-Reset": String(Math.floor(now / 1000) + 3) } }), now))
    .toBeGreaterThan(1000);
  expect(retryDelay(new Response(null, { status: 429, headers: { "Ratelimit-Reset": String(Math.floor(now / 1000) + 600) } }), now))
    .toBe(5000);
  expect(retryDelay(new Response(null, { status: 503 }))).toBe(1000);
  expect(retryDelay(new Response(null, { status: 500 }))).toBeUndefined();
  const sleep = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  await expect(requestJson("https://api.twitch.tv/helix/x", {}, fetcher, sleep)).resolves.toEqual({ ok: true });
  expect(sleep).toHaveBeenCalledWith(1000);
  const twice = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
  await expect(requestJson("https://api.twitch.tv/helix/x", {}, twice, sleep)).rejects.toThrow("HTTP 429");
  expect(twice).toHaveBeenCalledTimes(2);
});

it("cancels retry bodies and honors caller deadlines without another request", async () => {
  const cancel = vi.fn();
  const controller = new AbortController();
  const response = new Response(new ReadableStream({ cancel }), { status: 503 });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  await expect(requestJson("https://example.test", { signal: controller.signal }, fetcher,
    async () => { controller.abort(new Error("private token")); })).rejects.toThrow("Twitch request failed");
  expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  expect(retryDelay(new Response(null, { status: 429, headers: { "Ratelimit-Reset": "1" } }))).toBe(1000);
});

it("aborts retry backoff immediately at the caller deadline", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
  const sleep = vi.fn(() => new Promise<void>(() => {}));
  const pending = requestJson("https://example.test", { signal: controller.signal }, fetcher, sleep);
  for (let i = 0; i < 10 && !sleep.mock.calls.length; i++) await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toThrow("Twitch request failed"); expect(fetcher).toHaveBeenCalledOnce();
});
