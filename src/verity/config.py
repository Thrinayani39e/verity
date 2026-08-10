import os

from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


class Settings:
    """Runtime configuration, loaded from environment variables (.env for local dev)."""

    # CockroachDB Cloud connection string, e.g.
    # postgresql://user:pass@host:26257/verity?sslmode=verify-full
    database_url: str = os.environ.get("DATABASE_URL", "")

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

    db_pool_min_size: int = int(os.environ.get("DB_POOL_MIN_SIZE", "1"))
    db_pool_max_size: int = int(os.environ.get("DB_POOL_MAX_SIZE", "10"))

    max_txn_retries: int = int(os.environ.get("MAX_TXN_RETRIES", "5"))

    def validate(self) -> None:
        _require("DATABASE_URL")


settings = Settings()
