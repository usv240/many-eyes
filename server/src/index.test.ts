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
