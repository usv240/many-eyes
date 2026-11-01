import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { cropHashes, readCachedDebate, publicDebate } from "./cache.js";
import { PROMPT_VERSION } from "./agents.js";

it("rejects missing, malformed and crop-stale caches; projects claims and normalized boxes only", () => {
  const root = mkdtempSync(join(tmpdir(), "many-eyes-debate-"));
  const pre = Buffer.from("before"), post = Buffer.from("after");
  try {
    expect(readCachedDebate("test", "mission", root)).toBeNull();
    mkdirSync(join(root, "debate")); mkdirSync(join(root, "crops/mission/test"), { recursive: true });
    writeFileSync(join(root, "crops/mission/test/pre.jpg"), pre); writeFileSync(join(root, "crops/mission/test/post.jpg"), post);
    const debate = { advocate: { claim: "Sediment covers the roof.", box: [96, 96, 192, 192] },
      skeptic: { claim: "A roof remains in shadow.", box: [96, 96, 192, 192] }, model_label: "destroyed", confidence: 0.9 };
    writeFileSync(join(root, "debate/test.json"), JSON.stringify({ model: "fixture", requestedModel: "fixture", promptVersion: PROMPT_VERSION,
      createdAt: "2026-11-01T00:00:00.000Z", cropHashes: cropHashes(pre, post), debate }));
    const cached = readCachedDebate("test", "mission", root)!;
    expect(publicDebate(cached.debate).advocate.box).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(JSON.stringify(publicDebate(cached.debate))).not.toMatch(/model_label|confidence|createdAt|cropHashes/);
    writeFileSync(join(root, "crops/mission/test/post.jpg"), "changed");
    expect(readCachedDebate("test", "mission", root)).toBeNull();
    expect(readCachedDebate("../test", "mission", root)).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
