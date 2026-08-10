let apiBase = localStorage.getItem("verity_api_base") || document.getElementById("apiBase").value;
document.getElementById("apiBase").value = apiBase;

const healthBadge = document.getElementById("healthStatus");

async function api(path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return body;
}

async function checkHealth() {
  try {
    await api("/health");
    healthBadge.textContent = "connected";
    healthBadge.className = "badge ok";
  } catch (err) {
    healthBadge.textContent = "unreachable";
    healthBadge.className = "badge fail";
  }
}

document.getElementById("saveApiBase").addEventListener("click", () => {
  apiBase = document.getElementById("apiBase").value.replace(/\/$/, "");
  localStorage.setItem("verity_api_base", apiBase);
  checkHealth();
});

document.getElementById("claimForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const body = {
    org_id: form.get("org_id"),
    claimant_name: form.get("claimant_name"),
    policy_number: form.get("policy_number"),
    description: form.get("description"),
    amount_cents: Number(form.get("amount_cents")),
  };
  const resultEl = document.getElementById("claimResult");
  try {
    const result = await api("/claims", { method: "POST", body: JSON.stringify(body) });
    resultEl.textContent = JSON.stringify(result, null, 2);
    e.target.reset();
    loadClaims();
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
});

async function loadClaims() {
  const tbody = document.querySelector("#claimsTable tbody");
  tbody.innerHTML = "<tr><td colspan='5'>Loading...</td></tr>";
  try {
    const claims = await api("/claims");
    tbody.innerHTML = "";
    for (const claim of claims) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td title="${claim.id}">${claim.id.slice(0, 8)}...</td>
        <td>${claim.claimant_name}</td>
        <td>$${(claim.amount_cents / 100).toFixed(2)}</td>
        <td>${claim.status}</td>
        <td></td>
      `;
      const actionCell = tr.querySelector("td:last-child");
      if (claim.status === "pending") {
        const btn = document.createElement("button");
        btn.textContent = "Claim + process";
        btn.addEventListener("click", () => processClaim(claim.id));
        actionCell.appendChild(btn);
      }
      tbody.appendChild(tr);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${err.message}</td></tr>`;
  }
}

async function processClaim(claimId) {
  const agentId = document.getElementById("agentId").value || crypto.randomUUID();
  document.getElementById("agentId").value = agentId;
  try {
    await api(`/claims/${claimId}/claim`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    });
    const result = await api(`/claims/${claimId}/process`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    });
    document.getElementById("decisionResult").textContent = JSON.stringify(result, null, 2);
    document.getElementById("decisionId").value = result.decision_id;
    loadClaims();
  } catch (err) {
    alert(`Processing failed: ${err.message}`);
  }
}

document.getElementById("refreshClaims").addEventListener("click", loadClaims);

document.getElementById("loadDecision").addEventListener("click", async () => {
  const id = document.getElementById("decisionId").value;
  const resultEl = document.getElementById("decisionResult");
  try {
    resultEl.textContent = JSON.stringify(await api(`/decisions/${id}`), null, 2);
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
});

document.getElementById("replayDecision").addEventListener("click", async () => {
  const id = document.getElementById("decisionId").value;
  const resultEl = document.getElementById("decisionResult");
  try {
    resultEl.textContent = JSON.stringify(await api(`/decisions/${id}/replay`), null, 2);
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
});

document.getElementById("checkDoubleClaims").addEventListener("click", async () => {
  const resultEl = document.getElementById("doubleClaimsResult");
  try {
    const result = await api("/audit/double-claims-check");
    resultEl.textContent = result.violations.length === 0
      ? "PASS — zero claims were ever double-claimed."
      : `FAIL — violations found: ${JSON.stringify(result.violations, null, 2)}`;
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
});

checkHealth();
loadClaims();
