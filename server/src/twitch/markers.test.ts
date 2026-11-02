import { expect, it, vi } from "vitest";
import { createMarker } from "./markers.js";

const config = { clientId: "client", userToken: "token", refreshToken: "refresh", botUserId: "1", broadcasterUserId: "1" };
const reply = (status: number, body: unknown = { data: [{ id: "m" }] }) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

it("posts one marker per decision with a short description", async () => {
  const fetcher = vi.fn(() => reply(200));
  const mark = createMarker(config, fetcher as unknown as typeof fetch);
  expect(await mark("Many Eyes · Tile 3: validated intact (81% agreement, 23 voters) " + "x".repeat(200))).toBe(true);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.twitch.tv/helix/streams/markers");
  const body = JSON.parse(String(init.body)) as { user_id: string; description: string };
  expect(body.user_id).toBe("1");
  expect(body.description.length).toBeLessThanOrEqual(140);
  expect(String(init.body)).not.toContain("token");
});

it("stays quiet when offline and stops after a missing scope", async () => {
  const warn = vi.fn();
  const fetcher = vi.fn().mockImplementationOnce(() => reply(404)).mockImplementation(() => reply(401));
  const mark = createMarker(config, fetcher as unknown as typeof fetch, warn);
  expect(await mark("a")).toBe(false);
  expect(warn).not.toHaveBeenCalled();
  expect(await mark("b")).toBe(false);
  expect(await mark("c")).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledTimes(1);
});

it("uses a timeout and never exposes marker response bodies or network errors", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private token"));
  const warn = vi.fn();
  expect(await createMarker(config, fetcher, warn)("Tile 1: refused")).toBe(false);
  expect(fetcher.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  expect(warn).not.toHaveBeenCalled();
});
