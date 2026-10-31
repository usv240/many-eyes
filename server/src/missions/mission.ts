import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const SceneSchema = z.object({ title: z.string(), acquired: z.string(), gsd_m: z.number().positive(),
  tms: z.string().url(), license: z.string() });
const BuildingSchema = z.object({ id: z.string(), lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90),
  expert_grade: z.string(), building_type: z.string(), source: z.string() }).passthrough();
const GoldSchema = z.object({ building_id: z.string(), truth: z.enum(["destroyed", "intact"]), source: z.string() });
export const MissionSchema = z.object({ id: z.string(), name: z.string(), event_date: z.string(),
  bbox: z.array(z.number()).length(4), aoi: z.array(z.unknown()), pre_scene: SceneSchema,
  post_scene: SceneSchema, fallback_pre_scene: SceneSchema, fallback_post_scene: SceneSchema,
  attribution: z.string(), buildings: z.array(BuildingSchema), gold: z.array(GoldSchema) });
export type Mission = z.infer<typeof MissionSchema>;
export type MissionScene = Mission["pre_scene"];
export type Tile = { buildingId: string; missionId: string };
const cache = new Map<string, Mission>();

function missionPath(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid mission ID.");
  return resolve(process.cwd(), "data", "missions", `${id}.json`);
}

export function getMission(id: string): Mission {
  const loaded = cache.get(id);
  if (loaded) return loaded;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(missionPath(id), "utf8")); }
  catch { throw new Error(`Mission not found or invalid: ${id}`); }
  const mission = MissionSchema.parse(parsed);
  if (mission.id !== id) throw new Error(`Mission filename does not match its ID: ${id}`);
  const buildingIds = new Set(mission.buildings.map((building) => building.id));
  if (buildingIds.size !== mission.buildings.length || mission.gold.some((gold) => !buildingIds.has(gold.building_id)))
    throw new Error(`Mission has duplicate or unmatched building IDs: ${id}`);
  cache.set(id, mission);
  return mission;
}

export function listMissions(): Mission[] {
  const directory = resolve(process.cwd(), "data", "missions");
  return readdirSync(directory).filter((file) => file.endsWith(".json"))
    .map((file) => getMission(file.slice(0, -5)));
}

export function isGold(buildingId: string, missionId = "nepal-flood-2026"): boolean {
  return getMission(missionId).gold.some((entry) => entry.building_id === buildingId);
}
export function goldTruth(buildingId: string, missionId = "nepal-flood-2026"): "destroyed" | "intact" | null {
  return getMission(missionId).gold.find((entry) => entry.building_id === buildingId)?.truth ?? null;
}

export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let index = items.length - 1; index > 0; index--) {
    const target = Math.floor(rng() * (index + 1));
    [items[index], items[target]] = [items[target]!, items[index]!];
  }
  return items;
}
const schedules = new Map<string, { key: string | (() => number); tiles: Tile[]; cursor: number }>();
function scheduleFor(missionId: string, key: string | (() => number), rng: () => number) {
  const existing = schedules.get(missionId);
  if (existing?.key === key) return existing;
  const mission = getMission(missionId);
  const goldIds = new Set(mission.gold.map(({ building_id }) => building_id));
  const work = shuffle(mission.buildings.filter(({ id }) => !goldIds.has(id)).map(({ id }) => id), rng);
  const gold = shuffle(mission.buildings.filter(({ id }) => goldIds.has(id)).map(({ id }) => id), rng);
  const tiles: Tile[] = [];
  let wi = 0; let gi = 0;
  while (wi < work.length || gi < gold.length) {
    for (let count = 0; count < 4 && wi < work.length; count++)
      tiles.push({ missionId, buildingId: work[wi++]! });
    if (gi < gold.length) tiles.push({ missionId, buildingId: gold[gi++]! });
  }
  const schedule = { key, tiles, cursor: 0 };
  schedules.set(missionId, schedule);
  return schedule;
}

/** Supply a seed or stable RNG to make the session's shuffled work/gold schedule reproducible. */
export function nextTile(missionId: string, rng: (() => number) | number = Math.random): Tile {
  const key = typeof rng === "number" ? `seed:${rng >>> 0}` : rng;
  const source = typeof rng === "number" ? seededRng(rng) : rng;
  const schedule = scheduleFor(missionId, key, source);
  const tile = schedule.tiles[schedule.cursor++];
  if (!tile) throw new Error(`Mission has no tiles: ${missionId}`);
  return tile;
}
