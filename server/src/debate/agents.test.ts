import { expect, it, vi } from "vitest";
import { DebateSchema, debateRequest, generateDebate } from "./agents.js";

export const sampleDebate = { advocate: { claim: "Sediment covers the roof footprint.", box: [130, 140, 100, 90] },
  skeptic: { claim: "A roof edge could remain beneath the shadow.", box: [140, 140, 70, 90] }, model_label: "destroyed" as const, confidence: 0.8 };
it("sends only the two image bytes and instructions, with strict structured output", async () => {
  const payload = debateRequest(Buffer.from("before"), Buffer.from("after"), "test-model");
  expect(payload.input[0]!.content.filter((item) => item.type === "input_image")).toHaveLength(2);
  expect(payload.text.format).toMatchObject({ type: "json_schema", strict: true });
  expect(JSON.stringify(payload)).not.toMatch(/cems-|osm-|expert_grade|goldMembership|broadcaster/);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "completed", model: "test-model",
    output: [{ content: [{ type: "output_text", text: JSON.stringify(sampleDebate) }] }] })));
  expect((await generateDebate(Buffer.alloc(1), Buffer.alloc(1), { apiKey: "fixture-key", fetcher }))?.debate).toEqual(sampleDebate);
  expect(fetcher).toHaveBeenCalledOnce();
});
it("validates concise, grounded, dignified claims and clamps all box edges", () => {
  const valid = DebateSchema.parse({ ...sampleDebate, advocate: { claim: sampleDebate.advocate.claim, box: [-10, 370, 900, 50] } });
  expect(valid.advocate.box).toEqual([0, 370, 384, 14]);
  for (const claim of ["roof ".repeat(23), "The roof is wrecked.", "I know the answer."])
    expect(DebateSchema.safeParse({ ...sampleDebate, advocate: { ...sampleDebate.advocate, claim } }).success).toBe(false);
});
it("aborts each attempt at eight seconds, retries once, and never exposes credentials in failures", async () => {
  vi.useFakeTimers(); const failures: string[] = [];
  const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) =>
    init!.signal!.addEventListener("abort", () => reject(new Error("fixture-key")))));
  try {
    const pending = generateDebate(Buffer.alloc(1), Buffer.alloc(1), { apiKey: "fixture-key", fetcher, onFailure: (reason) => failures.push(reason) });
    await vi.advanceTimersByTimeAsync(16000);
    expect(await pending).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(failures).toEqual(["timeout", "timeout"]); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
