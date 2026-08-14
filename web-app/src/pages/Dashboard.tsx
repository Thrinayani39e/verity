import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AnalyticsSummary, Claim, ClaimStatus } from "../lib/types";
import { api } from "../lib/api";
import { useOrg } from "../lib/OrgContext";
import { fmtMoney, fmtTimeAgo } from "../lib/format";
import { STATUS_META } from "../lib/statusMeta";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Submitted" },
  { key: "claimed", label: "Processing" },
  { key: "flagged", label: "Flagged" },
  { key: "approved", label: "Paid" },
  { key: "denied", label: "Denied" },
];

export function Dashboard() {
  const { orgs, activeOrgId } = useOrg();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [filter, setFilter] = useState("all");
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    api.listClaims().then(setClaims).catch(() => setClaims([]));
    api.analyticsSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const orgName = orgs.find((o) => o.id === activeOrgId)?.name;
  const heroLabel = activeOrgId === "all" ? "ALL ORGANIZATIONS" : (orgName ?? "").toUpperCase();

  const byStatus = new Map(summary?.by_status.map((s) => [s.status, s]) ?? []);
  const decided = (byStatus.get("approved")?.count ?? 0) + (byStatus.get("denied")?.count ?? 0);
  const approvalRate = decided
    ? `${Math.round(((byStatus.get("approved")?.count ?? 0) / decided) * 100)}%`
    : "-";
  const totalClaims = summary?.by_status.reduce((sum, s) => sum + s.count, 0) ?? claims.length;
  const totalPaid = fmtMoney(summary?.payouts.total_amount_cents ?? 0);
  const needsReview = byStatus.get("flagged")?.count ?? 0;

  const filtered = filter === "all" ? claims : claims.filter((c) => c.status === filter);

  return (
    <div className="animate-fade-up">
      <div className="mb-8.5 max-w-[680px]">
        <div className="mb-2.5 text-[11px] font-bold tracking-[0.08em] text-[var(--color-accent)]">
          {heroLabel}
        </div>
        <h1 className="text-[33px] font-semibold leading-[1.18] tracking-tight text-[var(--color-ink)]">
          Every claim decided with evidence, and a human always has the final say.
        </h1>
        <p className="mt-2.5 text-[14.5px] leading-relaxed text-[rgb(20_23_26_/_0.6)]">
          Verity's agents gather policy context, weigh precedent, and decide in minutes, flagging
          anything uncertain for an adjuster before a dollar moves.
        </p>
      </div>

      <div className="mb-9 grid grid-cols-4 gap-px overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-line)]">
        <StatTile label="TOTAL CLAIMS" value={String(totalClaims)} />
        <StatTile label="APPROVAL RATE" value={approvalRate} />
        <StatTile label="TOTAL PAID OUT" value={totalPaid} />
        <StatTile label="NEEDS HUMAN REVIEW" value={String(needsReview)} accent />
      </div>

      <div className="mb-3.5 flex items-center justify-between">
        <div className="text-[16.5px] font-semibold text-[var(--color-ink)]">Claims queue</div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="rounded-full border px-3 py-1.5 text-[11.5px] font-semibold"
              style={
                filter === f.key
                  ? { background: "var(--color-ink)", borderColor: "var(--color-ink)", color: "#fff" }
                  : { background: "transparent", borderColor: "var(--color-line-strong)", color: "rgb(20 23 26 / 0.55)" }
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white">
        <div className="grid grid-cols-[118px_1.6fr_105px_150px_90px] border-b border-[var(--color-line)] px-4.5 py-2.5 text-[10px] font-bold tracking-[0.06em] text-[rgb(20_23_26_/_0.4)]">
          <div>CLAIM</div>
          <div>CLAIMANT / DESCRIPTION</div>
          <div>AMOUNT</div>
          <div>STATUS</div>
          <div>SUBMITTED</div>
        </div>
        {filtered.map((c) => {
          const meta = STATUS_META[c.status as ClaimStatus];
          return (
            <div
              key={c.id}
              onClick={() => navigate(`/claims/${c.id}`)}
              className="grid cursor-pointer grid-cols-[118px_1.6fr_105px_150px_90px] items-center border-b border-[var(--color-line-soft)] px-4.5 py-3.5 last:border-0 hover:bg-[rgb(20_23_26_/_0.02)]"
            >
              <div className="font-mono text-xs font-semibold text-[var(--color-ink)]">
                {c.id.slice(0, 8)}
              </div>
              <div className="min-w-0 pr-3.5">
                <div className="text-[13px] font-semibold text-[var(--color-ink)]">{c.claimant_name}</div>
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-[rgb(20_23_26_/_0.5)]">
                  {c.description}
                </div>
              </div>
              <div className="text-[12.5px] font-semibold text-[var(--color-ink)]">
                {fmtMoney(c.amount_cents)}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: meta.dot }} />
                <span className="text-xs font-semibold" style={{ color: meta.fg }}>
                  {meta.label}
                </span>
              </div>
              <div className="text-[11.5px] text-[rgb(20_23_26_/_0.45)]">{fmtTimeAgo(c.created_at)}</div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-[rgb(20_23_26_/_0.4)]">
            No claims match this filter.
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white px-5 py-4.5">
      <div
        className="mb-2 text-[10.5px] font-semibold tracking-[0.05em]"
        style={{ color: accent ? "var(--color-status-flagged)" : "rgb(20 23 26 / 0.45)" }}
      >
        {label}
      </div>
      <div
        className="text-[25px] font-semibold"
        style={{ color: accent ? "var(--color-status-flagged)" : "var(--color-ink)" }}
      >
        {value}
      </div>
    </div>
  );
}
