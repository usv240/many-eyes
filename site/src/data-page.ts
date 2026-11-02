import { presetText, csvCell } from "./data-io.js";
import { attachInfo, download, escapeHtml, percent } from "./common.js";
import { decideBatch, votesFromCsv, type DecideResponse } from "../../server/src/api/decide.js";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const textarea = $<HTMLTextAreaElement>("[data-csv]");
const status = $<HTMLElement>("[data-status]");
let last: DecideResponse | null = null;
let lastName = "results";

function setStatus(text: string, error = false) { status.textContent = text; status.classList.toggle("error", error); }

async function loadPreset(name: string) {
  setStatus("Loading " + name + "…");
  try {
    const text = await presetText(name);
    textarea.value = text; lastName = name;
    run();
    document.querySelector("[data-results]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch { last = null; $<HTMLElement>("[data-results]").hidden = true; setStatus("Could not load the preset within 10 seconds. Try again.", true); }
}

function run() {
  last = null; $<HTMLElement>("[data-results]").hidden = true;
  try {
    const started = performance.now();
    last = decideBatch(votesFromCsv(textarea.value));
    render(last);
    setStatus(`Decided ${last.summary.tiles} tiles from ${last.summary.votes} votes in ${Math.max(1, Math.round(performance.now() - started))} ms.`);
  } catch (error) {
    const issues = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues;
    setStatus(issues ? "Check your data: " + issues.slice(0, 3).map((issue) => (issue.path.join(".") || "file") + " " + issue.message).join("; ")
      : error instanceof Error ? error.message : "Could not read the data.", true);
  }
}

function render(result: DecideResponse) {
  const checks = result.summary.checks;
  const figures = [
    [String(result.summary.validated), "validated", "Weighted agreement of at least 66% from at least 3 voters."],
    [String(result.summary.refused), "refused, sent to experts", "Too few voters, or the crowd was split."],
    [checks.count ? percent(checks.weightedAccuracy, 1) : "n/a", "accuracy on hidden checks, weighted", checks.count
      ? `${checks.weightedCorrect} of ${checks.count} hidden checks validated correctly. Accuracy counts only the checks that were validated.` : "Add a truth column to measure accuracy."],
    [checks.count ? percent(checks.unweightedAccuracy, 1) : "n/a", "the same without weighting", "One person, one vote. Compare it with the weighted figure."],
  ];
  $<HTMLElement>("[data-figures]").innerHTML = figures.map(([value, label, info]) =>
    `<div class="figure"><span class="value">${escapeHtml(value!)}</span><p>${escapeHtml(label!)}<span data-info="${escapeHtml(info!)}" data-info-label="${escapeHtml(label!)}"></span></p></div>`).join("");
  const rows = result.tiles.slice(0, 400).map((tile) => `<tr><td>${escapeHtml(tile.id)}</td>
    <td>${tile.status === "validated" ? `<b class="${tile.label}">${tile.label}</b>` : "refused"}</td>
    <td class="num">${percent(tile.agreement)}</td><td class="num">${tile.voters}</td>
    <td>${tile.check ? (tile.check.correct ? "check, matched" : "check, missed") : ""}</td>
    <td class="muted">${tile.unweighted.status === tile.status && tile.unweighted.label === tile.label ? "same" : tile.unweighted.status === "validated" ? tile.unweighted.label : "refused"}</td></tr>`).join("");
  $<HTMLElement>("[data-tiles]").innerHTML = `<table><thead><tr><th>Tile</th><th>Result</th><th class="num">Agreement</th><th class="num">Voters</th><th>Hidden check</th><th>Unweighted</th></tr></thead><tbody>${rows}</tbody></table>` +
    (result.tiles.length > 400 ? `<p class="small muted" style="padding:10px 14px">Showing 400 of ${result.tiles.length} tiles. Download for the rest.</p>` : "");
  $<HTMLElement>("[data-weights]").innerHTML = `<table><thead><tr><th>Voter</th><th class="num">Weight</th></tr></thead><tbody>${
    (result.weights.length ? result.weights : []).slice(0, 200).map((item) => `<tr><td>${escapeHtml(item.user)}</td><td class="num">${item.weight.toFixed(1)}</td></tr>`).join("")
    || `<tr><td colspan="2" class="muted">No hidden checks, so every vote counts 1.0.</td></tr>`}</tbody></table>`;
  document.querySelectorAll<HTMLElement>("[data-results] [data-info]").forEach(attachInfo);
  $<HTMLElement>("[data-results]").hidden = false;
}

document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) =>
  button.addEventListener("click", () => { void loadPreset(button.dataset.preset!); }));
$<HTMLButtonElement>("[data-run]").addEventListener("click", () => { lastName = "my-data"; run(); });

const drop = $<HTMLElement>("[data-drop]");
async function readFile(file: File) {
  if (file.size > 20 * 1024 * 1024) { setStatus("That file is over 20 MB. Split it into smaller runs.", true); return; }
  textarea.value = await file.text(); lastName = file.name.replace(/\.[^.]+$/, ""); run();
}
$<HTMLInputElement>("[data-file]").addEventListener("change", (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (file) void readFile(file);
});
drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (event) => {
  event.preventDefault(); drop.classList.remove("over");
  const file = event.dataTransfer?.files[0]; if (file) void readFile(file);
});

document.querySelectorAll<HTMLButtonElement>("[data-download]").forEach((button) => button.addEventListener("click", () => {
  if (!last) return;
  const kind = button.dataset.download;
  if (kind === "geojson") download(lastName + ".geojson", JSON.stringify(last.geojson, null, 2), "application/geo+json");
  else if (kind === "json") download(lastName + "-decisions.json", JSON.stringify(last, null, 2), "application/json");
  else download(lastName + "-decisions.csv", ["tile_id,status,label,agreement,voters,reason,check_truth,check_correct"].concat(last.tiles.map((tile) =>
    [tile.id, tile.status, tile.label ?? "", tile.agreement, tile.voters, tile.reason ?? "", tile.check?.truth ?? "", tile.check ? tile.check.correct : ""].map(csvCell).join(","))).join("\n") + "\n", "text/csv");
}));
