"""Document ingestion: pull a claim attachment from S3, chunk it, and embed it into memory.

Triggered by an S3 `ObjectCreated` event via lambdas/ingestion_handler.py so
that uploading a supporting document (e.g. a police report, medical record,
repair estimate) immediately becomes part of the same transactionally
consistent memory store the claims agent reads from — no separate vector
database, no sync lag between "the file" and "what the agent knows".
"""

from __future__ import annotations

import boto3
import psycopg

from verity.config import settings
from verity.db import run_in_transaction
from verity.vector_memory import store_embedding

_s3 = boto3.client("s3", region_name=settings.aws_region)

CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200


def _chunk_text(text: str) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start = end - CHUNK_OVERLAP
    return [c for c in chunks if c.strip()]


def ingest_document(*, claim_id: str, bucket: str, key: str, doc_type: str = "attachment") -> str:
    """Fetch a plain-text document from S3, register it, and embed its chunks.

    For non-text formats (PDF, images), extract text upstream (e.g. Amazon
    Textract) before calling this function — kept out of scope here to keep
    the ingestion path simple and dependency-light.
    """
    obj = _s3.get_object(Bucket=bucket, Key=key)
    text = obj["Body"].read().decode("utf-8", errors="ignore")

    def _register(conn: psycopg.Connection) -> str:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO documents (claim_id, s3_bucket, s3_key, doc_type, extracted_text)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (claim_id, bucket, key, doc_type, text),
            )
            document_id = str(cur.fetchone()[0])
        for chunk in _chunk_text(text):
            store_embedding(conn, claim_id=claim_id, chunk_text=chunk, document_id=document_id)
        return document_id

    return run_in_transaction(_register)
