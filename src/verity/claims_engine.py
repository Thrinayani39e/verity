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

    similar = find_similar_claims(description, exclude_claim_id=claim_id, top_k=5)

    context = {
        "claim": {
            "claimant_name": claimant_name,
            "policy_number": policy_number,
            "description": description,
            "amount_cents": amount_cents,
        },
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
        return {"decision_id": decision_id, **decision_result}

    return run_in_transaction(_write)
