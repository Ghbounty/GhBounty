/**
 * GHB-92: notifications inbox.
 *
 * Reads/writes against the `notifications` table (migration 0014). All
 * helpers go through the user's Supabase client — RLS scopes SELECT/UPDATE
 * to `auth.uid() = user_id`, INSERT is MVP-permissive.
 *
 * Kinds:
 *   submission_approved      — company picked the dev as winner
 *   submission_rejected      — company manually rejected the PR
 *   submission_auto_rejected — relayer auto-rejected (GHB-85 threshold)
 *   submission_evaluated     — relayer wrote an evaluation (score ready)
 *   bounty_followed_new      — company you follow posted a bounty
 *
 * Today only the two action-driven kinds fire from the frontend
 * (`recordWinnerOnchain` + `rejectSubmission`). The relayer-side kinds
 * are wired up in the schema and types so the bell starts surfacing them
 * the moment the relayer lands, with zero frontend work.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db.types";

type DBClient = SupabaseClient<Database>;

export type NotificationKind =
  | "submission_approved"
  | "submission_rejected"
  | "submission_auto_rejected"
  | "submission_evaluated"
  | "bounty_followed_new"
  /**
   * "The bounty you submitted to was awarded to someone else." Targets
   * the loser's own submission so clicking the notif lands on their
   * /app/profile entry. Emitted by `recordWinnerOnchain` to every dev
   * who submitted a PR to the bounty other than the winner.
   */
  | "bounty_resolved_other";

export type NotificationPayload = {
  /** Bounty title (issue title, if set), for inline rendering. */
  bountyTitle?: string;
  /** Bounty amount in display units (SOL today). */
  bountyAmount?: number;
  /** First ~120 chars of company feedback, for the dropdown preview. */
  feedbackExcerpt?: string;
  /** Score the relayer assigned (1-10). */
  score?: number;
  /** Reject threshold the score was compared against, for auto-rejects. */
  threshold?: number;
  /**
   * GHB-127: company branding embedded at write-time so the bell can
   * render the company logo + name without a JOIN on read. We persist a
   * snapshot, not a live reference — if the company later changes their
   * logo or name, old notifications keep the original (acceptable: the
   * notif is a historical record of the moment the action happened).
   */
  companyName?: string;
  /** Company logo URL snapshot. Optional — bell falls back to initials. */
  companyAvatarUrl?: string;
  /** Company id, used to deep-link the notif row to the company page. */
  companyId?: string;
};

export type Notification = {
  id: string;
  userId: string;
  kind: NotificationKind;
  submissionId: string | null;
  issueId: string | null;
  payload: NotificationPayload;
  readAt: number | null;
  createdAt: number;
};

type NotificationRow = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  submission_id: string | null;
  issue_id: string | null;
  payload: NotificationPayload | null;
  read_at: string | null;
  created_at: string;
};

function rowToNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    submissionId: r.submission_id,
    issueId: r.issue_id,
    payload: r.payload ?? {},
    readAt: r.read_at ? new Date(r.read_at).getTime() : null,
    createdAt: new Date(r.created_at).getTime(),
  };
}

/** Newest-first inbox slice. Caps at `limit` (default 50). */
export async function fetchNotifications(
  supabase: DBClient,
  userId: string,
  limit = 50,
): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications" as never)
    .select(
      "id, user_id, kind, submission_id, issue_id, payload, read_at, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[fetchNotifications]", error);
    return [];
  }
  return ((data as unknown as NotificationRow[]) ?? []).map(rowToNotification);
}

/** Cheap unread count for the bell badge. Uses the partial index. */
export async function fetchUnreadCount(
  supabase: DBClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications" as never)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) {
    console.error("[fetchUnreadCount]", error);
    return 0;
  }
  return count ?? 0;
}

/** Flip read_at on a single notification. */
export async function markNotificationRead(
  supabase: DBClient,
  notificationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications" as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq("id", notificationId)
    .is("read_at", null);
  if (error) console.warn("[markNotificationRead]", error);
}

/** Bulk-flip everything unread for the current user. */
export async function markAllRead(
  supabase: DBClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications" as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) console.warn("[markAllRead]", error);
}

/* ---------------------------------------------------------------- */
/* Writers — call from the action that produced the event.           */
/* ---------------------------------------------------------------- */

type EmitSubmissionParams = {
  /** Privy DID of the recipient (the dev). */
  recipientUserId: string;
  /** UUID of the submission this notif is about. */
  submissionId: string;
  payload?: NotificationPayload;
};

/**
 * All submission-targeted writers share the same shape; this helper keeps
 * the call sites honest (compile-time guarantee that we pass submission_id
 * and not issue_id when the kind is submission-targeted).
 */
async function emitSubmissionNotification(
  supabase: DBClient,
  kind: Extract<
    NotificationKind,
    | "submission_approved"
    | "submission_rejected"
    | "submission_auto_rejected"
    | "submission_evaluated"
    | "bounty_resolved_other"
  >,
  p: EmitSubmissionParams,
): Promise<void> {
  const { error } = await supabase
    .from("notifications" as never)
    .insert({
      user_id: p.recipientUserId,
      kind,
      submission_id: p.submissionId,
      issue_id: null,
      payload: p.payload ?? {},
    } as never);
  // Best-effort: a failed notification write must not block the action that
  // produced it (the company's pick-winner / reject flow already succeeded
  // by the time this runs).
  if (error) console.warn(`[emitNotification:${kind}]`, error);
}

export async function emitSubmissionApproved(
  supabase: DBClient,
  p: EmitSubmissionParams,
): Promise<void> {
  return emitSubmissionNotification(supabase, "submission_approved", p);
}

export async function emitSubmissionRejected(
  supabase: DBClient,
  p: EmitSubmissionParams,
): Promise<void> {
  return emitSubmissionNotification(supabase, "submission_rejected", p);
}

/**
 * Bulk-fire `bounty_resolved_other` notifications. Called from
 * `recordWinnerOnchain` to ping every losing submitter once a winner is
 * picked. Single round-trip insert; failures are logged, not thrown.
 *
 * `recipients` is shaped as `{ recipientUserId, submissionId }` per dev
 * — the submission_id we attach is the LOSER's own submission, so
 * clicking the notif routes the loser to their own /app/profile entry,
 * not the winner's.
 */
export async function emitBountyResolvedOtherBulk(
  supabase: DBClient,
  recipients: EmitSubmissionParams[],
  sharedPayload: NotificationPayload = {},
): Promise<void> {
  if (recipients.length === 0) return;
  const rows = recipients.map((r) => ({
    user_id: r.recipientUserId,
    kind: "bounty_resolved_other" as const,
    submission_id: r.submissionId,
    issue_id: null,
    payload: { ...sharedPayload, ...(r.payload ?? {}) },
  }));
  const { error } = await supabase
    .from("notifications" as never)
    .insert(rows as never);
  if (error) console.warn("[emitBountyResolvedOtherBulk]", error);
}

/** Truncate company feedback for the dropdown preview. */
export function truncateFeedback(s: string | undefined, n = 120): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (t.length === 0) return undefined;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
