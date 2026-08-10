#!/usr/bin/env bash
# Reports recent backups / point-in-time-recovery coverage for the cluster.
# This is the infra-level half of Verity's compliance story: AS OF SYSTEM
# TIME (see src/verity/audit.py) reconstructs memory within the GC window;
# backups extend recoverability beyond it. Run this before widening the GC
# TTL or relying on long-range historical replay for an audit.
#
# Uses `ccloud cluster backup list` / `backup config get`, per the documented
# ccloud CLI command list (https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-reference).
set -euo pipefail

CLUSTER_ID="${CLUSTER_ID:?Set CLUSTER_ID to the target cluster ID}"

echo "==> Backup list for cluster ${CLUSTER_ID}"
ccloud cluster backup list --cluster "${CLUSTER_ID}" --output json

echo "==> Backup / PITR configuration for cluster ${CLUSTER_ID}"
ccloud cluster backup config get --cluster "${CLUSTER_ID}" --output json
