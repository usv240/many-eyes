import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { getMission } from "../missions/mission.js";
import { lonLatToPixel, cropBuilding } from "./crop.js";

// A continuous position-encoded gradient across all nine tiles: unlike a repeated
// photo or solid fill, its pixel values identify where the crop came from.
async function syntheticCrops(locals: { x: number; y: number }[]) {
  const cacheRoot = await mkdtemp(join(tmpdir(), "many-eyes-position-"));
  const mission = structuredClone(getMission("nepal-flood-2026"));
  const tileX = 386427; const tileY = 219373; const scale = 256 * 2 ** 19;
  mission.buildings = locals.map(({ x, y }, index) => ({ ...mission.buildings[0]!, id: "synthetic-" + index,
    lon: (tileX * 256 + x) / scale * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY * 256 + y) / scale))) * 180 / Math.PI }));
  for (const scene of [mission.pre_scene, mission.post_scene, mission.fallback_pre_scene, mission.fallback_post_scene])
    scene.tms = "https://synthetic.invalid/{z}/{x}/{y}";
  const fetcher: typeof fetch = async (url) => {
    const parts = new URL(String(url)).pathname.split("/");
    const col = Number(parts[2]) - tileX + 1; const row = Number(parts[3]) - tileY + 1;
    const pixels = Buffer.alloc(256 * 256 * 3);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const offset = (y * 256 + x) * 3;
      pixels[offset] = Math.floor((col * 256 + x) / 4);
      pixels[offset + 1] = Math.floor((row * 256 + y) / 4); pixels[offset + 2] = 60;
    }
    const image = await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
    return new Response(new Uint8Array(image), { headers: { "content-type": "image/png" } });
  };
  try {
    return await Promise.all(mission.buildings.map((building) => cropBuilding(mission, building.id, { fetcher, cacheRoot })));
  } finally { await rm(cacheRoot, { recursive: true, force: true }); }
}
async function centrePixel(image: Buffer) {
  const raw = await sharp(image).removeAlpha().raw().toBuffer();
  return [...raw.subarray((192 * 384 + 192) * 3, (192 * 384 + 192) * 3 + 3)];
}
it.each([{ x: 194, y: 202 }, { x: 250, y: 3 }])("centres the building at local $x,$y, including tile edges", async (local) => {
  const [crop] = await syntheticCrops([local]);
  const expected = [Math.floor((256 + local.x) / 4), Math.floor((256 + local.y) / 4), 60];
  for (const scene of [crop!.pre, crop!.post]) {
    const actual = await centrePixel(scene.image);
    // JPEG quantization can perturb channels slightly; the old top-left crop is ~64 levels off.
    actual.forEach((channel, index) => expect(Math.abs(channel - expected[index]!)).toBeLessThanOrEqual(3));
  }
});
it("produces different centred crops for buildings 30 metres apart inside one tile", async () => {
  const metresPerPixel = 156543.03392 * Math.cos(28.16 * Math.PI / 180) / 2 ** 19;
  const [first, second] = await syntheticCrops([{ x: 60, y: 120 }, { x: 60 + 30 / metresPerPixel, y: 120 }]);
  expect(first!.post.image.equals(second!.post.image)).toBe(false);
  const a = await centrePixel(first!.post.image); const b = await centrePixel(second!.post.image);
  expect(b[0]! - a[0]!).toBeGreaterThan(25);
});

it("computes the known z18 tile and pixel for Syaphru Besi fixture coordinates", () => {
  const result = lonLatToPixel(85.3360598, 28.1599836, 18);
  expect(result.tileX).toBe(193211);
  expect(result.tileY).toBe(109687);
  expect(result.localX).toBeGreaterThanOrEqual(0);
  expect(result.localX).toBeLessThan(256);
  expect(result.localY).toBeGreaterThanOrEqual(0);
  expect(result.localY).toBeLessThan(256);
});
it("stitches recorded tile fixtures and returns an undecorated 384 square JPEG", async () => {
  const mission = getMission("nepal-flood-2026");
  const fixture = await readFile(join(process.cwd(), "data", "sources", "sample_pre_z18.jpg"));
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(fixture,
    { headers: { "content-type": "image/jpeg" } }));
  const result = await cropBuilding(mission, "cems-0003", {
    zoom: 18, fetcher, cacheRoot: join(process.cwd(), "data", "cache", "test-crop"),
  });
  for (const crop of [result.pre, result.post]) {
    const metadata = await sharp(crop.image).metadata();
    expect(metadata.width).toBe(384); expect(metadata.height).toBe(384); expect(metadata.format).toBe("jpeg");
  }
  expect(result.pre.usedFallback).toBe(false);
  expect(result).toMatchObject({ zoom: 18, sizePx: 384,
    lat: mission.buildings.find(({ id }) => id === "cems-0003")!.lat });
});
it("uses the fallback scene as a complete crop when primary tiles fail", async () => {
  const mission = getMission("nepal-flood-2026");
  const fixture = await readFile(join(process.cwd(), "data", "sources", "sample_pre_z18.jpg"));
  const primaryPrefix = mission.pre_scene.tms.split("{")[0]!;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) =>
    String(input).startsWith(primaryPrefix) ? new Response(null, { status: 503 }) :
      new Response(fixture, { headers: { "content-type": "image/jpeg" } }));
  const result = await cropBuilding(mission, "cems-0003", {
    zoom: 18, fetcher, sleep: async () => {}, cacheRoot: join(process.cwd(), "data", "cache", "fallback-crop"),
  });
  expect(result.pre.usedFallback).toBe(true);
  expect(result.pre.scene).toEqual(mission.fallback_pre_scene);
});
