import type { PublicState } from "../../server/src/runner/mission-runner.js";
import type { TileImages } from "./view.js";

export interface Snapshot {
  state: PublicState | null; receivedAt: number; imagery?: TileImages;
  imageryStatus: "loading" | "ready" | "error"; connection: "connecting" | "open" | "reconnecting";
}
interface Events {
  onopen: (() => void) | null; onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null; close(): void;
}
export function connectStream(update: (snapshot: Snapshot) => void,
  dependencies: { events?: (url: string) => Events; fetcher?: typeof fetch; now?: () => number } = {}) {
  const factory = dependencies.events ?? ((url: string) => new EventSource(url) as unknown as Events);
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  let snapshot: Snapshot = { state: null, receivedAt: now(), imageryStatus: "loading", connection: "connecting" };
  let stopped = false; let events: Events;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let imageTimer: ReturnType<typeof setTimeout> | undefined;
  let token: string | undefined;
  const publish = () => { if (!stopped) update({ ...snapshot }); };
  const connect = () => {
    if (stopped) return;
    events = factory("/api/stream");
    // Bound attempts to establish an SSE connection; an established stream is intentionally long-lived.
    const armDeadline = () => {
      clearTimeout(deadline);
      deadline = setTimeout(() => { events.close(); snapshot.connection = "reconnecting"; publish();
        deadline = setTimeout(connect, 3000); }, 10000);
    };
    armDeadline();
    events.onopen = () => { clearTimeout(deadline); snapshot.connection = "open"; publish(); };
    events.onerror = () => { snapshot.connection = "reconnecting"; publish(); armDeadline(); };
    events.onmessage = (event) => {
      if (stopped) return;
      let state: PublicState;
      try {
        state = JSON.parse(event.data) as PublicState;
        if (!Number.isFinite(state.serverNow) || !state.mission || !state.stats || !state.live ||
          (state.tile && !/^[a-f0-9]{12}$/.test(state.tile.token))) return;
      } catch { return; }
      snapshot = { ...snapshot, state, receivedAt: now(), connection: "open" };
      clearTimeout(deadline);
      const nextToken = state.tile?.token;
      if (nextToken !== token) {
        token = nextToken; request?.abort(); clearTimeout(imageTimer); snapshot.imagery = undefined; snapshot.imageryStatus = "loading";
        if (token) {
          const current = token; const controller = new AbortController(); request = controller;
          const imageryUrl = state.tile!.imageryUrl;
          if (!imageryUrl?.startsWith("/api/tiles/")) { snapshot.imageryStatus = "error"; publish(); return; }
          const timeout = setTimeout(() => {
            controller.abort();
            if (!stopped && token === current) { snapshot = { ...snapshot, imageryStatus: "error" }; publish(); }
          }, 8000);
          imageTimer = timeout;
          void fetcher(imageryUrl, { signal: controller.signal })
            .then(async (response) => {
              if (!response.ok) throw new Error("Imagery request failed.");
              const image = await response.json() as TileImages;
              if (!image.pre?.startsWith("data:image/jpeg;base64,") || !image.post?.startsWith("data:image/jpeg;base64,") ||
                !Number.isFinite(image.zoom) || !Number.isFinite(image.sizePx) || image.sizePx <= 0 ||
                !Number.isFinite(image.lat)) throw new Error("Invalid imagery.");
              if (stopped || current !== token || controller.signal.aborted) return;
              snapshot = { ...snapshot, imagery: image, imageryStatus: "ready" }; publish();
            }).catch(() => {
              if (stopped || current !== token) return;
              snapshot = { ...snapshot, imageryStatus: "error" }; publish();
            }).finally(() => clearTimeout(timeout));
        }
      }
      publish();
    };
  };
  connect(); publish();
  return () => { stopped = true; clearTimeout(deadline); clearTimeout(imageTimer); request?.abort(); events.close(); };
}
