import { MemoryLedger } from "../../server/src/ledger/ledger.js";
import { MissionRunner } from "../../server/src/runner/mission-runner.js";
import { compareMetrics } from "../../server/src/consensus/metrics.js";
import type { CrowdConfig } from "./crowd.js";

export async function runGoldSimulation(config: CrowdConfig, runId = "sim-" + config.seed,
  missionId = "nepal-flood-2026") {
  const ledger = new MemoryLedger();
  const runner = new MissionRunner({ missionId, source: "sim", seed: config.seed, runId, virtual: true,
    goldOnly: true, crowd: config, ledger });
  const gold = await runner.run();
  return { gold, metrics: compareMetrics(gold), events: ledger.events };
}
