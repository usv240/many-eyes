import { attachInfo, escapeHtml } from "./common.js";

type Label = "destroyed" | "intact" | "unsure";
interface Tile {
  id: string; truth: "destroyed" | "intact"; lat: number; lon: number; grade: string;
  ai: { label: "destroyed" | "intact"; confidence: number; model: string };
  advocate: { claim: string; box: number[] }; skeptic: { claim: string; box: number[] };
}

/** Wipe slider: the range input drives a CSS variable; dragging on the photo works too. */
function bindWipe(stage: HTMLElement, range: HTMLInputElement) {
  const set = (value: number) => { const clamped = Math.max(0, Math.min(100, value)); stage.style.setProperty("--wipe", clamped + "%"); range.value = String(Math.round(clamped)); };
  range.addEventListener("input", () => set(Number(range.value)));
  let dragging = false;
  const move = (event: PointerEvent) => { const box = stage.getBoundingClientRect(); set((event.clientX - box.left) / box.width * 100); };
  stage.addEventListener("pointerdown", (event) => { if (event.pointerType === "mouse") { dragging = true; stage.setPointerCapture(event.pointerId); move(event); } });
  stage.addEventListener("pointermove", (event) => { if (dragging) move(event); });
  stage.addEventListener("pointerup", () => { dragging = false; });
  return set;
}

const heroStage = document.querySelector<HTMLElement>("[data-hero-stage]");
const heroRange = document.querySelector<HTMLInputElement>("[data-hero-wipe]");
if (heroStage && heroRange) bindWipe(heroStage, heroRange);

/** Sections rise in once as they enter the viewport. Content never stays hidden without JavaScript. */
const observer = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("seen"); observer?.unobserve(entry.target); }
}, { rootMargin: "0px 0px -10% 0px" }) : null;
document.querySelectorAll(".reveal-up").forEach((element) => observer ? observer.observe(element) : element.classList.add("seen"));

const trial = document.querySelector<HTMLElement>("[data-trial]");
if (trial) void startTrial(trial);

async function startTrial(root: HTMLElement) {
  const tiles = await fetch("data/tiles.json").then((response) => response.json() as Promise<Tile[]>);
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const stage = $<HTMLElement>("[data-stage]");
  const setWipe = bindWipe(stage, $<HTMLInputElement>("[data-wipe]"));
  const reveal = $<HTMLElement>("[data-reveal]");
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-vote]")];
  const answers: { tile: Tile; vote: Label }[] = [];
  let index = 0;

  const placeBox = (name: "advocate" | "skeptic", box: number[]) => {
    const element = $<HTMLElement>(`[data-box="${name}"]`);
    const [x = 0, y = 0, w = 0, h = 0] = box;
    Object.assign(element.style, { left: x + "%", top: y + "%", width: w + "%", height: h + "%" });
    element.hidden = !(w > 0 && h > 0);
  };

  function show() {
    const tile = tiles[index]!;
    $<HTMLImageElement>("[data-pre]").src = `tiles/${tile.id}-pre.jpg`;
    $<HTMLImageElement>("[data-pre]").alt = "Satellite photo before the flood";
    $<HTMLImageElement>("[data-post]").src = `tiles/${tile.id}-post.jpg`;
    $<HTMLImageElement>("[data-post]").alt = "Satellite photo after the flood";
    setWipe(50);
    placeBox("advocate", tile.advocate.box); placeBox("skeptic", tile.skeptic.box);
    $<HTMLElement>("[data-progress]").textContent = `Building ${index + 1} of ${tiles.length}`;
    $<HTMLElement>("[data-advocate]").textContent = tile.advocate.claim;
    $<HTMLElement>("[data-skeptic]").textContent = tile.skeptic.claim;
    $<HTMLElement>("[data-caption]").textContent = `${tile.lat.toFixed(4)}° N, ${tile.lon.toFixed(4)}° E · Before 17 Sep 2023 · After 27 Aug 2026`;
    reveal.hidden = true; reveal.innerHTML = "";
    for (const button of buttons) { button.disabled = false; button.setAttribute("aria-pressed", "false"); }
  }

  function vote(label: Label) {
    if (reveal.hidden === false) return;
    const tile = tiles[index]!;
    answers.push({ tile, vote: label });
    for (const button of buttons) { button.disabled = true; button.setAttribute("aria-pressed", String(button.dataset.vote === label)); }
    const verdict = label === "unsure" ? "You chose unsure. In Many Eyes that counts toward nothing, which is honest when you cannot tell."
      : label === tile.truth ? "You matched the experts." : "You and the experts disagree on this one.";
    const aiRight = tile.ai.label === tile.truth;
    const last = index === tiles.length - 1;
    reveal.innerHTML = `
      <p><b>Experts:</b> <span class="${tile.truth}">${tile.truth}</span>. <b>You:</b> ${label}.</p>
      <p>${verdict}</p>
      <p class="small muted">AI alone said <b>${tile.ai.label}</b> with ${Math.round(tile.ai.confidence * 100)}% confidence${aiRight ? "." : ", and was wrong."}<span data-info="${escapeHtml(
        "On the stream this line only appears after chat has decided, so the AI cannot sway the vote. Expert grade from Copernicus: " + tile.grade + ".")}" data-info-label="AI alone"></span></p>
      <div class="actions"><button class="button" type="button" data-next>${last ? "See your score" : "Next building"}</button></div>`;
    reveal.querySelectorAll<HTMLElement>("[data-info]").forEach(attachInfo);
    reveal.hidden = false;
    reveal.querySelector<HTMLButtonElement>("[data-next]")!.addEventListener("click", () => { if (last) finish(); else { index++; show(); } });
    reveal.querySelector<HTMLButtonElement>("[data-next]")!.focus({ preventScroll: true });
  }

  function finish() {
    const right = answers.filter((answer) => answer.vote === answer.tile.truth).length;
    const unsure = answers.filter((answer) => answer.vote === "unsure").length;
    const aiRight = tiles.filter((tile) => tile.ai.label === tile.truth).length;
    const weight = answers.reduce((value, answer) => answer.vote === "unsure" ? value
      : Math.max(0.2, Math.min(2, Math.round((value + (answer.vote === answer.tile.truth ? 0.1 : -0.2)) * 10) / 10)), 1);
    reveal.innerHTML = `
      <p class="score">${right} of ${tiles.length}</p>
      <p>You matched the experts on ${right} building${right === 1 ? "" : "s"}${unsure ? `, and said unsure on ${unsure}` : ""}. The AI alone matched on ${aiRight} of ${tiles.length}.</p>
      <p>If these had been hidden checks on stream, your vote would now count <b>${weight.toFixed(1)}×</b> a new viewer's.<span data-info="Every viewer starts at 1.0. A correct hidden check adds 0.1, a wrong one removes 0.2, and weights stay between 0.2 and 2.0. Unsure leaves the weight unchanged." data-info-label="Your weight"></span></p>
      <p class="small muted">Across all 80 hidden checks, the AI alone scored 73.8%, and called 52.5% of standing buildings destroyed.</p>
      <div class="actions"><button class="button" type="button" data-again>Try again</button><a class="button quiet" href="#results">See the full results</a></div>`;
    reveal.querySelectorAll<HTMLElement>("[data-info]").forEach(attachInfo);
    reveal.querySelector<HTMLButtonElement>("[data-again]")!.addEventListener("click", () => { answers.length = 0; index = 0; show(); });
  }

  for (const button of buttons) button.addEventListener("click", () => vote(button.dataset.vote as Label));
  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey) return;
    const rect = root.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const label = ({ "1": "destroyed", "2": "intact", "3": "unsure" } as const)[event.key as "1" | "2" | "3"];
    if (label) vote(label);
  });
  show();
}
