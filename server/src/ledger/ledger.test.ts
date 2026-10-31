import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Ledger, MemoryLedger, verify, type EventType } from "./ledger.js";
import { openSession, closeSession } from "../consensus/engine.js";
import { seededRng } from "../missions/mission.js";

const directories: string[] = [];
function path() { const directory = mkdtempSync(join(tmpdir(), "many-eyes-ledger-")); directories.push(directory); return join(directory, "ledger.jsonl"); }
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
it.each([1, 77, 9901])("detects edits to every record including the final line, seed %i", (seed) => {
  const file = path(); const ledger = new Ledger(file); const rng = seededRng(seed);
  for (let index = 0; index < 30; index++) ledger.append("vote", { sample: rng() }, index);
  const original = readFileSync(file, "utf8");
  const lines = original.trimEnd().split("\n");
  expect(verify(file).lines).toBe(30);
  for (let index = 0; index < lines.length; index++) {
    const edited = [...lines]; const record = JSON.parse(edited[index]!);
    record.data.sample += 1; edited[index] = JSON.stringify(record);
    writeFileSync(file, edited.join("\n") + "\n");
    expect(() => verify(file)).toThrow("line " + (index + 1) + ".");
  }
  writeFileSync(file, original);
  expect(new Ledger(file).verify().lines).toBe(30);
});
it("detects suffix deletion, malformed JSON and final-line whitespace changes", () => {
  const file = path(); const ledger = new Ledger(file);
  ledger.append("mission_started", {}, 0); ledger.append("tile_opened", {}, 1);
  const [first, last] = readFileSync(file, "utf8").trimEnd().split("\n");
  writeFileSync(file, first + "\n"); expect(() => verify(file)).toThrow("line 2");
  writeFileSync(file, first + "\n{broken\n"); expect(() => verify(file)).toThrow("line 2");
  writeFileSync(file, first + "\n" + last + " \n"); expect(() => verify(file)).toThrow("line 2");
});
it("only records tile decisions by passing a closed session through decide", () => {
  const file = path(); const ledger = new Ledger(file);
  expect(() => ledger.append("tile_decided" as Exclude<EventType, "tile_decided">, {}, 0)).toThrow("recordDecision");
  expect(() => ledger.recordDecision(openSession("tile", 0), { missionId: "mission", runId: "run", buildingId: "b" })).toThrow("Close");
  const memory = new MemoryLedger();
  memory.recordDecision(closeSession(openSession("tile", 0), 15000), { missionId: "mission", runId: "run", buildingId: "b" });
  memory.events[0]!.data.weighted = { status: "validated", label: "intact" };
  ledger.appendBatch(memory.events);
  expect(JSON.parse(readFileSync(file, "utf8")).data.weighted.status).toBe("refused");
});
