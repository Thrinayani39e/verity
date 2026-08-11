"""Prove the core concurrency-safety claim: fire many "agent" workers at a
shared pool of pending claims simultaneously, and show that every claim was
claimed by exactly one of them. This is the CockroachDB-specific guarantee a
single-writer chatbot design could never demonstrate.

Usage:
    python scripts/seed_demo_data.py          # once, to create an org
    python scripts/simulate_concurrent_claims.py --org-id <ORG_ID> --claims 30 --workers 12
"""

import argparse
import sys
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from verity.audit import check_no_double_claims
from verity.claims_engine import claim_next_pending, submit_claim
from verity.db import run_in_transaction


def _create_worker_agents(org_id: str, agent_ids: list[str]) -> None:
    """claims.claimed_by is a foreign key into agents, so each simulated worker
    needs a real row there before it can claim anything."""

    def _run(conn):
        with conn.cursor() as cur:
            for agent_id in agent_ids:
                cur.execute(
                    "INSERT INTO agents (id, org_id, name, kind) VALUES (%s, %s, %s, 'claims_worker')",
                    (agent_id, org_id, f"load-test-worker-{agent_id[:8]}"),
                )

    run_in_transaction(_run)


def _seed_pending_claims(org_id: str, count: int) -> list[str]:
    ids = []
    for i in range(count):
        claim_id = submit_claim(
            org_id=org_id,
            claimant_name=f"Load Test Claimant {i}",
            policy_number=f"POL-LOAD-{i}",
            description=f"Concurrency test claim #{i}: minor fender bender, no injuries.",
            amount_cents=50000,
        )
        ids.append(claim_id)
    return ids


def _worker_loop(agent_id: str) -> list[tuple[str, str]]:
    """Repeatedly claim until no pending claims remain. Returns (claim_id, agent_id) pairs."""
    claimed = []
    while True:
        claim_id = claim_next_pending(agent_id)
        if claim_id is None:
            break
        claimed.append((claim_id, agent_id))
    return claimed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--org-id", required=True)
    parser.add_argument("--claims", type=int, default=30)
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()

    print(f"Seeding {args.claims} pending claims...")
    _seed_pending_claims(args.org_id, args.claims)

    from verity.db import read_only_connection

    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM claims WHERE status = 'pending'")
        total_pending = cur.fetchone()[0]

    agent_ids = [str(uuid.uuid4()) for _ in range(args.workers)]
    _create_worker_agents(args.org_id, agent_ids)
    print(f"Launching {args.workers} concurrent worker agents to race for {total_pending} pending claim(s)...")

    all_claimed: list[tuple[str, str]] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(_worker_loop, agent_id) for agent_id in agent_ids]
        for future in as_completed(futures):
            all_claimed.extend(future.result())

    counts = Counter(claim_id for claim_id, _ in all_claimed)
    duplicates = {cid: n for cid, n in counts.items() if n > 1}

    print(f"\nTotal claims claimed: {len(all_claimed)} (expected {total_pending})")
    per_agent = Counter(agent_id for _, agent_id in all_claimed)
    for agent_id, n in per_agent.items():
        print(f"  agent {agent_id[:8]}... claimed {n} claim(s)")

    print("\nApplication-level duplicate check:", "FAIL" if duplicates else "PASS (no duplicates)")

    print("Database-level check (double_claims_check view):")
    violations = check_no_double_claims()
    print("  FAIL:" if violations else "  PASS - zero rows, no claim was ever double-claimed", violations if violations else "")


if __name__ == "__main__":
    main()
