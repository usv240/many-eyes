import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, readSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { decide, decideUnweighted, type TileSession, type Truth } from "../consensus/engine.js";

export type EventType = "mission_started" | "tile_opened" | "vote" | "tile_decided" | "weight_updated" | "export_written";
export interface LedgerEvent { type: EventType; timestamp: number; data: Record<string, unknown> }
export interface RecordLine extends LedgerEvent { prev_hash: string; hash: string }
export interface DecisionContext { missionId: string; runId: string; buildingId: string; truth?: Truth;
  difficulty?: "easy" | "hard" | "misleading" }
export interface LedgerPort {
  append(type: Exclude<EventType, "tile_decided">, data: Record<string, unknown>, timestamp: number): void;
  recordDecision(session: TileSession, context: DecisionContext): ReturnType<typeof decisions>;
}
function decisions(session: TileSession) {
  return { weighted: decide(session), unweighted: decideUnweighted(session) };
}
const GENESIS = "0".repeat(64);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const eventTypes: string[] = ["mission_started", "tile_opened", "vote", "tile_decided", "weight_updated", "export_written"];
const broken = (line: number): never => { throw new Error("Ledger integrity failure at line " + line + "."); };

/** Both the full-line chain and record checksums are verified, including the final record. */
export function verify(path = "data/ledger.jsonl"): { lines: number; head: string } {
  if (!existsSync(path)) {
    if (existsSync(path + ".head")) broken(1);
    return { lines: 0, head: GENESIS };
  }
  let previous = GENESIS;
  let lineNumber = 0;
  let pending = "";
  const decoder = new StringDecoder("utf8");
  const fd = openSync(path, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  const verifyLine = (line: string, number: number) => {
    try {
      const record = JSON.parse(line) as RecordLine;
      const { hash, ...payload } = record;
      if (!eventTypes.includes(record.type) || !Number.isFinite(record.timestamp) || !record.data ||
          record.prev_hash !== previous || hash !== digest(JSON.stringify(payload)) ||
          line !== JSON.stringify(record)) broken(number);
      previous = digest(line);
    } catch { broken(number); }
  };
  try {
    let bytes: number;
    while ((bytes = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      pending += decoder.write(chunk.subarray(0, bytes));
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        lineNumber++;
        verifyLine(pending.slice(0, newline), lineNumber);
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    }
    pending += decoder.end();
  } finally {
    closeSync(fd);
  }
  if (pending.length) broken(lineNumber + 1);
  // Saved head detects deleted final lines; a plain prev_hash chain cannot.
  if (!existsSync(path + ".head")) broken(lineNumber || 1);
  try {
    const head = JSON.parse(readFileSync(path + ".head", "utf8")) as { lines: number; head: string };
    if (head.lines !== lineNumber || head.head !== previous) broken(lineNumber + 1);
  } catch { broken(lineNumber + 1); }
  return { lines: lineNumber, head: previous };
}

/** Single-process writer. The head sidecar must be retained with the ledger. */
export class Ledger {
  private head: string;
  private lines: number;
  constructor(readonly path = "data/ledger.jsonl") {
    const state = verify(path); this.head = state.head; this.lines = state.lines;
    mkdirSync(dirname(path), { recursive: true });
  }
  append(type: Exclude<EventType, "tile_decided">, data: Record<string, unknown>, timestamp: number) {
    if ((type as EventType) === "tile_decided") throw new Error("Use recordDecision(session) for tile_decided.");
    this.write({ type, data, timestamp });
  }
  recordDecision(session: TileSession, context: DecisionContext) {
    const { weighted, unweighted } = decisions(session);
    this.write({ type: "tile_decided", timestamp: session.closesAt,
      data: { ...context, tileId: session.id, session, weighted, unweighted } });
    return { weighted, unweighted };
  }
  private write(event: LedgerEvent) {
    this.writeBatch([event]);
  }
  /** Persist virtual-run events in one append; decisions are recomputed at this boundary. */
  appendBatch(events: readonly LedgerEvent[]) {
    const checked = events.map((event): LedgerEvent => {
      if (event.type !== "tile_decided") return event;
      const session = event.data.session as TileSession;
      return { ...event, data: { ...event.data, ...decisions(session) } };
    });
    this.writeBatch(checked);
  }
  private writeBatch(events: readonly LedgerEvent[]) {
    if (!events.length) return;
    // Detect another writer before append; never silently fork the chain.
    if (existsSync(this.path + ".head")) {
      const current = JSON.parse(readFileSync(this.path + ".head", "utf8")) as { head: string };
      if (current.head !== this.head) throw new Error("Ledger was changed by another writer.");
    }
    let head = this.head;
    const lines = events.map((event) => {
      if (!eventTypes.includes(event.type) || !Number.isFinite(event.timestamp)) throw new Error("Invalid ledger event.");
      const payload = { ...event, prev_hash: head };
      const line = JSON.stringify({ ...payload, hash: digest(JSON.stringify(payload)) });
      head = digest(line);
      return line;
    });
    appendFileSync(this.path, lines.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
    this.head = head; this.lines += lines.length;
    const temporary = this.path + ".head.tmp";
    writeFileSync(temporary, JSON.stringify({ lines: this.lines, head: this.head }));
    renameSync(temporary, this.path + ".head");
  }
  verify() { return verify(this.path); }
}

/** Same scoring boundary as the disk ledger, for virtual runs and tests. */
export class MemoryLedger implements LedgerPort {
  readonly events: LedgerEvent[] = [];
  append(type: Exclude<EventType, "tile_decided">, data: Record<string, unknown>, timestamp: number) {
    if ((type as EventType) === "tile_decided") throw new Error("Use recordDecision(session) for tile_decided.");
    this.events.push(structuredClone({ type, data, timestamp }));
  }
  recordDecision(session: TileSession, context: DecisionContext) {
    const result = decisions(session);
    this.events.push(structuredClone({ type: "tile_decided", timestamp: session.closesAt,
      data: { ...context, tileId: session.id, session, ...result } }));
    return result;
  }
}
