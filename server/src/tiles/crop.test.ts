import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { getMission } from "../missions/mission.js";
import { lonLatToPixel, cropBuilding } from "./crop.js";

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
