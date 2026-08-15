import type {
  AnalyticsSummary,
  Claim,
  ClaimDetail,
  DoubleClaimViolation,
  FraudRing,
  HealthCheckResult,
  Organization,
  Policy,
  ProcessResult,
  ReplayResult,
  SearchResult,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8010";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.detail ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  listOrganizations: () => request<Organization[]>("/organizations"),
  createOrganization: (name: string) =>
    request<{ org_id: string; agent_id: string }>("/organizations", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  listClaims: (status?: string) =>
    request<Claim[]>(`/claims${status ? `?status=${status}` : ""}`),

  submitClaim: (input: {
    org_id: string;
    claimant_name: string;
    policy_number: string;
    description: string;
    amount_cents: number;
  }) =>
    request<{ claim_id: string }>("/claims", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  claimDetail: (claimId: string) => request<ClaimDetail>(`/claims/${claimId}/detail`),

  ensureDefaultAgent: (orgId: string) =>
    request<{ agent_id: string }>("/agents/ensure-default", {
      method: "POST",
      body: JSON.stringify({ org_id: orgId }),
    }),

  claimAndProcess: async (claimId: string, agentId: string): Promise<ProcessResult> => {
    await request(`/claims/${claimId}/claim`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    });
    return request<ProcessResult>(`/claims/${claimId}/process`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    });
  },

  reviewClaim: (
    claimId: string,
    input: { decision_id: string; reviewer_name: string; outcome: "approve" | "deny"; notes: string },
  ) =>
    request<{ review_id: string; status: string; payout_id: string | null }>(
      `/claims/${claimId}/review`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  replayDecision: (decisionId: string) =>
    request<ReplayResult>(`/decisions/${decisionId}/replay`),

  checkDoubleClaims: () =>
    request<{ violations: DoubleClaimViolation[] }>("/audit/double-claims-check"),

  search: (q: string, limit = 10) =>
    request<SearchResult[]>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  uploadDocument: async (claimId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/claims/${claimId}/documents`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.detail ?? "Upload failed", res.status);
    return body as { document_id: string };
  },

  listPolicies: (orgId?: string) =>
    request<Policy[]>(`/policies${orgId ? `?org_id=${orgId}` : ""}`),

  createPolicy: (input: {
    org_id: string;
    policy_number: string;
    policyholder_name: string;
    coverage_type: string;
    coverage_limit_cents: number;
    deductible_cents: number;
    effective_date: string;
    expiration_date: string;
  }) => request<{ policy_id: string }>("/policies", { method: "POST", body: JSON.stringify(input) }),

  listEvents: (limit = 100) => request<import("./types").GlobalEvent[]>(`/events?limit=${limit}`),

  analyticsSummary: () => request<AnalyticsSummary>("/analytics/summary"),

  opsHealthCheck: () => request<HealthCheckResult>("/ops/health-check", { method: "POST" }),

  fraudRings: () => request<FraudRing[]>("/fraud-rings"),
};

export { ApiError };
