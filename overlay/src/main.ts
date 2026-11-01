import { createRenderer } from "./render.js";
import { connectStream, type Snapshot } from "./stream.js";
import { view } from "./view.js";
import { fixtureSnapshot, isFixtureName } from "./fixtures.js";
import { createMotion } from "./motion.js";
import "./style.css";

const root = document.querySelector<HTMLElement>("#scene")!;
const render = createRenderer(root);
const motion = createMotion(root);
const requested = new URLSearchParams(location.search).get("fixture");
const fixtureName = requested && isFixtureName(requested) ? requested : null;
if (requested && !fixtureName) throw new Error("Unknown overlay fixture: " + requested);
let latest: Snapshot = { state: null, receivedAt: Date.now(), connection: "connecting", imageryStatus: "loading" };
const paint = () => {
  const now = latest.state ? Date.now() - (latest.receivedAt - latest.state.serverNow) : Date.now();
  motion.sync(latest, now);
  render(view(latest.state, { ...latest, now, localNow: Date.now(), ...(fixtureName === "intro" ? { intro: true } : {}) }));
};
const disconnect = fixtureName ? (() => {
  latest = fixtureSnapshot(fixtureName); paint(); return () => {};
})() : connectStream((snapshot) => { latest = snapshot; paint(); });
const fit = () => {
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  root.style.transform = "scale(" + scale + ")";
  root.style.left = Math.max(0, (innerWidth - 1920 * scale) / 2) + "px";
  root.style.top = Math.max(0, (innerHeight - 1080 * scale) / 2) + "px";
};
fit(); window.addEventListener("resize", fit);
const timer = setInterval(paint, 100);
window.addEventListener("pagehide", () => { disconnect(); motion.close(); clearInterval(timer); window.removeEventListener("resize", fit); }, { once: true });
