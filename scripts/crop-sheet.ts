import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getMission } from "../server/src/missions/mission.js";

export interface SheetPair { id: string; lat: number; pre: Buffer; post: Buffer }
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
export async function renderCropSheet(pairs: SheetPair[], attribution: string) {
  const width = 2352; const rowHeight = 420; const height = Math.ceil(pairs.length / 3) * rowHeight + 100;
  const layers: sharp.OverlayOptions[] = [];
  for (const [index, pair] of pairs.entries()) {
    const x = index % 3 * 784; const y = Math.floor(index / 3) * rowHeight;
    const radius = 12 / (156543.03392 * Math.cos(pair.lat * Math.PI / 180) / 2 ** 19);
    const ring = Buffer.from(`<svg width="384" height="384"><circle cx="192" cy="192" r="${radius}" fill="none" stroke="black" stroke-width="3"/><circle cx="192" cy="192" r="${radius}" fill="none" stroke="white" stroke-width="1.5"/></svg>`);
    layers.push({ input: Buffer.from(`<svg width="784" height="32"><text x="8" y="23" fill="white" font-size="18">${index + 1}. ${escape(pair.id)} — PRE</text><text x="400" y="23" fill="white" font-size="18">POST · 12 m ring</text></svg>`), left: x, top: y });
    for (const [side, image] of [pair.pre, pair.post].entries()) {
      const decorated = await sharp(image).composite([{ input: ring }]).png().toBuffer();
      layers.push({ input: decorated, left: x + side * 392, top: y + 32 });
    }
  }
  const credit = Buffer.from(`<svg width="2352" height="100"><text x="12" y="28" fill="white" font-size="20">First 12 gold tiles in mission-file order. Centred 384 px crops, z19; no image registration applied.</text><text x="12" y="64" fill="white" font-size="13">${escape(attribution)}</text></svg>`);
  layers.push({ input: credit, left: 0, top: height - 100 });
  return sharp({ create: { width, height, channels: 3, background: "#171817" } }).composite(layers).png().toBuffer();
}
async function main() {
  const mission = getMission("nepal-flood-2026");
  const pairs = await Promise.all(mission.gold.slice(0, 12).map(async ({ building_id: id }) => {
    const building = mission.buildings.find((entry) => entry.id === id)!;
    const directory = resolve("data/cache/crops", mission.id, id);
    return { id, lat: building.lat, pre: await readFile(resolve(directory, "pre.jpg")), post: await readFile(resolve(directory, "post.jpg")) };
  }));
  await mkdir("reports/overlay", { recursive: true });
  await writeFile("reports/overlay/crop-sheet.png", await renderCropSheet(pairs, mission.attribution));
  console.log("Wrote reports/overlay/crop-sheet.png (12 pre/post pairs).");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
