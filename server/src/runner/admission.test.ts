import { expect, it } from "vitest";
import { Admission } from "./admission.js";
it("bounds mission messages and voters without evicting replay protection or existing voters", () => {
  const guard = new Admission(2, 1);
  expect(guard.message("first")).toBe(true); expect(guard.message("second")).toBe(true);
  expect(guard.message("third")).toBe(false); expect(guard.message("first")).toBe(false);
  expect(guard.user("one")).toBe(true); expect(guard.user("two")).toBe(false);
  expect(guard.user("one")).toBe(true);
});
