import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("..", import.meta.url));

// Static, multi-page site. Relative base so it works on GitHub Pages under /many-eyes/ and from any folder.
export default defineConfig({
  root,
  base: "./",
  server: { host: "127.0.0.1", port: Number(process.env.SITE_PORT || 5190), strictPort: true, fs: { allow: [repo] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { index: root + "index.html", data: root + "data.html", api: root + "api.html" } },
  },
});
