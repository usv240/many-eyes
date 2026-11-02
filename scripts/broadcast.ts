import { createServer } from "vite";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/src/index.js";
import { assertOwnServer, assertPortUnused } from "../server/src/http/health.js";

import { createVideoLive } from "../server/src/runner/video.js";

const source = process.argv[2] ?? "sim";
if (source !== "sim" && source !== "twitch" && source !== "mixed" && source !== "video") throw new Error("Use sim, twitch, mixed or video.");
process.env.MANY_EYES_SOURCE = source === "video" ? "sim" : source;
const port = Number(process.env.PORT || 8791);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
let app: ReturnType<typeof createApp> | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.allSettled([app?.close(), vite?.close()]);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void close(); });
try {
  await assertPortUnused(port);
  const instanceId = randomUUID();
  app = createApp({ instanceId, ...(source === "video" ? { live: createVideoLive() } : {}) });
  vite = await createServer({ configFile: "overlay/vite.config.ts" });
  await app.listen({ port, host: "127.0.0.1" });
  await assertOwnServer(port, instanceId);
  await vite.listen();
  console.log("Many Eyes (" + source + ") — OBS browser source: http://localhost:" + vite.config.server.port + "/ (1920 × 1080)");
} catch (error) {
  await close();
  console.error(error instanceof Error ? error.message : "Server startup failed.");
  process.exitCode = 1;
}
