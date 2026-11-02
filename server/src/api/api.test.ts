import { expect, it } from "vitest";
import Fastify from "fastify";
import { decideBatch, votesFromCsv } from "./decide.js";
import { KeyStore, RateLimiter } from "./keys.js";
import { registerApiRoutes } from "./routes.js";
import { openApiDocument } from "./openapi.js";

const votes = (pairs: [string, string][]) => pairs.map(([user, vote]) => ({ user, vote }));

it("validates, refuses and replaces votes exactly like the live engine", () => {
  const result = decideBatch({ tiles: [
    { id: "a", votes: votes([["u1", "1"], ["u2", "destroyed"], ["u3", "!1"], ["u4", "2"]]) },
    { id: "b", votes: votes([["u1", "1"], ["u2", "2"]]) },
    { id: "c", votes: votes([["u1", "1"], ["u2", "2"], ["u3", "1"], ["u4", "2"]]) },
    { id: "d", votes: votes([["u1", "2"], ["u1", "1"], ["u2", "1"], ["u3", "1"], ["u4", "3"]]) },
  ] });
  expect(result.tiles.map((tile) => [tile.status, tile.label, tile.reason])).toEqual([
    ["validated", "destroyed", null], ["refused", null, "too_few_voters"], ["refused", null, "low_agreement"], ["validated", "destroyed", null]]);
  expect(result.tiles[3]!.voters).toBe(3);
  expect(result.summary).toMatchObject({ tiles: 4, validated: 2, refused: 2 });
});

it("lets hidden checks reweight voters for later tiles only", () => {
  const troll = (truth: "destroyed" | "intact", id: string) => ({ id, truth,
    votes: votes([["honest1", truth === "destroyed" ? "1" : "2"], ["honest2", truth === "destroyed" ? "1" : "2"],
      ["troll1", truth === "destroyed" ? "2" : "1"], ["troll2", truth === "destroyed" ? "2" : "1"]]) });
  const tiles = [troll("destroyed", "g1"), troll("intact", "g2"), troll("destroyed", "g3"), troll("intact", "g4"),
    { id: "work", votes: votes([["honest1", "1"], ["honest2", "1"], ["troll1", "2"], ["troll2", "2"]]) }];
  const result = decideBatch({ tiles });
  expect(result.tiles[0]!.status).toBe("refused");
  const work = result.tiles.at(-1)!;
  expect(work.status).toBe("validated");
  expect(work.label).toBe("destroyed");
  expect(work.unweighted.status).toBe("refused");
  expect(result.weights[0]!.weight).toBeGreaterThan(result.weights.at(-1)!.weight);
  expect(result.summary.checks.count).toBe(4);
});

it("reads CSV votes with optional truth and coordinates, and builds GeoJSON", () => {
  const request = votesFromCsv("tile_id,user_id,vote,truth,lon,lat\nt1,a,1,destroyed,85.33,28.16\nt1,b,1,,,\nt1,c,2,,,\nt1,d,1,,,\nt2,a,3,,,\n");
  expect(request.tiles).toHaveLength(2);
  const result = decideBatch(request);
  expect(result.tiles[0]).toMatchObject({ status: "validated", label: "destroyed", check: { truth: "destroyed", correct: true } });
  expect(result.geojson.features).toHaveLength(1);
  expect(result.geojson.features[0]).toMatchObject({ geometry: { type: "Point", coordinates: [85.33, 28.16] } });
  expect(() => votesFromCsv("tile,user\nx,y")).toThrow(/tile_id/);
  expect(() => votesFromCsv("tile_id,user_id,vote,truth\nx,y,1,maybe")).toThrow(/truth/);
});

it("rejects bad input with readable issues", () => {
  expect(() => decideBatch({ tiles: [] })).toThrow();
  expect(() => decideBatch({ tiles: [{ id: "x", votes: [{ user: "a", vote: "7" }] }] })).toThrow();
  expect(() => decideBatch({ tiles: [{ id: "x", votes: [] }, { id: "x", votes: [] }] })).toThrow();
});

it("issues keys once, stores only hashes, and guards decide with keys and rate limits", async () => {
  const keys = new KeyStore();
  const app = Fastify();
  registerApiRoutes(app, { keys, decideLimit: new RateLimiter(2, 60_000), keyLimit: new RateLimiter(1, 60_000) });
  const issued = await app.inject({ method: "POST", url: "/v1/keys", payload: { name: "judge" } });
  expect(issued.statusCode).toBe(201);
  const { key } = issued.json() as { key: string };
  expect(key).toMatch(/^me_[0-9a-f]{48}$/);
  expect(JSON.stringify(keys)).not.toContain(key);
  expect((await app.inject({ method: "POST", url: "/v1/keys" })).statusCode).toBe(429);
  const body = { tiles: [{ id: "t", votes: votes([["a", "1"], ["b", "1"], ["c", "1"]]) }] };
  expect((await app.inject({ method: "POST", url: "/v1/decide", payload: body })).statusCode).toBe(401);
  const ok = await app.inject({ method: "POST", url: "/v1/decide", payload: body, headers: { authorization: "Bearer " + key } });
  expect(ok.statusCode).toBe(200);
  expect(ok.headers["access-control-allow-origin"]).toBe("*");
  expect(ok.json()).toMatchObject({ summary: { validated: 1 } });
  const bad = await app.inject({ method: "POST", url: "/v1/decide", payload: { tiles: [] }, headers: { authorization: "Bearer " + key } });
  expect(bad.statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: "/v1/decide", payload: body, headers: { authorization: "Bearer " + key } })).statusCode).toBe(429);
  expect((await app.inject({ method: "OPTIONS", url: "/v1/decide" })).statusCode).toBe(204);
  await app.close();
});

it("documents every public route in the OpenAPI file", async () => {
  const app = Fastify();
  registerApiRoutes(app, { keys: new KeyStore() });
  await app.ready();
  for (const path of Object.keys(openApiDocument.paths)) expect(app.printRoutes()).toContain(path.split("/").pop());
  expect((await app.inject("/v1/openapi.json")).json()).toMatchObject({ openapi: "3.1.0" });
  await app.close();
});
