import type { Decision, Truth, Preview } from "../consensus/engine.js";
import type { LedgerPort } from "../ledger/ledger.js";
import type { ChatMessage } from "../twitch/eventsub.js";
import type { VoteLabel } from "../votes/parse.js";
import type { CrowdConfig } from "../../../sim/src/crowd.js";
import type { CachedDebate } from "../debate/cache.js";
import type { CrewMember } from "./crew.js";
export interface DebateArgument { claim: string; box?: { x: number; y: number; width: number; height: number } }
export interface PublicState {
  missionId: string; source: "sim" | "twitch"; phase: "idle" | "voting" | "decided" | "complete" | "stopped";
  mission: { name: string; place: string; eventDate: string; preDate: string; postDate: string; attribution: string };
  live: Preview;
  stats: { goldChecked: number; goldCorrect: number; validated: number; refused: number; remaining: number; total: number };
  lastResult: (Pick<Decision, "status" | "label" | "agreement" | "voters" | "reason"> & {
    tileNumber: number; gold?: { truth: Truth; chatCorrect: boolean };
    ai?: { label: Truth; agreedWithChat: boolean } }) | null;
  serverNow: number;
  pauseReason?: string;
  debate?: { advocate: DebateArgument; skeptic: DebateArgument };
  /** Mixed mode: real Twitch chat votes join the simulated crowd. */
  liveChat?: boolean;
  /** The newest accepted real chat vote, shown briefly on the overlay. */
  liveVote?: { login: string; label: VoteLabel; at: number };
  /** Who matched the experts most often on decided hidden checks; credit only, never a weight or a label. */
  crew?: CrewMember[];
  attribution: string; refusedCount: number;
  tile?: { token: string; number: number; lon: number; lat: number;
    openedAt: number; closesAt: number; imageryUrl: string };
  votes: { destroyed: number; intact: number; unsure: number; total: number };
  decision?: Decision; baseline?: Decision; reveal?: { gold: true; truth: Truth };
}
export interface Clock { now(): number; wait(ms: number, signal: AbortSignal): Promise<void> }
export interface TwitchSource {
  on(event: "chatMessage", listener: (message: ChatMessage) => void): unknown;
  on(event: "fault", listener: (error: Error) => void): unknown;
  off(event: "chatMessage", listener: (message: ChatMessage) => void): unknown;
  off(event: "fault", listener: (error: Error) => void): unknown;
  start(): Promise<void>;
  stop(): void;
}
export interface RunnerOptions {
  missionId: string; source: "sim" | "twitch"; seed?: number; runId?: string;
  crowd?: Partial<Omit<CrowdConfig, "seed">>; goldOnly?: boolean; maxTiles?: number;
  virtual?: boolean; clock?: Clock; ledger?: LedgerPort;
  twitch?: TwitchSource;
  sendChat?: (text: string) => Promise<void>;
  loadDebate?: (buildingId: string) => CachedDebate | null;
  fixedTiles?: readonly string[]; votingMs?: number; pauseMs?: number; pauseAfterLast?: boolean;
  gradedWork?: boolean; video?: boolean;
  /** Add real Twitch chat votes to a simulated crowd (mixed mode). */
  liveChat?: boolean;
  /** Called for every chat message after vote handling, for commands such as !why. */
  onChat?: (message: ChatMessage, accepted: boolean) => void;
}
