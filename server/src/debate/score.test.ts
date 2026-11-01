import { expect, it } from "vitest";
import { getMission } from "../missions/mission.js";
import { scoreDebates } from "./score.js";
import type { CachedDebate } from "./cache.js";

it("counts real cached predictions against gold and never invents binary work truth", () => {
  const mission = getMission("nepal-flood-2026");
  const entries = new Map(mission.buildings.map((building) => [building.id,
    { debate: { model_label: "destroyed" } } as CachedDebate]));
  const score = scoreDebates(mission, entries);
  expect(score.gold).toMatchObject({ correct: 40, total: 80, destroyed: { correct: 40, total: 40 }, intact: { correct: 0, total: 40 } });
  expect(score.expertAgreement).toBeNull();
  expect(score.work).toEqual({ "Damaged": { destroyed: 32, intact: 0, total: 32 }, "Possibly damaged": { destroyed: 78, intact: 0, total: 78 } });
  entries.delete(mission.gold[0]!.building_id);
  expect(scoreDebates(mission, entries).missing).toEqual([mission.gold[0]!.building_id]);
});
