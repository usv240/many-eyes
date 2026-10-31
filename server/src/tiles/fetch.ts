import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MissionScene } from "../missions/mission.js";

export interface TileCoordinate { z: number; x: number; y: number }
export interface FetchOptions {
  fetcher?: typeof fetch;
  cacheRoot?: string;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultCache = join(process.cwd(), "data", "cache", "tiles");

export function sceneId(scene: MissionScene): string {
  return createHash("sha256").update(scene.tms).digest("hex").slice(0, 20);
}
export function tileUrl(scene: MissionScene, { z, x, y }: TileCoordinate): string {
  if (![z, x, y].every(Number.isSafeInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
    throw new Error("Invalid tile coordinate.");
  return scene.tms.replaceAll("{z}", String(z)).replaceAll("{x}", String(x)).replaceAll("{y}", String(y));
}
function cachePath(root: string, id: string, coordinate: TileCoordinate) {
  if (!/^[a-f0-9]{20}$/.test(id)) throw new Error("Invalid scene ID.");
  return join(root, id, String(coordinate.z), String(coordinate.x), `${coordinate.y}.jpg`);
}

export async function fetchTile(scene: MissionScene, id: string, coordinate: TileCoordinate,
  options: FetchOptions = {}): Promise<Buffer> {
  const path = cachePath(options.cacheRoot ?? defaultCache, id, coordinate);
  try { return await readFile(path); } catch { /* a missing cache entry is fetched below */ }
  const fetcher = options.fetcher ?? fetch;
  const attempts = (options.retries ?? 2) + 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(tileUrl(scene, coordinate), {
        method: "GET", redirect: "follow", signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        headers: { Accept: "image/jpeg" },
      });
      if (!response.ok) throw new Error(`Tile server returned HTTP ${response.status}.`);
      const type = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!type.includes("image/jpeg") && !type.includes("image/jpg") && !type.includes("image/png"))
        throw new Error("Tile server returned a non-image response.");
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 100 || data.length > 10_000_000) throw new Error("Tile image size is invalid.");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, data);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await (options.sleep ?? defaultSleep)((options.backoffMs ?? 250) * 2 ** attempt);
    }
  }
  throw new Error(`Could not fetch tile ${coordinate.z}/${coordinate.x}/${coordinate.y} after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : "network error"}`);
}

export async function fetchTileWithFallback(primary: MissionScene, fallback: MissionScene,
  coordinate: TileCoordinate, options: FetchOptions = {}): Promise<{ data: Buffer; scene: MissionScene; usedFallback: boolean }> {
  try { return { data: await fetchTile(primary, sceneId(primary), coordinate, options), scene: primary, usedFallback: false }; }
  catch {
    return { data: await fetchTile(fallback, sceneId(fallback), coordinate, options), scene: fallback, usedFallback: true };
  }
}
