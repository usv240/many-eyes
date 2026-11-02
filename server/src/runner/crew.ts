import type { Truth } from "../consensus/engine.js";

export interface CrewMember { name: string; matched: number; checked: number; live: boolean }
interface Credit { userId: string; label: string }

/** Simulated voters have ids like sim_0009; on screen they are "viewer 9". */
export function displayName(userId: string, logins: ReadonlyMap<string, string>): { name: string; live: boolean } {
  const login = logins.get(userId);
  if (login) return { name: login, live: true };
  const number = /^sim_0*(\d+)$/.exec(userId)?.[1];
  return { name: number ? "viewer " + number : userId, live: false };
}

/**
 * The crew board: who matched the experts on hidden checks. Pure bookkeeping for credit on stream;
 * it never touches labels or weights, which come only from consensus.decide() and updateGoldWeights().
 */
export class Crew {
  private readonly scores = new Map<string, CrewMember>();
  constructor(private readonly maxVoters = 10_000) {}

  /** Credits every non-unsure vote on a decided hidden check. Returns the real chat names that matched, in vote order. */
  credit(votes: readonly Credit[], truth: Truth, logins: ReadonlyMap<string, string>): string[] {
    const matchedLive: string[] = [];
    for (const vote of votes) {
      if (vote.label === "unsure") continue;
      let entry = this.scores.get(vote.userId);
      if (!entry) {
        if (this.scores.size >= this.maxVoters) continue;
        entry = { ...displayName(vote.userId, logins), matched: 0, checked: 0 };
        this.scores.set(vote.userId, entry);
      }
      entry.checked++;
      if (vote.label === truth) { entry.matched++; if (entry.live) matchedLive.push(entry.name); }
    }
    return matchedLive;
  }

  /** Most matches first, then fewest misses, then name, so ties are stable. Real chat wins a full tie. */
  top(count = 3): CrewMember[] {
    return [...this.scores.values()].filter((entry) => entry.matched > 0)
      .sort((a, b) => b.matched - a.matched || (a.checked - a.matched) - (b.checked - b.matched) ||
        Number(b.live) - Number(a.live) || a.name.localeCompare(b.name))
      .slice(0, count).map((entry) => ({ ...entry }));
  }
}
