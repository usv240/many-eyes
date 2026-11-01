import type { DebateArgument, PublicState } from "../../server/src/runner/mission-runner.js";

export interface TileImages {
  pre: string; post: string; zoom: number; sizePx: number; lat: number; attribution: string;
  scenes: { pre: { title: string; date: string }; post: { title: string; date: string } };
}
export interface ViewOptions {
  now?: number; imagery?: TileImages; imageryStatus?: "loading" | "ready" | "error";
  connection?: "connecting" | "open" | "reconnecting"; offlineSince?: number; localNow?: number; intro?: boolean;
}
export interface ViewModel {
  text: Record<string, string>;
  attributes: Record<string, Record<string, string | null>>;
  styles: Record<string, Record<string, string>>;
  hidden: Record<string, boolean>;
  geometry: { metresPerPixel: number; ringRadiusPx: number; scaleBarPx: number; countdownFraction: number };
}
export const STAGE_SIZE = 984;
export function metresPerPixel(zoom: number, lat: number) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
}
function date(value: string | undefined, full = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: full ? "long" : "short",
    year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));
function claim(argument: DebateArgument | undefined) {
  const text = argument?.claim?.trim() || "No argument available.";
  if (/\b(?:wrecked|ko)\b|points for destruction/i.test(text)) return "Review the visible evidence inside the ring.";
  const words = text.split(/\s+/);
  return words.slice(0, 30).join(" ") + (words.length > 30 ? "…" : "");
}
function box(argument: DebateArgument | undefined) {
  const b = argument?.box;
  if (!b || !Object.values(b).every(Number.isFinite) || b.width <= 0 || b.height <= 0) return null;
  const x = clamp(b.x); const y = clamp(b.y);
  return { left: x * 100 + "%", top: y * 100 + "%", width: clamp(b.width, 1 - x) * 100 + "%",
    height: clamp(b.height, 1 - y) * 100 + "%" };
}
/** Pure projection. Wall-clock time and fetched imagery are explicit inputs, never read here. */
export function view(state: PublicState | null, options: ViewOptions = {}): ViewModel {
  const tile = state?.tile;
  const mission = state?.mission;
  const live = state?.live ?? { agreement: 0, leading: null, voters: 0, unsure: 0 };
  const stats = state?.stats ?? { goldChecked: 0, goldCorrect: 0, validated: 0, refused: 0, remaining: 0, total: 0 };
  const image = options.imagery;
  const mpp = metresPerPixel(image?.zoom ?? 19, image?.lat ?? tile?.lat ?? 28.16);
  const displayPixelsPerCropPixel = STAGE_SIZE / (image?.sizePx ?? 384);
  const ringRadiusPx = 12 / mpp * displayPixelsPerCropPixel;
  const scaleBarPx = 20 / mpp * displayPixelsPerCropPixel;
  const timeLeft = state?.phase === "voting" && tile ? clamp(tile.closesAt - (options.now ?? state.serverNow), 15000) : 0;
  const countdownFraction = timeLeft / 15000;
  const destroyed = live.voters ? live.leading === "destroyed" ? live.agreement : live.leading === "intact" ? 1 - live.agreement : 0.5 : 0;
  const intact = live.voters ? 1 - destroyed : 0;
  const result = state?.phase === "decided" ? state.lastResult : null;
  const intro = options.intro ?? (!!tile && state?.phase === "voting" && (tile.number - 1) % 20 === 0 &&
    (options.now ?? state.serverNow) - tile.openedAt < 10000);
  const empty = state?.phase === "voting" && live.voters === 0;
  const complete = state?.phase === "complete";
  const share = Math.round((result?.agreement ?? 0) * 100);
  const resultCopy = !result ? "" : result.status === "validated"
    ? `Validated: ${result.label} · ${share}% agreement · ${result.voters} voters`
    : result.reason === "too_few_voters" ? `Refused: only ${result.voters} voters`
    : `Refused: chat split ${share} / ${100 - share}. Sent to expert review.`;
  const goldCopy = result?.gold ? `Hidden check: experts graded this building ${result.gold.truth}. ` +
    (result.gold.chatCorrect ? "Chat matched." : "Chat missed this one.") : "";
  const debate = state?.debate;
  const advocateBox = box(debate?.advocate); const skepticBox = box(debate?.skeptic);
  const ready = !!image && options.imageryStatus !== "error";
  const status = options.connection === "reconnecting" && options.offlineSince !== undefined &&
    (options.localNow ?? options.now ?? 0) - options.offlineSince >= 3000 ? "Reconnecting to server"
    : !state ? "Connecting to the mission…" : "";
  const countdown = state?.phase === "voting" ? Math.ceil(timeLeft / 1000) + " s" : state?.phase === "decided" && result
    ? result.status === "validated" ? "Validated " + result.label : "Refused · sent to experts"
    : state?.phase === "complete" ? "Mission complete" : state?.phase === "stopped" ? "Mission paused" : "Waiting for a tile";
  return {
    text: {
      wordmark: "Many Eyes", location: mission ? mission.place.replace(", Rasuwa", "") + " · flood of " + date(mission.eventDate) : "Waiting for the mission",
      tileCount: "Tile " + (tile?.number ?? 0) + " of " + stats.total, simulated: "Simulated crowd",
      question: complete ? "Mission complete" : "Did the building in the ring survive?", key1: "1", key2: "2", key3: "3",
      destroyedKey: "destroyed", intactKey: "intact", unsureKey: "unsure",
      beforeDate: "Before · " + date(mission?.preDate), afterDate: "After · " + date(mission?.postDate),
      coordinates: tile ? Math.abs(tile.lat).toFixed(4) + "° " + (tile.lat >= 0 ? "N" : "S") + ", " +
        Math.abs(tile.lon).toFixed(4) + "° " + (tile.lon >= 0 ? "E" : "W") : "—",
      scaleLabel: "20 m", caution: "The before photo can sit up to 25 m off. Judge the building inside the ring.",
      intro1: "Satellite photos of Syaphru Besi, Nepal, before and after the flood of " + date(mission?.eventDate, true) + ".",
      intro2: "Look at the building in the ring. Did it survive?",
      intro3: "Type 1, 2 or 3. At least three of you must agree, or the tile goes to expert review.",
      advocateTitle: "Advocate · argues destroyed", skepticTitle: "Skeptic · argues intact",
      advocateClaim: claim(debate?.advocate), skepticClaim: claim(debate?.skeptic),
      advocateBoxLabel: "Advocate · destroyed", skepticBoxLabel: "Skeptic · intact",
      aiFootnote: "AI arguments. They never count as votes.",
      emptyCopy: "Waiting for votes. Type 1, 2 or 3 in chat.", resultCopy, goldCopy,
      completeCopy: "Results are being exported for humanitarian mappers.",
      agreement: live.voters ? Math.round(live.agreement * 100) + "%" : "—",
      leading: live.leading ? "say " + live.leading : live.voters ? "no leading label" : "waiting for votes",
      destroyedBarLabel: "destroyed", intactBarLabel: "intact", threshold: "66% needed",
      voters: live.voters + " voters · " + live.unsure + " unsure · 3 needed", countdown,
      pauseReason: state?.phase === "stopped" ? state.pauseReason || "Waiting for the mission to resume." : "",
      accuracyTitle: "Chat accuracy on hidden checks", accuracy: stats.goldChecked ? (stats.goldCorrect / stats.goldChecked * 100).toFixed(1) + "%" : "—",
      checks: stats.goldChecked ? "(" + stats.goldChecked + " checks)" : "no checks yet",
      validatedTitle: "Validated", validated: String(stats.validated), refusedTitle: "Refused", refused: String(stats.refused),
      remainingTitle: "Left", remaining: String(stats.remaining), attribution: mission?.attribution || "Waiting for mission attribution.",
      imageStatus: options.imageryStatus === "error" ? "Photos unavailable for this tile" : "Loading photos", connection: status,
    },
    attributes: {
      before: { src: ready ? image.pre : null, alt: "Satellite image before the flood" },
      after: { src: ready ? image.post : null, alt: "Satellite image after the flood" },
      lead: { "data-tone": live.leading ?? "neutral" },
      photoStage: { "data-refused": String(result?.status === "refused") },
      resultPlate: { "data-visible": String(!!result), "aria-hidden": String(!result) },
      ringDark: { r: String(ringRadiusPx) }, ringLight: { r: String(ringRadiusPx) },
    },
    styles: { scaleBar: { width: scaleBarPx + "px" }, destroyedFill: { transform: `scaleX(${destroyed})` },
      intactFill: { transform: `scaleX(${intact})` },
      advocateBox: advocateBox ?? {}, skepticBox: skepticBox ?? {} },
    hidden: { simulated: state?.source !== "sim", debate: !debate || intro || complete, explainer: !intro,
      completeCopy: !complete, emptyCopy: !empty, lead: empty || complete, voteBar: empty || complete,
      barLabels: empty || complete, threshold: empty || complete, goldCopy: !goldCopy,
      advocateBox: !ready || !advocateBox, skepticBox: !ready || !skepticBox, imageStatus: ready,
      before: !ready, after: !ready, target: !ready, scale: !tile, divider: !ready, connection: !status,
      pauseReason: state?.phase !== "stopped" },
    geometry: { metresPerPixel: mpp, ringRadiusPx, scaleBarPx, countdownFraction },
  };
}
