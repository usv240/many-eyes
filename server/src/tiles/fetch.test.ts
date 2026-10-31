import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { getMission } from "../missions/mission.js";
import { fetchTile, fetchTileWithFallback, sceneId, tileUrl } from "./fetch.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function cacheRoot() {
  const root = await mkdtemp(join(tmpdir(), "many-eyes-tiles-")); roots.push(root); return root;
}
const fixture = () => readFile(join(process.cwd(), "data", "sources", "sample_pre_z18.jpg"));
it("replaces TMS placeholders and accepts only valid XYZ coordinates", () => {
  const mission = getMission("nepal-flood-2026");
  expect(tileUrl(mission.pre_scene, { z: 18, x: 123, y: 456 })).toBe(mission.pre_scene.tms.replace("{z}", "18").replace("{x}", "123").replace("{y}", "456"));
  expect(() => tileUrl(mission.pre_scene, { z: 18, x: 2 ** 18, y: 0 })).toThrow("Invalid tile coordinate");
});
it("follows redirects, writes the JPEG cache, and reads it without another request", async () => {
  const mission = getMission("nepal-flood-2026"); const root = await cacheRoot();
  const image = await fixture(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(image, { status: 200, headers: { "content-type": "image/jpeg" } }));
  const coordinate = { z: 18, x: 123, y: 456 };
  expect(await fetchTile(mission.pre_scene, sceneId(mission.pre_scene), coordinate,
    { fetcher, cacheRoot: root })).toEqual(image);
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("follow");
  expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  expect(await fetchTile(mission.pre_scene, sceneId(mission.pre_scene), coordinate,
    { fetcher, cacheRoot: root })).toEqual(image);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("tries the fallback scene after two failed retries", async () => {
  const mission = getMission("nepal-flood-2026"); const root = await cacheRoot();
  const image = await fixture();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) =>
    String(input).startsWith(mission.pre_scene.tms.split("{")[0]!)
      ? new Response(null, { status: 503 })
      : new Response(image, { headers: { "content-type": "image/jpeg" } }));
  const result = await fetchTileWithFallback(mission.pre_scene, mission.fallback_pre_scene,
    { z: 18, x: 123, y: 456 }, { fetcher, cacheRoot: root, sleep: async () => {} });
  expect(result.usedFallback).toBe(true);
  expect(result.scene).toEqual(mission.fallback_pre_scene);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
