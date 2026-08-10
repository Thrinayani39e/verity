import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SearchResult } from "../lib/types";
import { api } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { STATUS_META } from "../lib/statusMeta";

export function PrecedentSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [corpusSize, setCorpusSize] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .listClaims()
      .then((claims) => setCorpusSize(claims.length))
      .catch(() => setCorpusSize(null));
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.search(query, 8).then(setResults).catch(() => setResults([]));
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="animate-fade-up max-w-[840px]">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        Precedent search
      </h1>
      <p className="mb-5 max-w-[600px] text-[13.5px] leading-relaxed text-[rgb(20_23_26_/_0.55)]">
        Describe a claim in plain language. Verity searches the vector index of every past claim and
        ranks the closest precedent by semantic similarity.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. burst pipe flooded the kitchen ceiling from upstairs"
        className="mb-6 w-full rounded-[9px] border border-[var(--color-line-strong)] bg-white px-4 py-3.5 text-sm"
      />

      {!query.trim() && (
        <div className="py-14 text-center text-[13px] text-[rgb(20_23_26_/_0.38)]">
          Start typing to search {corpusSize ?? "…"} indexed past claims.
        </div>
      )}

      {results.map((r) => {
        const meta = STATUS_META[r.status];
        const similarity = Math.max(0, Math.min(1, 1 - r.cosine_distance));
        return (
          <div
            key={r.claim_id}
            onClick={() => navigate(`/claims/${r.claim_id}`)}
            className="mb-2.5 cursor-pointer rounded-[10px] border border-[var(--color-line)] bg-white px-4.5 py-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center gap-2.5">
                  <span className="font-mono text-[11.5px] font-bold text-[rgb(20_23_26_/_0.4)]">
                    {r.claim_id.slice(0, 8)}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: meta.fg }}>
                    {meta.label}
                  </span>
                </div>
                <div className="text-[13px] leading-relaxed text-[var(--color-ink)]">{r.chunk_text}</div>
              </div>
              <div className="flex-none text-[14.5px] font-semibold text-[var(--color-ink)]">
                {fmtMoney(r.amount_cents)}
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-2.5">
              <div className="w-[100px] flex-none text-[10px] font-bold text-[rgb(20_23_26_/_0.38)]">
                DIST {r.cosine_distance.toFixed(3)}
              </div>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgb(20_23_26_/_0.07)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)]"
                  style={{ width: `${Math.round(similarity * 100)}%` }}
                />
              </div>
              <div className="w-[70px] text-right text-[10.5px] font-bold text-[var(--color-accent)]">
                {Math.round(similarity * 100)}% match
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
