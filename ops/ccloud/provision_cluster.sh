#!/usr/bin/env bash
# Provision the CockroachDB Cloud cluster Verity runs against, plus a
# service account for agent-driven automation (used by the ccloud health
# check and, optionally, as the Managed MCP Server credential).
#
# Verified against the ccloud CLI's documented noun-verb command list
# (https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-reference) as of
# writing. Flags below are best-effort — run `ccloud <command> --help` to
# confirm exact flags for your installed CLI version before scripting this
# further; the reference page enumerates commands but not every flag.
#
# Prerequisites: `ccloud auth login` has been run once interactively.
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-verity-hackathon}"
SQL_USER="${SQL_USER:-verity_app}"

echo "==> Fastest path for first-time setup: run 'ccloud quickstart' interactively."
echo "    It creates a free cluster, a SQL user, and prints a connection string in one step."
echo "    The steps below are the equivalent non-interactive/scriptable path."
echo

echo "==> Creating cluster (free/basic plan): ${CLUSTER_NAME}"
ccloud cluster create basic "${CLUSTER_NAME}" --output json | tee /tmp/verity_cluster.json

CLUSTER_ID=$(jq -r '.id' /tmp/verity_cluster.json)
echo "==> Cluster ID: ${CLUSTER_ID}"

echo "==> Creating SQL user: ${SQL_USER}"
ccloud cluster user create "${SQL_USER}" --cluster "${CLUSTER_ID}" --output json

echo "==> Fetching connection string"
ccloud cluster sql --cluster "${CLUSTER_ID}" --connection-url --sql-user "${SQL_USER}" --output json

echo "==> Creating a service account for agent-driven ops (ccloud health checks, MCP key)"
ccloud service-account create "verity-agent" --output json | tee /tmp/verity_service_account.json
SERVICE_ACCOUNT_ID=$(jq -r '.id' /tmp/verity_service_account.json)
ccloud service-account api-key create --service-account "${SERVICE_ACCOUNT_ID}" --output json

echo
echo "Next steps:"
echo "  1. Set the printed connection string as DATABASE_URL in .env"
echo "  2. Run: psql \"\$DATABASE_URL\" -f db/schema.sql"
echo "  3. Enable the Managed MCP Server for this cluster from the Cloud Console"
echo "     (Cluster -> Connect -> MCP Server integration) and use the service"
echo "     account API key printed above as the Bearer token in"
echo "     ops/mcp/mcp_config_example.json (copy it to mcp_config.json first)."
echo "  4. Save CLUSTER_ID=${CLUSTER_ID} for health_check.sh / backup_status.sh."
