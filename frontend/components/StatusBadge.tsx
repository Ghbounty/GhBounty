import type { BountyStatus } from "@/lib/types";

const LABELS: Record<BountyStatus, string> = {
  open: "Open",
  reviewing: "Reviewing",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
  closed: "Closed",
};

export function StatusBadge({ status }: { status: BountyStatus }) {
  return <span className={`status-badge status-${status}`}>● {LABELS[status]}</span>;
}
