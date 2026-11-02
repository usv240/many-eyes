import { expect, it, vi } from "vitest";
import { createChatCommands, WELCOME_TEXT } from "./commands.js";
import type { ChatMessage } from "./eventsub.js";

const message = (userId: string, text: string): ChatMessage =>
  ({ messageId: userId + text + Math.random(), userId, userLogin: userId + "_login", text, timestamp: new Date(0).toISOString() });

it("answers !why once per user per minute and includes the repo link", () => {
  let now = 0;
  const send = vi.fn().mockResolvedValue(undefined);
  const handle = createChatCommands({ send, repoUrl: "https://example.test/repo", now: () => now });
  expect(handle(message("a", "!why"), false)).toBe("why");
  expect(handle(message("a", "  !WHY "), false)).toBeNull();
  expect(handle(message("b", "!why"), false)).toBe("why");
  now = 60_000;
  expect(handle(message("a", "!why"), false)).toBe("why");
  expect(send).toHaveBeenCalledTimes(3);
  expect(send.mock.calls[0]![0]).toMatch(/^@a_login .*Code: https:\/\/example\.test\/repo$/);
  for (const [text] of send.mock.calls) expect((text as string).length).toBeLessThanOrEqual(500);
});

it("welcomes a voter once, only after an accepted vote", () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const handle = createChatCommands({ send });
  expect(handle(message("a", "hello"), false)).toBeNull();
  expect(handle(message("a", "1"), false)).toBeNull();
  expect(handle(message("a", "1"), true)).toBe("welcome");
  expect(handle(message("a", "2"), true)).toBeNull();
  expect(send).toHaveBeenCalledWith("@a_login " + WELCOME_TEXT);
  expect(send).toHaveBeenCalledTimes(1);
});

it("keeps memory bounded and survives a failing sender", async () => {
  const send = vi.fn().mockRejectedValue(new Error("offline"));
  const handle = createChatCommands({ send, maxUsers: 2 });
  for (const user of ["a", "b", "c"]) expect(handle(message(user, "1"), true)).toBe("welcome");
  expect(handle(message("a", "1"), true)).toBe("welcome");
  await Promise.resolve();
});

it("bounds queued command replies and contains synchronous sender failures", async () => {
  const send = vi.fn(() => new Promise<void>(() => {}));
  const handle = createChatCommands({ send });
  for (let i = 0; i < 1000; i++) handle(message(String(i), "!why"), false);
  expect(send).toHaveBeenCalledTimes(20);
  const broken = createChatCommands({ send: () => { throw new Error("private failure"); } });
  expect(() => broken(message("a", "!why"), false)).not.toThrow();
});
