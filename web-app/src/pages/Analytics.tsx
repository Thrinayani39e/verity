import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AnalyticsSummary } from "../lib/types";
import { api } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { STATUS_META } from "../lib/statusMeta";

export function Analytics() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.analyticsSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  if (!summary) return <p className="text-sm text-[rgb(20_23_26_/_0.4)]">Loading…</p>;

  const maxStatusCount = Math.max(1, ...summary.by_status.map((s) => s.count));
  const maxAgentCount = Math.max(1, ...summary.by_agent.map((a) => a.claims_processed));

  return (
    <div className="animate-fade-up">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Analytics</h1>

      <div className="mb-3.5 grid grid-cols-[1.1fr_0.9fr] gap-3.5">
        <div className="rounded-[10px] border border-[var(--color-line)] bg-white px-5.5 py-5">
          <div className="mb-4 text-[13.5px] font-semibold text-[var(--color-ink)]">Claims by status</div>
          {summary.by_status.map((s) => {
            const meta = STATUS_META[s.status];
            return (
              <div key={s.status} className="mb-3.5">
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="font-semibold text-[var(--color-ink)]">{meta.label}</span>
                  <span className="text-[rgb(20_23_26_/_0.45)]">
                    {s.count} · {fmtMoney(s.total_amount_cents)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-[rgb(20_23_26_/_0.06)]">
                  <div
                    className="h-full rounded"
                    style={{ width: `${Math.round((s.count / maxStatusCount) * 100)}%`, background: meta.dot }}
                  />
                </div>
              </div>
            );
          })}
          {summary.by_status.length === 0 && (
            <p className="text-xs text-[rgb(20_23_26_/_0.4)]">No claims yet.</p>
          )}
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="rounded-[10px] bg-[var(--color-ink)] px-5.5 py-5 text-white">
            <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.05em] text-white/55">
              TOTAL PAID OUT
            </div>
            <div className="text-[27px] font-semibold">{fmtMoney(summary.payouts.total_amount_cents)}</div>
            <div className="mt-1 text-xs text-white/45">across {summary.payouts.count} payouts</div>
          </div>
          <div className="rounded-[10px] border border-[rgb(150_115_31_/_0.25)] bg-white px-5.5 py-5">
            <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.05em] text-[var(--color-status-flagged)]">
              AWAITING HUMAN REVIEW
            </div>
            <div className="text-[27px] font-semibold text-[var(--color-status-flagged)]">
              {summary.human_reviews}
            </div>
            <button
              onClick={() => navigate("/reviews")}
              className="mt-1 text-xs font-semibold text-[var(--color-accent)]"
            >
              Open review queue →
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--color-line)] bg-white px-5.5 py-5">
        <div className="mb-1 text-[13.5px] font-semibold text-[var(--color-ink)]">Agent leaderboard</div>
        <div className="mb-4 text-xs text-[rgb(20_23_26_/_0.45)]">
          Claims processed per agent — proof work was distributed with no overlap.
        </div>
        {summary.by_agent.map((a) => (
          <div key={a.agent_id} className="mb-2.5 flex items-center gap-3.5">
            <div className="w-[74px] flex-none font-mono text-xs font-semibold text-[var(--color-ink)]">
              {a.agent_id.slice(0, 8)}
            </div>
            <div className="h-3.5 flex-1 overflow-hidden rounded bg-[rgb(20_23_26_/_0.06)]">
              <div
                className="h-full rounded bg-[var(--color-accent)]"
                style={{ width: `${Math.round((a.claims_processed / maxAgentCount) * 100)}%` }}
              />
            </div>
            <div className="w-[30px] text-right text-xs font-bold text-[var(--color-ink)]">
              {a.claims_processed}
            </div>
          </div>
        ))}
        {summary.by_agent.length === 0 && (
          <p className="text-xs text-[rgb(20_23_26_/_0.4)]">No claims have been processed by an agent yet.</p>
        )}
      </div>
    </div>
  );
}
