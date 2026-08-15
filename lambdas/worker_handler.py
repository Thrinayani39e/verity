"""AWS Lambda worker: claims one pending case and processes it, then exits.

Designed to be invoked on a short interval (e.g. every minute via EventBridge
Scheduler); if invocations ever overlap, claims_engine.claim_next_pending's
SERIALIZABLE-isolation retry loop is what makes that safe, not any Lambda
concurrency setting.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from verity import claims_engine
from verity.db import run_in_transaction

_agent_id: str | None = None


def _ensure_worker_agent() -> str | None:
    """Find-or-create a stable agent row for this worker to claim as.

    claims.claimed_by is a foreign key to agents(id), so a made-up or
    previously-set id that no longer exists (e.g. after the agents table
    gets reseeded) fails every single claim attempt with a
    ForeignKeyViolation - silently, since nothing surfaces a scheduled
    Lambda's errors unless someone is watching CloudWatch. Looked up once
    per warm container and cached, same pattern as the dashboard's
    POST /agents/ensure-default.
    """
    global _agent_id
    if _agent_id is not None:
        return _agent_id

    def _run(conn):
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM agents WHERE name = 'scheduled-worker' LIMIT 1")
            row = cur.fetchone()
            if row is not None:
                return str(row[0])
            cur.execute("SELECT id FROM organizations ORDER BY created_at LIMIT 1")
            org_row = cur.fetchone()
            if org_row is None:
                return None
            cur.execute(
                "INSERT INTO agents (org_id, name, kind) VALUES (%s, 'scheduled-worker', 'claims_worker') RETURNING id",
                (str(org_row[0]),),
            )
            return str(cur.fetchone()[0])

    _agent_id = run_in_transaction(_run)
    return _agent_id


def handler(event, context):
    agent_id = _ensure_worker_agent()
    if agent_id is None:
        return {"status": "idle", "message": "no organizations exist yet"}

    claim_id = claims_engine.claim_next_pending(agent_id)
    if claim_id is None:
        return {"status": "idle", "message": "no pending claims"}

    result = claims_engine.process_claim(claim_id, agent_id)
    return {"status": "processed", "claim_id": claim_id, **result}
