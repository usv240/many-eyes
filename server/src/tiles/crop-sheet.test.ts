import { expect, it } from "vitest";
import sharp from "sharp";
import { renderCropSheet } from "../../../scripts/crop-sheet.js";

it("renders twelve synthetic pre/post pairs in four rows with unshifted image centres", async () => {
  const image = await sharp({ create: { width: 384, height: 384, channels: 3, background: "#246842" } }).png().toBuffer();
  const sheet = await renderCropSheet(Array.from({ length: 12 }, (_, index) => ({ id: "test-" + index,
    lat: 28.16, pre: image, post: image })), "Fixture attribution");
  expect(await sharp(sheet).metadata()).toMatchObject({ width: 2352, height: 1780, format: "png" });
  const centre = await sharp(sheet).extract({ left: 192, top: 224, width: 1, height: 1 }).raw().toBuffer();
  expect([...centre.subarray(0, 3)]).toEqual([36, 104, 66]);
});
