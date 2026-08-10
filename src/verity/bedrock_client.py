"""Amazon Bedrock integration: Titan embeddings for vector memory, Claude for decisions."""

from __future__ import annotations

import json
from functools import lru_cache

import boto3

from verity.config import settings


@lru_cache(maxsize=1)
def _client():
    return boto3.client("bedrock-runtime", region_name=settings.aws_region)


def embed_text(text: str) -> list[float]:
    """Embed text with Amazon Titan Text Embeddings V2 for vector memory storage/search."""
    body = json.dumps(
        {
            "inputText": text[:8000],  # Titan v2 input limit safeguard
            "dimensions": settings.embedding_dimensions,
            "normalize": True,
        }
    )
    response = _client().invoke_model(
        modelId=settings.bedrock_embedding_model_id,
        body=body,
        contentType="application/json",
        accept="application/json",
    )
    payload = json.loads(response["body"].read())
    return payload["embedding"]


DECISION_SYSTEM_PROMPT = """You are a claims-adjudication agent. You are given a new claim, \
the policy backing it (if one is on file, including whether it is currently active and \
whether its coverage limit covers the claimed amount - already computed for you, don't \
recompute dates yourself), similar historical claims (retrieved by semantic similarity), and \
the claimant's own claim history. Decide whether to approve, deny, or flag the claim for \
human review.

If no policy record is on file, treat that as a reason for extra scrutiny, not automatic \
denial. If a policy is on file but expired, not yet active, or its coverage limit is below \
the claimed amount, that should weigh heavily toward deny or flag. Flag (rather than \
outright deny) whenever the evidence is genuinely ambiguous or the amount is unusually \
large - a human should make the final call in those cases, not the agent.

Respond with strict JSON only, no prose outside the JSON object, in this shape:
{"decision": "approve" | "deny" | "flag", "rationale": "<2-4 sentences citing specific \
evidence from the provided context>"}
"""


def generate_decision(context: dict) -> dict:
    """Call Claude via Bedrock to produce a claims decision grounded in the given context.

    Returns a dict with keys: decision, rationale, model_id.
    """
    user_content = json.dumps(context, default=str, indent=2)

    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            # Claude Sonnet 5 always reasons before answering (adaptive thinking
            # cannot be disabled), which consumes part of the max_tokens budget
            # before the final text block — 512 was sized for a non-reasoning
            # model and could truncate before ever reaching the answer.
            "max_tokens": 4096,
            "system": DECISION_SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_content}],
        }
    )
    response = _client().invoke_model(
        modelId=settings.bedrock_llm_model_id,
        body=body,
        contentType="application/json",
        accept="application/json",
    )
    payload = json.loads(response["body"].read())

    # Reasoning models may emit a leading "thinking" content block before the
    # final "text" block, so find the text block by type rather than assuming
    # index 0 — this is correct regardless of whether thinking is enabled.
    text_blocks = [block["text"] for block in payload["content"] if block.get("type") == "text"]
    if not text_blocks:
        raise ValueError(f"Model response contained no text block: {payload['content']!r}")
    text = text_blocks[-1].strip()

    # Models sometimes wrap JSON in a markdown code fence despite instructions
    # not to. Strip ```json / ``` fences before parsing rather than trusting
    # the model to follow the "no prose" instruction literally.
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Model did not return valid JSON: {text!r}") from exc

    if parsed.get("decision") not in {"approve", "deny", "flag"}:
        raise ValueError(f"Model returned an invalid decision value: {parsed!r}")

    parsed["model_id"] = settings.bedrock_llm_model_id
    return parsed
