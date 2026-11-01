import type { PublicState } from "../../server/src/runner/mission-runner.js";
import type { Snapshot } from "./stream.js";
export const FIXTURE_NAMES = ["intro", "empty", "voting", "validated", "refused", "gold", "loading", "disconnected", "complete", "refused-few", "gold-missed"] as const;
export type FixtureName = typeof FIXTURE_NAMES[number];
export function isFixtureName(name: string): name is FixtureName { return (FIXTURE_NAMES as readonly string[]).includes(name); }
/** Public-only sample state. Outcomes are illustrative, not mission measurements. */
export function fixtureSnapshot(name: FixtureName, now = Date.now()): Snapshot {
  const mission = {"name": "Nepal flash flood, Syaphru Besi (Rasuwa), 26 Aug 2026", "place": "Syaphru Besi, Rasuwa, Nepal", "eventDate": "2026-08-26", "preDate": "2023-09-17", "postDate": "2026-08-27", "attribution": "Imagery: Vantor via OpenAerialMap, CC BY-NC 4.0. Damage grading: © European Union, Copernicus Emergency Management Service (EMSR927). Buildings: © OpenStreetMap contributors, ODbL."};
  const state: PublicState = {
    missionId: "nepal-flood-2026", source: "sim", phase: "voting", mission, attribution: mission.attribution,
    serverNow: now, refusedCount: 4, live: { agreement: 0.81, leading: "destroyed", voters: 23, unsure: 2 },
    stats: { goldChecked: 8, goldCorrect: 7, validated: 32, refused: 4, remaining: 154, total: 190 },
    tile: { token: "abcdef123456", number: 37, lon: 85.334426, lat: 28.1631911, openedAt: now, closesAt: now + 15000, imageryUrl: "/fixtures/pre.jpg" },
    lastResult: null, votes: { destroyed: 19, intact: 4, unsure: 2, total: 25 },
  };
  if (name === "intro") state.tile!.number = 1;
  if (name === "empty") { state.live = { agreement: 0, leading: null, voters: 0, unsure: 0 }; state.votes = { destroyed: 0, intact: 0, unsure: 0, total: 0 }; }
  if (["validated", "refused", "gold", "refused-few", "gold-missed"].includes(name)) {
    state.phase = "decided";
    const refused = name.startsWith("refused");
    state.lastResult = { tileNumber: 37, status: refused ? "refused" : "validated", label: refused ? null : "destroyed",
      agreement: refused ? 0.54 : 0.81, voters: name === "refused-few" ? 2 : 23,
      reason: refused ? name === "refused-few" ? "too_few_voters" : "low_agreement" : null };
    state.live = { ...state.live, agreement: state.lastResult.agreement, voters: state.lastResult.voters };
    if (name.startsWith("gold")) state.lastResult.gold = { truth: "destroyed", chatCorrect: name === "gold" };
    if (name === "gold-missed") { state.lastResult = { ...state.lastResult, label: "intact" }; state.live.leading = "intact"; }
  }
  if (name === "complete") { state.phase = "complete"; state.stats = { goldChecked: 80, goldCorrect: 69, validated: 154, refused: 36, remaining: 0, total: 190 }; }
  return { state, receivedAt: now, connection: name === "disconnected" ? "reconnecting" : "open",
    ...(name === "disconnected" ? { offlineSince: now - 4000 } : {}),
    imageryStatus: name === "loading" ? "loading" : "ready",
    ...(name === "loading" ? {} : { imagery: { pre: "/fixtures/pre.jpg", post: "/fixtures/post.jpg", zoom: 19, sizePx: 384,
      lat: 28.1631911, attribution: mission.attribution, scenes: { pre: { title: "Before", date: mission.preDate }, post: { title: "After", date: mission.postDate } } } }),
  };
}
