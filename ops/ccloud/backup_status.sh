#!/usr/bin/env bash
# Reports cluster info relevant to the compliance/audit story: AS OF SYSTEM
# TIME (see src/verity/audit.py) reconstructs memory within the cluster's GC
# window; backups extend recoverability beyond it.
#
# Note: ccloud CLI v0.6.12 (the publicly downloadable build at the time of
# writing) has no `backup` subcommand at all, despite one being documented
# at https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-reference - if
# a newer CLI ships `ccloud cluster backup list` / `backup config get`,
# prefer those. Until then, backup schedules and PITR configuration for a
# Serverless cluster are managed entirely from the Cloud Console's
# "Backup & Restore" page; this script surfaces what IS available via CLI
# (version/upgrade state) as a quick sanity check.
#
# Usage: backup_status.sh <cluster_name>
set -euo pipefail

CLUSTER_NAME="${1:?Usage: backup_status.sh <cluster_name>}"

echo "==> Cluster info for ${CLUSTER_NAME} (version/upgrade state relevant to backup compatibility)"
ccloud cluster info "${CLUSTER_NAME}" --output json --quiet | jq '{name, cockroach_version, upgrade_status, state}'

echo
echo "For actual backup schedule / PITR window / restore points, see:"
echo "  Cloud Console -> ${CLUSTER_NAME} -> Backup & Restore"
