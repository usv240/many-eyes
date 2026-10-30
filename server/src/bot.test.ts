import { expect, it } from "vitest";
import { voteLog } from "./bot.js";

it("logs only parsed votes and sanitizes user names", () => {
  expect(voteLog("viewer", "!2")).toBe("viewer: intact");
  expect(voteLog("viewer", "non-vote text")).toBeNull();
  expect(voteLog("viewer\n", "3")).toBe("viewer: unsure");
});
