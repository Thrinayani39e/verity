"""Adds a synthetic fraud ring on top of the existing demo data, without
wiping anything - seed_demo_data.py resets the whole dataset; this script
only inserts new claims, so it's safe to run after it (or standalone against
an already-seeded database).

Two rings, two different shared attributes, so /fraud-rings has something
real to find:
  - three claims, three different claimant names, one shared bank account
  - three claims, three different claimant names, one shared address

Every claimant name and identifier here is fictional. Calls Bedrock for
real (embeddings), same as seed_demo_data.py.

Usage: python scripts/seed_fraud_ring.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from verity.claims_engine import submit_claim
from verity.db import read_only_connection

RING_BANK_ACCOUNT = "9284"
RING_ADDRESS = "482 Birchwood Lane, Unit 3, Millbrook"

# (claimant, policy_number, description, amount_cents, bank_account_last4, claimant_address)
RING_CLAIMS = [
    ("Harlan Voss", "POL-20101-AX",
     "Rear bumper dented backing out of a parking space, no other vehicle involved.",
     287_000, RING_BANK_ACCOUNT, None),
    ("Denise Okonkwo", "POL-20203-AX",
     "Side mirror snapped off by a passing truck on a narrow street.",
     291_000, RING_BANK_ACCOUNT, None),
    ("Marcus Feld", "POL-20101-AX",
     "Windshield chipped by gravel kicked up on the interstate.",
     279_500, RING_BANK_ACCOUNT, None),
    ("Priya Chandrasekaran", "POL-20102-HM",
     "Basement flooding after a heavy rainstorm damaged stored furniture.",
     640_000, None, RING_ADDRESS),
    ("Owen Vasquez", "POL-20202-PR",
     "Storm damage to a detached garden shed roof.",
     615_000, None, RING_ADDRESS),
    ("Sofia Almeida", "POL-20102-HM",
     "Wind damage tore shingles off the back slope of the roof.",
     628_000, None, RING_ADDRESS),
]


def _first_org_id() -> str:
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM organizations ORDER BY created_at LIMIT 1")
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("No organizations found - run scripts/seed_demo_data.py first")
        return str(row[0])


def _first_agent_id() -> str:
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM agents ORDER BY created_at LIMIT 1")
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("No agents found - run scripts/seed_demo_data.py first")
        return str(row[0])


def main() -> None:
    org_id = _first_org_id()
    agent_id = _first_agent_id()

    for claimant, policy_number, description, amount_cents, bank, address in RING_CLAIMS:
        claim_id = submit_claim(
            org_id=org_id,
            claimant_name=claimant,
            policy_number=policy_number,
            description=description,
            amount_cents=amount_cents,
            bank_account_last4=bank,
            claimant_address=address,
        )
        # Leave every ring claim in "pending" so the ring is visible before
        # any agent decision - claim_next_pending only grabs the single
        # oldest pending claim, so it's left alone here.
        print(f"Submitted ring claim {claim_id[:8]} ({claimant}, ${amount_cents / 100:,.2f})")

    print(
        f"\nSeeded a {len(RING_CLAIMS)}-claim fraud ring across two shared attributes "
        f"(bank account, address). agent_id available for manual processing: {agent_id[:8]}"
    )


if __name__ == "__main__":
    main()
