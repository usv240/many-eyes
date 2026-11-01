import { MissionRunner } from "../../server/src/runner/mission-runner.js";
import { MemoryLedger } from "../../server/src/ledger/ledger.js";
import type { TileImages } from "./view.js";
export function fixture() {
  const state = new MissionRunner({ missionId: "nepal-flood-2026", source: "sim", virtual: true,
    ledger: new MemoryLedger() }).getState();
  state.phase = "voting"; state.serverNow = 1000;
  state.tile = { token: "abcdef123456", number: 37, lon: 85.3378, lat: 28.1621,
    openedAt: 0, closesAt: 15000, imageryUrl: "/api/tiles/abcdef123456" };
  state.live = { agreement: 0.74, leading: "destroyed", voters: 23, unsure: 2 };
  state.stats = { goldChecked: 24, goldCorrect: 23, validated: 31, refused: 5, remaining: 154, total: 190 };
  return state;
}
export const imagery: TileImages = { pre: "data:image/jpeg;base64,AA==", post: "data:image/jpeg;base64,AQ==",
  zoom: 19, sizePx: 384, lat: 28.16, attribution: "Fixture attribution",
  scenes: { pre: { title: "Before", date: "2023-09-17" }, post: { title: "After", date: "2026-08-27" } } };
