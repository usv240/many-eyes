import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { getMission, goldTruth, nextTile, seededRng } from "../missions/mission.js";
import { openSession, closeSession, collectVote, updateGoldWeights, type TileSession, type Decision, type Truth } from "../consensus/engine.js";
import type { DecidedGold } from "../consensus/metrics.js";
import { Ledger, type LedgerPort } from "../ledger/ledger.js";
import { EventSubClient, type ChatMessage } from "../twitch/eventsub.js";
import { readConfig } from "../twitch/auth.js";
import { createChatSender } from "../twitch/send.js";
import { parseVote, type VoteLabel } from "../votes/parse.js";
import { createCrowd, createTileScenario, simulateVotes, type CrowdConfig } from "../../../sim/src/crowd.js";

export interface PublicState {
  missionId: string; source: "sim" | "twitch"; phase: "idle" | "voting" | "decided" | "complete" | "stopped";
  attribution: string; refusedCount: number;
  tile?: { id: string; buildingId: string; number: number; lon: number; lat: number;
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
}
function makeClock(virtual: boolean): Clock {
  let now = 0;
  return virtual ? { now: () => now, wait: async (ms, signal) => { signal.throwIfAborted(); now += ms; } }
    : { now: Date.now, wait: async (ms, signal) => { await sleep(ms, undefined, { signal }); } };
}

export class MissionRunner extends EventEmitter<{ state: [PublicState]; warning: [string] }> {
  private readonly mission;
  private readonly ledger: LedgerPort;
  private readonly clock: Clock;
  private readonly controller = new AbortController();
  private readonly seen = new Set<string>();
  private weights = new Map<string, number>();
  private session?: TileSession;
  private started = false;
  private fault?: Error;
  private state: PublicState;
  private refused: string[] = [];
  private gold: DecidedGold[] = [];
  readonly runId: string;
  constructor(private readonly options: RunnerOptions) {
    super();
    if (options.virtual && options.source === "twitch") throw new Error("Virtual time is only available for simulation.");
    this.mission = getMission(options.missionId);
    this.ledger = options.ledger ?? new Ledger();
    this.clock = options.clock ?? makeClock(options.virtual ?? false);
    this.runId = options.runId ?? randomUUID();
    this.state = { missionId: this.mission.id, source: options.source, phase: "idle",
      attribution: this.mission.attribution, refusedCount: 0,
      votes: { destroyed: 0, intact: 0, unsure: 0, total: 0 } };
  }
  getState() { return structuredClone(this.state); }
  getWeights() { return new Map(this.weights); }
  getRefusedQueue() { return [...this.refused]; }
  stop() { this.controller.abort(); }
  private publish() { this.emit("state", this.getState()); }

  ingestChat(message: ChatMessage): boolean {
    const label = parseVote(message.text);
    return label ? this.acceptVote(message.messageId, message.userId, label, Date.parse(message.timestamp)) : false;
  }
  private acceptVote(messageId: string, userId: string, label: VoteLabel, timestamp: number): boolean {
    if (!messageId || this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    const session = this.session;
    const now = this.clock.now();
    if (!session || !Number.isFinite(timestamp) || timestamp < session.openedAt || timestamp >= session.closesAt ||
        now < session.openedAt || now >= session.closesAt || session.closed) return false;
    const vote = { userId, label, weight: this.weights.get(userId) ?? 1 };
    const next = collectVote(session, vote, now);
    this.ledger.append("vote", { missionId: this.mission.id, runId: this.runId,
      tileId: session.id, messageId, ...vote, receivedAt: now, timestamp }, now);
    this.session = next;
    this.state.votes = { destroyed: 0, intact: 0, unsure: 0, total: next.votes.length };
    for (const item of next.votes) this.state.votes[item.label]++;
    this.publish();
    return true;
  }

  async run(): Promise<DecidedGold[]> {
    if (this.started) throw new Error("A mission runner may only run once.");
    this.started = true;
    const signal = this.controller.signal;
    const seed = this.options.seed ?? 1;
    const rng = seededRng(seed);
    const crowd = this.options.source === "sim" ? createCrowd({ seed, voters: 10, ...this.options.crowd }) : [];
    let twitch = this.options.twitch;
    let sendChat = this.options.sendChat;
    if (this.options.source === "twitch" && !twitch) {
      const config = readConfig();
      twitch = new EventSubClient(config);
      sendChat ??= createChatSender(config);
    }
    const onChat = (message: ChatMessage) => {
      try { this.ingestChat(message); }
      catch { this.fault = new Error("Vote recording failed; mission stopped."); this.stop(); }
    };
    const onFault = () => { this.fault = new Error("Twitch connection failed; mission stopped."); this.stop(); };
    try {
      if (this.options.source === "twitch") {
        if (!sendChat) throw new Error("A Twitch runner needs a chat sender.");
        twitch!.on("chatMessage", onChat); twitch!.on("fault", onFault);
        await twitch!.start();
      }
      signal.throwIfAborted();
      this.ledger.append("mission_started", { missionId: this.mission.id, runId: this.runId,
        source: this.options.source, seed, crowd: this.options.source === "sim" ? { voters: 10, ...this.options.crowd } : null },
      this.clock.now());
      const total = this.options.goldOnly ? this.mission.gold.length : this.mission.buildings.length;
      const limit = Math.min(total, this.options.maxTiles ?? total);
      for (let index = 0; index < limit && !signal.aborted; index++) {
        const buildingId = this.options.goldOnly ? this.mission.gold[index]!.building_id : nextTile(this.mission.id, rng).buildingId;
        const building = this.mission.buildings.find(({ id }) => id === buildingId)!;
        const session = openSession(this.runId + ":" + (index + 1), this.clock.now());
        this.session = session;
        // Construct the public projection explicitly; no mission/building object is spread into it.
        this.state = { missionId: this.mission.id, source: this.options.source, phase: "voting",
          attribution: this.mission.attribution, refusedCount: this.refused.length,
          tile: { id: session.id, buildingId, number: index + 1, lon: building.lon, lat: building.lat,
            openedAt: session.openedAt, closesAt: session.closesAt,
            imageryUrl: "/api/missions/" + this.mission.id + "/tiles/" + buildingId },
          votes: { destroyed: 0, intact: 0, unsure: 0, total: 0 } };
        this.ledger.append("tile_opened", { missionId: this.mission.id, runId: this.runId, ...this.state.tile }, session.openedAt);
        this.publish();
        const truth = goldTruth(buildingId, this.mission.id);
        let difficulty: "easy" | "hard" | "misleading" | undefined;
        if (this.options.source === "sim") {
          const tileSeed = seed ^ Math.imul(index + 1, 0x9e3779b1);
          const scenario = createTileScenario(tileSeed, truth ?? "possibly damaged", this.options.crowd?.raidProbability);
          difficulty = scenario.difficulty;
          const votes = simulateVotes(crowd, truth ?? "possibly damaged", tileSeed, session.id,
            { hardAccuracyMultiplier: this.options.crowd?.hardAccuracyMultiplier,
              raidProbability: this.options.crowd?.raidProbability, scenario });
          for (const vote of votes) {
            await this.clock.wait(Math.max(0, session.openedAt + vote.delayMs - this.clock.now()), signal);
            this.acceptVote(vote.messageId, vote.userId, vote.label, session.openedAt + vote.delayMs);
          }
        }
        await this.clock.wait(Math.max(0, session.closesAt - this.clock.now()), signal);
        this.session = closeSession(this.session!, this.clock.now());
        const decision = this.ledger.recordDecision(this.session, { missionId: this.mission.id, runId: this.runId,
          buildingId, ...(truth ? { truth } : {}), ...(difficulty ? { difficulty } : {}) });
        if (truth) {
          const updated = updateGoldWeights(this.weights, this.session, truth);
          for (const [userId, weight] of updated) {
            const previous = this.weights.get(userId) ?? 1;
            if (weight !== previous) this.ledger.append("weight_updated",
              { missionId: this.mission.id, runId: this.runId, tileId: session.id, userId, previous, weight }, session.closesAt);
          }
          this.weights = updated;
          this.gold.push({ truth, ...decision, ...(difficulty ? { difficulty } : {}) });
        }
        if (decision.weighted.status === "refused") this.refused.push(buildingId);
        this.state = { ...this.state, phase: "decided", decision: decision.weighted, baseline: decision.unweighted,
          refusedCount: this.refused.length, ...(truth ? { reveal: { gold: true, truth } } : {}) };
        this.publish();
        if (this.options.source === "twitch") {
          const result = decision.weighted;
          const text = result.status === "validated"
            ? "Tile " + (index + 1) + ": VALIDATED " + result.label + " (agreement " + result.agreement.toFixed(2) + ", " + result.voters + " voters)"
            : "Tile " + (index + 1) + ": REFUSED (" + result.reason + "), sent to experts";
          try { await sendChat!(text); } catch { this.emit("warning", "Tile result could not be sent to Twitch."); }
        }
        if (index + 1 < limit) await this.clock.wait(5000, signal);
      }
    } catch (error) {
      if (this.fault) throw this.fault;
      if (!signal.aborted) { this.stop(); throw error; }
    } finally {
      this.session = undefined;
      twitch?.off("chatMessage", onChat); twitch?.off("fault", onFault); twitch?.stop();
      this.state = { ...this.state, phase: signal.aborted ? "stopped" : "complete" };
      this.publish();
    }
    return structuredClone(this.gold);
  }
}
