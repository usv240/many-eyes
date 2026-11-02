import type { ChatMessage } from "./eventsub.js";

export const WHY_TEXT = "Many Eyes turns this chat into a disaster-mapping crew: you check satellite photos of buildings " +
  "after the August 2026 Nepal flood, and hidden expert checks keep the results honest. " +
  "Validated buildings export as map data for humanitarian mappers.";
export const WELCOME_TEXT = "thanks! 1 = destroyed, 2 = intact, 3 = unsure. Hidden checks weight your vote.";
const WHY_COOLDOWN_MS = 60_000;

export interface CommandOptions {
  send: (text: string) => Promise<void>;
  repoUrl?: string;
  now?: () => number;
  /** Cap on remembered users, so a long stream cannot grow memory without bound. */
  maxUsers?: number;
}

/**
 * Chat replies that sit beside voting, never inside it. Replies go through the caller's send queue,
 * which already enforces one message per second. Nothing here can change a vote or a label.
 */
export function createChatCommands(options: CommandOptions) {
  const now = options.now ?? Date.now;
  const maxUsers = options.maxUsers ?? 10_000;
  const welcomed = new Set<string>();
  const lastWhy = new Map<string, number>();
  const makeRoom = (store: Set<string> | Map<string, number>) => {
    if (store.size < maxUsers) return;
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  };
  let pending = 0;
  const reply = (text: string) => {
    pending++;
    try { void options.send(text).catch(() => {}).finally(() => { pending--; }); }
    catch { pending--; }
  };

  return (message: ChatMessage, accepted: boolean): "why" | "welcome" | null => {
    if (pending >= 20) return null; // Bound queued replies even when new callers keep arriving.
    const text = message.text.trim().toLowerCase();
    const login = message.userLogin || message.userId;
    if (text === "!why") {
      const last = lastWhy.get(message.userId);
      if (last !== undefined && now() - last < WHY_COOLDOWN_MS) return null;
      makeRoom(lastWhy);
      lastWhy.set(message.userId, now());
      reply("@" + login + " " + WHY_TEXT + (options.repoUrl ? " Code: " + options.repoUrl : ""));
      return "why";
    }
    if (accepted && !welcomed.has(message.userId)) {
      makeRoom(welcomed);
      welcomed.add(message.userId);
      reply("@" + login + " " + WELCOME_TEXT);
      return "welcome";
    }
    return null;
  };
}
