import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import { registerMissionRoutes } from "./http/missions.js";

export function createApp() {
  const app = Fastify({ logger: false });
  void registerMissionRoutes(app);
  return app;
}

async function main() {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  await createApp().listen({ port, host: "0.0.0.0" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Server startup failed.");
    process.exitCode = 1;
  });
