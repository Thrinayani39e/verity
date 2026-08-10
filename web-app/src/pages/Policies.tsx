import { useEffect, useState } from "react";
import type { Policy } from "../lib/types";
import { api, ApiError } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { useOrg } from "../lib/OrgContext";
import { useToast } from "../lib/toast";

const EMPTY_FORM = {
  policyholder_name: "",
  policy_number: "",
  coverage_type: "auto",
  limit: "",
  deductible: "",
  expiration_date: "",
};

export function Policies() {
  const { orgs, activeOrgId } = useOrg();
  const showToast = useToast();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api
      .listPolicies(activeOrgId !== "all" ? activeOrgId : undefined)
      .then(setPolicies)
      .catch(() => setPolicies([]));
  };

  useEffect(refresh, [activeOrgId]);

  const submit = async () => {
    const orgId = activeOrgId !== "all" ? activeOrgId : orgs[0]?.id;
    if (!form.policyholder_name || !form.policy_number || !orgId) {
      setError("Policyholder name and policy number are required.");
      return;
    }
    setError(null);
    try {
      await api.createPolicy({
        org_id: orgId,
        policy_number: form.policy_number,
        policyholder_name: form.policyholder_name,
        coverage_type: form.coverage_type,
        coverage_limit_cents: Math.round(parseFloat(form.limit || "0") * 100),
        deductible_cents: Math.round(parseFloat(form.deductible || "0") * 100),
        effective_date: new Date().toISOString().slice(0, 10),
        expiration_date: form.expiration_date || "2028-01-01",
      });
      showToast("Policy added to the book.");
      setShowForm(false);
      setForm(EMPTY_FORM);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create policy");
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-5.5 flex items-end justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Policy book</div>
          <div className="mt-1 text-[13.5px] text-[rgb(20_23_26_/_0.55)]">
            {policies.length} polic{policies.length === 1 ? "y" : "ies"} on file · every claim is checked
            against this book
          </div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-[var(--color-ink)] px-4 py-2.5 text-[12.5px] font-semibold text-white"
        >
          {showForm ? "Cancel" : "+ Add policy"}
        </button>
      </div>

      {showForm && (
        <div className="mb-5.5 grid grid-cols-3 gap-3.5 rounded-[10px] border border-[var(--color-line-strong)] bg-white p-5">
          <FormField label="POLICYHOLDER NAME">
            <input
              value={form.policyholder_name}
              onChange={(e) => setForm({ ...form, policyholder_name: e.target.value })}
              className="w-full rounded-[7px] border border-[var(--color-line-strong)] px-2.5 py-2 text-[12.5px]"
            />
          </FormField>
          <FormField label="POLICY NUMBER">
            <input
              value={form.policy_number}
              onChange={(e) => setForm({ ...form, policy_number: e.target.value })}
              placeholder="POL-10200-AX"
              className="w-full rounded-[7px] border border-[var(--color-line-strong)] px-2.5 py-2 text-[12.5px]"
            />
          </FormField>
          <FormField label="COVERAGE TYPE">
            <select
              value={form.coverage_type}
              onChange={(e) => setForm({ ...form, coverage_type: e.target.value })}
              className="w-full rounded-[7px] border border-[var(--color-line-strong)] px-2.5 py-2 text-[12.5px]"
            >
              {["auto", "home", "health", "life", "property"].map((t) => (
                <option key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="COVERAGE LIMIT ($)">
            <input
              type="number"
              value={form.limit}
              onChange={(e) => setForm({ ...form, limit: e.target.value })}
              className="w-full rounded-[7px] border border-[var(--color-line-strong)] px-2.5 py-2 text-[12.5px]"
            />
          </FormField>
          <FormField label="DEDUCTIBLE ($)">
            <input
              type="number"
              value={form.deductible}
              onChange={(e) => setForm({ ...form, deductible: e.target.value })}
              className="w-full rounded-[7px] border border-[var(--color-line-strong)] px-2.5 py-2 text-[12.5px]"
            />
          </FormField>
          <FormField label="EXPIRATION DATE">
            <input
              type="date"
              value={form.expiration_date}
              onChange={(e) => setForm({ ...form, expiration_date: e.target.value })}
              className="w-full rounded-[7px] border border-[var(--color-line-strong)] px-2.5 py-2 text-[12.5px]"
            />
          </FormField>
          <div className="col-span-3 flex items-center gap-2.5">
            <button
              onClick={submit}
              className="rounded-[7px] bg-[var(--color-accent)] px-4 py-2.5 text-[12.5px] font-semibold text-white"
            >
              Add policy
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-[7px] border border-[var(--color-line-strong)] px-4 py-2.5 text-[12.5px] font-semibold text-[var(--color-ink)]"
            >
              Cancel
            </button>
            {error && <p className="text-xs text-[var(--color-status-denied)]">{error}</p>}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white">
        <div className="grid grid-cols-[1.3fr_0.9fr_1fr_1fr_1fr_0.8fr] border-b border-[var(--color-line)] px-4.5 py-2.5 text-[10px] font-bold tracking-[0.06em] text-[rgb(20_23_26_/_0.4)]">
          <div>POLICYHOLDER / NUMBER</div>
          <div>TYPE</div>
          <div>LIMIT</div>
          <div>DEDUCTIBLE</div>
          <div>EXPIRES</div>
          <div>STATUS</div>
        </div>
        {policies.map((p) => (
          <div
            key={p.id}
            className="grid grid-cols-[1.3fr_0.9fr_1fr_1fr_1fr_0.8fr] items-center border-b border-[var(--color-line-soft)] px-4.5 py-3.5 last:border-0"
          >
            <div>
              <div className="text-[13px] font-semibold text-[var(--color-ink)]">{p.policyholder_name}</div>
              <div className="font-mono text-[11px] text-[rgb(20_23_26_/_0.45)]">{p.policy_number}</div>
            </div>
            <div className="text-xs capitalize text-[rgb(20_23_26_/_0.6)]">{p.coverage_type}</div>
            <div className="text-xs font-semibold text-[var(--color-ink)]">
              {fmtMoney(p.coverage_limit_cents)}
            </div>
            <div className="text-xs text-[rgb(20_23_26_/_0.6)]">{fmtMoney(p.deductible_cents)}</div>
            <div className="text-xs text-[rgb(20_23_26_/_0.6)]">{fmtDate(p.expiration_date)}</div>
            <div className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: p.status === "active" ? "var(--color-accent)" : "var(--color-status-denied)" }}
              />
              <span
                className="text-[11.5px] font-semibold capitalize"
                style={{ color: p.status === "active" ? "var(--color-accent)" : "var(--color-status-denied)" }}
              >
                {p.status}
              </span>
            </div>
          </div>
        ))}
        {policies.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-[rgb(20_23_26_/_0.4)]">
            No policies on file yet.
          </div>
        )}
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10.5px] font-semibold text-[rgb(20_23_26_/_0.45)]">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
