import { expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyStore, RateLimiter } from "./keys.js";
it("caps keys and rejects malformed stored hashes without leaking their contents", () => {
  const keys = new KeyStore(undefined, 1); const issued = keys.issue("a");
  expect(() => keys.issue("b")).toThrow("capacity"); expect(keys.check(issued.key)).toBeDefined();
  const dir = mkdtempSync(join(tmpdir(), "many-eyes-keys-"));
  try {
    const path = join(dir, "keys.json"); writeFileSync(path, '[{"hash":"private-value"}]');
    expect(() => new KeyStore(path)).toThrow("Invalid API key store.");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it("never evicts active rate limits to admit new callers", () => {
  const limiter = new RateLimiter(1, 1000, 2);
  expect(limiter.take("a", 0).ok).toBe(true); expect(limiter.take("b", 0).ok).toBe(true);
  expect(limiter.take("c", 0).ok).toBe(false); expect(limiter.take("a", 0).ok).toBe(false);
  expect(limiter.take("c", 1000).ok).toBe(true);
});

it("rolls back keys when persistence fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "many-eyes-key-failure-"));
  try {
    writeFileSync(join(dir, "blocked"), "file");
    const keys = new KeyStore(join(dir, "blocked", "keys.json"));
    expect(() => keys.issue("test")).toThrow("Could not save API key."); expect(keys.size).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
