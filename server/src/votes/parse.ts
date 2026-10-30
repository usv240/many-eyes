export type VoteLabel = "destroyed" | "intact" | "unsure";

export function parseVote(text: string): VoteLabel | null {
  switch (text.trim().toLowerCase()) {
    case "1": case "!1": case "destroyed": return "destroyed";
    case "2": case "!2": case "intact": return "intact";
    case "3": case "!3": case "unsure": return "unsure";
    default: return null;
  }
}
