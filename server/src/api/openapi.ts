/** OpenAPI 3.1 description of the public /v1 API. Kept by hand and checked by a test against the routes. */
export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Many Eyes API",
    version: "1.0.0",
    description: "Turn crowd votes into validated or refused labels with the same consensus engine the Many Eyes stream uses. " +
      "A label is validated when weighted agreement is at least 66% from at least 3 voters who did not vote unsure. " +
      "Tiles with a known answer (truth) act as hidden checks: they score the crowd and adjust each voter's weight for later tiles.",
    license: { name: "MIT" },
  },
  servers: [{ url: "http://127.0.0.1:8791", description: "Local server started by npm run demo" }],
  components: {
    securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "A key from POST /v1/keys" } },
    schemas: {
      Vote: { type: "object", required: ["user", "vote"], properties: {
        user: { type: "string", maxLength: 128, description: "Any stable voter id, for example a Twitch user id" },
        vote: { description: "1 or destroyed, 2 or intact, 3 or unsure", oneOf: [{ type: "string", maxLength: 32 }, { type: "integer" }] } } },
      Tile: { type: "object", required: ["id", "votes"], properties: {
        id: { type: "string", maxLength: 128 },
        votes: { type: "array", maxItems: 1000, items: { $ref: "#/components/schemas/Vote" } },
        truth: { type: "string", enum: ["destroyed", "intact"], description: "Known answer. Makes this tile a hidden check." },
        lon: { type: "number" }, lat: { type: "number" } } },
    },
  },
  paths: {
    "/v1/health": { get: { summary: "Service status", responses: { 200: { description: "OK" } } } },
    "/v1/keys": { post: { summary: "Request an API key (shown once, 5 per hour per address)",
      requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } },
      responses: { 201: { description: "The new key" }, 429: { description: "Too many keys requested" }, 413: { description: "Key request exceeds 1 KB" }, 503: { description: "Key store unavailable or full" } } } },
    "/v1/decide": { post: { summary: "Decide labels for a batch of tiles", security: [{ apiKey: [] }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["tiles"],
        properties: { tiles: { type: "array", minItems: 1, maxItems: 5000, items: { $ref: "#/components/schemas/Tile" } } } } } } },
      responses: { 200: { description: "Per-tile decisions, a summary, voter weights and GeoJSON" },
        400: { description: "Invalid request" }, 401: { description: "Missing or unknown key" }, 429: { description: "Rate limited" } } } },
  },
} as const;
