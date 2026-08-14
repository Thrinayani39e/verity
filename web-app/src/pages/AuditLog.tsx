import { useEffect, useState } from "react";
import type { GlobalEvent } from "../lib/types";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { EVENT_META } from "../lib/statusMeta";

const EVENT_TYPES = ["all", "submitted", "claimed", "context_gathered", "decided", "reviewed"];

export function AuditLog() {
  const [events, setEvents] = useState<GlobalEvent[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    api.listEvents(200).then(setEvents).catch(() => setEvents([]));
  }, []);

  const filtered = filter === "all" ? events : events.filter((e) => e.event_type === filter);

  return (
    <div className="animate-fade-up">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Audit log</h1>
      <p className="mb-5 text-[13.5px] text-[rgb(20_23_26_/_0.55)]">
        Every lifecycle event, in order, across every claim: the compliance record.
      </p>
      <div className="mb-4 flex items-center gap-2.5">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-[7px] border border-[var(--color-line-strong)] bg-white px-2.5 py-2 text-[12.5px]"
        >
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "all" ? "All event types" : t.replace("_", " ")}
            </option>
          ))}
        </select>
        <div className="text-xs text-[rgb(20_23_26_/_0.4)]">{filtered.length} events</div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white">
        {filtered.map((ev) => {
          const meta = EVENT_META[ev.event_type];
          return (
            <div
              key={ev.id}
              className="grid grid-cols-[148px_150px_130px_1fr] items-center border-b border-[var(--color-line-soft)] px-4.5 py-3 last:border-0"
            >
              <div className="text-[11.5px] text-[rgb(20_23_26_/_0.45)]">{fmtDateTime(ev.created_at)}</div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
                <span className="text-[11px] font-bold" style={{ color: meta.dot }}>
                  {meta.label}
                </span>
              </div>
              <div className="text-[11.5px] text-[rgb(20_23_26_/_0.5)]">
                {ev.claim_id.slice(0, 8)} · {ev.agent_id ? ev.agent_id.slice(0, 8) : "System"}
              </div>
              <div className="truncate text-[12.5px] text-[var(--color-ink)]">
                {eventText(ev, ev.claimant_name)}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-[rgb(20_23_26_/_0.4)]">
            No events match this filter.
          </div>
        )}
      </div>
    </div>
  );
}

function eventText(ev: GlobalEvent, claimantName: string): string {
  const payload = ev.payload as Record<string, unknown>;
  switch (ev.event_type) {
    case "submitted":
      return `${claimantName} submitted a claim.`;
    case "claimed":
      return `${ev.agent_id?.slice(0, 8) ?? "An agent"} claimed the case.`;
    case "context_gathered":
      return "Agent gathered claim context (policy, precedent, history).";
    case "decided":
      return String(payload.rationale ?? "Decision made.");
    case "reviewed":
      return String(payload.notes ?? "Reviewed by a human adjuster.");
    default:
      return "";
  }
}
