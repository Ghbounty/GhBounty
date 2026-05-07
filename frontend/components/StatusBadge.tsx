import type { BountyStatus } from "@/lib/types";

// `cap_reached` is a UI-only superset of BountyStatus; callers compute it
// (see `visualStatus` in BountyRow) so the cap rule lives in one place.
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
