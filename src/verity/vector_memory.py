"""Distributed vector memory: store and query claim/document embeddings in CockroachDB.

Uses CockroachDB's native VECTOR type + distributed vector index
(`idx_claim_embeddings_vec`, defined in db/schema.sql) for cosine-similarity
search. This is what powers fraud-pattern / precedent matching in
claims_engine.gather_context — semantic recall grounded in the same
transactionally-consistent store as the rest of the claim's memory, not a
separate vector database that can drift out of sync.

Embeddings are sent as CockroachDB's `[v1,v2,...]` vector literal syntax
(cast explicitly with `::VECTOR` in SQL) rather than through the pgvector
Python adapter's type registration, which probes `pg_type` in a way that
isn't guaranteed to match CockroachDB's catalog emulation. Plain literals
are simpler and avoid that dependency entirely.
"""

from __future__ import annotations

import psycopg

from verity.bedrock_client import embed_text
from verity.db import get_pool


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(repr(float(v)) for v in values) + "]"


def store_embedding(
    conn: psycopg.Connection,
    *,
    claim_id: str,
    chunk_text: str,
    document_id: str | None = None,
) -> None:
    """Embed `chunk_text` and store it against `claim_id`. Call within an open transaction."""
    vector = _vector_literal(embed_text(chunk_text))
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO claim_embeddings (claim_id, document_id, chunk_text, embedding)
            VALUES (%s, %s, %s, %s::VECTOR)
            """,
            (claim_id, document_id, chunk_text, vector),
        )


def find_similar_claims(query_text: str, *, exclude_claim_id: str | None = None, top_k: int = 5) -> list[dict]:
    """Semantic search over historical claim/document text for precedent or fraud-pattern matches.

    Returns the top_k most similar chunks (by cosine distance) joined back to
    their parent claim, for use as grounding context in agent decisions.
    """
    vector = _vector_literal(embed_text(query_text))
    pool = get_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                ce.claim_id,
                ce.chunk_text,
                c.status,
                c.amount_cents,
                (ce.embedding <=> %s::VECTOR) AS cosine_distance
            FROM claim_embeddings ce
            JOIN claims c ON c.id = ce.claim_id
            WHERE (%s::UUID IS NULL OR ce.claim_id != %s::UUID)
            ORDER BY ce.embedding <=> %s::VECTOR
            LIMIT %s
            """,
            (vector, exclude_claim_id, exclude_claim_id, vector, top_k),
        )
        columns = [desc.name for desc in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]
