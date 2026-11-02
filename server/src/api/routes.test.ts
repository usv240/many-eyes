import { expect, it } from "vitest";
import Fastify from "fastify";
import { KeyStore } from "./keys.js";
import { registerApiRoutes } from "./routes.js";
it("bounds key request bodies, disables credential caching and sanitizes issuance failures", async () => {
  const app = Fastify(); registerApiRoutes(app, { keys: new KeyStore(undefined, 1) });
  try {
    const issued = await app.inject({ method: "POST", url: "/v1/keys", payload: { name: "test" } });
    expect(issued.headers["cache-control"]).toBe("no-store");
    const full = await app.inject({ method: "POST", url: "/v1/keys", payload: {} });
    expect(full.statusCode).toBe(503); expect(full.body).not.toMatch(/hash|data\/|me_/);
    expect((await app.inject({ method: "POST", url: "/v1/keys", payload: { name: "x".repeat(2000) } })).statusCode).toBe(413);
  } finally { await app.close(); }
});
