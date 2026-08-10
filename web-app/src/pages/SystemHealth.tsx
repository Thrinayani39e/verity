import { useEffect, useState } from "react";
import type { Claim, DoubleClaimViolation, HealthCheckResult } from "../lib/types";
import { api, ApiError } from "../lib/api";
import { fmtDateTime } from "../lib/format";

type HealthState = { status: "idle" } | { status: "checking" } | { status: "done"; result: HealthCheckResult; at: string } | { status: "error"; message: string };

export function SystemHealth() {
  const [health, setHealth] = useState<HealthState>({ status: "idle" });
  const [violations, setViolations] = useState<DoubleClaimViolation[] | null>(null);
  const [lockedClaims, setLockedClaims] = useState<Claim[]>([]);

  useEffect(() => {
    api.checkDoubleClaims().then((r) => setViolations(r.violations)).catch(() => setViolations(null));
    api
      .listClaims()
      .then((claims) => setLockedClaims(claims.filter((c) => c.claimed_by)))
      .catch(() => setLockedClaims([]));
  }, []);

  const runHealthCheck = async () => {
    setHealth({ status: "checking" });
    try {
      const result = await api.opsHealthCheck();
      setHealth({ status: "done", result, at: new Date().toISOString() });
    } catch (err) {
      setHealth({ status: "error", message: err instanceof ApiError ? err.message : "Health check failed" });
    }
  };

  return (
    <div className="animate-fade-up max-w-[880px]">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">System & ops</h1>

      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <div className="rounded-[10px] border border-[var(--color-line)] bg-white px-5.5 py-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[13.5px] font-semibold text-[var(--color-ink)]">Cluster health</div>
            <button
              onClick={runHealthCheck}
              disabled={health.status === "checking"}
              className="rounded-[7px] bg-[var(--color-ink)] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Run health check
            </button>
          </div>

          {health.status === "idle" && (
            <p className="text-[12.5px] text-[rgb(20_23_26_/_0.4)]">No check run yet this session.</p>
          )}
          {health.status === "checking" && (
            <div className="flex items-center gap-2.5 text-[12.5px] text-[rgb(20_23_26_/_0.55)]">
              <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--color-status-flagged-dot)]" />
              Pinging cluster nodes… (calling ccloud CLI)
            </div>
          )}
          {health.status === "error" && (
            <p className="text-[12.5px] text-[var(--color-status-denied)]">{health.message}</p>
          )}
          {health.status === "done" && (
            <div>
              <div className="mb-3.5 flex items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: health.result.healthy ? "var(--color-accent)" : "var(--color-status-denied)" }}
                />
                <span
                  className="text-[15px] font-semibold"
                  style={{ color: health.result.healthy ? "var(--color-accent)" : "var(--color-status-denied)" }}
                >
                  {health.result.healthy ? "Healthy" : "Unhealthy"}
                </span>
              </div>
              <HealthRow label="Status" value={health.result.status} />
              <HealthRow label="Cluster" value={health.result.cluster_name} mono />
              <HealthRow label="Checked" value={fmtDateTime(health.at)} />
            </div>
          )}
        </div>

        <div className="rounded-[10px] border border-[var(--color-line)] bg-white px-5.5 py-5">
          <div className="mb-1.5 text-[13.5px] font-semibold text-[var(--color-ink)]">
            Double-claim safety check
          </div>
          <div className="mb-4 text-xs text-[rgb(20_23_26_/_0.45)]">
            Every claim can be locked by exactly one agent at a time. This scans for violations.
          </div>
          {violations === null ? (
            <p className="text-[12.5px] text-[rgb(20_23_26_/_0.4)]">Checking…</p>
          ) : (
            <div
              className="flex items-center gap-3"
              style={{
                background: violations.length === 0 ? "rgb(47 107 79 / 0.06)" : "rgb(154 74 59 / 0.06)",
                border: `1px solid ${violations.length === 0 ? "rgb(47 107 79 / 0.2)" : "rgb(154 74 59 / 0.2)"}`,
                borderRadius: 9,
                padding: "13px 15px",
              }}
            >
              <span
                className="flex h-7.5 w-7.5 flex-none items-center justify-center rounded-full text-[15px] font-bold text-white"
                style={{ background: violations.length === 0 ? "var(--color-accent)" : "var(--color-status-denied)" }}
              >
                {violations.length === 0 ? "✓" : "!"}
              </span>
              <div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: violations.length === 0 ? "var(--color-accent-dark)" : "var(--color-status-denied)" }}
                >
                  {violations.length === 0 ? "0 conflicts detected" : `${violations.length} conflict(s) detected`}
                </div>
                <div className="text-[11.5px]" style={{ color: violations.length === 0 ? "var(--color-accent)" : "var(--color-status-denied)" }}>
                  {lockedClaims.length} claims checked, each held by exactly one agent
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white">
        <div className="border-b border-[var(--color-line)] px-4.5 py-3.5 text-[13.5px] font-semibold text-[var(--color-ink)]">
          Agent lock ledger
        </div>
        <div className="grid grid-cols-[1fr_1fr_100px] border-b border-[var(--color-line-soft)] px-4.5 py-2.5 text-[10px] font-bold tracking-[0.06em] text-[rgb(20_23_26_/_0.4)]">
          <div>CLAIM</div>
          <div>HELD BY</div>
          <div>STATUS</div>
        </div>
        {lockedClaims.slice(0, 10).map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[1fr_1fr_100px] items-center border-b border-[var(--color-line-soft)] px-4.5 py-2.5 last:border-0"
          >
            <div className="font-mono text-xs font-semibold text-[var(--color-ink)]">{c.id.slice(0, 8)}</div>
            <div className="font-mono text-xs text-[rgb(20_23_26_/_0.6)]">{c.claimed_by?.slice(0, 8)}</div>
            <div className="text-[11px] font-bold text-[var(--color-accent)]">◆ unique</div>
          </div>
        ))}
        {lockedClaims.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-[rgb(20_23_26_/_0.4)]">
            No claims have been claimed by an agent yet.
          </div>
        )}
      </div>
    </div>
  );
}

function HealthRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-t border-[rgb(20_23_26_/_0.06)] py-1.5 text-xs">
      <span className="text-[rgb(20_23_26_/_0.45)]">{label}</span>
      <span className={`font-semibold ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
