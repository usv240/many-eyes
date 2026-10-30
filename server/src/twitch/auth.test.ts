import { expect, it, vi } from "vitest";
import { readConfig, rewriteTokens, validateToken, requestJson } from "./auth.js";

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
  await expect(validateToken(settings, fetcher)).rejects.toThrow("twitch token -r <refresh token>");
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
