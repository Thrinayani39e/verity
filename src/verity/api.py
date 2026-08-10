"""FastAPI app exposing the claims workflow and audit tooling to the web dashboard.

Runs identically locally (`uvicorn verity.api:app`) and on AWS Lambda behind
API Gateway via lambdas/api_handler.py (Mangum adapter) — no code fork
between local dev and production.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from verity import audit, claims_engine
from verity.db import read_only_connection

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


class ProcessIn(BaseModel):
    agent_id: UUID


@app.get("/health")
def health() -> dict:
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return {"status": "ok"}


@app.post("/claims")
def create_claim(body: ClaimIn) -> dict:
    claim_id = claims_engine.submit_claim(
        org_id=str(body.org_id),
        claimant_name=body.claimant_name,
        policy_number=body.policy_number,
        description=body.description,
        amount_cents=body.amount_cents,
    )
    return {"claim_id": claim_id}


@app.get("/claims")
def list_claims(status: str | None = None, limit: int = 50) -> list[dict]:
    query = "SELECT id, claimant_name, policy_number, amount_cents, status, created_at FROM claims"
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
