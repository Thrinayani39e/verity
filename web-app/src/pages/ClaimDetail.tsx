import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ClaimDetail as ClaimDetailType } from "../lib/types";
import { api } from "../lib/api";
import { fmtDateTime, fmtMoney } from "../lib/format";
import { STATUS_META, EVENT_META } from "../lib/statusMeta";
import { ReplayModal } from "../components/ReplayModal";
import { useOrg } from "../lib/OrgContext";

export function ClaimDetail() {
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();
  const { orgs } = useOrg();
  const [detail, setDetail] = useState<ClaimDetailType | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);

  useEffect(() => {
    if (!claimId) return;
    api.claimDetail(claimId).then(setDetail).catch(() => setDetail(null));
  }, [claimId]);

  if (!detail) return <p className="text-sm text-[rgb(20_23_26_/_0.4)]">Loading…</p>;

  const { claim, events, documents, decisions, payout, review } = detail;
  const meta = STATUS_META[claim.status];
  const orgName = orgs.find((o) => o.id === claim.org_id)?.name ?? "";
  const latestDecision = decisions[decisions.length - 1];

  const contextEvent = events.find((e) => e.event_type === "context_gathered");
  const policyFromContext = (contextEvent?.payload as { policy?: Record<string, unknown> } | undefined)
    ?.policy;
  const pending = claim.status === "pending" || claim.status === "claimed";

  return (
    <div className="animate-fade-up max-w-[880px]">
      <button
        onClick={() => navigate("/")}
        className="mb-4 border-none bg-transparent p-0 text-[12.5px] font-semibold text-[rgb(20_23_26_/_0.5)]"
      >
        ← Back to overview
      </button>

      <div className="mb-1.5 flex items-start justify-between">
        <div>
          <div className="font-mono text-[11.5px] font-bold tracking-[0.02em] text-[rgb(20_23_26_/_0.4)]">
            {claim.id}
          </div>
          <div className="mt-0.5 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
            {claim.claimant_name}
          </div>
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <span className="h-2 w-2 rounded-full" style={{ background: meta.dot }} />
          <span className="text-[13px] font-semibold" style={{ color: meta.fg }}>
            {meta.label}
          </span>
        </div>
      </div>
      <div className="mb-5 text-sm leading-relaxed text-[rgb(20_23_26_/_0.6)]">{claim.description}</div>

      <div className="mb-7 grid grid-cols-4 gap-px overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-line)]">
        <MiniStat label="AMOUNT CLAIMED" value={fmtMoney(claim.amount_cents)} />
        <MiniStat label="ORGANIZATION" value={orgName} />
        <MiniStat label="POLICY NUMBER" value={claim.policy_number} mono />
        <MiniStat label="SUBMITTED" value={fmtDateTime(claim.created_at)} />
      </div>

      <div className="grid grid-cols-[1.6fr_1fr] items-start gap-6.5">
        <div>
          <div className="mb-4 text-sm font-semibold text-[var(--color-ink)]">Case timeline</div>
          <div className="relative pl-6">
            <div className="absolute bottom-1.5 left-1.5 top-1.5 w-[1.5px] bg-[rgb(20_23_26_/_0.1)]" />
            {events.map((ev) => {
              const em = EVENT_META[ev.event_type];
              const text = describeEvent(ev, claim.claimant_name, claim.amount_cents);
              return (
                <div key={ev.id} className="relative pb-6">
                  <div
                    className="absolute -left-6 top-0.5 h-2.5 w-2.5 rounded-full border-[2.5px] border-[var(--color-bg)]"
                    style={{ background: em.dot }}
                  />
                  <div className="mb-0.5 text-[10.5px] font-bold tracking-[0.05em]" style={{ color: em.dot }}>
                    {em.label}
                  </div>
                  <div className="mb-1 text-[11px] text-[rgb(20_23_26_/_0.4)]">
                    {fmtDateTime(ev.created_at)} · {ev.agent_id ? ev.agent_id.slice(0, 8) : "System"}
                  </div>
                  <div className="rounded-lg border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--color-ink)]">
                    {text}
                  </div>
                </div>
              );
            })}
          </div>

          {latestDecision && (
            <button
              onClick={() => setReplayOpen(true)}
              className="mt-1 rounded-lg bg-[var(--color-ink)] px-4 py-2.5 text-[12.5px] font-semibold text-white"
            >
              ↻ Replay decision as of system time
            </button>
          )}

          {review && (
            <div className="mt-5 rounded-[10px] bg-[var(--color-ink)] px-4.5 py-4 text-white">
              <div className="mb-2 text-[10.5px] font-bold tracking-[0.06em] text-[var(--color-modal-accent)]">
                HUMAN REVIEW
              </div>
              <div className="text-[13px] leading-relaxed text-white/90">{review.notes}</div>
              <div className="mt-2 text-[11.5px] text-white/50">
                {review.reviewer_name} · {review.outcome === "approve" ? "Approved" : "Denied"} ·{" "}
                {fmtDateTime(review.created_at)}
              </div>
            </div>
          )}

          {payout && (
            <div className="mt-5 rounded-[10px] border border-[rgb(47_107_79_/_0.25)] bg-white px-4.5 py-4">
              <div className="mb-2 text-[10.5px] font-bold tracking-[0.06em] text-[var(--color-accent)]">
                PAYOUT ISSUED
              </div>
              <div className="text-[19px] font-semibold text-[var(--color-accent)]">
                {fmtMoney(payout.amount_cents)}
              </div>
              <div className="mt-0.5 text-xs text-[rgb(20_23_26_/_0.5)]">
                {fmtDateTime(payout.created_at)}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="mb-4 text-sm font-semibold text-[var(--color-ink)]">Documents</div>
          <div className="mb-6 flex flex-col gap-1.5">
            {documents.length === 0 && (
              <p className="text-xs text-[rgb(20_23_26_/_0.4)]">No documents uploaded yet.</p>
            )}
            {documents.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2"
              >
                <div
                  className="h-7 w-5.5 flex-none rounded-sm border border-[rgb(20_23_26_/_0.12)]"
                  style={{
                    background:
                      "repeating-linear-gradient(135deg, rgb(20 23 26 / 0.07) 0 3px, transparent 3px 7px)",
                  }}
                />
                <div className="text-xs font-semibold text-[var(--color-ink)]">
                  {d.s3_key.split("/").pop()}
                </div>
              </div>
            ))}
          </div>

          <div className="mb-2.5 text-sm font-semibold text-[var(--color-ink)]">Coverage check</div>
          <div className="rounded-[10px] border border-[var(--color-line)] bg-white p-4">
            {pending && (
              <p className="text-xs leading-relaxed text-[rgb(20_23_26_/_0.4)]">
                Coverage check not yet performed. An agent hasn't gathered context on this case.
              </p>
            )}
            {!pending && !policyFromContext && (
              <p className="text-xs leading-relaxed text-[var(--color-status-denied)]">
                No policy record found for <b>{claim.policy_number}</b>. Coverage could not be verified.
              </p>
            )}
            {!pending && policyFromContext && (
              <PolicySummary policy={policyFromContext} />
            )}
          </div>
        </div>
      </div>

      {replayOpen && latestDecision && (
        <ReplayModal decisionId={latestDecision.id} onClose={() => setReplayOpen(false)} />
      )}
    </div>
  );
}

function MiniStat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white px-3.5 py-3">
      <div className="mb-1 text-[10px] font-semibold tracking-[0.05em] text-[rgb(20_23_26_/_0.4)]">
        {label}
      </div>
      <div className={`text-[13.5px] font-semibold text-[var(--color-ink)] ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function PolicySummary({ policy }: { policy: Record<string, unknown> }) {
  const isActive = policy.is_active === true;
  return (
    <div>
      <Row label="Coverage type" value={String(policy.coverage_type ?? "-")} capitalize />
      <Row
        label="Policy status"
        value={String(policy.status ?? "-")}
        color={isActive ? "var(--color-accent)" : "var(--color-status-denied)"}
        capitalize
      />
      <Row label="Coverage limit" value={fmtMoney(Number(policy.coverage_limit_cents ?? 0))} />
      <Row label="Deductible" value={fmtMoney(Number(policy.deductible_cents ?? 0))} last />
    </div>
  );
}

function Row({
  label,
  value,
  color,
  capitalize,
  last,
}: {
  label: string;
  value: string;
  color?: string;
  capitalize?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-1.5 text-xs ${last ? "" : "border-b border-[rgb(20_23_26_/_0.06)]"}`}
    >
      <span className="text-[rgb(20_23_26_/_0.45)]">{label}</span>
      <span className={`font-semibold ${capitalize ? "capitalize" : ""}`} style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function describeEvent(
  ev: { event_type: string; payload: Record<string, unknown>; agent_id: string | null },
  claimantName: string,
  amountCents: number,
): string {
  switch (ev.event_type) {
    case "submitted":
      return `${claimantName} submitted a claim for ${fmtMoney(amountCents)}.`;
    case "claimed":
      return `${ev.agent_id?.slice(0, 8) ?? "An agent"} claimed the case.`;
    case "context_gathered": {
      const policy = (ev.payload as { policy?: Record<string, unknown> }).policy;
      if (!policy) return "No matching policy record found. Coverage could not be verified.";
      return `Located policy ${policy.policy_number}: ${policy.coverage_type} coverage, ${policy.status}, limit ${fmtMoney(Number(policy.coverage_limit_cents))}, deductible ${fmtMoney(Number(policy.deductible_cents))}.`;
    }
    case "decided":
      return String((ev.payload as { rationale?: string }).rationale ?? "");
    case "reviewed":
      return String((ev.payload as { notes?: string }).notes ?? "Reviewed.");
    default:
      return "";
  }
}
