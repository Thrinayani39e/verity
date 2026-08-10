#!/usr/bin/env bash
# Provision the CockroachDB Cloud cluster Verity runs against.
#
# Verified directly against `ccloud --help` / `ccloud cluster --help` output
# on ccloud CLI v0.6.12 (the publicly downloadable build at the time of
# writing - https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-reference
# documents a larger command set, including `service-account` and `backup`
# subcommands, that is NOT present in this binary; if a newer CLI version
# ships those, prefer them over the Console-UI fallbacks noted below).
#
# Prerequisites: `ccloud auth login` has been run once interactively.
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-verity-hackathon}"
SQL_USER="${SQL_USER:-verity_app}"
REGION="${REGION:-us-east-1}"

echo "==> Fastest path for first-time setup: run 'ccloud quickstart' interactively instead."
echo "    The steps below are the scriptable equivalent."
echo

echo "==> Creating serverless cluster: ${CLUSTER_NAME}"
ccloud cluster create serverless "${CLUSTER_NAME}" "${REGION}" \
    --cloud AWS \
    --primary-region "${REGION}" \
    --spend-limit 15 \
    --wait \
    --output json

echo "==> Creating SQL user: ${SQL_USER}"
SQL_PASSWORD=$(openssl rand -base64 24)
ccloud cluster user create "${CLUSTER_NAME}" "${SQL_USER}" -p "${SQL_PASSWORD}" --output json
echo "    (generated password, save it now - it will not be shown again: ${SQL_PASSWORD})"

echo "==> Fetching connection string"
ccloud cluster sql "${CLUSTER_NAME}" --connection-url -u "${SQL_USER}" -p "${SQL_PASSWORD}"

echo
echo "Next steps:"
echo "  1. Set the printed connection string as DATABASE_URL in .env"
echo "  2. Run: psql \"\$DATABASE_URL\" -f db/schema.sql"
echo "  3. Enable the Managed MCP Server from the Cloud Console (Cluster ->"
echo "     Connect -> MCP integration) - it generates a ready-to-use config"
echo "     with OAuth auth built in, no API key needed for interactive use."
echo "     See ops/mcp/mcp_config_example.json."
echo "  4. This CLI build has no 'service-account' command; if you need a"
echo "     service-account API key for headless/automated MCP or API access,"
echo "     create one via the Cloud Console's Service Accounts page instead."
