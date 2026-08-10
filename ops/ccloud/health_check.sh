#!/usr/bin/env bash
# Agent-facing preflight check: is the cluster healthy enough to accept a
# large batch write (e.g. a bulk document ingestion job)? Called by
# src/verity/cluster_ops.py::preflight_health_check before ingest_document
# runs on a large batch, and safe to run manually at any time.
#
# Uses `ccloud cluster info <cluster name>` - verified directly against this
# machine's installed ccloud CLI (v0.6.12), which takes the cluster's NAME,
# not its UUID (some ccloud docs/examples use the id; this build does not).
#
# Usage: health_check.sh <cluster_name>
# Prints a single JSON object to stdout: {"healthy": true|false, "status": "...", "cluster_name": "..."}
# Exits non-zero if the cluster is not in a healthy/ready state.
set -euo pipefail

CLUSTER_NAME="${1:?Usage: health_check.sh <cluster_name>}"

RAW=$(ccloud cluster info "${CLUSTER_NAME}" --output json --quiet)
STATUS=$(echo "${RAW}" | jq -r '.state // "UNKNOWN"')

if [[ "${STATUS}" == "CREATED" || "${STATUS}" == "READY" || "${STATUS}" == "ACTIVE" ]]; then
    echo "{\"healthy\": true, \"status\": \"${STATUS}\", \"cluster_name\": \"${CLUSTER_NAME}\"}"
    exit 0
else
    echo "{\"healthy\": false, \"status\": \"${STATUS}\", \"cluster_name\": \"${CLUSTER_NAME}\"}"
    exit 1
fi
