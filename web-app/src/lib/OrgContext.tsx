import { createContext, useContext, useEffect, useState } from "react";
import type { Organization } from "./types";
import { api } from "./api";

interface OrgContextValue {
  orgs: Organization[];
  activeOrgId: string; // "all" or a real org id
  setActiveOrgId: (id: string) => void;
  refreshOrgs: () => void;
}

const OrgContext = createContext<OrgContextValue>({
  orgs: [],
  activeOrgId: "all",
  setActiveOrgId: () => {},
  refreshOrgs: () => {},
});

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState("all");

  const refreshOrgs = () => {
    api.listOrganizations().then(setOrgs).catch(() => setOrgs([]));
  };

  useEffect(() => {
    refreshOrgs();
  }, []);

  return (
    <OrgContext.Provider value={{ orgs, activeOrgId, setActiveOrgId, refreshOrgs }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  return useContext(OrgContext);
}
