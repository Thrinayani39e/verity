#!/usr/bin/env bash
# Agent-facing preflight check: is the cluster healthy enough to accept a
# large batch write (e.g. a bulk document ingestion job)? Called by
# src/verity/cluster_ops.py::preflight_health_check before ingest_document
# runs on a large batch, and safe to run manually at any time.
#
# Uses `ccloud cluster info`, per the documented ccloud CLI command list
# (https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-reference).
#
# Prints a single JSON object to stdout: {"healthy": true|false, "status": "...", "cluster_id": "..."}
# Exits non-zero if the cluster is not in a healthy/ready state.
set -euo pipefail

CLUSTER_ID="${CLUSTER_ID:?Set CLUSTER_ID to the target cluster ID}"

RAW=$(ccloud cluster info "${CLUSTER_ID}" --output json)
STATUS=$(echo "${RAW}" | jq -r '.state // .status // "UNKNOWN"')

if [[ "${STATUS}" == "CREATED" || "${STATUS}" == "READY" || "${STATUS}" == "ACTIVE" ]]; then
    echo "{\"healthy\": true, \"status\": \"${STATUS}\", \"cluster_id\": \"${CLUSTER_ID}\"}"
    exit 0
else
    echo "{\"healthy\": false, \"status\": \"${STATUS}\", \"cluster_id\": \"${CLUSTER_ID}\"}"
    exit 1
fi
