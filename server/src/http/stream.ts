import type { FastifyInstance } from "fastify";
import type { PublicState } from "../runner/mission-runner.js";

export interface StateSource {
  getState(): PublicState;
  on(event: "state", listener: (state: PublicState) => void): unknown;
  off(event: "state", listener: (state: PublicState) => void): unknown;
}

export function registerStreamRoutes(app: FastifyInstance, source: StateSource) {
  const clients = new Set<() => void>();
  // SSE requests must finish before Fastify can drain HTTP connections.
  app.addHook("preClose", async () => { for (const close of clients) close(); });
  app.get("/api/stream", (_request, reply) => {
    reply.hijack();
    const response = reply.raw;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      source.off("state", onState);
      response.off("close", cleanup);
      response.off("error", close);
      clients.delete(close);
    };
    const close = () => { cleanup(); response.end(); };
    const send = (frame: string) => {
      if (closed || response.destroyed) return;
      // Bound memory for slow clients. EventSource will reconnect and receive the latest snapshot.
      if (!response.write(frame)) { cleanup(); response.destroy(); }
    };
    const onState = (state: PublicState) => send("data: " + JSON.stringify(state) + "\n\n");
    response.on("close", cleanup);
    response.on("error", close);
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    response.flushHeaders();
    clients.add(close);
    source.on("state", onState);
    const timer = setInterval(() => send(": ping\n\n"), 15000);
    timer.unref();
    onState(source.getState());
  });
}
