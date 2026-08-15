"""Time-travel audit: reconstruct exactly what an agent's memory looked like at decision time.

This is the compliance story: instead of trusting a stored JSON snapshot at
face value, we re-run the *original* queries against the live cluster using
`AS OF SYSTEM TIME <hlc timestamp>`, which returns the exact MVCC-consistent
data that existed at that instant — even if the claims table has been
updated many times since. That is a guarantee CockroachDB provides natively;
an application-level snapshot table could always be wrong, forged, or out of
sync with what actually happened.

Note: AS OF SYSTEM TIME reads must fall within the cluster's GC window
(`gc.ttlseconds`, default 4h on CockroachDB Serverless free tier at the time
of writing). For a production compliance use case, raise the GC TTL on the
relevant tables or export decisions to a changefeed-backed archive.
"""

from __future__ import annotations

import psycopg

from verity.db import read_only_connection


class ReplayWindowExpired(Exception):
    """A decision's AS OF SYSTEM TIME read fell outside the cluster's GC window.

    Not a bug - CockroachDB physically garbage-collects MVCC history older
    than gc.ttlseconds, so a read pinned to a timestamp before that horizon
    cannot succeed. Raised so the API layer can return a clear, expected
    error instead of letting the raw psycopg exception surface as an
    uncaught 500 (which strips CORS headers and looks like a CORS bug).
    """


def get_decision(decision_id: str) -> dict:
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, claim_id, agent_id, decision, rationale, context_snapshot,
                   context_query_time, context_hlc_time, model_id, created_at
            FROM decisions WHERE id = %s
            """,
            (decision_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise ValueError(f"No decision found with id {decision_id}")
        columns = [d.name for d in cur.description]
        return dict(zip(columns, row))


def replay_decision(decision_id: str) -> dict:
    """Re-read the claim, its history, and its events exactly as of the decision's read time.

    Returns both the replayed (historical) state and the current state, so a
    reviewer can see precisely what, if anything, has changed since the
    agent made its decision.
    """
    decision = get_decision(decision_id)
    hlc_time = decision["context_hlc_time"]
    claim_id = str(decision["claim_id"])

    # Two things matter here:
    #  1. A CockroachDB transaction is pinned to a single read timestamp, so
    #     an AS OF SYSTEM TIME read and a "current state" (implicitly now())
    #     read cannot share one transaction - mixing them raises
    #     FeatureNotSupported ("inconsistent AS OF SYSTEM TIME timestamp").
    #     The historical reads and the current-state read therefore each get
    #     their own connection/transaction.
    #  2. Within the historical read, `SET TRANSACTION AS OF SYSTEM TIME` as
    #     its own leading statement is used rather than inlining
    #     `AS OF SYSTEM TIME` in each query's FROM clause - the inline form
    #     hits the same "inconsistent" error here due to how CockroachDB
    #     interacts with psycopg's query protocol, even on a brand-new
    #     connection with nothing else run on it. SET TRANSACTION is also
    #     CockroachDB's own documented fix for that exact error.
    try:
        with read_only_connection() as conn, conn.cursor() as cur:
            cur.execute(f"SET TRANSACTION AS OF SYSTEM TIME '{hlc_time}'")

            cur.execute("SELECT * FROM claims WHERE id = %s", (claim_id,))
            historical_columns = [d.name for d in cur.description]
            historical_row = cur.fetchone()
            historical_claim = dict(zip(historical_columns, historical_row)) if historical_row else None

            cur.execute(
                """
                SELECT event_type, payload, created_at
                FROM claim_events
                WHERE claim_id = %s
                ORDER BY created_at
                """,
                (claim_id,),
            )
            event_columns = [d.name for d in cur.description]
            historical_events = [dict(zip(event_columns, row)) for row in cur.fetchall()]
    except psycopg.InternalError as exc:
        if "GC threshold" not in str(exc):
            raise
        raise ReplayWindowExpired(
            f"This decision's read timestamp ({hlc_time}) is older than the cluster's "
            "gc.ttlseconds retention window - CockroachDB has already garbage-collected "
            "the MVCC history needed to replay it."
        ) from exc

    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM claims WHERE id = %s", (claim_id,))
        current_columns = [d.name for d in cur.description]
        current_row = cur.fetchone()
        current_claim = dict(zip(current_columns, current_row)) if current_row else None

    return {
        "decision": decision,
        "as_of_hlc_time": hlc_time,
        "historical_claim_state": historical_claim,
        "historical_events": historical_events,
        "current_claim_state": current_claim,
        "state_has_changed_since_decision": historical_claim != current_claim,
    }


def check_no_double_claims() -> list[dict]:
    """Concurrency-safety proof: should always return an empty list.

    Backed by the `double_claims_check` view in db/schema.sql, which finds
    any claim_id claimed by more than one distinct agent. Used by
    scripts/simulate_concurrent_claims.py to prove correctness under load.
    """
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT claim_id, distinct_claimants FROM double_claims_check")
        columns = [d.name for d in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]
