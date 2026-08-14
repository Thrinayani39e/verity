"""Fraud-ring detection: finds claims that look independent one at a time but
share an identifying attribute across otherwise-unrelated claimants.

This is the argument for persistent memory made concrete: a stateless agent
evaluating each claim in isolation has no way to see that three claims filed
under three different names, weeks apart, all pay out to the same bank
account. Only a store that can be queried across every claim ever filed can
surface that. The clustering here is exact-match relational SQL against
CockroachDB - not a fabricated demo, and independent of (and a corroborating
signal alongside) the semantic similarity `vector_memory.find_similar_claims`
already provides.
"""

from __future__ import annotations

from verity.db import read_only_connection

_SIGNALS: tuple[tuple[str, str], ...] = (
    ("bank_account", "bank_account_last4"),
    ("address", "claimant_address"),
)


def find_fraud_rings() -> list[dict]:
    """Returns every group of >=2 claims sharing a bank account or address.

    Each ring names its shared attribute (never displayed as the raw account
    number/address on its own - only in the context of the ring it forms)
    and lists the claims in it.
    """
    rings: list[dict] = []
    with read_only_connection() as conn, conn.cursor() as cur:
        for kind, column in _SIGNALS:
            cur.execute(
                f"""
                SELECT {column},
                       array_agg(id),
                       array_agg(claimant_name),
                       array_agg(amount_cents),
                       array_agg(status),
                       array_agg(created_at)
                FROM claims
                WHERE {column} IS NOT NULL
                GROUP BY {column}
                HAVING count(*) > 1
                """
            )
            for value, ids, names, amounts, statuses, created_ats in cur.fetchall():
                claims = [
                    {
                        "id": str(cid),
                        "claimant_name": name,
                        "amount_cents": amount,
                        "status": status,
                        "created_at": created_at,
                    }
                    for cid, name, amount, status, created_at in zip(
                        ids, names, amounts, statuses, created_ats
                    )
                ]
                rings.append(
                    {
                        "shared_attribute_kind": kind,
                        "shared_attribute_value": value,
                        "claims": claims,
                        "total_amount_cents": sum(c["amount_cents"] for c in claims),
                    }
                )
    rings.sort(key=lambda r: len(r["claims"]), reverse=True)
    return rings
