import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DebateSchema, PROMPT_VERSION, type Debate } from "./agents.js";

export const CacheSchema = z.object({ model: z.string().min(1), requestedModel: z.string().min(1),
  createdAt: z.string().datetime(), promptVersion: z.literal(PROMPT_VERSION),
  cropHashes: z.object({ pre: z.string().regex(/^[a-f0-9]{64}$/), post: z.string().regex(/^[a-f0-9]{64}$/) }),
  debate: DebateSchema }).strict();
export type CachedDebate = z.infer<typeof CacheSchema>;
export const cropHashes = (pre: Buffer, post: Buffer) => ({
  pre: createHash("sha256").update(pre).digest("hex"), post: createHash("sha256").update(post).digest("hex"),
});
export function readCachedDebate(buildingId: string, missionId = "nepal-flood-2026", root = "data/cache"): CachedDebate | null {
  if (!/^[a-z0-9-]+$/.test(buildingId) || !/^[a-z0-9-]+$/.test(missionId)) return null;
  try {
    const entry = CacheSchema.parse(JSON.parse(readFileSync(join(root, "debate", buildingId + ".json"), "utf8")));
    const directory = join(root, "crops", missionId, buildingId);
    const hashes = cropHashes(readFileSync(join(directory, "pre.jpg")), readFileSync(join(directory, "post.jpg")));
    return hashes.pre === entry.cropHashes.pre && hashes.post === entry.cropHashes.post ? entry : null;
  } catch { return null; }
}
export function publicDebate(debate: Debate) {
  const project = ({ claim, box }: Debate["advocate"]) => ({ claim,
    box: { x: box[0]! / 384, y: box[1]! / 384, width: box[2]! / 384, height: box[3]! / 384 } });
  return { advocate: project(debate.advocate), skeptic: project(debate.skeptic) };
}
