"""Adds a synthetic fraud ring on top of the existing demo data, without
wiping anything else - seed_demo_data.py resets the whole dataset; this
script only touches its own fixed set of claimant names, so it's safe to run
after it (or standalone against an already-seeded database) and safe to
re-run (it deletes its own prior claims first, so re-running doesn't create
duplicates).

Two direct rings plus one deliberate bridge, so /fraud-rings has a real
transitive case to find, not just two clean single-attribute clusters:
  - Harlan, Denise, and Marcus share one bank account
  - Denise ALSO shares an address with Talia - a claim that shares nothing
    directly with Harlan or Marcus still ends up in the same ring, because
    Denise bridges the two attributes. That's the case a single GROUP BY
    can't find and fraud_ring.py's connected-components logic can.
  - Priya, Owen, and Sofia share a separate address and stay a separate,
    unconnected ring - proving the graph doesn't just merge everything.

Every claimant name and identifier here is fictional. Calls Bedrock for
real (embeddings), same as seed_demo_data.py.

Usage: python scripts/seed_fraud_ring.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from verity.claims_engine import submit_claim
from verity.db import read_only_connection, run_in_transaction

RING_BANK_ACCOUNT = "9284"
BRIDGE_ADDRESS = "204 Larkspur Court, Unit 2"
SEPARATE_ADDRESS = "482 Birchwood Lane, Unit 3, Millbrook"

# (claimant, policy_number, description, amount_cents, bank_account_last4, claimant_address)
RING_CLAIMS = [
    ("Harlan Voss", "POL-20101-AX",
     "Rear bumper dented backing out of a parking space, no other vehicle involved.",
     287_000, RING_BANK_ACCOUNT, None),
    ("Denise Okonkwo", "POL-20203-AX",
     "Side mirror snapped off by a passing truck on a narrow street.",
     291_000, RING_BANK_ACCOUNT, BRIDGE_ADDRESS),
    ("Marcus Feld", "POL-20101-AX",
     "Windshield chipped by gravel kicked up on the interstate.",
     279_500, RING_BANK_ACCOUNT, None),
    ("Talia Reyes", "POL-20203-AX",
     "Kitchen fire scorched the cabinets above the stove.",
     305_000, None, BRIDGE_ADDRESS),
    ("Priya Chandrasekaran", "POL-20102-HM",
     "Basement flooding after a heavy rainstorm damaged stored furniture.",
     640_000, None, SEPARATE_ADDRESS),
    ("Owen Vasquez", "POL-20202-PR",
     "Storm damage to a detached garden shed roof.",
     615_000, None, SEPARATE_ADDRESS),
    ("Sofia Almeida", "POL-20102-HM",
     "Wind damage tore shingles off the back slope of the roof.",
     628_000, None, SEPARATE_ADDRESS),
]

_RING_CLAIMANT_NAMES = [c[0] for c in RING_CLAIMS]


def _delete_existing_ring_claims() -> None:
    """Makes this script safe to re-run: removes any claims (and their
    dependent rows) from a previous run of this exact script, identified by
    its fixed, fictional claimant names - never touches anything from
    seed_demo_data.py's dataset."""

    def _run(conn):
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM claims WHERE claimant_name = ANY(%s)",
                (_RING_CLAIMANT_NAMES,),
            )
            claim_ids = [str(r[0]) for r in cur.fetchall()]
            if not claim_ids:
                return
            for table in ("claim_embeddings", "claim_events", "documents"):
                cur.execute(f"DELETE FROM {table} WHERE claim_id = ANY(%s)", (claim_ids,))
            cur.execute("DELETE FROM claims WHERE id = ANY(%s)", (claim_ids,))

    run_in_transaction(_run)


def _first_org_id() -> str:
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM organizations ORDER BY created_at LIMIT 1")
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("No organizations found - run scripts/seed_demo_data.py first")
        return str(row[0])


def main() -> None:
    _delete_existing_ring_claims()
    org_id = _first_org_id()

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
        f"\nSeeded {len(RING_CLAIMS)} claims: a 4-claim ring bridged across bank "
        "account + address, and a separate 3-claim address-only ring."
    )


if __name__ == "__main__":
    main()
