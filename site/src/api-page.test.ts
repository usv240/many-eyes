import { afterEach, expect, it, vi } from "vitest";
import { pageHarness } from "./page-harness.js";
vi.mock("./common.js", () => ({}));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
const key = "me_" + "a".repeat(48);
async function setup() {
  const page = pageHarness(); vi.stubGlobal("document", page.document);
  page.node("[data-target]").value = "server"; page.node("[data-server]").value = "https://a.test";
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ key }, { status: 201 })); vi.stubGlobal("fetch", fetcher);
  await import("./api-page.js"); return { ...page, fetcher };
}
it("never sends a key to a changed server even without an input event", async () => {
  const { node, fetcher } = await setup();
  await node("[data-issue]").fire("click");
  node("[data-server]").value = "https://b.test";
  await node("[data-send]").fire("click");
  expect(fetcher).toHaveBeenCalledOnce(); expect(node("[data-send]").disabled).toBe(true);
  expect(node("[data-key-out]").textContent).toBe("");
});
it("discards late key responses after a target edit and refuses redirects", async () => {
  const { node, fetcher } = await setup();
  let resolve!: (response: Response) => void;
  fetcher.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const pending = node("[data-issue]").fire("click");
  node("[data-server]").value = "https://b.test"; await node("[data-server]").fire("input");
  resolve(Response.json({ key }, { status: 201 })); await pending;
  expect(node("[data-send]").disabled).toBe(true); expect(node("[data-key-out]").textContent).toBe("");
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
});
it("does not render credential-bearing server errors", async () => {
  const { node, fetcher } = await setup();
  fetcher.mockResolvedValue(Response.json({ error: "private-token" }, { status: 500 }));
  await node("[data-issue]").fire("click");
  expect(node("[data-status]").textContent).not.toContain("private-token");
});

it("shell-quotes request data in curl examples and omits the real key", async () => {
  const { node, fetcher } = await setup();
  await node("[data-issue]").fire("click");
  node("[data-body]").value = JSON.stringify({ tiles: [{ id: "O'Brien", votes: [] }] });
  fetcher.mockResolvedValue(Response.json({ ok: true }));
  await node("[data-send]").fire("click");
  expect(node("[data-curl]").textContent).toContain("O'\"'\"'Brien");
  expect(node("[data-curl]").textContent).not.toContain(key);
});
it("rejects oversized sandbox input before parsing it", async () => {
  const { node, fetcher } = await setup();
  await node("[data-issue]").fire("click");
  node("[data-body]").value = "x".repeat(8 * 1024 * 1024 + 1);
  await node("[data-send]").fire("click");
  expect(fetcher).toHaveBeenCalledOnce(); expect(node("[data-status]").textContent).toContain("8 MB");
});
