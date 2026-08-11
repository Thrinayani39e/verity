"""AWS Lambda worker: claims one pending case and processes it, then exits.

Designed to be invoked on a short interval (e.g. every minute via EventBridge
Scheduler); if invocations ever overlap, claims_engine.claim_next_pending's
SERIALIZABLE-isolation retry loop is what makes that safe, not any Lambda
concurrency setting. Each invocation is a fresh, independent "agent"
identified by AGENT_ID (or a per-invocation UUID if unset).
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from verity import claims_engine

AGENT_ID = os.environ.get("AGENT_ID") or str(uuid.uuid4())


def handler(event, context):
    claim_id = claims_engine.claim_next_pending(AGENT_ID)
    if claim_id is None:
        return {"status": "idle", "message": "no pending claims"}

    result = claims_engine.process_claim(claim_id, AGENT_ID)
    return {"status": "processed", "claim_id": claim_id, **result}
