/** Timeout covers downloading the body as well as receiving its headers. */
export async function presetText(name: string, fetcher = fetch) {
  const response = await fetcher(`downloads/${encodeURIComponent(name)}.csv`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Preset unavailable.");
  return response.text();
}
/** Quote delimiters and neutralize spreadsheet formulas in untrusted identifiers. */
export function csvCell(value: unknown): string {
  let text = String(value);
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
