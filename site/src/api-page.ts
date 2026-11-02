import "./common.js";
import { decideBatch } from "../../server/src/api/decide.js";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const target = $<HTMLSelectElement>("[data-target]");
const server = $<HTMLInputElement>("[data-server]");
const body = $<HTMLTextAreaElement>("[data-body]");
const status = $<HTMLElement>("[data-status]");
const send = $<HTMLButtonElement>("[data-send]");
let key: string | null = null;
let keyTarget: string | null = null;

body.value = JSON.stringify({ tiles: [
  { id: "check-1", truth: "destroyed", lon: 85.3362, lat: 28.1614, votes: [
    { user: "ana", vote: "1" }, { user: "ben", vote: "1" }, { user: "cai", vote: "2" }, { user: "dev", vote: "1" }] },
  { id: "house-7", lon: 85.3354, lat: 28.1626, votes: [
    { user: "ana", vote: "2" }, { user: "ben", vote: "2" }, { user: "cai", vote: "1" }, { user: "dev", vote: "2" }, { user: "eve", vote: "3" }] },
] }, null, 2);

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const base = () => server.value.trim().replace(/\/+$/, "");
function invalidateKey() {
  key = keyTarget = null; send.disabled = true;
  $<HTMLElement>("[data-key-out]").textContent = "";
  $<HTMLElement>("[data-response]").hidden = true;
  setStatus("Request a key for this target first.");
}
let generation = 0;
server.addEventListener("input", () => { generation++; invalidateKey(); });
const where = () => target.value === "server" ? base() : "sandbox";
function setStatus(text: string, error = false) { status.textContent = text; status.classList.toggle("error", error); }

target.addEventListener("change", () => {
  $<HTMLElement>("[data-server-row]").hidden = target.value !== "server";
  generation++;
  if (keyTarget !== where()) invalidateKey();
});

async function http(destination: string, path: string, init: RequestInit) {
  const url = new URL(destination);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid API server URL.");
  const response = await fetch(destination + path, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
  return { status: response.status, json: await response.json().catch(() => ({})) as unknown };
}

$<HTMLButtonElement>("[data-issue]").addEventListener("click", async () => {
  const name = $<HTMLInputElement>("[data-key-name]").value.trim() || "my-app";
  const out = $<HTMLElement>("[data-key-out]");
  const destination = where(), attempt = ++generation;
  invalidateKey();
  let issued: string;
  try {
    if (target.value === "sandbox") {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      issued = "me_" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } else {
      const result = await http(destination, "/v1/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (result.status !== 201) throw new Error("Key request was rejected.");
      issued = (result.json as { key: string }).key;
    }
    if (attempt !== generation || destination !== where()) return;
    if (!/^me_[0-9a-f]{48}$/.test(issued)) throw new Error("Invalid key response.");
    key = issued; keyTarget = destination;
    out.innerHTML = "";
    out.append("Your key for ", target.value === "sandbox" ? "the sandbox" : base(), ": ");
    const code = document.createElement("code"); code.textContent = key; out.append(code, ". It is shown once.");
    send.disabled = false; setStatus("Ready. Edit the body if you like, then send.");
  } catch (error) {
    if (attempt !== generation) return;
    out.textContent = "";
    setStatus((error instanceof Error && error.name === "TimeoutError" ? "No answer within 10 seconds. " : "") +
      "Could not issue a key. Check the server address and try again.", true);
  }
});

send.addEventListener("click", async () => {
  if (!key || keyTarget !== where()) { invalidateKey(); return; }
  const destination = keyTarget, requestKey = key, attempt = generation;
  if (body.value.length > 8 * 1024 * 1024) { setStatus("The request exceeds 8 MB. Split it into smaller batches.", true); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(body.value); } catch { setStatus("The body is not valid JSON.", true); return; }
  const started = performance.now();
  let result: { status: number; json: unknown };
  try {
    if (target.value === "sandbox") {
      try { result = { status: 200, json: decideBatch(parsed) }; }
      catch (error) {
        const issues = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues;
        result = { status: 400, json: { error: "Invalid request", issues: issues?.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message })) } };
      }
    } else {
      result = await http(destination, "/v1/decide", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + requestKey }, body: JSON.stringify(parsed) });
    }
  } catch { if (attempt === generation) setStatus("Request failed or timed out. Check the server connection.", true); return; }
  if (attempt !== generation || destination !== where()) return;
  const ms = Math.max(1, Math.round(performance.now() - started));
  setStatus(`HTTP ${result.status} in ${ms} ms${target.value === "sandbox" ? " (sandbox)" : ""}.`, result.status >= 400);
  $<HTMLElement>("[data-response-body]").textContent = JSON.stringify(result.json, null, 2);
  const url = (target.value === "sandbox" ? "http://127.0.0.1:8791" : base()) + "/v1/decide";
  $<HTMLElement>("[data-curl]").textContent = `curl -X POST ${shellQuote(url)} \\\n  -H "Authorization: Bearer <key>" \\\n  -H "Content-Type: application/json" \\\n  -d ${shellQuote(JSON.stringify(parsed))}`;
  $<HTMLElement>("[data-response]").hidden = false;
});
