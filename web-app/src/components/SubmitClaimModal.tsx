import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { useOrg } from "../lib/OrgContext";
import { useToast } from "../lib/toast";

export function SubmitClaimModal({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { orgs, activeOrgId } = useOrg();
  const showToast = useToast();
  const [orgId, setOrgId] = useState(activeOrgId !== "all" ? activeOrgId : orgs[0]?.id ?? "");
  const [claimantName, setClaimantName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!orgId || !claimantName || !description || !amount) {
      setError("Fill in organization, claimant, description, and amount.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.submitClaim({
        org_id: orgId,
        claimant_name: claimantName,
        policy_number: policyNumber || "UNKNOWN",
        description,
        amount_cents: Math.round(parseFloat(amount) * 100),
      });
      showToast("Claim submitted. An agent will pick it up shortly.");
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit claim");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-60 flex items-center justify-center bg-[rgb(10_14_18_/_0.5)] p-7"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[88vh] w-full max-w-[540px] overflow-y-auto rounded-[14px] bg-[var(--color-bg)] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.2)]">
        <div className="mb-1.5 text-[10.5px] font-bold tracking-[0.06em] text-[var(--color-accent)]">
          NEW CLAIM
        </div>
        <div className="mb-1.5 text-xl font-semibold text-[var(--color-ink)]">Tell us what happened</div>
        <div className="mb-5 text-[12.5px] leading-relaxed text-[rgb(20_23_26_/_0.5)]">
          An agent will pick this up right away. If the policy number matches a real policy on file,
          we'll check it against the coverage and deductible automatically.
        </div>

        <Field label="ORGANIZATION">
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-line-strong)] bg-white px-3 py-2.5 text-[13px]"
          >
            <option value="" disabled>
              Select an organization
            </option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="CLAIMANT NAME">
          <input
            value={claimantName}
            onChange={(e) => setClaimantName(e.target.value)}
            placeholder="Full name"
            className="w-full rounded-lg border border-[var(--color-line-strong)] px-3 py-2.5 text-[13px]"
          />
        </Field>

        <div>
          <label className="text-[10.5px] font-semibold text-[rgb(20_23_26_/_0.45)]">POLICY NUMBER</label>
          <input
            value={policyNumber}
            onChange={(e) => setPolicyNumber(e.target.value)}
            placeholder="POL-10101-AX"
            className="mt-1.5 mb-1 w-full rounded-lg border border-[var(--color-line-strong)] px-3 py-2.5 font-mono text-[13px]"
          />
          <div className="mb-3.5 text-[11px] text-[rgb(20_23_26_/_0.4)]">
            We'll match this against the policy book once an agent gathers context.
          </div>
        </div>

        <Field label="WHAT HAPPENED">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the incident…"
            rows={3}
            className="w-full resize-y rounded-lg border border-[var(--color-line-strong)] px-3 py-2.5 text-[13px]"
          />
        </Field>

        <div className="mb-5">
          <Field label="AMOUNT CLAIMED ($)">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-[var(--color-line-strong)] px-3 py-2.5 text-[13px]"
            />
          </Field>
        </div>

        {error && <p className="mb-3 text-[12.5px] text-[var(--color-status-denied)]">{error}</p>}

        <div className="flex gap-2.5">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 rounded-lg bg-[var(--color-accent)] py-3 text-[13.5px] font-bold text-white disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit claim"}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--color-line-strong)] px-4.5 py-3 text-[13.5px] font-semibold text-[var(--color-ink)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <label className="mb-1.5 block text-[10.5px] font-semibold text-[rgb(20_23_26_/_0.45)]">
        {label}
      </label>
      {children}
    </div>
  );
}
