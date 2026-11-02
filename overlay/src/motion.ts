import type { Snapshot } from "./stream.js";

export function motionPlan(snapshot: Snapshot, now: number, reduced: boolean) {
  const state = snapshot.state; const tile = state?.tile;
  return { wipe: !reduced && state?.phase === "voting" && snapshot.imageryStatus === "ready",
    countdown: state?.phase === "voting" && tile ? Math.max(0, tile.closesAt - now) : 0,
    duration: tile ? tile.closesAt - tile.openedAt : 15000,
    key: `${tile?.token}:${state?.phase}`, blur: reduced ? "none" : "blur(2px)" };
}

/** Call before rendering: retain the outgoing pixels, then transition the new layer. */
export function createMotion(root: HTMLElement) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const layer = root.querySelector<HTMLElement>('[data-node="photoLayer"]')!;
  const countdown = root.querySelector<HTMLElement>('[data-node="countdownFill"]')!;
  const divider = root.querySelector<HTMLElement>('[data-node="divider"]')!;
  let old: HTMLElement | undefined; let token: string | undefined; let image: string | undefined;
  let clockKey = ""; let wiping = false; let direction = false;
  let wipeTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  const frames = new Set<number>();
  const frame = (fn: () => void) => { const id = requestAnimationFrame(() => { frames.delete(id); fn(); }); frames.add(id); };
  const position = (percent: number, park = false) => {
    for (const [node, sign] of [[layer.querySelector<HTMLElement>(".wipe-window")!, 1],
      [layer.querySelector<HTMLElement>(".after")!, -1], [layer.querySelector<HTMLElement>(".after-annotations")!, -1], [divider, 1]] as const) {
      node.style.transitionDuration = reduced.matches ? "0ms" : park ? "200ms" : "7000ms";
      node.style.transform = `translateX(${percent * sign}%)`;
    }
  };
  const sweep = () => { direction = !direction; position(direction ? 85 : 15); wipeTimer = setTimeout(sweep, 7000); };
  const reset = () => { clockKey = ""; wiping = false; clearTimeout(wipeTimer); position(50, true); };
  reduced.addEventListener("change", reset);
  return {
    sync(snapshot: Snapshot, now: number) {
      const plan = motionPlan(snapshot, now, reduced.matches);
      if (token !== snapshot.state?.tile?.token) {
        clearTimeout(fadeTimer); old?.remove(); old = undefined;
        if (image) {
          old = layer.cloneNode(true) as HTMLElement;
          old.querySelectorAll("[data-node]").forEach((node) => node.removeAttribute("data-node"));
          old.removeAttribute("data-node"); old.setAttribute("aria-hidden", "true");
          layer.before(old);
        }
        token = snapshot.state?.tile?.token; image = undefined;
      }
      if (snapshot.imageryStatus === "ready" && snapshot.imagery?.pre !== image) {
        image = snapshot.imagery?.pre;
        layer.style.transition = "none"; layer.style.opacity = "0"; layer.style.filter = plan.blur;
        frame(() => { frame(() => {
          layer.style.transition = ""; layer.style.opacity = "1"; layer.style.filter = "";
          if (old) { old.style.opacity = "0"; old.style.filter = plan.blur; }
          fadeTimer = setTimeout(() => { old?.remove(); old = undefined; }, 200);
        }); });
      }
      if (snapshot.imageryStatus === "error") { old?.remove(); old = undefined; }
      if (plan.wipe !== wiping) {
        clearTimeout(wipeTimer); wiping = plan.wipe;
        if (wiping) {
          // Establish the parked pose before the first paint; never sweep in from 0%.
          position(50, true);
          for (const node of [layer.querySelector<HTMLElement>(".wipe-window")!,
            layer.querySelector<HTMLElement>(".after")!, layer.querySelector<HTMLElement>(".after-annotations")!, divider]) node.style.transitionDuration = "0ms";
          void layer.getBoundingClientRect();
          frame(() => { frame(() => { if (wiping) sweep(); }); });
        } else position(50, true);
      }
      if (clockKey !== plan.key) {
        clockKey = plan.key; countdown.style.transition = "none";
        countdown.style.transform = `scaleX(${Math.min(1, plan.countdown / plan.duration)})`;
        if (!reduced.matches) frame(() => { frame(() => {
          countdown.style.transition = `transform ${plan.countdown}ms linear`;
          countdown.style.transform = "scaleX(0)";
        }); });
      }
      if (reduced.matches) countdown.style.transform = `scaleX(${Math.min(1, plan.countdown / plan.duration)})`;
    },
    close() { clearTimeout(wipeTimer); clearTimeout(fadeTimer); frames.forEach(cancelAnimationFrame);
      reduced.removeEventListener("change", reset); old?.remove(); },
  };
}
