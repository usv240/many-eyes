import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["{server,overlay,sim}/src/**/*.test.ts"] } });
