import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Keys are shown once and stored only as SHA-256 hashes. */
export interface KeyRecord { hash: string; prefix: string; name: string; createdAt: string }
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export class KeyStore {
  private records: KeyRecord[] = [];
  constructor(private readonly path?: string, private readonly maxKeys = 10_000) {
    if (path && existsSync(path)) {
      try {
        const records: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (!Array.isArray(records) || records.length > maxKeys || records.some((record) =>
          !record || typeof record.hash !== "string" || !/^[a-f0-9]{64}$/.test(record.hash) ||
          typeof record.prefix !== "string" || typeof record.name !== "string" || typeof record.createdAt !== "string")) throw new Error();
        this.records = records as KeyRecord[];
      } catch { throw new Error("Invalid API key store."); }
    }
  }
  issue(name: string, now = new Date()): { key: string; record: KeyRecord } {
    if (this.records.length >= this.maxKeys) throw new Error("API key capacity reached.");
    const key = "me_" + randomBytes(24).toString("hex");
    const record = { hash: hash(key), prefix: key.slice(0, 7), name: name.slice(0, 60) || "unnamed", createdAt: now.toISOString() };
    this.records.push(record);
    try { this.save(); } catch { this.records.pop(); throw new Error("Could not save API key."); }
    return { key, record };
  }
  check(key: string | undefined): KeyRecord | undefined {
    if (!key || !/^me_[0-9a-f]{48}$/.test(key)) return undefined;
    const candidate = Buffer.from(hash(key), "hex");
    return this.records.find((record) => timingSafeEqual(Buffer.from(record.hash, "hex"), candidate));
  }
  get size() { return this.records.length; }
  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + ".tmp", JSON.stringify(this.records, null, 2), { mode: 0o600 });
    renameSync(this.path + ".tmp", this.path);
  }
}

/** Fixed-window counter per caller. Small and in memory, which is enough for one server. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxCallers = 10_000) {}
  take(caller: string, now = Date.now()): { ok: boolean; remaining: number; resetMs: number } {
    let window = this.windows.get(caller);
    if (!window || now - window.start >= this.windowMs) {
      if (!window && this.windows.size >= this.maxCallers) {
        for (const [id, entry] of this.windows) if (now - entry.start >= this.windowMs) this.windows.delete(id);
        if (this.windows.size >= this.maxCallers) return { ok: false, remaining: 0, resetMs: this.windowMs };
      }
      window = { start: now, count: 0 };
      this.windows.set(caller, window);
    }
    window.count++;
    return { ok: window.count <= this.limit, remaining: Math.max(0, this.limit - window.count), resetMs: window.start + this.windowMs - now };
  }
}
