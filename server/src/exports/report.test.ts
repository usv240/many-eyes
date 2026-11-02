import { expect, it } from "vitest";
import { MemoryLedger } from "../ledger/ledger.js";
import { MissionRunner } from "../runner/mission-runner.js";
import { readVideoPlan } from "../runner/video.js";
import { headlineTable, renderArtifacts } from "./report.js";

it("recomputes the headline from recorded benchmark and API predictions", () => {
  const { table } = headlineTable();
  for (const value of ["75.9%", "89.2%", "81.3%", "73.8%", "47.5%", "52.5%", "gpt-6-luna", "2026-11-01"])
    expect(table).toContain(value);
});
it("regenerates identical GeoJSON, provenance and report from the same ledger", async () => {
  const ledger = new MemoryLedger(), plan = readVideoPlan();
  const runner = new MissionRunner({ missionId: plan.missionId, source: "sim", seed: plan.seed, virtual: true,
    ledger, gradedWork: true, video: true, fixedTiles: plan.tiles.map((tile) => tile.buildingId) });
  await runner.run();
  const first = renderArtifacts(ledger.events, runner.runId);
  expect(renderArtifacts(structuredClone(ledger.events), runner.runId)).toEqual(first);
  const report = first.files["reports/nepal-flood-2026.md"]!;
  expect(report).toMatch(/^\| Measurement/); expect(report).toContain("5 validated");
  expect(report).toContain("1 refused"); expect(report).toContain("1.7 m");
  expect(report).toContain("0.0%"); expect(report).toContain("10% of the assumed");
});
