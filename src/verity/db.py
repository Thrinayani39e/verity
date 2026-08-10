"""Connection pooling and the CockroachDB client-side transaction retry pattern.

CockroachDB uses SERIALIZABLE isolation for every transaction. Under
contention (e.g. two claims workers racing to claim the same case) one
transaction may be aborted with a 40001 (serialization_failure) error. The
correct, documented response is for the client to retry the whole
transaction with backoff — CockroachDB will not silently downgrade
isolation or block indefinitely. `run_in_transaction` below implements that
pattern once so the rest of the codebase never has to think about it.
"""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from contextlib import contextmanager
from typing import TypeVar

import psycopg
from psycopg_pool import ConnectionPool

from verity.config import settings

logger = logging.getLogger("verity.db")

T = TypeVar("T")

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        settings.validate()
        _pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=settings.db_pool_min_size,
            max_size=settings.db_pool_max_size,
            kwargs={"autocommit": False},
        )
    return _pool


SERIALIZATION_FAILURE = "40001"


def run_in_transaction(fn: Callable[[psycopg.Connection], T]) -> T:
    """Run `fn(conn)` inside a transaction, retrying on serialization failures.

    `fn` should perform all of its reads/writes on the given connection and
    must be safe to re-run from scratch (no side effects outside the DB).
    """
    pool = get_pool()
    max_retries = settings.max_txn_retries

    for attempt in range(max_retries + 1):
        with pool.connection() as conn:
            try:
                result = fn(conn)
                conn.commit()
                return result
            except psycopg.errors.Error as exc:
                conn.rollback()
                sqlstate = getattr(exc, "sqlstate", None)
                if sqlstate == SERIALIZATION_FAILURE and attempt < max_retries:
                    backoff = min(2**attempt * 0.05, 2.0) + random.uniform(0, 0.05)
                    logger.info(
                        "serialization failure, retrying (attempt %s/%s) after %.3fs",
                        attempt + 1,
                        max_retries,
                        backoff,
                    )
                    time.sleep(backoff)
                    continue
                raise

    raise RuntimeError("run_in_transaction: exhausted retries without success")


@contextmanager
def read_only_connection():
    """A plain pooled connection for simple reads (list views, health checks)."""
    pool = get_pool()
    with pool.connection() as conn:
        yield conn
