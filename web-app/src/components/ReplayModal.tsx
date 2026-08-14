import { useEffect, useState } from "react";
import type { ReplayResult } from "../lib/types";
import { api, ApiError } from "../lib/api";
import { fmtDateTime } from "../lib/format";

export function ReplayModal({ decisionId, onClose }: { decisionId: string; onClose: () => void }) {
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .replayDecision(decisionId)
      .then(setReplay)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Replay failed"));
  }, [decisionId]);

  const histStatus = replay?.historical_claim_state?.status as string | undefined;
  const nowStatus = replay?.current_claim_state?.status as string | undefined;
  const histDesc = replay?.historical_claim_state?.description as string | undefined;
  const nowDesc = replay?.current_claim_state?.description as string | undefined;

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-[rgb(10_14_18_/_0.7)] p-9"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[86vh] w-full max-w-[900px] overflow-y-auto rounded-[14px] bg-[var(--color-modal-dark)] p-8.5 text-white">
        <div className="mb-1.5 flex items-start justify-between">
          <div>
            <div className="text-[10.5px] font-bold tracking-[0.08em] text-[var(--color-modal-accent)]">
              TIME-TRAVEL REPLAY
            </div>
            <div className="mt-1 text-[19px] font-semibold">State as of decision, vs. now</div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-md border-none bg-white/10 text-sm text-white"
          >
            ×
          </button>
        </div>

        {error && <p className="mt-6 text-sm text-red-300">{error}</p>}

        {!replay && !error && <p className="mt-6 text-sm text-white/50">Replaying…</p>}

        {replay && (
          <>
            <div className="mb-6 text-xs text-white/45">
              Decision made at <b className="text-white">{fmtDateTime(replay.decision.context_query_time)}</b>{" "}
              · HLC-verified snapshot
            </div>

            <div className="relative grid grid-cols-2">
              <div className="animate-sweep-line absolute inset-y-0 left-1/2 w-[1.5px] bg-gradient-to-b from-transparent via-[#3D7A5E] to-transparent" />
              <div className="border-r border-white/10 py-5 pr-6.5">
                <div className="mb-3.5 text-[10.5px] font-bold tracking-[0.06em] text-white/40">
                  AS OF DECISION TIME
                </div>
                <ReplayField label="Status" value={histStatus} />
                <ReplayField label="Description" value={histDesc} last />
              </div>
              <div className="py-5 pl-6.5">
                <div className="mb-3.5 text-[10.5px] font-bold tracking-[0.06em] text-[var(--color-modal-accent)]">
                  CURRENT STATE (NOW)
                </div>
                <ReplayField label="Status" value={nowStatus} accent />
                <ReplayField label="Description" value={nowDesc} accent last changed={histDesc !== nowDesc} />
              </div>
            </div>

            {replay.state_has_changed_since_decision ? (
              <div className="mt-5 rounded-[9px] border border-[rgb(61_122_94_/_0.3)] bg-[rgb(61_122_94_/_0.14)] px-4 py-3.5 text-[12.5px] text-[#C9E9D6]">
                State has changed since this decision was made. The record above shows exactly what
                changed.
              </div>
            ) : (
              <div className="mt-5 rounded-[9px] border border-white/10 bg-white/5 px-4 py-3.5 text-[12.5px] text-white/55">
                No changes to claim state since this decision was made.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ReplayField({
  label,
  value,
  accent,
  last,
  changed,
}: {
  label: string;
  value: string | undefined;
  accent?: boolean;
  last?: boolean;
  changed?: boolean;
}) {
  return (
    <div className={last ? "" : "mb-4"}>
      <div className="mb-0.5 text-[11.5px] text-white/40">{label}</div>
      <div
        className={`text-[15px] font-semibold capitalize ${changed ? "rounded bg-[rgb(150_115_31_/_0.2)] px-1.5 py-0.5" : ""}`}
        style={{ color: changed ? "#E8C978" : accent ? "var(--color-modal-accent)" : "rgba(255,255,255,0.85)" }}
      >
        {value ?? "-"}
      </div>
    </div>
  );
}
