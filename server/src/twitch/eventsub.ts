import { EventEmitter } from "node:events";
import { z } from "zod";
import { HttpError, requestJson, validateToken, type TwitchConfig } from "./auth.js";

export interface ChatMessage {
  messageId: string; userId: string; userLogin: string; text: string; timestamp: string;
}
export type Socket = Pick<WebSocket, "addEventListener" | "close">;
interface Dependencies {
  fetcher?: typeof fetch;
  socketFactory?: (url: string) => Socket;
  saveTokens?: (access: string, refresh: string) => Promise<void>;
  now?: () => number;
}
const endpoint = "wss://eventsub.wss.twitch.tv/ws";
/** Twitch: reject events older than 10 minutes (replay protection) and revalidate a kept session hourly. */
export const MAX_EVENT_AGE_MS = 10 * 60 * 1000;
export const VALIDATE_EVERY_MS = 60 * 60 * 1000;
export const isStale = (timestamp: string, now = Date.now()) => {
  const at = Date.parse(timestamp);
  return !Number.isFinite(at) || now - at > MAX_EVENT_AGE_MS;
};
const envelope = z.object({
  metadata: z.object({ message_id: z.string(), message_type: z.string(),
    message_timestamp: z.string(), subscription_type: z.string().optional() }),
  payload: z.object({ session: z.object({ id: z.string(),
    keepalive_timeout_seconds: z.number().positive().nullable().optional(),
    reconnect_url: z.string().nullable().optional() }).optional(),
  event: z.object({ chatter_user_id: z.string(), chatter_user_login: z.string(),
    message: z.object({ text: z.string() }) }).optional() }),
});
const closeReasons: Record<number, string> = {
  4000: "internal server error", 4001: "prohibited client traffic",
  4002: "ping-pong failure", 4003: "subscription deadline missed",
  4004: "reconnect grace expired", 4005: "network timeout",
  4006: "network error", 4007: "invalid reconnect URL",
};

export class EventSubClient extends EventEmitter<{
  chatMessage: [ChatMessage]; ready: []; status: [string]; fault: [Error];
}> {
  private readonly fetcher: typeof fetch;
  private readonly factory: (url: string) => Socket;
  private active?: Socket;
  private pending?: Socket;
  private timers = new Map<Socket, ReturnType<typeof setTimeout>>();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private validateTimer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private seen = new Map<string, true>();
  private stopped = true;
  private attempts = 0;
  private initial?: { resolve: () => void; reject: (error: Error) => void };

  constructor(private config: TwitchConfig, private deps: Dependencies = {}) {
    super();
    this.fetcher = deps.fetcher ?? fetch;
    this.factory = deps.socketFactory ?? ((url) => new WebSocket(url));
    this.now = deps.now ?? Date.now;
  }

  /** Hourly check required by Twitch for apps that keep a user session; refreshes when a client secret is set. */
  async revalidate(): Promise<boolean> {
    try { await validateToken(this.config, this.fetcher, this.deps.saveTokens); return true; }
    catch (error) {
      this.emit("status", "Twitch token check failed: " + (error instanceof Error ? error.message : "unknown error"));
      return false;
    }
  }

  async start(): Promise<void> {
    if (!this.stopped) throw new Error("EventSub client is already started.");
    this.stopped = false;
    try { await validateToken(this.config, this.fetcher, this.deps.saveTokens); }
    catch (error) { this.stopped = true; throw error; }
    if (this.stopped) return;
    this.validateTimer = setInterval(() => { void this.revalidate(); }, VALIDATE_EVERY_MS);
    this.validateTimer.unref?.();
    return new Promise<void>((resolve, reject) => {
      this.initial = { resolve, reject };
      this.connect(endpoint, false);
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.validateTimer);
    for (const socket of [...this.timers.keys()]) this.drop(socket);
    this.active = this.pending = undefined;
    this.initial?.reject(new Error("EventSub stopped before it was ready."));
    this.initial = undefined;
  }

  private fail(error: Error) {
    this.initial?.reject(error);
    this.initial = undefined;
    this.stop();
    this.emit("fault", error);
  }

  private drop(socket: Socket) {
    clearTimeout(this.timers.get(socket));
    this.timers.delete(socket);
    if (this.active === socket) this.active = undefined;
    if (this.pending === socket) this.pending = undefined;
    socket.close();
  }

  private arm(socket: Socket, milliseconds: number) {
    clearTimeout(this.timers.get(socket));
    this.timers.set(socket, setTimeout(() => {
      if (this.stopped) return;
      this.emit("status", "EventSub connection timed out; reconnecting.");
      this.restart();
    }, milliseconds));
  }

  private restart() {
    if (this.stopped || this.retryTimer) return;
    for (const socket of [...this.timers.keys()]) this.drop(socket);
    if (++this.attempts > 8) return this.fail(new Error("EventSub reconnection attempts exhausted."));
    const delay = Math.min(1000 * 2 ** (this.attempts - 1), 30000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect(endpoint, false);
    }, delay);
  }

  private connect(url: string, transfer: boolean) {
    if (this.stopped) return;
    let socket: Socket;
    try { socket = this.factory(url); }
    catch { this.restart(); return; }
    this.pending = socket;
    // Covers DNS, TLS, WebSocket handshake and missing welcome.
    this.arm(socket, 10000);
    let welcomed = false;
    let keepaliveMs = 10000;
    socket.addEventListener("message", (event) => {
      if (this.stopped || !this.timers.has(socket)) return;
      let raw: unknown;
      try { raw = JSON.parse(String(event.data)); } catch { return; }
      const parsed = envelope.safeParse(raw);
      if (!parsed.success) return;
      const { metadata, payload } = parsed.data;
      if (metadata.message_type === "session_welcome") {
        if (welcomed || !payload.session) return;
        welcomed = true;
        keepaliveMs = (payload.session.keepalive_timeout_seconds ?? 10) * 1000;
        this.arm(socket, keepaliveMs);
        const old = this.active;
        this.active = socket;
        this.pending = undefined;
        if (old && old !== socket) this.drop(old);
        if (transfer) this.markReady();
        else void this.subscribe(payload.session.id).then(() => {
          if (this.active === socket && !this.stopped) this.markReady();
        }).catch((error: unknown) => {
          if (this.active !== socket || this.stopped) return;
          if (error instanceof HttpError && error.status >= 400 && error.status < 500)
            this.fail(new Error(`EventSub subscription rejected (HTTP ${error.status}); check token scopes and user IDs.`));
          else this.restart();
        });
      } else if (metadata.message_type === "session_keepalive") {
        if (welcomed) this.arm(socket, keepaliveMs);
      } else if (metadata.message_type === "session_reconnect") {
        if (socket === this.active && !this.pending && payload.session?.reconnect_url)
          this.connect(payload.session.reconnect_url, true);
      } else if (metadata.message_type === "revocation") {
        this.fail(new Error("Twitch revoked the chat subscription; reauthorize the bot."));
      } else if (metadata.message_type === "notification" && welcomed) {
        this.arm(socket, keepaliveMs);
        if (this.seen.has(metadata.message_id)) {
          this.seen.delete(metadata.message_id);
          this.seen.set(metadata.message_id, true);
          return;
        }
        this.seen.set(metadata.message_id, true);
        if (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value!);
        if (metadata.subscription_type !== "channel.chat.message" || !payload.event) return;
        if (isStale(metadata.message_timestamp, this.now())) return;
        this.emit("chatMessage", { messageId: metadata.message_id,
          userId: payload.event.chatter_user_id, userLogin: payload.event.chatter_user_login,
          text: payload.event.message.text, timestamp: metadata.message_timestamp });
      }
    });
    socket.addEventListener("error", () => {
      if (this.timers.has(socket) && !this.stopped) this.restart();
    });
    socket.addEventListener("close", (event) => {
      if (!this.timers.has(socket) || this.stopped) return;
      this.emit("status", `EventSub closed (${event.code}: ${closeReasons[event.code] ?? "connection closed"}).`);
      if (event.code === 4001 || event.code === 4002) {
        this.fail(new Error(`EventSub protocol failure (${event.code}); restart after checking the WebSocket implementation.`));
      } else if (socket === this.active && this.pending) {
        // The replacement is already connecting; its welcome timer remains in force.
        this.drop(socket);
      } else this.restart();
    });
  }

  private markReady() {
    this.attempts = 0;
    this.initial?.resolve();
    this.initial = undefined;
    this.emit("ready");
  }

  private async subscribe(sessionId: string) {
    await requestJson("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST", headers: { Authorization: `Bearer ${this.config.userToken}`,
        "Client-Id": this.config.clientId, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "channel.chat.message", version: "1",
        condition: { broadcaster_user_id: this.config.broadcasterUserId, user_id: this.config.botUserId },
        transport: { method: "websocket", session_id: sessionId } }),
    }, this.fetcher);
  }
}
