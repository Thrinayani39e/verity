"""Demo the compliance story end-to-end:

  1. Submit a claim and have an agent decide on it (grounded in memory at time T1).
  2. Mutate the claim's data afterward (simulating new information arriving, or
     a data-quality fix) so the "current" state no longer matches what the
     agent saw.
  3. Replay the decision using AS OF SYSTEM TIME to reconstruct exactly what
     the agent's memory looked like at T1, and show it differs from "now".

Usage:
    python scripts/demo_time_travel.py --org-id <ORG_ID> --agent-id <AGENT_ID>
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from verity.audit import replay_decision  # noqa: E402
from verity.claims_engine import claim_next_pending, process_claim, submit_claim  # noqa: E402
from verity.db import run_in_transaction  # noqa: E402


def _mutate_claim(claim_id: str, new_description: str) -> None:
    def _run(conn):
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE claims SET description = %s, updated_at = now() WHERE id = %s",
                (new_description, claim_id),
            )

    run_in_transaction(_run)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--org-id", required=True)
    parser.add_argument("--agent-id", required=True)
    args = parser.parse_args()

    print("Submitting claim...")
    claim_id = submit_claim(
        org_id=args.org_id,
        claimant_name="Time Travel Demo Claimant",
        policy_number="POL-TT-1",
        description="Minor rear bumper damage from a parking lot incident, no injuries claimed.",
        amount_cents=80000,
    )
    print(f"  claim_id = {claim_id}")

    claimed_id = claim_next_pending(args.agent_id)
    assert claimed_id == claim_id, "expected to claim the claim we just submitted"

    print("Agent processing claim (calling Bedrock)...")
    result = process_claim(claim_id, args.agent_id)
    decision_id = result["decision_id"]
    print(f"  decision_id = {decision_id}")
    print(f"  decision = {result['decision']}")
    print(f"  rationale = {result['rationale']}")

    time.sleep(1)

    print("\nMutating the claim's description AFTER the decision was made "
          "(simulating new information / a data correction)...")
    _mutate_claim(
        claim_id,
        "Rear bumper damage from a parking lot incident - claimant later admitted "
        "to backing into a fixed post, injuries now also being claimed.",
    )

    print("\nReplaying the decision with AS OF SYSTEM TIME...")
    replay = replay_decision(decision_id)

    print(f"\n  Replayed AS OF cluster time: {replay['as_of_hlc_time']}")
    print(f"  Description agent actually saw: "
          f"{replay['historical_claim_state']['description']!r}")
    print(f"  Current description in the table now: "
          f"{replay['current_claim_state']['description']!r}")
    print(f"\n  State changed since decision? {replay['state_has_changed_since_decision']}")
    print("\nThis proves the agent's decision was reasonable given exactly what it knew at "
          "the time - even though the claim record has since changed.")


if __name__ == "__main__":
    main()
