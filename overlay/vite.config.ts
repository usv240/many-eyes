import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), ["PORT", "OVERLAY_PORT"]);
  const port = Number(process.env.PORT || env.PORT || 8791);
  const overlayPort = Number(process.env.OVERLAY_PORT || env.OVERLAY_PORT || 5180);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  if (!Number.isInteger(overlayPort) || overlayPort < 1 || overlayPort > 65535) throw new Error("OVERLAY_PORT must be a valid TCP port.");
  return { root, server: { host: "127.0.0.1", port: overlayPort, strictPort: true,
    fs: { allow: [root, fileURLToPath(new URL("../node_modules", import.meta.url))] },
    proxy: { "/api": { target: "http://127.0.0.1:" + port, changeOrigin: true, proxyTimeout: 30000, timeout: 30000 } } },
    build: { outDir: "dist" } };
});
