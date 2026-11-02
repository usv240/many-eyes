import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["{server,overlay,sim,site}/src/**/*.test.ts"] } });
