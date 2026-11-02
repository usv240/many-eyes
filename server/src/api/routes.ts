import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { decideBatch, LIMITS } from "./decide.js";
import { KeyStore, RateLimiter } from "./keys.js";
import { openApiDocument } from "./openapi.js";

export interface ApiOptions { keys?: KeyStore; decideLimit?: RateLimiter; keyLimit?: RateLimiter }

/**
 * Public developer API under /v1. CORS is open so the project website can call a running server.
 * Keys protect the decide endpoint; issuing a key is rate limited per IP address.
 */
export function registerApiRoutes(app: FastifyInstance, options: ApiOptions = {}) {
  const keys = options.keys ?? new KeyStore("data/api-keys.json");
  const decideLimit = options.decideLimit ?? new RateLimiter(60, 60_000);
  const keyLimit = options.keyLimit ?? new RateLimiter(5, 60 * 60_000);
  const cors = (reply: FastifyReply) => reply
    .header("Access-Control-Allow-Origin", "*")
    .header("Access-Control-Allow-Headers", "Authorization, Content-Type")
    .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  app.addHook("onRequest", async (request, reply) => { if (request.url.startsWith("/v1/")) cors(reply); });
  app.options("/v1/*", async (_request, reply) => reply.code(204).send());
  app.get("/v1/health", async () => ({ ok: true, service: "many-eyes", api: "v1", keysIssued: keys.size }));
  app.get("/v1/openapi.json", async () => openApiDocument);

  app.post<{ Body: { name?: unknown } }>("/v1/keys", async (request, reply) => {
    const limit = keyLimit.take("ip:" + request.ip);
    if (!limit.ok) return reply.code(429).header("Retry-After", Math.ceil(limit.resetMs / 1000)).send({ error: "Too many keys requested from this address. Try again later." });
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    const { key, record } = keys.issue(name);
    return reply.code(201).send({ key, prefix: record.prefix, name: record.name, createdAt: record.createdAt,
      note: "Shown once. Store it safely. Send it as: Authorization: Bearer <key>" });
  });

  app.post("/v1/decide", { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const header = request.headers.authorization;
    const key = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    const record = keys.check(key);
    if (!record) return reply.code(401).send({ error: "Missing or unknown API key. Request one with POST /v1/keys." });
    const limit = decideLimit.take("key:" + record.hash);
    reply.header("RateLimit-Remaining", limit.remaining);
    if (!limit.ok) return reply.code(429).header("Retry-After", Math.ceil(limit.resetMs / 1000)).send({ error: "Rate limit: 60 requests per minute per key." });
    try { return decideBatch(request.body); }
    catch (error) {
      if (error instanceof ZodError) return reply.code(400).send({ error: "Invalid request", limits: LIMITS,
        issues: error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
      throw error;
    }
  });
}
