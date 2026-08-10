"""Seed an organization, a handful of agents, and historical claims (including a
repeating fraud-pattern description) so vector search has something meaningful
to find. Run once against a fresh cluster before the other demo scripts.

Usage: python scripts/seed_demo_data.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from verity.claims_engine import submit_claim  # noqa: E402
from verity.db import read_only_connection, run_in_transaction  # noqa: E402

FRAUD_PATTERN_DESCRIPTIONS = [
    "Rear-ended at a red light on Elm Street, whiplash injury, no witnesses, "
    "requesting reimbursement for a chiropractor visit same day.",
    "Struck from behind while stopped at a traffic signal, neck pain, no "
    "witnesses present, saw a chiropractor within hours of the incident.",
]

NORMAL_DESCRIPTIONS = [
    "Windshield cracked by road debris on the highway, requesting glass replacement.",
    "Kitchen pipe burst causing water damage to flooring, plumber invoice attached.",
    "Laptop stolen from car during a break-in, police report filed.",
]


def _create_org_and_agent() -> tuple[str, str]:
    def _run(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO organizations (name) VALUES ('Demo Insurance Co') RETURNING id"
            )
            org_id = str(cur.fetchone()[0])
            cur.execute(
                "INSERT INTO agents (org_id, name, kind) VALUES (%s, 'seed-agent', 'claims_worker') RETURNING id",
                (org_id,),
            )
            agent_id = str(cur.fetchone()[0])
        return org_id, agent_id

    return run_in_transaction(_run)


def main() -> None:
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM organizations LIMIT 1")
        existing = cur.fetchone()

    if existing:
        org_id = str(existing[0])
        print(f"Using existing organization {org_id}")
        with read_only_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM agents WHERE org_id = %s LIMIT 1", (org_id,))
            agent_row = cur.fetchone()
        agent_id = str(agent_row[0]) if agent_row else None
    else:
        org_id, agent_id = _create_org_and_agent()
        print(f"Created organization {org_id} and agent {agent_id}")

    descriptions = FRAUD_PATTERN_DESCRIPTIONS + NORMAL_DESCRIPTIONS
    for i, description in enumerate(descriptions):
        claim_id = submit_claim(
            org_id=org_id,
            claimant_name=f"Historical Claimant {i}",
            policy_number=f"POL-{1000 + i}",
            description=description,
            amount_cents=150000 + i * 5000,
        )
        print(f"Seeded historical claim {claim_id}: {description[:60]}...")

    print("\nSave these for the other demo scripts:")
    print(f"  ORG_ID={org_id}")
    print(f"  AGENT_ID={agent_id}")


if __name__ == "__main__":
    main()
