import sharp from "sharp";
import { getMission, type Mission, type MissionScene } from "../missions/mission.js";
import { fetchTile, sceneId, type FetchOptions, type TileCoordinate } from "./fetch.js";

const TILE_SIZE = 256;
export interface PixelPosition { pixelX: number; pixelY: number; tileX: number; tileY: number; localX: number; localY: number }
export interface CropOptions extends FetchOptions { zoom?: number }
export interface SceneCrop { image: Buffer; scene: MissionScene; usedFallback: boolean }
export interface BuildingCrops { pre: SceneCrop; post: SceneCrop }

export function lonLatToPixel(lon: number, lat: number, zoom = 19): PixelPosition {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90 ||
    !Number.isInteger(zoom) || zoom < 0 || zoom > 22) throw new Error("Invalid map position or zoom.");
  const boundedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const scale = TILE_SIZE * 2 ** zoom;
  const radians = boundedLat * Math.PI / 180;
  const pixelX = (lon + 180) / 360 * scale;
  const pixelY = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale;
  const tileX = Math.min(2 ** zoom - 1, Math.floor(pixelX / TILE_SIZE));
  const tileY = Math.min(2 ** zoom - 1, Math.floor(pixelY / TILE_SIZE));
  return { pixelX, pixelY, tileX, tileY, localX: pixelX - tileX * TILE_SIZE, localY: pixelY - tileY * TILE_SIZE };
}

async function cropScene(primary: MissionScene, fallback: MissionScene, lon: number, lat: number,
  options: CropOptions): Promise<SceneCrop> {
  const zoom = options.zoom ?? 19;
  const position = lonLatToPixel(lon, lat, zoom);
  const candidates: { scene: MissionScene; usedFallback: boolean }[] = [
    { scene: primary, usedFallback: false }, { scene: fallback, usedFallback: true },
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const max = 2 ** zoom - 1;
      const coordinates: TileCoordinate[] = [];
      for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++)
        coordinates.push({ z: zoom, x: Math.max(0, Math.min(max, position.tileX + col)),
          y: Math.max(0, Math.min(max, position.tileY + row)) });
      const tiles = await Promise.all(coordinates.map((coordinate) =>
        fetchTile(candidate.scene, sceneId(candidate.scene), coordinate, options)));
      const metadata = await sharp(tiles[0]!).metadata();
      const tileWidth = metadata.width; const tileHeight = metadata.height;
      if (!tileWidth || !tileHeight) throw new Error("Tile has no image dimensions.");
      const layers = await Promise.all(tiles.map(async (tile, index) => {
        const tileMetadata = await sharp(tile).metadata();
        if (tileMetadata.width !== tileWidth || tileMetadata.height !== tileHeight)
          throw new Error("Tile dimensions do not match within the scene.");
        return { input: await sharp(tile).jpeg().toBuffer(),
          left: index % 3 * tileWidth, top: Math.floor(index / 3) * tileHeight };
      }));
      const centerX = tileWidth + position.localX * tileWidth / TILE_SIZE;
      const centerY = tileHeight + position.localY * tileHeight / TILE_SIZE;
      const left = Math.round(centerX - 192); const top = Math.round(centerY - 192);
      const image = await sharp({ create: { width: tileWidth * 3, height: tileHeight * 3,
        channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .composite(layers).extract({ left, top, width: 384, height: 384 }).jpeg({ quality: 88 }).toBuffer();
      return { image, scene: candidate.scene, usedFallback: candidate.usedFallback };
    } catch (error) { lastError = error; }
  }
  throw new Error("Could not crop imagery from primary or fallback scene: " +
    (lastError instanceof Error ? lastError.message : "tile error"));
}

export async function cropBuilding(mission: Mission, buildingId: string, options: CropOptions = {}): Promise<BuildingCrops> {
  const building = mission.buildings.find(({ id }) => id === buildingId);
  if (!building) throw new Error("Building not found in mission " + mission.id + ": " + buildingId);
  const [pre, post] = await Promise.all([
    cropScene(mission.pre_scene, mission.fallback_pre_scene, building.lon, building.lat, options),
    cropScene(mission.post_scene, mission.fallback_post_scene, building.lon, building.lat, options),
  ]);
  return { pre, post };
}

export async function cropMissionBuilding(missionId: string, buildingId: string, options: CropOptions = {}) {
  return cropBuilding(getMission(missionId), buildingId, options);
}
