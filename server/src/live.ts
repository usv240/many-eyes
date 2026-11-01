import { MissionRunner } from "./runner/mission-runner.js";
import type { LedgerPort } from "./ledger/ledger.js";
import { readConfig } from "./twitch/auth.js";
import { EventSubClient } from "./twitch/eventsub.js";
import { createChatSender } from "./twitch/send.js";

export interface LiveMission { runner: MissionRunner; start(): Promise<void>; stop(): Promise<void> }
export function readLiveConfig(env: NodeJS.ProcessEnv = process.env): { source: "sim" | "twitch"; seed: number } {
  const source = env.MANY_EYES_SOURCE?.trim() || "sim";
  const seed = Number(env.MANY_EYES_SEED?.trim() || "7");
  if (source !== "sim" && source !== "twitch") throw new Error("MANY_EYES_SOURCE must be sim or twitch.");
  if (!Number.isSafeInteger(seed)) throw new Error("MANY_EYES_SEED must be a safe integer.");
  return { source, seed };
}

/** One real-time mission per server instance. start() resolves when the first tile opens. */
export function createLive(options: { env?: NodeJS.ProcessEnv; ledger?: LedgerPort; onError?: (error: Error) => void } = {}): LiveMission {
  const env = options.env ?? process.env;
  const config = readLiveConfig(env);
  const twitch = config.source === "twitch" ? readConfig(env) : undefined;
  const runner = new MissionRunner({ missionId: "nepal-flood-2026", ...config, virtual: false,
    ledger: options.ledger, ...(twitch ? { twitch: new EventSubClient(twitch), sendChat: createChatSender(twitch) } : {}) });
  let ready: Promise<void> | undefined;
  let task: Promise<void> | undefined;
  return {
    runner,
    start() {
      if (ready) return ready;
      ready = new Promise<void>((resolve, reject) => {
        let opened = false;
        const onState = () => {
          if (runner.getState().phase !== "voting") return;
          opened = true;
          runner.off("state", onState);
          resolve();
        };
        runner.on("state", onState);
        task = runner.run().then(() => {
          runner.off("state", onState);
          if (!opened) reject(new Error("Live mission stopped before the first tile opened."));
        }, (error: unknown) => {
          runner.off("state", onState);
          if (!opened) reject(config.source === "twitch"
            ? new Error("Live Twitch mission failed to start. Check Twitch configuration and connectivity.")
            : new Error("Live simulation failed to start: " + (error instanceof Error ? error.message : "unknown startup error")));
          else (options.onError ?? ((cause: Error) => console.error("Live mission stopped: " + cause.message)))(
            error instanceof Error ? error : new Error(String(error)));
        });
      });
      return ready;
    },
    async stop() { runner.stop(); await task; },
  };
}
