import type { Mission } from "../missions/mission.js";
import type { CachedDebate } from "./cache.js";

export function scoreDebates(mission: Mission, entries: ReadonlyMap<string, CachedDebate>) {
  const gold = new Map(mission.gold.map((item) => [item.building_id, item.truth]));
  const buckets = { destroyed: { correct: 0, total: 0 }, intact: { correct: 0, total: 0 } };
  const work: Record<string, { destroyed: number; intact: number; total: number }> = {};
  const missing: string[] = [];
  for (const building of mission.buildings) {
    const entry = entries.get(building.id);
    if (!entry) { missing.push(building.id); continue; }
    const truth = gold.get(building.id);
    if (truth) { buckets[truth].total++; buckets[truth].correct += Number(entry.debate.model_label === truth); }
    else {
      const row = work[building.expert_grade] ??= { destroyed: 0, intact: 0, total: 0 };
      row[entry.debate.model_label]++; row.total++;
    }
  }
  return { gold: { correct: buckets.destroyed.correct + buckets.intact.correct,
    total: buckets.destroyed.total + buckets.intact.total, ...buckets }, work, missing,
    // Damaged / Possibly damaged are not binary destroyed / intact reference labels.
    expertAgreement: null };
}
