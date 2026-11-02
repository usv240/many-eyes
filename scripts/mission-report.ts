import { readFileSync } from "node:fs";
import { writeMissionReport } from "../server/src/exports/report.js";
const manifest = JSON.parse(readFileSync("reports/nepal-flood-2026.json", "utf8")) as { runId: string };
writeMissionReport(manifest.runId);
console.log("Regenerated mission report and GeoJSON from the recorded video run.");
