import { expect, it, vi } from "vitest";
import { csvCell, presetText } from "./data-io.js";
it("times out preset fetches and rejects failed HTTP responses", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("not CSV", { status: 503 }));
  await expect(presetText("sample", fetcher)).rejects.toThrow("Preset unavailable");
  expect(fetcher.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
});
it("quotes CSV delimiters and neutralizes spreadsheet formulas", () => {
  expect(csvCell('a,"b')).toBe('"a,""b"');
  expect(csvCell("=HYPERLINK(\"https://example.test\")")).toBe('"\'=HYPERLINK(""https://example.test"")"');
  expect(csvCell("@SUM(1,2)")).toBe('"\'@SUM(1,2)"');
});
