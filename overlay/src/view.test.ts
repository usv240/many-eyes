import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { fixture, imagery } from "./test-fixtures.js";
import { metresPerPixel, view } from "./view.js";
import { fixtureSnapshot } from "./fixtures.js";
import type { FixtureName } from "./fixtures.js";

const sample = (name: FixtureName) => { const snapshot = fixtureSnapshot(name, 10000);
  return view(snapshot.state, { ...snapshot, now: 10000, localNow: 10000 }); };
it("renders every overlay state's copy", () => {
  expect(sample("intro").hidden.explainer).toBe(false);
  expect(sample("intro").text.intro2).toBe("Look at the building in the ring. Did it survive?");
  expect(sample("empty").text.emptyCopy).toBe("Waiting for votes. Type 1, 2 or 3 in chat.");
  expect(sample("empty").hidden.voteBar).toBe(true);
  expect(sample("voting").text.agreement).toBe("81%");
  expect(sample("validated").text.resultCopy).toBe("Validated: destroyed · 81% agreement · 23 voters");
  expect(sample("refused").text.resultCopy).toBe("Refused: chat split 54 / 46. Sent to expert review.");
  expect(sample("refused-few").text.resultCopy).toBe("Refused: only 2 voters");
  expect(sample("refused").attributes.photoStage!["data-refused"]).toBe("true");
  expect(sample("gold").text.goldCopy).toBe("Hidden check: experts graded this building destroyed. Chat matched.");
  expect(sample("gold-missed").text.goldCopy).toBe("Hidden check: experts graded this building destroyed. Chat missed this one.");
  expect(sample("loading").text.imageStatus).toBe("Loading photos");
  expect(sample("loading").hidden.scale).toBe(false);
  expect(sample("loading").text.coordinates).not.toBe("—");
  expect(sample("disconnected").text.connection).toBe("Reconnecting to server");
  expect(sample("complete").text.question).toBe("Mission complete");
  expect(sample("complete").text.completeCopy).toBe("Results are being exported for humanitarian mappers.");
});
it("shows intro for ten seconds at tiles 1, 21, 41, then restores debate", () => {
  const snapshot = fixtureSnapshot("intro", 1000); const state = snapshot.state!;
  state.debate = fixtureSnapshot("debate").state!.debate;
  for (const number of [1, 21, 41]) {
    state.tile!.number = number;
    expect(view(state, { now: 10999 }).hidden.explainer).toBe(false);
    expect(view(state, { now: 11000 }).hidden.explainer).toBe(true);
  }
  state.tile!.number = 20; expect(view(state, { now: 1000 }).hidden.explainer).toBe(true);
});
it("delays the disconnected notice three seconds and hides stale gold outside decided", () => {
  const snapshot = fixtureSnapshot("gold", 10000); snapshot.state!.phase = "voting";
  expect(view(snapshot.state).text.goldCopy).toBe("");
  expect(view(snapshot.state, { connection: "reconnecting", offlineSince: 1000, localNow: 3999 }).text.connection).toBe("");
  expect(view(snapshot.state, { connection: "reconnecting", offlineSince: 1000, localNow: 4000 }).text.connection).toBe("Reconnecting to server");
});
it("shows a paused mission with its reason and an honest photo failure message", () => {
  const state = fixture(); state.phase = "stopped"; state.pauseReason = "Ledger write failed.";
  const model = view(state, { imageryStatus: "error" });
  expect(model.text.countdown).toBe("Mission paused");
  expect(model.text.pauseReason).toBe("Ledger write failed.");
  expect(model.hidden.pauseReason).toBe(false);
  expect(Object.values(model.text)).toContain("Photos unavailable for this tile");
});

it("uses honest map scale and converts crop pixels to the 984-pixel photo stage", () => {
  expect(metresPerPixel(19, 28.16)).toBeCloseTo(0.2632, 3);
  const model = view(fixture(), { imagery });
  expect(model.geometry.scaleBarPx).toBeCloseTo(20 / metresPerPixel(19, 28.16) * 984 / 384, 8);
  expect(model.geometry.ringRadiusPx).toBeCloseTo(model.geometry.scaleBarPx * 12 / 20, 8);
  expect(model.text.coordinates).toBe("28.1621° N, 85.3378° E");
});
it("shows no fabricated accuracy before hidden checks and always retains verbatim attribution", () => {
  const state = fixture(); state.stats.goldChecked = 0; state.stats.goldCorrect = 0;
  for (const phase of ["idle", "voting", "decided", "complete", "stopped"] as const) {
    state.phase = phase;
    const model = view(state);
    expect(model.text.accuracy).toBe("—"); expect(model.text.checks).toBe("no checks yet");
    expect(model.text.attribution).toBe(state.mission.attribution);
  }
});
it("uses weighted shares, excludes unsure, and clamps the skew-corrected countdown", () => {
  const state = fixture();
  const model = view(state, { now: 5000 });
  expect(model.text.agreement).toBe("74%");
  expect(model.styles.destroyedFill!.transform).toBe("scaleX(0.74)");
  expect(model.styles.intactFill!.transform).toBe("scaleX(0.26)");
  expect(model.text.countdown).toBe("10 s");
  expect(view(state, { now: 16000 }).geometry.countdownFraction).toBe(0);
  expect(view(state, { now: -2000 }).geometry.countdownFraction).toBe(1);
  expect(view(state).text.accuracy).toBe("95.8%");
});
it("bounds debate claims and boxes and keeps every displayed string dignified", () => {
  const state = fixture();
  state.debate = { advocate: { claim: Array(40).fill("Evidence").join(" "), box: { x: -0.1, y: 0.8, width: 0.5, height: 0.5 } },
    skeptic: { claim: "wrecked KO points for destruction" } };
  const model = view(state, { imagery });
  expect(model.text.advocateClaim!.split(/\s+/).length).toBeLessThanOrEqual(22);
  expect(model.styles.advocateBox).toMatchObject({ left: "0%", top: "80%", width: "50%" });
  for (const text of Object.values(model.text)) expect(text).not.toMatch(/\b(?:wrecked|ko)\b|points for destruction/i);
  expect(model.hidden.debate).toBe(false); expect(model.hidden.explainer).toBe(true);
  expect(model.text.aiFootnote).toBe("AI arguments. They never count as votes.");
});
it("keeps every text colour at 4.5:1 on each surface where it is used", () => {
  const css = readFileSync("overlay/src/style.css", "utf8");
  const colors = Object.fromEntries([...css.matchAll(/--([a-z]+):\s*(#[a-f\d]{6})/gi)].map((match) => [match[1], match[2]!]));
  const luminance = (hex: string) => hex.slice(1).match(/../g)!.map((part) => parseInt(part, 16) / 255)
    .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((total, n, i) => total + n * [0.2126, 0.7152, 0.0722][i]!, 0);
  for (const text of ["text", "muted", "faint", "destroyed", "intact"]) {
    const backgrounds = text === "destroyed" ? ["ground", "surface"] : ["ground", "surface", "raised"];
    for (const background of backgrounds) expect((luminance(colors[text]!) + 0.05) / (luminance(colors[background]!) + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
  expect(readFileSync("overlay/public/fonts/public-sans-latin.woff2").subarray(0, 4).toString()).toBe("wOF2");
  expect(readFileSync("overlay/public/fonts/OFL.txt", "utf8")).toContain("SIL OPEN FONT LICENSE");
});
