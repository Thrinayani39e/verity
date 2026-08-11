"""Seed a realistic, populated demo dataset: multiple organizations, a real
policy book spanning coverage types (including one expired policy), and
claims covering the full status spread (submitted, processing, paid,
denied, flagged-awaiting-review) - so every screen in the app has real
content the moment someone opens it, rather than a wall of zeros.

Calls Bedrock for real (embeddings + Claude decisions), so this takes a few
minutes to run and makes real, small AWS charges. Safe to re-run - it always
starts by wiping existing demo tables first.

Usage: python scripts/seed_demo_data.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from verity.claims_engine import (
    claim_next_pending,
    process_claim,
    review_claim,
    submit_claim,
)
from verity.db import read_only_connection, run_in_transaction
from verity.ingestion import upload_and_ingest_document

ORGS = ["Meridian Mutual", "Coastal Assurance"]

POLICIES = [
    # (org_index, policy_number, policyholder, coverage_type, limit_cents, deductible_cents, effective, expiration)
    (0, "POL-20101-AX", "Dana Ferro", "auto", 3_000_000, 50_000, "2024-01-15", "2028-01-15"),
    (0, "POL-20102-HM", "Marcus Whitfield", "home", 45_000_000, 250_000, "2023-06-01", "2027-06-01"),
    (0, "POL-20103-LF", "Louis Okafor", "life", 25_000_000, 0, "2020-03-10", "2030-03-10"),
    (1, "POL-20201-HL", "Priya Anand", "health", 10_000_000, 150_000, "2024-01-01", "2025-01-01"),  # expired
    (1, "POL-20202-PR", "Renata Silva", "property", 8_000_000, 500_000, "2024-09-01", "2028-09-01"),
    (1, "POL-20203-AX", "Tom Bracken", "auto", 2_500_000, 75_000, "2025-02-01", "2028-02-01"),
]

# (org_index, claimant, policy_number, description, amount_cents, action)
# action: "process" = claim + process now, "claim_only" = claim but leave
# unprocessed (shows as "Processing"), "leave_pending" = submit only.
CLAIMS = [
    (0, "Dana Ferro", "POL-20101-AX",
     "Rear-ended at a stoplight; bumper and trunk damage.", 285_000, "process"),
    (0, "Marcus Whitfield", "POL-20102-HM",
     "Burst pipe in upstairs bathroom flooded the kitchen ceiling.", 1_840_000, "process"),
    (1, "Tom Bracken", "POL-20203-AX",
     "Windshield cracked by highway debris.", 168_000, "process"),
    (1, "Renata Silva", "POL-20202-PR",
     "Warehouse roof collapse after a storm; inventory loss.", 4_200_000, "process"),
    (1, "Priya Anand", "POL-20201-HL",
     "Emergency appendectomy and a two-night hospital stay.", 920_000, "process"),
    (0, "Dana Ferro", "POL-20101-AX",
     "Minor fender bender in a parking lot, other driver at fault, no injuries.", 154_000, "process"),
    (1, "Tom Bracken", "POL-20203-AX",
     "Deer collision on a rural highway, front-end damage.", 610_000, "process"),
    (0, "Louis Okafor", "POL-20103-LF",
     ("Accidental death benefit claim filed by beneficiary. Beneficiary designation "
      "was updated 11 days before the date of death."), 25_000_000, "process_leave_flagged"),
    (0, "Rosalind Achebe", "POL-20101-AX",
     ("Multi-vehicle collision claim exceeding the standard auto threshold. Claimant "
      "has two prior approved claims in the past 12 months."), 240_000, "process_review_approve"),
    (1, "Yuki Tanaka", "POL-99201-XX",
     "Bicycle collision claimed under an unlisted auto policy.", 78_000, "process"),
    # "leave_pending" claims must come after every "process"/"claim_only" entry
    # above: claim_next_pending() always grabs the OLDEST pending claim
    # cluster-wide, so any claim left pending here would get grabbed by a
    # later claim_only/process call instead of the claim just submitted.
    (1, "Rafael Cuevas", "POL-20203-AX",
     "Physical therapy sessions for a workplace back injury.", 415_000, "claim_only"),
    (0, "Marcus Whitfield", "POL-20102-HM",
     "Attic fire from faulty wiring, extensive smoke damage throughout the second floor.",
     6_200_000, "leave_pending"),
    (1, "Layla Haddad", "POL-99203-XX",
     "Jewelry theft claim filed under home policy, no police report yet.", 89_000, "leave_pending"),
]

SAMPLE_DOCUMENT = (
    "POLICE REPORT SUMMARY\n\n"
    "Incident confirmed as described by claimant. Responding officer noted rear-end "
    "collision at intersection, no injuries requiring transport, other driver cited "
    "for following too closely. Two independent witness statements corroborate the "
    "account.\n"
)


def _reset_demo_tables() -> None:
    def _run(conn):
        with conn.cursor() as cur:
            for table in (
                "reviews", "payouts", "decisions", "claim_embeddings",
                "documents", "claim_events", "claims", "policies", "agents", "organizations",
            ):
                cur.execute(f"DELETE FROM {table}")

    run_in_transaction(_run)
    print("Cleared existing demo data.")


def _create_orgs_and_agents() -> tuple[list[str], list[str]]:
    def _run(conn):
        org_ids = []
        with conn.cursor() as cur:
            for name in ORGS:
                cur.execute("INSERT INTO organizations (name) VALUES (%s) RETURNING id", (name,))
                org_ids.append(str(cur.fetchone()[0]))

            agent_ids = []
            for i in range(5):
                org_id = org_ids[i % len(org_ids)]
                cur.execute(
                    "INSERT INTO agents (org_id, name, kind) VALUES (%s, %s, 'claims_worker') RETURNING id",
                    (org_id, f"seed-agent-{i}"),
                )
                agent_ids.append(str(cur.fetchone()[0]))
        return org_ids, agent_ids

    return run_in_transaction(_run)


def _create_policies(org_ids: list[str]) -> None:
    def _run(conn):
        with conn.cursor() as cur:
            for org_idx, number, holder, ctype, limit, deductible, eff, exp in POLICIES:
                cur.execute(
                    """
                    INSERT INTO policies
                        (org_id, policy_number, policyholder_name, coverage_type,
                         coverage_limit_cents, deductible_cents, effective_date, expiration_date)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (org_ids[org_idx], number, holder, ctype, limit, deductible, eff, exp),
                )

    run_in_transaction(_run)
    print(f"Seeded {len(POLICIES)} policies.")


def main() -> None:
    _reset_demo_tables()
    org_ids, agent_ids = _create_orgs_and_agents()
    print(f"Created organizations: {dict(zip(ORGS, org_ids))}")
    _create_policies(org_ids)

    agent_cycle = 0
    first_claim_id = None

    for org_idx, claimant, policy_number, description, amount_cents, action in CLAIMS:
        claim_id = submit_claim(
            org_id=org_ids[org_idx],
            claimant_name=claimant,
            policy_number=policy_number,
            description=description,
            amount_cents=amount_cents,
        )
        first_claim_id = first_claim_id or claim_id
        print(f"Submitted {claim_id[:8]} ({claimant}, ${amount_cents / 100:,.2f}) [{action}]")

        if action == "leave_pending":
            continue

        agent_id = agent_ids[agent_cycle % len(agent_ids)]
        agent_cycle += 1
        claimed = claim_next_pending(agent_id)
        assert claimed == claim_id, "seed script assumes single-threaded sequential processing"

        if action == "claim_only":
            continue

        result = process_claim(claim_id, agent_id)
        print(f"  -> {result['decision']}: {result['rationale'][:90]}...")

        if action == "process_review_approve" and result["decision"] == "flag":
            review_result = review_claim(
                claim_id=claim_id,
                decision_id=result["decision_id"],
                reviewer_name="M. Alvarez, Senior Adjuster",
                outcome="approve",
                notes=(
                    "Reviewed police report, third-party witness statements, and repair "
                    "estimates. Damage pattern is consistent with the reported collision. "
                    "Approving with standard deductible applied; no indication of fraud."
                ),
            )
            print(f"  -> human review: approved, payout {review_result.get('payout_id')}")

    # Attach a real document to the first processed claim to demo ingestion.
    if first_claim_id:
        doc_id = upload_and_ingest_document(
            claim_id=first_claim_id,
            filename="police_report.txt",
            content=SAMPLE_DOCUMENT.encode("utf-8"),
        )
        print(f"Attached sample document {doc_id[:8]} to claim {first_claim_id[:8]}.")

    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, count(*) FROM claims GROUP BY status ORDER BY status")
        counts = cur.fetchall()

    print("\nFinal claim status counts:")
    for status, count in counts:
        print(f"  {status}: {count}")

    print("\nOrganizations:")
    for name, org_id in zip(ORGS, org_ids):
        print(f"  {name}: {org_id}")


if __name__ == "__main__":
    main()
