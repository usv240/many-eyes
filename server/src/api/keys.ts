import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Keys are shown once and stored only as SHA-256 hashes. */
export interface KeyRecord { hash: string; prefix: string; name: string; createdAt: string }
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export class KeyStore {
  private records: KeyRecord[] = [];
  constructor(private readonly path?: string) {
    if (path && existsSync(path)) this.records = JSON.parse(readFileSync(path, "utf8")) as KeyRecord[];
  }
  issue(name: string, now = new Date()): { key: string; record: KeyRecord } {
    const key = "me_" + randomBytes(24).toString("hex");
    const record = { hash: hash(key), prefix: key.slice(0, 7), name: name.slice(0, 60) || "unnamed", createdAt: now.toISOString() };
    this.records.push(record);
    this.save();
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
      if (!window && this.windows.size >= this.maxCallers) this.windows.delete(this.windows.keys().next().value!);
      window = { start: now, count: 0 };
      this.windows.set(caller, window);
    }
    window.count++;
    return { ok: window.count <= this.limit, remaining: Math.max(0, this.limit - window.count), resetMs: window.start + this.windowMs - now };
  }
}
