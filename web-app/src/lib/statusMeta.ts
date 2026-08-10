import type { ClaimStatus } from "./types";

export const STATUS_META: Record<ClaimStatus, { label: string; fg: string; dot: string }> = {
  pending: { label: "Submitted", fg: "var(--color-status-submitted)", dot: "var(--color-status-submitted-dot)" },
  claimed: { label: "Processing", fg: "var(--color-status-progress)", dot: "var(--color-status-progress-dot)" },
  // approved and payout creation happen in the same transaction in this system,
  // so there is no meaningful "approved but not yet paid" gap state to show.
  approved: { label: "Paid", fg: "var(--color-status-approved)", dot: "var(--color-status-approved-dot)" },
  denied: { label: "Denied", fg: "var(--color-status-denied)", dot: "var(--color-status-denied-dot)" },
  flagged: { label: "Flagged for review", fg: "var(--color-status-flagged)", dot: "var(--color-status-flagged-dot)" },
};

export const EVENT_META: Record<string, { label: string; dot: string }> = {
  submitted: { label: "SUBMITTED", dot: "var(--color-status-submitted-dot)" },
  claimed: { label: "CLAIMED", dot: "var(--color-status-progress-dot)" },
  context_gathered: { label: "CONTEXT GATHERED", dot: "var(--color-status-progress-dot)" },
  decided: { label: "DECIDED", dot: "var(--color-status-flagged-dot)" },
  reviewed: { label: "HUMAN REVIEWED", dot: "var(--color-status-approved-dot)" },
};
