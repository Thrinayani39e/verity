"""FastAPI app exposing the claims workflow and audit tooling to the web dashboard.

Runs identically locally (`uvicorn verity.api:app`) and on AWS Lambda behind
API Gateway via lambdas/api_handler.py (Mangum adapter) — no code fork
between local dev and production.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from verity import (
    audit,
    claims_engine,
    cluster_ops,
    fraud_ring,
    ingestion,
    vector_memory,
)
from verity.config import settings
from verity.db import read_only_connection, run_in_transaction

app = FastAPI(title="Verity", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your dashboard's origin before production use
    allow_methods=["*"],
    allow_headers=["*"],
)


class ClaimIn(BaseModel):
    org_id: UUID
    claimant_name: str = Field(min_length=1, max_length=200)
    policy_number: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=5000)
    amount_cents: int = Field(gt=0)
    bank_account_last4: str | None = Field(default=None, max_length=4)
    claimant_address: str | None = Field(default=None, max_length=300)


class ProcessIn(BaseModel):
    agent_id: UUID


class OrganizationIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class PolicyIn(BaseModel):
    org_id: UUID
    policy_number: str = Field(min_length=1, max_length=100)
    policyholder_name: str = Field(min_length=1, max_length=200)
    coverage_type: str = Field(pattern="^(auto|home|health|life|property)$")
    coverage_limit_cents: int = Field(gt=0)
    deductible_cents: int = Field(ge=0, default=0)
    effective_date: str
    expiration_date: str


class ReviewIn(BaseModel):
    decision_id: UUID
    reviewer_name: str = Field(min_length=1, max_length=200)
    outcome: str = Field(pattern="^(approve|deny)$")
    notes: str = Field(min_length=1, max_length=2000)


@app.get("/health")
def health() -> dict:
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return {"status": "ok"}


@app.get("/organizations")
def list_organizations() -> list[dict]:
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, name, created_at FROM organizations ORDER BY created_at DESC")
        columns = [d.name for d in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


@app.post("/organizations")
def create_organization(body: OrganizationIn) -> dict:
    """Creates an organization plus one default agent, so a fresh org can claim work immediately."""

    def _run(conn):
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO organizations (name) VALUES (%s) RETURNING id", (body.name,)
            )
            org_id = str(cur.fetchone()[0])
            cur.execute(
                "INSERT INTO agents (org_id, name, kind) VALUES (%s, 'default-agent', 'claims_worker') RETURNING id",
                (org_id,),
            )
            agent_id = str(cur.fetchone()[0])
        return {"org_id": org_id, "agent_id": agent_id}

    return run_in_transaction(_run)


@app.get("/policies")
def list_policies(org_id: UUID | None = None) -> list[dict]:
    query = (
        "SELECT id, org_id, policy_number, policyholder_name, coverage_type, "
        "coverage_limit_cents, deductible_cents, effective_date, expiration_date, "
        "status, created_at FROM policies"
    )
    params: list = []
    if org_id:
        query += " WHERE org_id = %s"
        params.append(str(org_id))
    query += " ORDER BY created_at DESC"

    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute(query, params)
        columns = [d.name for d in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


@app.post("/policies")
def create_policy(body: PolicyIn) -> dict:
    def _run(conn):
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO policies
                    (org_id, policy_number, policyholder_name, coverage_type,
                     coverage_limit_cents, deductible_cents, effective_date, expiration_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    str(body.org_id),
                    body.policy_number,
                    body.policyholder_name,
                    body.coverage_type,
                    body.coverage_limit_cents,
                    body.deductible_cents,
                    body.effective_date,
                    body.expiration_date,
                ),
            )
            return {"policy_id": str(cur.fetchone()[0])}

    try:
        return run_in_transaction(_run)
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=409, detail="policy_number already exists") from exc
        raise


@app.post("/claims")
def create_claim(body: ClaimIn) -> dict:
    claim_id = claims_engine.submit_claim(
        org_id=str(body.org_id),
        claimant_name=body.claimant_name,
        policy_number=body.policy_number,
        description=body.description,
        amount_cents=body.amount_cents,
        bank_account_last4=body.bank_account_last4,
        claimant_address=body.claimant_address,
    )
    return {"claim_id": claim_id}


@app.get("/claims")
def list_claims(status: str | None = None, limit: int = 50) -> list[dict]:
    query = (
        "SELECT id, claimant_name, policy_number, description, amount_cents, "
        "status, claimed_by, created_at FROM claims"
    )
    params: list = []
    if status:
        query += " WHERE status = %s"
        params.append(status)
    query += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)

    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute(query, params)
        columns = [d.name for d in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


@app.post("/claims/{claim_id}/claim")
def claim_claim(claim_id: UUID, body: ProcessIn) -> dict:
    claimed_id = claims_engine.claim_next_pending(str(body.agent_id))
    if claimed_id is None:
        raise HTTPException(status_code=409, detail="No pending claims available")
    return {"claimed_claim_id": claimed_id}


@app.post("/claims/{claim_id}/process")
def process(claim_id: UUID, body: ProcessIn) -> dict:
    try:
        return claims_engine.process_claim(str(claim_id), str(body.agent_id))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/claims/{claim_id}/review")
def review(claim_id: UUID, body: ReviewIn) -> dict:
    """Human-in-the-loop review of a flagged claim - required before a flagged
    case can resolve to approved/denied. Mirrors the automated decision path
    exactly for payout creation (same _create_payout, same UNIQUE constraint)."""
    try:
        return claims_engine.review_claim(
            claim_id=str(claim_id),
            decision_id=str(body.decision_id),
            reviewer_name=body.reviewer_name,
            outcome=body.outcome,
            notes=body.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/decisions/{decision_id}")
def get_decision(decision_id: UUID) -> dict:
    try:
        return audit.get_decision(str(decision_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/decisions/{decision_id}/replay")
def replay(decision_id: UUID) -> dict:
    """The 'time travel' endpoint: reconstructs exactly what the agent knew when it decided."""
    try:
        return audit.replay_decision(str(decision_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/audit/double-claims-check")
def double_claims_check() -> dict:
    """Concurrency-safety proof endpoint: `violations` should always be empty."""
    return {"violations": audit.check_no_double_claims()}


@app.get("/fraud-rings")
def fraud_rings() -> list[dict]:
    """Clusters of claims that look independent one at a time but share a
    bank account or address across different claimant names - the pattern a
    stateless, one-claim-at-a-time agent structurally cannot see, and only a
    persistent, queryable memory can surface across every claim ever filed.
    """
    return fraud_ring.find_fraud_rings()


@app.get("/search")
def search_precedents(q: str, exclude_claim_id: UUID | None = None, limit: int = 10) -> list[dict]:
    """Semantic precedent search: the distributed vector index, exposed directly.

    Same underlying query claims_engine uses internally to ground a decision
    in fraud-pattern/precedent history, but callable standalone so the
    vector search itself is visible and explorable, not just an invisible
    step inside a decision.
    """
    return vector_memory.find_similar_claims(
        q,
        exclude_claim_id=str(exclude_claim_id) if exclude_claim_id else None,
        top_k=limit,
    )


@app.post("/claims/{claim_id}/documents")
async def upload_document(claim_id: UUID, file: UploadFile) -> dict:
    """Upload a supporting document (plain text works best; see ingestion.py's
    docstring on non-text formats) - it's chunked, embedded, and becomes part
    of the same memory store the claims agent reads from immediately."""
    content = await file.read()
    document_id = ingestion.upload_and_ingest_document(
        claim_id=str(claim_id),
        filename=file.filename or "upload.txt",
        content=content,
    )
    return {"document_id": document_id}


@app.get("/events")
def list_events(limit: int = 50) -> list[dict]:
    """The append-only audit feed: every submitted/claimed/decided event, newest first."""
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT ce.id, ce.claim_id, c.claimant_name, ce.agent_id, ce.event_type,
                   ce.payload, ce.created_at
            FROM claim_events ce
            JOIN claims c ON c.id = ce.claim_id
            ORDER BY ce.created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        columns = [d.name for d in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


@app.get("/claims/{claim_id}/detail")
def claim_detail(claim_id: UUID) -> dict:
    """Everything known about one claim in a single call: the claim itself,
    its full event timeline, attached documents, its decision(s), and its
    payout/review if any - the narrative view of one case end to end."""
    cid = str(claim_id)
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, org_id, claimant_name, policy_number, description, amount_cents, "
            "status, claimed_by, claimed_at, created_at, updated_at FROM claims WHERE id = %s",
            (cid,),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="claim not found")
        claim = dict(zip([d.name for d in cur.description], row))

        cur.execute(
            "SELECT id, agent_id, event_type, payload, created_at FROM claim_events "
            "WHERE claim_id = %s ORDER BY created_at",
            (cid,),
        )
        events = [dict(zip([d.name for d in cur.description], r)) for r in cur.fetchall()]

        cur.execute(
            "SELECT id, s3_bucket, s3_key, doc_type, created_at FROM documents WHERE claim_id = %s",
            (cid,),
        )
        documents = [dict(zip([d.name for d in cur.description], r)) for r in cur.fetchall()]

        cur.execute(
            "SELECT id, agent_id, decision, rationale, model_id, created_at FROM decisions "
            "WHERE claim_id = %s ORDER BY created_at",
            (cid,),
        )
        decisions = [dict(zip([d.name for d in cur.description], r)) for r in cur.fetchall()]

        cur.execute(
            "SELECT id, amount_cents, status, created_at FROM payouts WHERE claim_id = %s", (cid,)
        )
        payout_row = cur.fetchone()
        payout = dict(zip([d.name for d in cur.description], payout_row)) if payout_row else None

        cur.execute(
            "SELECT id, reviewer_name, outcome, notes, created_at FROM reviews WHERE claim_id = %s",
            (cid,),
        )
        review_row = cur.fetchone()
        review = dict(zip([d.name for d in cur.description], review_row)) if review_row else None

    return {
        "claim": claim,
        "events": events,
        "documents": documents,
        "decisions": decisions,
        "payout": payout,
        "review": review,
    }


@app.get("/analytics/summary")
def analytics_summary() -> dict:
    """Aggregate stats computed straight from CockroachDB - counts, totals, and
    the per-agent breakdown that turns the concurrency proof into an actual
    leaderboard instead of just a pass/fail line."""
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, count(*), sum(amount_cents) FROM claims GROUP BY status")
        by_status = [
            {"status": s, "count": c, "total_amount_cents": int(total or 0)}
            for s, c, total in cur.fetchall()
        ]

        cur.execute("SELECT count(*), sum(amount_cents) FROM payouts")
        payout_count, payout_total = cur.fetchone()

        cur.execute(
            """
            SELECT claimed_by, count(*)
            FROM claims
            WHERE claimed_by IS NOT NULL
            GROUP BY claimed_by
            ORDER BY count(*) DESC
            """
        )
        by_agent = [{"agent_id": str(a), "claims_processed": c} for a, c in cur.fetchall()]

        cur.execute("SELECT count(*) FROM reviews")
        review_count = cur.fetchone()[0]

    return {
        "by_status": by_status,
        "payouts": {"count": payout_count, "total_amount_cents": int(payout_total or 0)},
        "by_agent": by_agent,
        "human_reviews": review_count,
    }


@app.post("/ops/health-check")
def ops_health_check() -> dict:
    """Runs the same ccloud preflight check the ingestion pipeline gates on
    before a bulk write, so the UI can show the agent's own view of its
    infrastructure's health."""
    if not settings.cluster_name:
        raise HTTPException(status_code=503, detail="CLUSTER_NAME is not configured")
    try:
        return cluster_ops.preflight_health_check(settings.cluster_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
