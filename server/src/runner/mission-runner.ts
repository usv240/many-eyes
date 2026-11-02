import { EventEmitter } from "node:events";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { getMission, goldTruth, nextTile, seededRng } from "../missions/mission.js";
import { openSession, closeSession, collectVote, preview, updateGoldWeights, type TileSession } from "../consensus/engine.js";
import type { DecidedGold } from "../consensus/metrics.js";
import { Ledger, type LedgerPort } from "../ledger/ledger.js";
import { EventSubClient, type ChatMessage } from "../twitch/eventsub.js";
import { readConfig } from "../twitch/auth.js";
import { createChatSender } from "../twitch/send.js";
import { parseVote, type VoteLabel } from "../votes/parse.js";
import { createCrowd, createTileScenario, simulateVotes } from "../../../sim/src/crowd.js";
import { readCachedDebate, publicDebate } from "../debate/cache.js";
import { Crew } from "./crew.js";
import { liveScenario } from "./scenario.js";

import type { PublicState, Clock, RunnerOptions } from "./types.js";
import { Admission } from "./admission.js";

const publicTokenKey = randomBytes(32);
export type { PublicState, Clock, TwitchSource, RunnerOptions, DebateArgument } from "./types.js";
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
  private readonly admission = new Admission();
  private readonly publicTiles = new Map<string, string>();
  private weights = new Map<string, number>();
  private readonly crew = new Crew();
  private readonly logins = new Map<string, string>();
  private session?: TileSession;
  private started = false;
  private fault?: Error;
  private pauseReason?: string;
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
    if (options.fixedTiles?.some((id) => !this.mission.buildings.some((b) => b.id === id))) throw new Error("Unknown fixed tile.");
    if (options.video && options.source !== "sim") throw new Error("Video mode requires a simulated crowd.");
    if (options.liveChat && (options.virtual || options.source !== "sim")) throw new Error("Live chat mixing needs a real-time simulated crowd.");
    const total = Math.min(options.maxTiles ?? Infinity, options.fixedTiles?.length ?? (options.goldOnly ? this.mission.gold.length : this.mission.buildings.length));
    this.state = { missionId: this.mission.id, source: options.source, phase: "idle",
      mission: { name: this.mission.name, place: "Syaphru Besi, Rasuwa, Nepal", eventDate: this.mission.event_date,
        preDate: this.mission.pre_scene.acquired, postDate: this.mission.post_scene.acquired, attribution: this.mission.attribution },
      live: { agreement: 0, leading: null, voters: 0, unsure: 0 }, lastResult: null, serverNow: this.clock.now(),
      stats: { goldChecked: 0, goldCorrect: 0, validated: 0, refused: 0, remaining: total, total },
      attribution: this.mission.attribution, refusedCount: 0, ...(options.liveChat ? { liveChat: true } : {}),
      votes: { destroyed: 0, intact: 0, unsure: 0, total: 0 } };
  }
  getState() { return structuredClone({ ...this.state, serverNow: this.clock.now() }); }
  resolveTile(token: string) {
    const buildingId = this.publicTiles.get(token);
    return buildingId ? { missionId: this.mission.id, buildingId } : undefined;
  }
  getWeights() { return new Map(this.weights); }
  getRefusedQueue() { return [...this.refused]; }
  stop(reason = "Mission was stopped.") { this.pauseReason = reason; this.controller.abort(); }
  private publish() { this.emit("state", this.getState()); }

  ingestChat(message: ChatMessage): boolean {
    if (!message.messageId || message.userId.startsWith("sim_") || this.admission.has(message.messageId)) return false;
    const label = parseVote(message.text);
    if (!label && !this.admission.message(message.messageId)) return false;
    const accepted = label ? this.acceptVote(message.messageId, message.userId, label, Date.parse(message.timestamp),
      message.userLogin || message.userId) : false;
    this.options.onChat?.(message, accepted);
    return accepted;
  }
  private acceptVote(messageId: string, userId: string, label: VoteLabel, timestamp: number, login?: string): boolean {
    if (!messageId || !this.admission.message(messageId)) return false;
    const session = this.session;
    const now = this.clock.now();
    if (!session || !Number.isFinite(timestamp) || timestamp < session.openedAt || timestamp >= session.closesAt ||
        now < session.openedAt || now >= session.closesAt || session.closed || !this.admission.user(userId)) return false;
    const vote = { userId, label, weight: this.weights.get(userId) ?? 1 };
    const next = collectVote(session, vote, now);
    this.ledger.append("vote", { missionId: this.mission.id, runId: this.runId,
      tileId: session.id, messageId, ...vote, receivedAt: now, timestamp }, now);
    this.session = next;
    this.state.votes = { destroyed: 0, intact: 0, unsure: 0, total: next.votes.length };
    for (const item of next.votes) this.state.votes[item.label]++;
    this.state.live = preview(next);
    if (login) { this.state.liveVote = { login, label, at: now }; if (this.logins.size < 10_000) this.logins.set(userId, login); }
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
    const useTwitch = this.options.source === "twitch" || !!this.options.liveChat;
    if (useTwitch && !twitch) {
      const config = readConfig();
      twitch = new EventSubClient(config);
      sendChat ??= createChatSender(config);
    }
    const onChat = (message: ChatMessage) => {
      try { this.ingestChat(message); }
      catch (error) {
        this.fault = new Error("Vote recording failed: " + (error instanceof Error ? error.message : "unknown ledger error"));
        this.stop(this.fault.message);
      }
    };
    const onFault = (error: Error) => { this.fault = new Error("Twitch connection failed: " + error.message); this.stop(this.fault.message); };
    try {
      if (useTwitch) {
        if (!sendChat) throw new Error("A Twitch runner needs a chat sender.");
        twitch!.on("chatMessage", onChat); twitch!.on("fault", onFault);
        await twitch!.start();
      }
      signal.throwIfAborted();
      this.ledger.append("mission_started", { missionId: this.mission.id, runId: this.runId,
        ...((this.options.gradedWork ?? !this.options.virtual) ? { simulationPolicy: "graded-work-v1" } : {}),
        ...(this.options.video ? { video: true, fixedTiles: this.options.fixedTiles } : {}),
        source: this.options.source, seed, crowd: this.options.source === "sim" ? { voters: 10, ...this.options.crowd } : null },
      this.clock.now());
      const limit = this.state.stats.total;
      for (let index = 0; index < limit && !signal.aborted; index++) {
        const buildingId = this.options.fixedTiles?.[index] ?? (this.options.goldOnly ? this.mission.gold[index]!.building_id : nextTile(this.mission.id, rng).buildingId);
        const building = this.mission.buildings.find(({ id }) => id === buildingId)!;
        const token = createHmac("sha256", publicTokenKey).update(this.runId + buildingId).digest("hex").slice(0, 12);
        if (this.publicTiles.has(token) && this.publicTiles.get(token) !== buildingId) throw new Error("Public tile token collision.");
        this.publicTiles.set(token, buildingId);
        // Disk-only, hash-checked context. Virtual benchmarks never consult live caches.
        const cached = this.options.loadDebate ? this.options.loadDebate(buildingId)
          : this.options.virtual ? null : readCachedDebate(buildingId, this.mission.id);
        const session = openSession(this.runId + ":" + (index + 1), this.clock.now(), this.options.votingMs);
        this.session = session;
        // Construct the public projection explicitly; no mission/building object is spread into it.
        this.state = { missionId: this.mission.id, source: this.options.source, phase: "voting",
          mission: this.state.mission, stats: this.state.stats, live: preview(session), serverNow: this.clock.now(),
          // Keep the previous result's public scores, but clear gold metadata during the next voting window.
          lastResult: this.state.lastResult ? { tileNumber: this.state.lastResult.tileNumber,
            status: this.state.lastResult.status, label: this.state.lastResult.label, agreement: this.state.lastResult.agreement,
            voters: this.state.lastResult.voters, reason: this.state.lastResult.reason } : null,
          attribution: this.mission.attribution, refusedCount: this.refused.length,
          ...(this.options.liveChat ? { liveChat: true } : {}), ...(this.crew.top().length ? { crew: this.crew.top() } : {}),
          ...(cached ? { debate: publicDebate(cached.debate) } : {}),
          tile: { token, number: index + 1, lon: Number(building.lon.toFixed(4)), lat: Number(building.lat.toFixed(4)),
            openedAt: session.openedAt, closesAt: session.closesAt,
            imageryUrl: "/api/tiles/" + token },
          votes: { destroyed: 0, intact: 0, unsure: 0, total: 0 } };
        this.ledger.append("tile_opened", { missionId: this.mission.id, runId: this.runId, id: session.id, buildingId,
          number: index + 1, lon: building.lon, lat: building.lat, openedAt: session.openedAt, closesAt: session.closesAt }, session.openedAt);
        this.publish();
        const truth = goldTruth(buildingId, this.mission.id);
        let matchedLive: string[] = [];
        let difficulty: "easy" | "hard" | "misleading" | undefined;
        if (this.options.source === "sim") {
          const tileSeed = seed ^ Math.imul(index + 1, 0x9e3779b1);
          const scenario = (this.options.gradedWork ?? !this.options.virtual)
            ? liveScenario(tileSeed, truth, building.expert_grade, this.options.crowd?.raidProbability)
            : createTileScenario(tileSeed, truth ?? "possibly damaged", this.options.crowd?.raidProbability);
          difficulty = scenario.difficulty;
          const votes = simulateVotes(crowd, truth ?? "possibly damaged", tileSeed, session.id,
            { hardAccuracyMultiplier: this.options.crowd?.hardAccuracyMultiplier,
              raidProbability: this.options.crowd?.raidProbability, scenario });
          for (const vote of votes) {
            const delay = Math.floor(vote.delayMs * (session.closesAt - session.openedAt) / 15000);
            await this.clock.wait(Math.max(0, session.openedAt + delay - this.clock.now()), signal);
            this.acceptVote(vote.messageId, vote.userId, vote.label, session.openedAt + delay);
          }
        }
        await this.clock.wait(Math.max(0, session.closesAt - this.clock.now()), signal);
        this.session = closeSession(this.session!, this.clock.now());
        const decision = this.ledger.recordDecision(this.session, { missionId: this.mission.id, runId: this.runId,
          buildingId, ...(truth ? { truth } : {}), ...(difficulty ? { difficulty } : {}),
          ...(cached ? { model_label: cached.debate.model_label, ai_model: cached.model } : {}) });
        if (truth) {
          const updated = updateGoldWeights(this.weights, this.session, truth);
          for (const [userId, weight] of updated) {
            const previous = this.weights.get(userId) ?? 1;
            if (weight !== previous) this.ledger.append("weight_updated",
              { missionId: this.mission.id, runId: this.runId, tileId: session.id, userId, previous, weight }, session.closesAt);
          }
          this.weights = updated;
          matchedLive = this.crew.credit(this.session.votes, truth, this.logins);
          this.gold.push({ truth, ...decision, ...(difficulty ? { difficulty } : {}) });
        }
        if (decision.weighted.status === "refused") this.refused.push(buildingId);
        const result = decision.weighted;
        const chatCorrect = !!truth && result.status === "validated" && result.label === truth;
        const stats = this.state.stats;
        this.state = { ...this.state, phase: "decided", decision: decision.weighted, baseline: decision.unweighted,
          live: preview(this.session),
          stats: { goldChecked: stats.goldChecked + Number(!!truth), goldCorrect: stats.goldCorrect + Number(chatCorrect),
            validated: stats.validated + Number(result.status === "validated"), refused: this.refused.length,
            remaining: stats.remaining - 1, total: stats.total },
          lastResult: { tileNumber: index + 1, status: result.status, label: result.label,
            agreement: result.agreement, voters: result.voters, reason: result.reason,
            ...(cached ? { ai: { label: cached.debate.model_label,
              agreedWithChat: result.status === "validated" && result.label === cached.debate.model_label } } : {}),
            ...(truth ? { gold: { truth, chatCorrect } } : {}) },
          refusedCount: this.refused.length, ...(truth ? { reveal: { gold: true, truth } } : {}),
          ...(this.crew.top().length ? { crew: this.crew.top() } : {}) };
        this.publish();
        if (useTwitch) {
          const result = decision.weighted;
          const text = result.status === "validated"
            ? "Tile " + (index + 1) + ": validated " + result.label + " (" + Math.round(result.agreement * 100) + "% agreement, " + result.voters + " voters)"
            : "Tile " + (index + 1) + ": refused (" + (result.reason === "low_agreement" ? "chat split" : "too few voters") + "), sent to expert review";
          // Hidden checks are revealed once decided, so the bot can thank the real viewers who matched the experts.
          const thanks = matchedLive.length ? " · matched the experts: " + matchedLive.slice(0, 3).join(", ") +
            (matchedLive.length > 3 ? " and " + (matchedLive.length - 3) + " more" : "") : "";
          try { await sendChat!(text + thanks); } catch { this.emit("warning", "Tile result could not be sent to Twitch."); }
        }
        if (index + 1 < limit || this.options.pauseAfterLast) await this.clock.wait(this.options.pauseMs ?? 5000, signal);
      }
      if (useTwitch && !signal.aborted) {
        const { validated, refused, goldChecked, goldCorrect } = this.state.stats;
        const checks = goldChecked ? `. Chat matched the experts on ${goldCorrect} of ${goldChecked} hidden checks` : "";
        try { await sendChat!(`Mission complete: ${validated} validated, ${refused} sent to expert review${checks}. Thank you, crew.`); }
        catch { this.emit("warning", "Mission summary could not be sent to Twitch."); }
      }
    } catch (error) {
      if (this.fault) throw this.fault;
      if (!signal.aborted) { this.stop(error instanceof Error ? error.message : "Unknown mission error."); throw error; }
    } finally {
      this.session = undefined;
      twitch?.off("chatMessage", onChat); twitch?.off("fault", onFault); twitch?.stop();
      this.state = { ...this.state, phase: signal.aborted ? "stopped" : "complete",
        ...(signal.aborted ? { pauseReason: this.pauseReason } : {}) };
      this.publish();
    }
    return structuredClone(this.gold);
  }
}
