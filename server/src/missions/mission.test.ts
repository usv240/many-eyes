import { expect, it } from "vitest";
import { getMission, goldTruth, isGold, nextTile, seededRng } from "./mission.js";

it("loads the existing mission and its source counts", () => {
  const mission = getMission("nepal-flood-2026");
  expect(mission.buildings).toHaveLength(190);
  expect(mission.gold).toHaveLength(80);
  expect(mission.gold.filter((entry) => entry.truth === "destroyed")).toHaveLength(40);
  expect(mission.gold.filter((entry) => entry.truth === "intact")).toHaveLength(40);
});
it("looks up gold labels internally", () => {
  expect(isGold("cems-0003")).toBe(true);
  expect(goldTruth("cems-0003")).toBe("destroyed");
  expect(goldTruth("cems-0083")).toBeNull();
});
it("interleaves gold with four work items and is reproducible from a seed", () => {
  const firstRng = seededRng(171);
  const secondRng = seededRng(171);
  const first = Array.from({ length: 40 }, () => nextTile("nepal-flood-2026", firstRng));
  const second = Array.from({ length: 40 }, () => nextTile("nepal-flood-2026", secondRng));
  expect(first).toEqual(second);
  const goldIds = new Set(getMission("nepal-flood-2026").gold.map(({ building_id }) => building_id));
  expect(first.slice(0, 5).filter(({ buildingId }) => goldIds.has(buildingId))).toHaveLength(1);
  expect(first.slice(5, 10).filter(({ buildingId }) => goldIds.has(buildingId))).toHaveLength(1);
});
