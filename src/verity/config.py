import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# CockroachDB Cloud Serverless certs are signed by a public CA (Let's Encrypt),
# but sslmode=verify-full defaults to looking for a root cert at
# ~/.postgresql/root.crt - a path that only exists on machines where someone
# manually placed it, not on CI runners or inside the Lambda deployment
# package. Bundling the CA cert in the repo and resolving its path relative to
# this file (not the process's CWD) makes verify-full work identically in
# local dev, CI, and Lambda, all of which have `db/` as a sibling of `src/`.
_CA_CERT_PATH = (Path(__file__).resolve().parent.parent.parent / "db" / "certs" / "isrg-root-x1.pem").as_posix()


def _with_root_cert(url: str) -> str:
    if not url or "sslrootcert=" in url:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}sslrootcert={_CA_CERT_PATH}"


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


class Settings:
    """Runtime configuration, loaded from environment variables (.env for local dev)."""

    # CockroachDB Cloud connection string, e.g.
    # postgresql://user:pass@host:26257/verity?sslmode=verify-full
    database_url: str = _with_root_cert(os.environ.get("DATABASE_URL", ""))

    aws_region: str = os.environ.get("AWS_REGION", "us-east-1")

    # Bedrock model ids — override in .env if your account has different access.
    # anthropic.claude-3-5-sonnet* reached end-of-life 2026-07-30; Claude Sonnet 5
    # is the current model as of writing (no date/version suffix in its Bedrock ID).
    bedrock_llm_model_id: str = os.environ.get(
        "BEDROCK_LLM_MODEL_ID", "anthropic.claude-sonnet-5"
    )
    bedrock_embedding_model_id: str = os.environ.get(
        "BEDROCK_EMBEDDING_MODEL_ID", "amazon.titan-embed-text-v2:0"
    )
    embedding_dimensions: int = int(os.environ.get("EMBEDDING_DIMENSIONS", "1024"))

    documents_bucket: str = os.environ.get("DOCUMENTS_BUCKET", "")

    # CockroachDB Cloud cluster name (not UUID - see ops/ccloud/*.sh), used by
    # the /ops/health-check API endpoint's ccloud preflight check.
    cluster_name: str = os.environ.get("CLUSTER_NAME", "")

    db_pool_min_size: int = int(os.environ.get("DB_POOL_MIN_SIZE", "1"))
    # Must be >= the number of concurrent workers you intend to run (e.g. in
    # scripts/simulate_concurrent_claims.py) or extra workers queue for a
    # pooled connection, which skews retry timing under contention.
    db_pool_max_size: int = int(os.environ.get("DB_POOL_MAX_SIZE", "20"))

    # All workers deliberately race for the SAME oldest-pending row first,
    # which is the worst case for contention (N-way collision on one row,
    # cascading down as each loser retries against the new oldest row). 5
    # was too low under 12-way contention in testing; 15 comfortably clears it.
    max_txn_retries: int = int(os.environ.get("MAX_TXN_RETRIES", "15"))

    def validate(self) -> None:
        _require("DATABASE_URL")


settings = Settings()
