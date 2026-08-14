import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { ClaimDetail } from "./pages/ClaimDetail";
import { PrecedentSearch } from "./pages/PrecedentSearch";
import { FraudRingPage } from "./pages/FraudRing";
import { Policies } from "./pages/Policies";
import { ReviewQueue } from "./pages/ReviewQueue";
import { AuditLog } from "./pages/AuditLog";
import { Analytics } from "./pages/Analytics";
import { SystemHealth } from "./pages/SystemHealth";
import { OrgProvider } from "./lib/OrgContext";
import { ToastProvider } from "./lib/toast";

function App() {
  return (
    <ToastProvider>
      <OrgProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="claims/:claimId" element={<ClaimDetail />} />
              <Route path="search" element={<PrecedentSearch />} />
              <Route path="fraud-rings" element={<FraudRingPage />} />
              <Route path="policies" element={<Policies />} />
              <Route path="reviews" element={<ReviewQueue />} />
              <Route path="audit" element={<AuditLog />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="system" element={<SystemHealth />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </OrgProvider>
    </ToastProvider>
  );
}

export default App;
