import { expect, it, vi } from "vitest";
import { assertOwnServer, assertPortUnused } from "./health.js";

it("rejects any existing HTTP responder and bounds the probe", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("Other proxy", { status: 404 }));
  await expect(assertPortUnused(8791, fetcher)).rejects.toThrow("already answers");
  expect(fetcher.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  fetcher.mockRejectedValue(Object.assign(new Error("connection refused"), { cause: { code: "ECONNREFUSED" } }));
  await expect(assertPortUnused(8791, fetcher)).resolves.toBeUndefined();
});
it("verifies the response comes from the instance just started", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]", { headers: { "x-many-eyes-instance": "ours" } }));
  await expect(assertOwnServer(8791, "ours", fetcher)).resolves.toBeUndefined();
  await expect(assertOwnServer(8791, "other", fetcher)).rejects.toThrow("another program");
});
