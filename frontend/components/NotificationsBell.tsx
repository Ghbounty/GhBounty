"use client";

/**
 * GHB-92: bell icon + unread badge + dropdown panel.
 *
 * Lives in `AppNav` between the wallet chips and the user avatar. Polls
 * the unread count every 30s; opening the panel triggers a one-shot
 * fetch of the full inbox (last 50). Clicking a row marks it read and
 * routes to the relevant page.
 *
 * Render strategy:
 *   - Closed: button + badge only. Cheap.
 *   - Open: dropdown anchored to the trigger; click-outside closes it.
 *   - The panel itself is a sibling absolute container so the bell can
 *     stay inside the flex row without distorting layout.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "./Avatar";
import { createClient } from "@/utils/supabase/client";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllRead,
  clearNotifications,
  markNotificationRead,
  type Notification,
} from "@/lib/notifications";

const POLL_MS = 30_000;

export function NotificationsBell({ userId }: { userId: string }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Cheap badge poll. Only the count, no payload — keeps the wire small
  // and the request stays under the partial index from migration 0014.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const tick = async () => {
      const n = await fetchUnreadCount(supabase, userId);
      if (!cancelled) setUnread(n);
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [userId]);

  // Lazy-load the full list when the panel opens. We intentionally don't
  // pre-fetch on mount: the inbox is only useful when the panel is open,
  // and skipping the fetch keeps cold loads fast.
  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const list = await fetchNotifications(supabase, userId, 50);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    // The inbox fetch is the side-effect that opening the panel
    // schedules; the lint rule is conservative about setState-in-effect
    // patterns but this matches the same shape used elsewhere in the
    // codebase (PickWinnerModal, SubmissionsListModal).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void loadInbox();
  }, [open, loadInbox]);

  // Click-outside closes the panel. Only listen while open so we don't
  // pay the listener cost in the common case.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  async function onClickItem(n: Notification) {
    // Optimistically flip read locally so the badge moves immediately;
    // RLS-protected update follows. Even if the update silently fails
    // (e.g. wrong user), the next badge poll reconciles.
    if (n.readAt === null) {
      setItems((prev) =>
        prev.map((it) => (it.id === n.id ? { ...it, readAt: Date.now() } : it)),
      );
      setUnread((u) => Math.max(0, u - 1));
      const supabase = createClient();
      await markNotificationRead(supabase, n.id);
    }
    setOpen(false);
    // Submission-targeted kinds → /app/profile (the dev's own list).
    // Bounty-targeted kinds → /app/dev (marketplace) for now; bounty
    // detail page lands later.
    if (n.submissionId) router.push("/app/profile");
    else if (n.issueId) router.push("/app/dev");
  }

  async function onMarkAll() {
    setItems((prev) => prev.map((it) => ({ ...it, readAt: it.readAt ?? Date.now() })));
    setUnread(0);
    const supabase = createClient();
    await markAllRead(supabase, userId);
  }

  async function onClearAll() {
    setItems([]);
    setUnread(0);
    const supabase = createClient();
    await clearNotifications(supabase, userId);
  }

  const hasItems = items.length > 0;
  const badge = unread > 99 ? "99+" : unread > 0 ? String(unread) : null;

  return (
    <div className="notif-wrap" ref={containerRef}>
      <button
        type="button"
        className={`notif-btn ${open ? "open" : ""}`}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9z" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
        {badge && <span className="notif-badge">{badge}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="menu">
          <div className="notif-panel-head">
            <span className="notif-panel-title">Notifications</span>
            <span className="notif-panel-actions">
              {unread > 0 && (
                <button
                  type="button"
                  className="notif-mark-all"
                  onClick={onMarkAll}
                >
                  Mark all read
                </button>
              )}
              {hasItems && (
                <button
                  type="button"
                  className="notif-mark-all"
                  onClick={onClearAll}
                >
                  Clear all
                </button>
              )}
            </span>
          </div>

          {loading && <div className="notif-state">Loading…</div>}
          {!loading && !hasItems && (
            <div className="notif-state">
              You&apos;re all caught up. New activity will show up here.
            </div>
          )}

          {hasItems && (
            <ul className="notif-list">
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  onClick={() => void onClickItem(n)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  n,
  onClick,
}: {
  n: Notification;
  onClick: () => void;
}) {
  const { title, body, accent } = renderNotification(n);
  // GHB-127: company branding snapshot was persisted at write-time. We
  // prefer the logo over the colour dot when present — it's the same
  // identity the dev sees on the bounty card / detail page, so the
  // notification feels like "from Acme" rather than a system message.
  const companyName = n.payload.companyName;
  const companyAvatar = n.payload.companyAvatarUrl;
  const hasBranding = !!companyName;

  return (
    <li>
      <button
        type="button"
        className={`notif-item notif-item-${accent} ${n.readAt === null ? "unread" : ""}`}
        onClick={onClick}
      >
        {hasBranding ? (
          <span className="notif-avatar">
            <Avatar
              src={companyAvatar}
              name={companyName!}
              size={28}
              rounded={false}
            />
            <span className={`notif-avatar-tag notif-dot-${accent}`} />
          </span>
        ) : (
          <span className={`notif-dot notif-dot-${accent}`} />
        )}
        <span className="notif-body">
          {hasBranding && (
            <span className="notif-company">{companyName}</span>
          )}
          <span className="notif-title">{title}</span>
          {body && <span className="notif-excerpt">{body}</span>}
          <span className="notif-time">{relativeTime(n.createdAt)}</span>
        </span>
      </button>
    </li>
  );
}

/** Map kind → display copy + colour accent. Keeps the list dumb. */
function renderNotification(n: Notification): {
  title: string;
  body: string | null;
  accent:
    | "approved"
    | "rejected"
    | "auto-rejected"
    | "scored"
    | "info"
    | "resolved-other";
} {
  const bountyTitle = n.payload.bountyTitle;
  const amount = n.payload.bountyAmount;
  const amountSuffix =
    typeof amount === "number" ? ` · ${amount.toLocaleString()} SOL` : "";

  switch (n.kind) {
    case "submission_approved":
      return {
        title: bountyTitle
          ? `You won "${bountyTitle}"${amountSuffix}`
          : `Your PR was selected as the winner${amountSuffix}`,
        body: n.payload.feedbackExcerpt ?? null,
        accent: "approved",
      };
    case "submission_rejected":
      return {
        title: bountyTitle
          ? `Your PR for "${bountyTitle}" was rejected`
          : "Your PR was rejected",
        body: n.payload.feedbackExcerpt ?? null,
        accent: "rejected",
      };
    case "submission_auto_rejected": {
      const score = n.payload.score;
      const threshold = n.payload.threshold;
      const detail =
        typeof score === "number" && typeof threshold === "number"
          ? `Score ${score}/10 below threshold ${threshold}`
          : "Score below the bounty's threshold.";
      return {
        title: bountyTitle
          ? `Auto-rejected on "${bountyTitle}"`
          : "Your PR was auto-rejected",
        body: detail,
        accent: "auto-rejected",
      };
    }
    case "submission_evaluated": {
      const score = n.payload.score;
      const detail =
        typeof score === "number" ? `Scored ${score}/10` : "Evaluation ready";
      return {
        title: bountyTitle
          ? `Evaluation ready for "${bountyTitle}"`
          : "Your PR has been evaluated",
        body: detail,
        accent: "scored",
      };
    }
    case "bounty_followed_new":
      return {
        title: bountyTitle
          ? `New bounty: ${bountyTitle}${amountSuffix}`
          : "A company you follow posted a bounty",
        body: null,
        accent: "info",
      };
    case "bounty_resolved_other":
      return {
        title: bountyTitle
          ? `"${bountyTitle}" was awarded to another submission`
          : "Another submission won the bounty",
        body: "Your PR didn't win this one. Thanks for participating.",
        accent: "resolved-other",
      };
    case "bounty_cap_approaching": {
      // GHB-184: heads-up at 80% of cap. Body shows the live counter so the
      // company can decide whether to raise the cap before it auto-closes.
      const eligible = n.payload.reviewEligibleCount;
      const max = n.payload.maxSubmissions;
      const detail =
        typeof eligible === "number" && typeof max === "number"
          ? `${eligible} of ${max} PRs received. Subí el cap si querés más opciones.`
          : "Casi alcanzaste el cap de PRs.";
      return {
        title: bountyTitle
          ? `"${bountyTitle}" is close to its cap`
          : "Bounty close to its PR cap",
        body: detail,
        accent: "info",
      };
    }
    case "bounty_cap_reached": {
      // GHB-184: bounty was auto-closed by the cap. Tell the company to
      // start reviewing — no new PRs will arrive.
      const max = n.payload.maxSubmissions;
      const detail =
        typeof max === "number"
          ? `Llegó al máximo de ${max} PRs. Revisá las submissions pendientes.`
          : "Bounty cerrado por cap. Revisá las submissions pendientes.";
      return {
        title: bountyTitle
          ? `"${bountyTitle}" closed by cap`
          : "Bounty closed by cap",
        body: detail,
        accent: "info",
      };
    }
  }
}

/** Compact "5m ago" / "2h ago" / "3d ago" formatter. */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
