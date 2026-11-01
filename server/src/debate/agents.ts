import { z } from "zod";

export const DEFAULT_MODEL = "gpt-6-luna";
export const PROMPT_VERSION = "centre-ring-v1";
const argument = z.object({ claim: z.string(), box: z.array(z.number()).length(4) }).strict();
const wireSchema = z.object({ advocate: argument, skeptic: argument,
  model_label: z.enum(["destroyed", "intact"]), confidence: z.number().min(0).max(1) }).strict();
export const DebateSchema = wireSchema.superRefine((value, context) => {
  for (const side of ["advocate", "skeptic"] as const) {
    const claim = value[side].claim.trim();
    if (!claim || claim.split(/\s+/).length > 22 || /\b(?:wrecked|ko)\b|points for destruction/i.test(claim) ||
        !/\b(?:roofs?|sediment|shadows?|trees?|roads?)\b/i.test(claim))
      context.addIssue({ code: "custom", path: [side, "claim"], message: "Claim must be dignified, visible and at most 22 words." });
  }
}).transform((value) => {
  const clamp = (n: number) => Math.max(0, Math.min(384, n));
  const normalize = (item: z.infer<typeof argument>) => {
    const [x, y, w, h] = item.box as [number, number, number, number];
    const left = clamp(x); const top = clamp(y);
    return { claim: item.claim.trim(), box: [left, top, Math.min(clamp(w), 384 - left), Math.min(clamp(h), 384 - top)] };
  };
  return { ...value, advocate: normalize(value.advocate), skeptic: normalize(value.skeptic) };
});
export type Debate = z.infer<typeof DebateSchema>;
export const INSTRUCTION = `Compare ONLY these two 384x384 satellite photos: first BEFORE, second AFTER.
Judge the building inside the centre ring: an imaginary circle centred at pixel (192,192), radius 46 pixels. The photos are unmarked.
Produce both arguments in one response. Advocate argues destroyed; skeptic argues intact.
Each claim must be at most 22 words, use short plain language, and point to a visible roof, sediment, shadow, tree or road.
Do not invent evidence. If one side is weak, acknowledge it honestly, e.g. "Hard to argue intact: grey sediment replaces the roof."
Never use wrecked, KO, or points for destruction. Do not mention confidence or your final model_label in either claim.
Each box is [x,y,width,height] in AFTER-photo pixels, bounded within 0..384, highlighting the evidence discussed.
Separately provide your own binary model_label (destroyed or intact) and confidence from 0 to 1. This is a baseline, not a chat vote.
Do not infer a location, building identifier, expert grading or hidden-check membership. Use only visible evidence.`;

/** This boundary accepts photos only: no mission, building ID, grades or coordinates. */
export function debateRequest(pre: Buffer, post: Buffer, model: string) {
  const schema = z.toJSONSchema(wireSchema); delete schema.$schema;
  return { model, store: false, max_output_tokens: 500, reasoning: { effort: "none" },
    instructions: INSTRUCTION, input: [{ role: "user", content: [
      { type: "input_text", text: "BEFORE, then AFTER. Compare the central building." },
      ...[pre, post].map((image) => ({ type: "input_image", image_url: "data:image/jpeg;base64," + image.toString("base64"), detail: "high" })),
    ] }], text: { format: { type: "json_schema", name: "building_debate", strict: true, schema } } };
}
export async function generateDebate(pre: Buffer, post: Buffer, options: {
  apiKey?: string; model?: string; fetcher?: typeof fetch; timeoutMs?: number; onFailure?: (reason: string) => void;
} = {}): Promise<{ debate: Debate; model: string } | null> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) throw new Error("Missing required environment variable: OPENAI_API_KEY");
  const model = options.model ?? (process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL);
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    let reason = "request failed";
    try {
      const response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
        method: "POST", signal: controller.signal,
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(debateRequest(pre, post, model)),
      });
      if (!response.ok) { reason = "HTTP " + response.status; throw new Error("Request failed"); }
      reason = "invalid response";
      const data = await response.json() as { model: string; status: string;
        output: { content?: { type: string; text?: string }[] }[] };
      if (data.status !== "completed") throw new Error("Incomplete response");
      const text = data.output.flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text")
        .map((part) => part.text ?? "").join("");
      return { debate: DebateSchema.parse(JSON.parse(text)), model: data.model || model };
    } catch (error) {
      // Never log SDK errors, request headers, response bodies, or credentials.
      const category = error instanceof Error && ["TypeError", "ZodError", "SyntaxError", "Error"].includes(error.name) ? error.name : "error";
      options.onFailure?.(controller.signal.aborted ? "timeout" : reason + " (" + category + ")");
    } finally { clearTimeout(timer); }
  }
  return null;
}
