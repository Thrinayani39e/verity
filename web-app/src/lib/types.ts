export type ClaimStatus = "pending" | "claimed" | "approved" | "denied" | "flagged";

export interface Organization {
  id: string;
  name: string;
  created_at: string;
}

export interface Claim {
  id: string;
  claimant_name: string;
  policy_number: string;
  description: string;
  amount_cents: number;
  status: ClaimStatus;
  claimed_by: string | null;
  created_at: string;
}

export interface Decision {
  id: string;
  claim_id: string;
  agent_id: string;
  decision: "approve" | "deny" | "flag";
  rationale: string;
  context_snapshot: Record<string, unknown>;
  context_query_time: string;
  context_hlc_time: string;
  model_id: string;
  created_at: string;
}

export interface ProcessResult {
  decision_id: string;
  payout_id: string | null;
  decision: "approve" | "deny" | "flag";
  rationale: string;
  model_id: string;
}

export interface ReplayResult {
  decision: Decision;
  as_of_hlc_time: string;
  historical_claim_state: Record<string, unknown> | null;
  historical_events: Array<{ event_type: string; payload: unknown; created_at: string }>;
  current_claim_state: Record<string, unknown> | null;
  state_has_changed_since_decision: boolean;
}

export interface DoubleClaimViolation {
  claim_id: string;
  distinct_claimants: number;
}

export interface Policy {
  id: string;
  org_id: string;
  policy_number: string;
  policyholder_name: string;
  coverage_type: "auto" | "home" | "health" | "life" | "property";
  coverage_limit_cents: number;
  deductible_cents: number;
  effective_date: string;
  expiration_date: string;
  status: "active" | "expired" | "cancelled";
  created_at: string;
}

export interface ClaimEvent {
  id: string;
  agent_id: string | null;
  event_type: "submitted" | "claimed" | "context_gathered" | "decided" | "reviewed";
  payload: Record<string, unknown>;
  created_at: string;
}

export interface GlobalEvent extends ClaimEvent {
  claim_id: string;
  claimant_name: string;
}

export interface Document {
  id: string;
  s3_bucket: string;
  s3_key: string;
  doc_type: string;
  created_at: string;
}

export interface Payout {
  id: string;
  amount_cents: number;
  status: "issued" | "sent" | "failed";
  created_at: string;
}

export interface Review {
  id: string;
  reviewer_name: string;
  outcome: "approve" | "deny";
  notes: string;
  created_at: string;
}

export interface ClaimDetail {
  claim: Claim & { org_id: string; claimed_at: string | null; updated_at: string };
  events: ClaimEvent[];
  documents: Document[];
  decisions: Decision[];
  payout: Payout | null;
  review: Review | null;
}

export interface SearchResult {
  claim_id: string;
  chunk_text: string;
  status: ClaimStatus;
  amount_cents: number;
  cosine_distance: number;
}

export interface AnalyticsSummary {
  by_status: Array<{ status: ClaimStatus; count: number; total_amount_cents: number }>;
  payouts: { count: number; total_amount_cents: number };
  by_agent: Array<{ agent_id: string; claims_processed: number }>;
  human_reviews: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  status: string;
  cluster_name: string;
}
