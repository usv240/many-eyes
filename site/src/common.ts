import "./styles.css";

/** Theme: light by default, dark on request. The choice is remembered when storage is available. */
const THEME_KEY = "many-eyes-theme";
function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  const toggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (toggle) {
    toggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
  }
}
function storedTheme(): "light" | "dark" {
  const requested = new URLSearchParams(location.search).get("theme");
  if (requested === "dark" || requested === "light") return requested;
  try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
}
applyTheme(storedTheme());
document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: the toggle still works for this visit */ }
});

/** Mobile navigation. */
const menu = document.querySelector<HTMLButtonElement>("[data-menu]");
const nav = document.querySelector<HTMLElement>("[data-nav]");
menu?.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  nav?.classList.toggle("open", open);
});
nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
  menu?.setAttribute("aria-expanded", "false"); nav.classList.remove("open");
}));

/**
 * Info buttons. Any element with data-info="text" gets an "i" button. The note opens on hover
 * (with a short delay), on keyboard focus and on tap, and closes on Escape or a tap elsewhere.
 */
let openNote: { button: HTMLButtonElement; note: HTMLElement } | null = null;
let counter = 0;
function closeNote() {
  if (!openNote) return;
  openNote.note.hidden = true;
  openNote.button.setAttribute("aria-expanded", "false");
  openNote = null;
}
function place(button: HTMLElement, note: HTMLElement) {
  note.hidden = false;
  const box = button.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 32);
  note.style.width = width + "px";
  const left = Math.min(Math.max(16, box.left + box.width / 2 - width / 2), window.innerWidth - width - 16);
  const below = box.bottom + 10 + note.offsetHeight < window.innerHeight;
  note.style.left = left + window.scrollX + "px";
  note.style.top = (below ? box.bottom + 10 : box.top - note.offsetHeight - 10) + window.scrollY + "px";
}
function show(button: HTMLButtonElement, note: HTMLElement) {
  if (openNote?.note === note) return;
  closeNote();
  place(button, note);
  button.setAttribute("aria-expanded", "true");
  openNote = { button, note };
}
export function attachInfo(target: HTMLElement) {
  const text = target.dataset.info;
  if (!text || target.dataset.infoReady) return;
  target.dataset.infoReady = "true";
  const label = target.dataset.infoLabel || target.textContent?.trim().slice(0, 60) || "this";
  const button = document.createElement("button");
  const id = "note-" + ++counter;
  button.type = "button";
  button.className = "info";
  button.textContent = "i";
  button.setAttribute("aria-label", "More about " + label);
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", id);
  const note = document.createElement("div");
  note.className = "note";
  note.id = id;
  note.setAttribute("role", "note");
  note.hidden = true;
  note.innerHTML = "<strong></strong><p></p>";
  note.querySelector("strong")!.textContent = label;
  note.querySelector("p")!.textContent = text;
  document.body.append(note);
  let timer: number | undefined;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (fine) {
    button.addEventListener("pointerenter", () => { timer = window.setTimeout(() => show(button, note), 180); });
    button.addEventListener("pointerleave", () => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (openNote?.note === note && !note.matches(":hover")) closeNote(); }, 220); });
    note.addEventListener("pointerleave", () => { if (openNote?.note === note) closeNote(); });
  }
  button.addEventListener("focus", () => show(button, note));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (openNote?.note === note && !fine) closeNote(); else show(button, note);
  });
  if (target.dataset.infoPlacement === "self") target.replaceWith(button); else target.append(button);
}
document.querySelectorAll<HTMLElement>("[data-info]").forEach(attachInfo);
document.addEventListener("click", (event) => { if (openNote && !openNote.note.contains(event.target as Node)) closeNote(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && openNote) { const { button } = openNote; closeNote(); button.focus(); } });
window.addEventListener("resize", closeNote);

/** Small helpers shared by pages. */
export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const percent = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined ? "n/a" : (value * 100).toFixed(digits) + "%";
export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}
