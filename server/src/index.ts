import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { registerMissionRoutes } from "./http/missions.js";
import { registerStreamRoutes } from "./http/stream.js";
import { createLive, type LiveMission } from "./live.js";

export function createApp(options: { live?: LiveMission; instanceId?: string } = {}) {
  const app = Fastify({ logger: false });
  const instanceId = options.instanceId ?? randomUUID();
  app.addHook("onRequest", async (_request, reply) => { reply.header("x-many-eyes-instance", instanceId); });
  const live = options.live ?? createLive();
  void registerMissionRoutes(app, live.runner);
  registerStreamRoutes(app, live.runner);
  app.addHook("onReady", async () => { await live.start(); });
  app.addHook("preClose", async () => { await live.stop(); });
  return app;
}

async function main() {
  const port = Number(process.env.PORT ?? 8791);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  const app = createApp();
  const shutdown = () => { void app.close(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  app.addHook("onClose", async () => { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); });
  try {
    await app.listen({ port, host: "127.0.0.1" });
    console.log("Many Eyes listening on http://localhost:" + port + " (SSE: /api/stream)");
  } catch (error) { await app.close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Server startup failed.");
    process.exitCode = 1;
  });
