import { MissionRunner, type RunnerOptions } from "./runner/mission-runner.js";
import type { LedgerPort } from "./ledger/ledger.js";
import { readConfig } from "./twitch/auth.js";
import { EventSubClient } from "./twitch/eventsub.js";
import { createChatSender } from "./twitch/send.js";
import { createChatCommands } from "./twitch/commands.js";
import { createMarker } from "./twitch/markers.js";

export interface LiveMission { runner: MissionRunner; start(): Promise<void>; stop(): Promise<void> }
export interface LiveConfig { source: "sim" | "twitch"; seed: number; liveChat: boolean }
export const DEFAULT_REPO_URL = "https://github.com/usv240/many-eyes";

/** sim: simulated crowd only. twitch: real chat only. mixed: simulated crowd plus real chat. */
export function readLiveConfig(env: NodeJS.ProcessEnv = process.env): LiveConfig {
  const mode = env.MANY_EYES_SOURCE?.trim() || "sim";
  const seed = Number(env.MANY_EYES_SEED?.trim() || "7");
  if (mode !== "sim" && mode !== "twitch" && mode !== "mixed") throw new Error("MANY_EYES_SOURCE must be sim, twitch or mixed.");
  if (!Number.isSafeInteger(seed)) throw new Error("MANY_EYES_SEED must be a safe integer.");
  return { source: mode === "twitch" ? "twitch" : "sim", seed, liveChat: mode === "mixed" };
}

/** One real-time mission per server instance. start() resolves when the first tile opens. */
export function createLive(options: { env?: NodeJS.ProcessEnv; ledger?: LedgerPort; onError?: (error: Error) => void;
  runnerOptions?: Partial<RunnerOptions>; onComplete?: (runId: string) => void } = {}): LiveMission {
  const env = options.env ?? process.env;
  const config = readLiveConfig(env);
  const usesTwitch = config.source === "twitch" || config.liveChat;
  const twitch = usesTwitch ? readConfig(env) : undefined;
  const sendChat = twitch ? createChatSender(twitch) : undefined;
  // The runner sends chat only for tile results; each result also becomes a stream marker on the saved video.
  const marker = twitch ? createMarker(twitch) : undefined;
  const sendResult = sendChat ? async (text: string) => { void marker?.("Many Eyes · " + text); await sendChat(text); } : undefined;
  const onChat = sendChat ? createChatCommands({ send: sendChat, repoUrl: env.REPO_URL?.trim() || DEFAULT_REPO_URL }) : undefined;
  const runner = new MissionRunner({ missionId: "nepal-flood-2026", ...config, virtual: false,
    ledger: options.ledger, ...options.runnerOptions,
    ...(twitch ? { twitch: new EventSubClient(twitch), sendChat: sendResult, onChat } : {}) });
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
          if (runner.getState().phase === "complete") options.onComplete?.(runner.runId);
        }).catch((error: unknown) => {
          runner.off("state", onState);
          const reason = error instanceof Error ? error.message : "unknown startup error";
          if (!opened) reject(usesTwitch
            ? new Error("Live Twitch mission failed to start: " + reason + " Check the Twitch token in .env " +
              "(twitch token -u -s \"user:read:chat user:write:chat user:bot channel:bot channel:manage:broadcast\").")
            : new Error("Live simulation failed to start: " + reason));
          else (options.onError ?? ((cause: Error) => console.error("Live mission stopped: " + cause.message)))(
            error instanceof Error ? error : new Error(String(error)));
        });
      });
      return ready;
    },
    async stop() { runner.stop(); await task; },
  };
}
