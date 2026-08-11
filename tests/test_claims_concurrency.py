"""Integration test for the core concurrency-safety guarantee.

Requires a live CockroachDB connection (DATABASE_URL) with db/schema.sql
applied, AND AWS/Bedrock credentials: submit_claim embeds each claim's
description via store_embedding on the way in, so even though
claim_next_pending itself never touches Bedrock, seeding the claims this
test races over does.

Run: DATABASE_URL=... pytest tests/test_claims_concurrency.py
"""

import os
import sys
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))


def _has_aws_credentials() -> bool:
    try:
        return boto3.Session().get_credentials() is not None
    except Exception:
        return False


pytestmark = [
    pytest.mark.skipif(
        not os.environ.get("DATABASE_URL"),
        reason="requires a live CockroachDB connection (DATABASE_URL)",
    ),
    pytest.mark.skipif(
        not _has_aws_credentials(),
        reason="requires AWS/Bedrock credentials (submit_claim embeds via Bedrock)",
    ),
]


@pytest.fixture
def org_id():
    from verity.db import run_in_transaction

    def _run(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO organizations (name) VALUES ('pytest-org') RETURNING id"
            )
            return str(cur.fetchone()[0])

    return run_in_transaction(_run)


def test_concurrent_workers_never_double_claim(org_id):
    from verity.audit import check_no_double_claims
    from verity.claims_engine import claim_next_pending, submit_claim

    num_claims = 20
    num_workers = 8

    claim_ids = [
        submit_claim(
            org_id=org_id,
            claimant_name=f"pytest claimant {i}",
            policy_number=f"PYTEST-{i}",
            description=f"pytest concurrency claim {i}",
            amount_cents=1000,
        )
        for i in range(num_claims)
    ]

    def worker_loop(agent_id: str) -> list[str]:
        claimed = []
        while True:
            claim_id = claim_next_pending(agent_id)
            if claim_id is None or claim_id not in claim_ids:
                break
            claimed.append(claim_id)
        return claimed

    from verity.db import run_in_transaction

    agent_ids = [str(uuid.uuid4()) for _ in range(num_workers)]

    def _create_agents(conn):
        with conn.cursor() as cur:
            for agent_id in agent_ids:
                cur.execute(
                    "INSERT INTO agents (id, org_id, name, kind) VALUES (%s, %s, %s, 'claims_worker')",
                    (agent_id, org_id, f"pytest-worker-{agent_id[:8]}"),
                )

    run_in_transaction(_create_agents)

    all_claimed: list[str] = []
    with ThreadPoolExecutor(max_workers=num_workers) as pool:
        futures = [pool.submit(worker_loop, agent_id) for agent_id in agent_ids]
        for future in as_completed(futures):
            all_claimed.extend(future.result())

    counts = Counter(all_claimed)
    duplicates = {cid: n for cid, n in counts.items() if n > 1}
    assert duplicates == {}, f"claim(s) claimed more than once: {duplicates}"

    violations = [v for v in check_no_double_claims() if v["claim_id"] in claim_ids]
    assert violations == [], f"double_claims_check view reported violations: {violations}"
