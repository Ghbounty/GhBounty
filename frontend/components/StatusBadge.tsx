import type { BountyStatus } from "@/lib/types";

// GHB-184: cap_reached is a UI-derived state, not a value of the DB enum.
// `BountyRow` (or any caller) is responsible for picking it when a bounty
// has been auto-closed by the cap mechanism — keeps StatusBadge dumb and
// keeps the cap rule in one place upstream.
export type StatusBadgeStatus = BountyStatus | "cap_reached";

const LABELS: Record<StatusBadgeStatus, string> = {
  open: "Open",
  reviewing: "Reviewing",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
  closed: "Closed",
  cap_reached: "Cap reached",
};

export function StatusBadge({ status }: { status: StatusBadgeStatus }) {
  return <span className={`status-badge status-${status}`}>● {LABELS[status]}</span>;
}
