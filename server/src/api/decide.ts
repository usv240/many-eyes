import { z } from "zod";
import { closeSession, collectVote, decide, decideUnweighted, openSession, updateGoldWeights, type Truth } from "../consensus/engine.js";
import { parseVote } from "../votes/parse.js";

/**
 * One pure function behind the public API, the bring-your-own-data page and the tests.
 * It runs the same consensus engine the live stream uses: weighted agreement of at least 66%
 * from at least 3 voters validates a label; anything else is refused. Weights change only on
 * tiles that carry a known answer (hidden checks), and only after that tile is decided.
 */
export const LIMITS = { tiles: 5000, votesPerTile: 1000, totalVotes: 200_000, idLength: 128, csvChars: 20 * 1024 * 1024 } as const;

const id = z.string().trim().min(1).max(LIMITS.idLength);
const voteInput = z.object({
  user: id,
  vote: z.union([z.string().max(32), z.number()]).transform((value, context) => {
    const label = parseVote(String(value));
    if (!label) context.addIssue({ code: "custom", message: "vote must be 1, 2, 3, destroyed, intact or unsure" });
    return label ?? "unsure";
  }),
});
export const decideRequest = z.object({
  tiles: z.array(z.object({
    id,
    votes: z.array(voteInput).max(LIMITS.votesPerTile),
    truth: z.enum(["destroyed", "intact"]).optional(),
    lon: z.number().min(-180).max(180).optional(),
    lat: z.number().min(-90).max(90).optional(),
  })).min(1).max(LIMITS.tiles),
}).superRefine((value, context) => {
  const total = value.tiles.reduce((sum, tile) => sum + tile.votes.length, 0);
  if (total > LIMITS.totalVotes) context.addIssue({ code: "custom", message: `at most ${LIMITS.totalVotes} votes per request` });
  const seen = new Set<string>();
  for (const tile of value.tiles) {
    if (seen.has(tile.id)) context.addIssue({ code: "custom", message: "tile ids must be unique" });
    seen.add(tile.id);
  }
});
export type DecideRequest = z.input<typeof decideRequest>;

export interface TileResult {
  id: string; status: "validated" | "refused"; label: Truth | null; agreement: number; voters: number;
  reason: "low_agreement" | "too_few_voters" | null;
  unweighted: { status: "validated" | "refused"; label: Truth | null; agreement: number };
  check?: { truth: Truth; correct: boolean; unweightedCorrect: boolean };
  lon?: number; lat?: number;
}
export interface DecideResponse {
  engine: { rule: string; version: string };
  tiles: TileResult[];
  summary: {
    tiles: number; validated: number; refused: number; votes: number;
    checks: { count: number; weightedCorrect: number; unweightedCorrect: number;
      weightedAccuracy: number | null; unweightedAccuracy: number | null };
  };
  weights: { user: string; weight: number }[];
  geojson: { type: "FeatureCollection"; features: unknown[] };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function decideBatch(input: unknown): DecideResponse {
  const request = decideRequest.parse(input);
  let weights = new Map<string, number>();
  const tiles: TileResult[] = [];
  let votes = 0;
  for (const tile of request.tiles) {
    let session = openSession(tile.id, 0);
    // Later votes from the same user replace earlier ones, exactly as in chat.
    for (const vote of tile.votes) session = collectVote(session, { userId: vote.user, label: vote.vote, weight: weights.get(vote.user) ?? 1 }, 0);
    session = closeSession(session, session.closesAt);
    votes += session.votes.length;
    const weighted = decide(session); const plain = decideUnweighted(session);
    const result: TileResult = { id: tile.id, status: weighted.status, label: weighted.label, agreement: round(weighted.agreement),
      voters: weighted.voters, reason: weighted.reason,
      unweighted: { status: plain.status, label: plain.label, agreement: round(plain.agreement) },
      ...(tile.lon !== undefined && tile.lat !== undefined ? { lon: tile.lon, lat: tile.lat } : {}) };
    if (tile.truth) {
      result.check = { truth: tile.truth, correct: weighted.status === "validated" && weighted.label === tile.truth,
        unweightedCorrect: plain.status === "validated" && plain.label === tile.truth };
      weights = updateGoldWeights(weights, session, tile.truth);
    }
    tiles.push(result);
  }
  const checked = tiles.filter((tile) => tile.check);
  const weightedCorrect = checked.filter((tile) => tile.check!.correct).length;
  const unweightedCorrect = checked.filter((tile) => tile.check!.unweightedCorrect).length;
  const weightedValidated = checked.filter((tile) => tile.status === "validated").length;
  const unweightedValidated = checked.filter((tile) => tile.unweighted.status === "validated").length;
  return {
    engine: { rule: "validated when weighted agreement >= 0.66 and at least 3 non-unsure voters; otherwise refused", version: "1" },
    tiles,
    summary: { tiles: tiles.length, validated: tiles.filter((tile) => tile.status === "validated").length,
      refused: tiles.filter((tile) => tile.status === "refused").length, votes,
      checks: { count: checked.length, weightedCorrect, unweightedCorrect,
        weightedAccuracy: weightedValidated ? round(weightedCorrect / weightedValidated) : null,
        unweightedAccuracy: unweightedValidated ? round(unweightedCorrect / unweightedValidated) : null } },
    weights: [...weights].map(([user, weight]) => ({ user, weight })).sort((a, b) => b.weight - a.weight || a.user.localeCompare(b.user)),
    geojson: { type: "FeatureCollection", features: tiles.filter((tile) => tile.lon !== undefined).map((tile) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [tile.lon, tile.lat] },
      properties: { id: tile.id, status: tile.status, label: tile.label, agreement: tile.agreement, voters: tile.voters, reason: tile.reason } })) },
  };
}

function csvRow(line: string): string[] {
  const cells: string[] = []; let cell = "", quoted = false, closed = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (line[index + 1] === '"') { cell += '"'; index++; }
      else { quoted = false; closed = true; }
    } else if (char === ",") { cells.push(cell.trim()); cell = ""; closed = false; }
    else if (char === '"') {
      if (cell.trim() || closed) throw new Error("Malformed CSV quoting.");
      cell = ""; quoted = true;
    } else {
      if (closed && char.trim()) throw new Error("Unexpected text after a quoted CSV field.");
      cell += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV field; multiline fields are not supported.");
  cells.push(cell.trim()); return cells;
}

/** Reads tile_id,user_id,vote[,truth][,lon][,lat] rows (header required, any column order) into a request. */
export function votesFromCsv(text: string): DecideRequest {
  if (text.length > LIMITS.csvChars) throw new Error("CSV exceeds 20 MB of text.");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("The CSV needs a header row and at least one vote.");
  if (lines.length - 1 > LIMITS.totalVotes) throw new Error("CSV exceeds the total vote limit.");
  const split = csvRow;
  const header = split(lines[0]!).map((name) => name.toLowerCase());
  if (new Set(header).size !== header.length) throw new Error("CSV header columns must be unique.");
  const column = (name: string, required: boolean) => {
    const index = header.indexOf(name);
    if (index < 0 && required) throw new Error(`The CSV header must include ${name}. Expected: tile_id,user_id,vote[,truth][,lon][,lat]`);
    return index;
  };
  const [tileCol, userCol, voteCol] = [column("tile_id", true), column("user_id", true), column("vote", true)];
  const [truthCol, lonCol, latCol] = [column("truth", false), column("lon", false), column("lat", false)];
  const tiles = new Map<string, { id: string; votes: { user: string; vote: string }[]; truth?: "destroyed" | "intact"; lon?: number; lat?: number }>();
  lines.slice(1).forEach((line, index) => {
    const cells = split(line);
    if (cells.length > header.length) throw new Error(`Row ${index + 2}: more cells than header columns.`);
    const tileId = cells[tileCol] ?? ""; const user = cells[userCol] ?? ""; const vote = cells[voteCol] ?? "";
    if (!tileId || !user) throw new Error(`Row ${index + 2} is missing tile_id or user_id.`);
    let tile = tiles.get(tileId);
    if (tileId.length > LIMITS.idLength || user.length > LIMITS.idLength || vote.length > 32) throw new Error(`Row ${index + 2}: field too long.`);
    if (!tile) {
      if (tiles.size >= LIMITS.tiles) throw new Error("CSV exceeds the tile limit.");
      tile = { id: tileId, votes: [] }; tiles.set(tileId, tile);
    }
    if (tile.votes.length >= LIMITS.votesPerTile) throw new Error("CSV exceeds the votes-per-tile limit.");
    if (vote) tile.votes.push({ user, vote });
    const truth = truthCol >= 0 ? cells[truthCol]?.toLowerCase() : "";
    if (truth === "destroyed" || truth === "intact") {
      if (tile.truth && tile.truth !== truth) throw new Error(`Row ${index + 2}: conflicting truth for this tile.`);
      tile.truth = truth;
    }
    else if (truth) throw new Error(`Row ${index + 2}: truth must be destroyed, intact or empty.`);
    const lon = lonCol >= 0 ? Number(cells[lonCol]) : NaN; const lat = latCol >= 0 ? Number(cells[latCol]) : NaN;
    if (cells[lonCol] || cells[latCol]) {
      if (!cells[lonCol] || !cells[latCol] || !Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`Row ${index + 2}: coordinates need numeric lon and lat.`);
      if (tile.lon !== undefined && (tile.lon !== lon || tile.lat !== lat)) throw new Error(`Row ${index + 2}: conflicting coordinates for this tile.`);
      tile.lon = lon; tile.lat = lat;
    }
  });
  return { tiles: [...tiles.values()] };
}
