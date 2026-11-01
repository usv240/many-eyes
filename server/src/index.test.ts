import { expect, it } from "vitest";
import { createApp } from "./index.js";
import { createLive } from "./live.js";
import { MemoryLedger } from "./ledger/ledger.js";

it("owns one live mission for the HTTP app's lifetime", async () => {
  const live = createLive({ env: {}, ledger: new MemoryLedger() });
  const app = createApp({ live });
  try {
    const response = await app.inject("/api/missions");
    expect(response.statusCode).toBe(200);
    expect(app.hasRoute({ method: "GET", url: "/api/stream" })).toBe(true);
    expect(live.runner.getState().phase).toBe("voting");
  } finally { await app.close(); }
  expect(live.runner.getState().phase).toBe("stopped");
});

it("reports the real port conflict in sim mode without Twitch advice", async () => {
  const first = createApp({ live: createLive({ env: {}, ledger: new MemoryLedger() }) });
  const second = createApp({ live: createLive({ env: {}, ledger: new MemoryLedger() }) });
  try {
    const url = await first.listen({ host: "127.0.0.1", port: 0 });
    await expect(second.listen({ host: "127.0.0.1", port: Number(new URL(url).port) })).rejects.toMatchObject({ code: "EADDRINUSE" });
  } finally { await Promise.all([first.close(), second.close()]); }
});
