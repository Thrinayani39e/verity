import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useOrg } from "../lib/OrgContext";
import { SubmitClaimModal } from "./SubmitClaimModal";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/search", label: "Precedent Search" },
  { to: "/policies", label: "Policies" },
  { to: "/reviews", label: "Review Queue" },
  { to: "/audit", label: "Audit Log" },
  { to: "/analytics", label: "Analytics" },
  { to: "/system", label: "System & Ops" },
];

function navLinkStyle(isActive: boolean) {
  return {
    background: isActive ? "rgb(20 23 26 / 0.07)" : "transparent",
    color: isActive ? "var(--color-ink)" : "rgb(20 23 26 / 0.55)",
    borderLeft: `2px solid ${isActive ? "var(--color-accent)" : "transparent"}`,
  };
}

export function Layout() {
  const { orgs, activeOrgId, setActiveOrgId } = useOrg();
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [showSubmit, setShowSubmit] = useState(false);
  const location = useLocation();

  const refreshPendingCount = () => {
    api
      .listClaims("flagged")
      .then((claims) => setPendingReviewCount(claims.length))
      .catch(() => {});
  };

  useEffect(() => {
    refreshPendingCount();
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)] font-sans text-[var(--color-ink)]">
      <div className="sticky top-0 flex h-screen w-[236px] flex-none flex-col overflow-y-auto border-r border-[var(--color-line)] bg-[var(--color-sidebar)] px-4 py-6">
        <div className="px-2 pb-5">
          <div className="text-[17px] font-bold tracking-tight text-[var(--color-ink)]">Verity</div>
          <div className="mt-0.5 text-[10px] font-semibold tracking-[0.09em] text-[rgb(20_23_26_/_0.4)]">
            CLAIMS INTELLIGENCE
          </div>
        </div>

        <div className="px-2 pb-4">
          <div className="mb-1.5 text-[10px] font-semibold tracking-[0.07em] text-[rgb(20_23_26_/_0.4)]">
            ORGANIZATION
          </div>
          <select
            value={activeOrgId}
            onChange={(e) => setActiveOrgId(e.target.value)}
            className="w-full rounded-[7px] border border-[var(--color-line-strong)] bg-white px-2.5 py-2 text-[12.5px] font-medium text-[var(--color-ink)]"
          >
            <option value="all">All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mx-2 mb-3 h-px bg-[var(--color-line)]" />

        <nav className="flex flex-1 flex-col gap-px">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium"
              style={({ isActive }) => navLinkStyle(isActive)}
            >
              <span>{item.label}</span>
              {item.to === "/reviews" && pendingReviewCount > 0 && (
                <span className="ml-auto rounded-full bg-[var(--color-status-flagged-dot)] px-1.5 py-px text-[10px] font-bold text-white">
                  {pendingReviewCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => setShowSubmit(true)}
          className="mx-2 mb-1.5 mt-3.5 rounded-lg bg-[var(--color-ink)] px-3.5 py-2.5 text-[13px] font-semibold text-white"
        >
          + New claim
        </button>
        <div className="px-2 text-[10.5px] text-[rgb(20_23_26_/_0.35)]">Verity v0.1 · hackathon build</div>
      </div>

      <div className="min-w-0 flex-1 px-[52px] pb-20 pt-11" style={{ maxWidth: 1180 }}>
        <Outlet context={{ refreshPendingCount }} />
      </div>

      {showSubmit && (
        <SubmitClaimModal
          onClose={() => setShowSubmit(false)}
          onSubmitted={() => {
            setShowSubmit(false);
            refreshPendingCount();
          }}
        />
      )}
    </div>
  );
}
