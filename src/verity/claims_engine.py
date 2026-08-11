"""Core claims workflow: submission, concurrency-safe claiming, and grounded decisions.

The central guarantee this module provides — and the thing a single-writer
chatbot-with-memory design could never demonstrate — is that many autonomous
agent workers can hit `claim_next_pending` concurrently and each pending
claim will be claimed by exactly one of them. That guarantee comes from
CockroachDB's SERIALIZABLE isolation plus the retry loop in verity.db, not
from any locking we implement ourselves.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import psycopg

from verity.bedrock_client import generate_decision
from verity.db import run_in_transaction
from verity.vector_memory import find_similar_claims, store_embedding

_POLICY_COLUMNS = [
    "policy_number",
    "policyholder_name",
    "coverage_type",
    "coverage_limit_cents",
    "deductible_cents",
    "effective_date",
    "expiration_date",
    "status",
]


def _lookup_policy(cur: psycopg.Cursor, policy_number: str) -> dict | None:
    """Find a real policy backing this policy_number, if one has been recorded.

    Deliberately joined by policy_number rather than a foreign key on claims -
    intake commonly happens before a formal policy record is confirmed, so a
    claim must be able to exist without one. When a policy IS found, its
    coverage limit and active/expired state are computed here (not left to
    the model to infer from raw dates) and folded into the decision context.
    """
    cur.execute(
        f"SELECT {', '.join(_POLICY_COLUMNS)} FROM policies WHERE policy_number = %s",
        (policy_number,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    policy = dict(zip(_POLICY_COLUMNS, row))
    # Explicit UTC rather than date.today()'s local-system timezone: Lambda
    # always runs in UTC, and policy effective/expiration dates should be
    # compared against an unambiguous "today", not whatever timezone the
    # host happens to be in.
    today = datetime.now(tz=timezone.utc).date()
    policy["is_active"] = (
        policy["status"] == "active" and policy["effective_date"] <= today <= policy["expiration_date"]
    )
    return policy


def _create_payout(
    cur: psycopg.Cursor, *, claim_id: str, decision_id: str, amount_cents: int, policy: dict | None
) -> str:
    """Insert the payout for an approved claim. payouts.claim_id is UNIQUE, so
    a second attempt to pay out the same claim (a retried transaction, a
    duplicate review, anything) fails at the database level, not just in
    application logic."""
    deductible = policy["deductible_cents"] if policy else 0
    payout_amount = max(amount_cents - deductible, 0)
    cur.execute(
        "INSERT INTO payouts (claim_id, decision_id, amount_cents) VALUES (%s, %s, %s) RETURNING id",
        (claim_id, decision_id, payout_amount),
    )
    return str(cur.fetchone()[0])


def submit_claim(
    *,
    org_id: str,
    claimant_name: str,
    policy_number: str,
    description: str,
    amount_cents: int,
) -> str:
    """Insert a new claim, log the submission event, and embed its description into memory."""

    def _run(conn: psycopg.Connection) -> str:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO claims (org_id, claimant_name, policy_number, description, amount_cents)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (org_id, claimant_name, policy_number, description, amount_cents),
            )
            claim_id = str(cur.fetchone()[0])
            cur.execute(
                """
                INSERT INTO claim_events (claim_id, event_type, payload)
                VALUES (%s, 'submitted', %s)
                """,
                (claim_id, json.dumps({"description": description, "amount_cents": amount_cents})),
            )
        store_embedding(conn, claim_id=claim_id, chunk_text=description)
        return claim_id

    return run_in_transaction(_run)


def claim_next_pending(agent_id: str) -> str | None:
    """Atomically claim the oldest pending claim for `agent_id`, or return None if none available.

    Safe to call concurrently from many workers: CockroachDB will abort and
    we will retry (see verity.db.run_in_transaction) any transaction that
    races another worker for the same row, so no claim is ever double-claimed.
    """

    def _run(conn: psycopg.Connection) -> str | None:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM claims
                WHERE status = 'pending'
                ORDER BY created_at
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if row is None:
                return None
            claim_id = str(row[0])

            cur.execute(
                """
                UPDATE claims
                SET status = 'claimed', claimed_by = %s, claimed_at = now(), updated_at = now()
                WHERE id = %s AND status = 'pending'
                RETURNING id
                """,
                (agent_id, claim_id),
            )
            updated = cur.fetchone()
            if updated is None:
                # Another transaction claimed it between our SELECT and UPDATE.
                # Under SERIALIZABLE isolation this branch is rare (the whole
                # transaction usually aborts and retries instead), but it's a
                # safe no-op either way.
                return None

            cur.execute(
                """
                INSERT INTO claim_events (claim_id, agent_id, event_type, payload)
                VALUES (%s, %s, 'claimed', '{}')
                """,
                (claim_id, agent_id),
            )
        return claim_id

    return run_in_transaction(_run)


def _gather_context(conn: psycopg.Connection, claim_id: str) -> tuple[dict, str, datetime]:
    """Read the claim, its claimant history, and similar historical claims as one snapshot.

    Returns (context_dict, hlc_timestamp, wall_clock_time) so the caller can
    persist exactly what was read and when, for later AS OF SYSTEM TIME replay.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT cluster_logical_timestamp()")
        hlc_time = str(cur.fetchone()[0])

        cur.execute(
            "SELECT claimant_name, policy_number, description, amount_cents FROM claims WHERE id = %s",
            (claim_id,),
        )
        claimant_name, policy_number, description, amount_cents = cur.fetchone()

        cur.execute(
            """
            SELECT id, description, amount_cents, status, created_at
            FROM claims
            WHERE policy_number = %s AND id != %s
            ORDER BY created_at DESC
            LIMIT 10
            """,
            (policy_number, claim_id),
        )
        columns = [d.name for d in cur.description]
        claimant_history = [dict(zip(columns, row)) for row in cur.fetchall()]

        policy = _lookup_policy(cur, policy_number)

    similar = find_similar_claims(description, exclude_claim_id=claim_id, top_k=5)

    context = {
        "claim": {
            "claimant_name": claimant_name,
            "policy_number": policy_number,
            "description": description,
            "amount_cents": amount_cents,
        },
        "policy": policy,
        "policy_covers_claim_amount": (
            amount_cents <= policy["coverage_limit_cents"] if policy else None
        ),
        "claimant_history": claimant_history,
        "similar_historical_claims": similar,
    }
    return context, hlc_time, datetime.now(timezone.utc)


def process_claim(claim_id: str, agent_id: str) -> dict:
    """Gather grounded context, call Bedrock for a decision, and atomically record it.

    The context snapshot and its exact read timestamp are persisted alongside
    the decision, so `verity.audit.replay_decision` can later reconstruct the
    precise memory state the agent acted on — even if the claims data has
    since changed.
    """
    pool_conn_context: dict = {}

    def _read(conn: psycopg.Connection):
        context, hlc_time, wall_time = _gather_context(conn, claim_id)
        pool_conn_context["context"] = context
        pool_conn_context["hlc_time"] = hlc_time
        pool_conn_context["wall_time"] = wall_time
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO claim_events (claim_id, agent_id, event_type, payload) VALUES (%s, %s, 'context_gathered', %s)",
                (claim_id, agent_id, json.dumps(context, default=str)),
            )

    run_in_transaction(_read)

    context = pool_conn_context["context"]
    decision_result = generate_decision(context)

    def _write(conn: psycopg.Connection) -> dict:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO decisions
                    (claim_id, agent_id, decision, rationale, context_snapshot,
                     context_query_time, context_hlc_time, model_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    claim_id,
                    agent_id,
                    decision_result["decision"],
                    decision_result["rationale"],
                    json.dumps(context, default=str),
                    pool_conn_context["wall_time"],
                    pool_conn_context["hlc_time"],
                    decision_result["model_id"],
                ),
            )
            decision_id = str(cur.fetchone()[0])

            new_status = {"approve": "approved", "deny": "denied", "flag": "flagged"}[
                decision_result["decision"]
            ]
            cur.execute(
                "UPDATE claims SET status = %s, updated_at = now() WHERE id = %s",
                (new_status, claim_id),
            )
            cur.execute(
                "INSERT INTO claim_events (claim_id, agent_id, event_type, payload) VALUES (%s, %s, 'decided', %s)",
                (claim_id, agent_id, json.dumps({"decision_id": decision_id, **decision_result})),
            )

            payout_id = None
            if decision_result["decision"] == "approve":
                payout_id = _create_payout(
                    cur,
                    claim_id=claim_id,
                    decision_id=decision_id,
                    amount_cents=context["claim"]["amount_cents"],
                    policy=context["policy"],
                )
        return {"decision_id": decision_id, "payout_id": payout_id, **decision_result}

    return run_in_transaction(_write)


def review_claim(*, claim_id: str, decision_id: str, reviewer_name: str, outcome: str, notes: str) -> dict:
    """Human review of a flagged claim - the required human-in-the-loop step for cases the
    agent didn't resolve on its own. `outcome` becomes the claim's final status; an 'approve'
    outcome creates a payout through the exact same _create_payout path an automated approval
    uses, so the claim_id UNIQUE constraint on payouts protects this path too.
    """

    def _write(conn: psycopg.Connection) -> dict:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT amount_cents, policy_number FROM claims WHERE id = %s AND status = 'flagged'",
                (claim_id,),
            )
            row = cur.fetchone()
            if row is None:
                raise ValueError(f"Claim {claim_id} is not awaiting review (not in 'flagged' status)")
            amount_cents, policy_number = row

            cur.execute(
                """
                INSERT INTO reviews (claim_id, decision_id, reviewer_name, outcome, notes)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (claim_id, decision_id, reviewer_name, outcome, notes),
            )
            review_id = str(cur.fetchone()[0])

            new_status = "approved" if outcome == "approve" else "denied"
            cur.execute(
                "UPDATE claims SET status = %s, updated_at = now() WHERE id = %s",
                (new_status, claim_id),
            )
            cur.execute(
                "INSERT INTO claim_events (claim_id, event_type, payload) VALUES (%s, 'reviewed', %s)",
                (claim_id, json.dumps({"review_id": review_id, "reviewer_name": reviewer_name, "outcome": outcome, "notes": notes})),
            )

            payout_id = None
            if outcome == "approve":
                policy = _lookup_policy(cur, policy_number)
                payout_id = _create_payout(
                    cur, claim_id=claim_id, decision_id=decision_id, amount_cents=amount_cents, policy=policy
                )
        return {"review_id": review_id, "status": new_status, "payout_id": payout_id}

    return run_in_transaction(_write)
