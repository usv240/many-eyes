import { afterEach, expect, it, vi } from "vitest";
import { pageHarness } from "./page-harness.js";
vi.mock("./common.js", () => ({ attachInfo: vi.fn(), download: vi.fn(), escapeHtml: (value: string) => value, percent: String }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it("hides stale decisions after invalid replacement data", async () => {
  const page = pageHarness(); vi.stubGlobal("document", page.document);
  await import("./data-page.js");
  page.node("[data-csv]").value = "tile_id,user_id,vote\na,b,1\na,c,1\na,d,1";
  await page.node("[data-run]").fire("click"); expect(page.node("[data-results]").hidden).toBe(false);
  page.node("[data-csv]").value = "invalid";
  await page.node("[data-run]").fire("click"); expect(page.node("[data-results]").hidden).toBe(true);
  expect(page.node("[data-status]").textContent).toContain("header");
});
