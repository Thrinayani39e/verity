import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Claim, ClaimDetail } from "../lib/types";
import { api, ApiError } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { useToast } from "../lib/toast";

interface ReviewFormState {
  open: boolean;
  reviewerName: string;
  outcome: "approve" | "deny";
  notes: string;
}

export function ReviewQueue() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [details, setDetails] = useState<Record<string, ClaimDetail>>({});
  const [forms, setForms] = useState<Record<string, ReviewFormState>>({});
  const navigate = useNavigate();
  const showToast = useToast();

  const refresh = () => {
    api
      .listClaims("flagged")
      .then(async (flagged) => {
        setClaims(flagged);
        const entries = await Promise.all(
          flagged.map(async (c) => [c.id, await api.claimDetail(c.id)] as const),
        );
        setDetails(Object.fromEntries(entries));
      })
      .catch(() => setClaims([]));
  };

  useEffect(refresh, []);

  const toggleForm = (id: string) =>
    setForms((f) => ({
      ...f,
      [id]: { ...(f[id] ?? { reviewerName: "", outcome: "approve", notes: "" }), open: !f[id]?.open },
    }));

  const updateForm = (id: string, patch: Partial<ReviewFormState>) =>
    setForms((f) => ({
      ...f,
      [id]: { ...(f[id] ?? { open: true, reviewerName: "", outcome: "approve", notes: "" }), ...patch },
    }));

  const submitReview = async (claim: Claim) => {
    const form = forms[claim.id];
    const decisionId = details[claim.id]?.decisions.at(-1)?.id;
    if (!form?.reviewerName || !decisionId) {
      showToast("Enter your name to submit a review.");
      return;
    }
    try {
      await api.reviewClaim(claim.id, {
        decision_id: decisionId,
        reviewer_name: form.reviewerName,
        outcome: form.outcome,
        notes: form.notes || (form.outcome === "approve" ? "Reviewed and approved." : "Reviewed and denied."),
      });
      showToast("Review recorded.");
      refresh();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Review failed");
    }
  };

  return (
    <div className="animate-fade-up max-w-[800px]">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Review queue</h1>
      <p className="mb-6 text-[13.5px] leading-relaxed text-[rgb(20_23_26_/_0.55)]">
        {claims.length} case{claims.length === 1 ? "" : "s"} the model won't decide alone. Read the
        rationale, then make the call. Nothing pays out without a signature here.
      </p>

      {claims.length === 0 && (
        <div className="py-14 text-center text-[13px] text-[rgb(20_23_26_/_0.38)]">
          Queue is clear. No claims currently need human review.
        </div>
      )}

      {claims.map((claim) => {
        const detail = details[claim.id];
        const decision = detail?.decisions.at(-1);
        const form = forms[claim.id] ?? { open: false, reviewerName: "", outcome: "approve" as const, notes: "" };
        return (
          <div
            key={claim.id}
            className="mb-3.5 rounded-[10px] border border-l-[3px] border-[var(--color-line-strong)] border-l-[var(--color-status-flagged-dot)] bg-white px-5.5 py-5"
          >
            <div className="mb-2 flex items-start justify-between">
              <div>
                <div className="whitespace-nowrap font-mono text-[11.5px] font-bold text-[rgb(20_23_26_/_0.4)]">
                  {claim.id.slice(0, 8)}
                </div>
                <div className="mt-1 text-base font-semibold text-[var(--color-ink)]">
                  {claim.claimant_name}
                </div>
              </div>
              <div className="text-lg font-semibold text-[var(--color-ink)]">
                {fmtMoney(claim.amount_cents)}
              </div>
            </div>
            <div className="mb-3 text-[13px] leading-relaxed text-[rgb(20_23_26_/_0.65)]">
              {claim.description}
            </div>

            {decision && (
              <div className="mb-3 rounded-lg border border-[var(--color-status-flagged-border)] bg-[var(--color-status-flagged-bg)] px-4 py-3.5">
                <div className="mb-1.5 text-[10px] font-bold tracking-[0.05em] text-[var(--color-status-flagged)]">
                  AGENT RATIONALE
                </div>
                <div className="text-[12.5px] leading-relaxed text-[#5c4718]">{decision.rationale}</div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => navigate(`/claims/${claim.id}`)}
                className="rounded-[7px] bg-[rgb(20_23_26_/_0.05)] px-3.5 py-2 text-xs font-semibold text-[var(--color-ink)]"
              >
                View full case →
              </button>
              {!form.open && (
                <button
                  onClick={() => toggleForm(claim.id)}
                  className="rounded-[7px] border-none bg-[var(--color-ink)] px-3.5 py-2 text-xs font-semibold text-white"
                >
                  Review this claim
                </button>
              )}
            </div>

            {form.open && (
              <div className="mt-3.5 border-t border-[var(--color-status-flagged-border)] pt-4">
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10.5px] font-semibold text-[rgb(20_23_26_/_0.45)]">
                      REVIEWER NAME
                    </label>
                    <input
                      value={form.reviewerName}
                      onChange={(e) => updateForm(claim.id, { reviewerName: e.target.value })}
                      placeholder="Your name"
                      className="mt-1.5 w-full rounded-[7px] border border-[var(--color-line-strong)] bg-white px-2.5 py-2 text-[12.5px]"
                    />
                  </div>
                  <div>
                    <label className="text-[10.5px] font-semibold text-[rgb(20_23_26_/_0.45)]">
                      DECISION
                    </label>
                    <div className="mt-1.5 flex gap-2">
                      <button
                        onClick={() => updateForm(claim.id, { outcome: "approve" })}
                        className="flex-1 rounded-[7px] py-2 text-xs font-bold"
                        style={
                          form.outcome === "approve"
                            ? { background: "var(--color-accent)", color: "#fff", border: "1px solid var(--color-accent)" }
                            : { background: "transparent", color: "var(--color-accent)", border: "1px solid rgb(47 107 79 / 0.4)" }
                        }
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => updateForm(claim.id, { outcome: "deny" })}
                        className="flex-1 rounded-[7px] py-2 text-xs font-bold"
                        style={
                          form.outcome === "deny"
                            ? { background: "var(--color-status-denied)", color: "#fff", border: "1px solid var(--color-status-denied)" }
                            : { background: "transparent", color: "var(--color-status-denied)", border: "1px solid rgb(154 74 59 / 0.4)" }
                        }
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                </div>
                <label className="text-[10.5px] font-semibold text-[rgb(20_23_26_/_0.45)]">
                  NOTES FOR THE FILE
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => updateForm(claim.id, { notes: e.target.value })}
                  placeholder="Document what you reviewed and why…"
                  rows={2}
                  className="mt-1.5 w-full resize-y rounded-[7px] border border-[var(--color-line-strong)] bg-white px-2.5 py-2.5 text-[12.5px]"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => submitReview(claim)}
                    className="rounded-[7px] bg-[var(--color-ink)] px-4 py-2.5 text-[12.5px] font-semibold text-white"
                  >
                    Submit decision
                  </button>
                  <button
                    onClick={() => toggleForm(claim.id)}
                    className="rounded-[7px] border border-[var(--color-line-strong)] px-4 py-2.5 text-[12.5px] font-semibold text-[var(--color-ink)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
