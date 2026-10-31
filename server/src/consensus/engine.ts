import type { VoteLabel } from "../votes/parse.js";

export type Truth = Exclude<VoteLabel, "unsure">;
export interface Vote { readonly userId: string; readonly label: VoteLabel; readonly weight: number }
export interface TileSession {
  readonly id: string; readonly openedAt: number; readonly closesAt: number;
  readonly closed: boolean; readonly votes: readonly Vote[];
}
interface Scores { readonly agreement: number; readonly voters: number; readonly totalVotes: number }
export interface Preview { agreement: number; leading: Truth | null; voters: number; unsure: number }
export type Decision = Scores & (
  { readonly status: "validated"; readonly label: Truth; readonly reason: null } |
  { readonly status: "refused"; readonly label: null; readonly reason: "low_agreement" | "too_few_voters" }
);
export const VOTING_MS = 15000;

export function openSession(id: string, openedAt: number): TileSession {
  if (!id || !Number.isFinite(openedAt)) throw new Error("Invalid tile session.");
  return { id, openedAt, closesAt: openedAt + VOTING_MS, closed: false, votes: [] };
}

export function collectVote(session: TileSession, vote: Vote, at: number): TileSession {
  if (session.closed || !Number.isFinite(at) || at < session.openedAt || at >= session.closesAt) return session;
  if (!vote.userId || !["destroyed", "intact", "unsure"].includes(vote.label) ||
      !Number.isFinite(vote.weight) || vote.weight <= 0) throw new Error("Invalid vote.");
  const votes = session.votes.filter(({ userId }) => userId !== vote.userId);
  return { ...session, votes: [...votes, { ...vote }] };
}

export function closeSession(session: TileSession, at: number): TileSession {
  if (!Number.isFinite(at) || at < session.closesAt) throw new Error("Voting window is still open.");
  return { ...session, closed: true };
}

function tally(session: TileSession, weighted: boolean) {
  // Defend the scoring boundary even if a session was deserialized by another caller.
  const votes = [...new Map(session.votes.map((vote) => [vote.userId, vote])).values()];
  let destroyed = 0; let intact = 0; let voters = 0;
  for (const vote of votes) {
    if (!vote.userId || !["destroyed", "intact", "unsure"].includes(vote.label) ||
        !Number.isFinite(vote.weight) || vote.weight <= 0) throw new Error("Invalid vote.");
    if (vote.label === "unsure") continue;
    voters++;
    const weight = weighted ? vote.weight : 1;
    if (vote.label === "destroyed") destroyed += weight;
    else intact += weight;
  }
  const total = destroyed + intact;
  const agreement = total ? Math.max(destroyed, intact) / total : 0;
  const leading: Truth | null = destroyed === intact ? null : destroyed > intact ? "destroyed" : "intact";
  return { agreement, voters, totalVotes: votes.length, leading };
}

/** A preview is a score, never a validation or a gold-weight update. Ties have no leader. */
export function preview(session: TileSession): Preview {
  const { agreement, leading, voters, totalVotes } = tally(session, true);
  return { agreement, leading, voters, unsure: totalVotes - voters };
}

function score(session: TileSession, weighted: boolean): Decision {
  if (!session.closed) throw new Error("Close the session before deciding.");
  const { agreement, voters, totalVotes, leading } = tally(session, weighted);
  const scores = { agreement, voters, totalVotes };
  if (voters < 3) return { ...scores, status: "refused", label: null, reason: "too_few_voters" };
  if (agreement < 0.66) return { ...scores, status: "refused", label: null, reason: "low_agreement" };
  return { ...scores, status: "validated", label: leading!, reason: null };
}

export function decide(session: TileSession): Decision { return score(session, true); }
export function decideUnweighted(session: TileSession): Decision { return score(session, false); }

export function updateGoldWeights(weights: ReadonlyMap<string, number>, session: TileSession, truth: Truth) {
  // Also enforces that updates can only follow a closed, scoreable session.
  decide(session);
  const next = new Map(weights);
  for (const vote of session.votes) {
    if (vote.label === "unsure") continue;
    const current = weights.get(vote.userId) ?? 1;
    const change = vote.label === truth ? 0.1 : -0.2;
    next.set(vote.userId, Math.max(0.2, Math.min(2, Math.round((current + change) * 10) / 10)));
  }
  return next;
}
