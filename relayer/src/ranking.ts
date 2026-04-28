/**
 * GHB-96: rank submissions that pass the reject threshold.
 *
 * Pure ranking logic, separated from DB IO so we can exhaustively test
 * tie-breaking and ordering without spinning up a fake Drizzle. Callers in
 * `db/ops.ts` fetch the relevant submissions, run them through here, and
 * persist the resulting rank values.
 *
 * Rules:
 *   1. Only submissions in states `scored` or `winner` are ranked. Anything
 *      `pending` or `auto_rejected` is excluded (rank = null).
 *   2. Order by score descending. Higher score wins.
 *   3. Tie-break by `createdAt` ascending — first submission to land wins
 *      (matches the ticket: "Empate: primera submission gana").
 *   4. Ranks are 1-based, dense (1, 2, 3, ...). No gaps for ties because we
 *      already broke them deterministically by createdAt.
 */

export type RankableState = "pending" | "scored" | "winner" | "auto_rejected";

export interface RankableSubmission {
  pda: string;
  state: RankableState;
  /** Opus score in [1, 10]. Defined for scored/winner; arbitrary for others. */
  score: number;
  /** Epoch ms or any monotonic numeric. We only use this for tie-break. */
  createdAt: number;
}

export interface RankAssignment {
  pda: string;
  /** 1-based rank, or null if the submission isn't eligible. */
  rank: number | null;
}

/**
 * Compute rank assignments for an issue's submissions.
 *
 * Returns one assignment per input submission, preserving the original
 * input order so callers can map back without re-keying. Submissions that
 * don't qualify (pending or auto_rejected) get `rank: null`.
 */
export function computeRanking(
  submissions: ReadonlyArray<RankableSubmission>,
): RankAssignment[] {
  // Tag each input with its original index so we can restore order at the end.
  const tagged = submissions.map((s, i) => ({ s, i }));

  // Eligible = scored or winner.
  const eligible = tagged.filter(
    ({ s }) => s.state === "scored" || s.state === "winner",
  );

  // Sort: score desc, then createdAt asc (earlier wins on tie).
  eligible.sort((a, b) => {
    if (b.s.score !== a.s.score) return b.s.score - a.s.score;
    return a.s.createdAt - b.s.createdAt;
  });

  // Assign 1-based rank to eligible only.
  const ranks = new Map<number, number>(); // index → rank
  eligible.forEach(({ i }, sortedIdx) => {
    ranks.set(i, sortedIdx + 1);
  });

  // Project back into input order.
  return tagged.map(({ s, i }) => ({
    pda: s.pda,
    rank: ranks.get(i) ?? null,
  }));
}
