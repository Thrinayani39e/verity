"""Fraud-ring detection: finds claims that look independent one at a time but
share an identifying attribute across otherwise-unrelated claimants - directly
or transitively.

Direct sharing (two claims, one bank account) is a single GROUP BY. Real
rings are rarely that clean: claim A and B might share a bank account while B
and C share nothing but an address - A and C are still part of one ring, just
connected through B. Finding that requires treating claims as a graph and
computing connected components (Union-Find), not a single-attribute query.

This is the argument for persistent memory made concrete a second way: a
stateless agent evaluating one claim at a time has no way to discover even
the direct case, let alone a bridge two hops away. Only a store that can be
queried across every claim ever filed, and reasoned about as a graph, can.

The clustering here is exact-match and deterministic - no fuzzy matching, no
model call - which is what makes it fast, correct, and unit-testable without
a live database (see tests/test_fraud_ring.py). It runs alongside, not merged
into, the semantic similarity `vector_memory.find_similar_claims` already
provides: exact identity and semantic resemblance are different claims about
the data, and conflating them into one score would make both harder to trust.
"""

from __future__ import annotations

from verity.db import read_only_connection

_SIGNAL_COLUMNS: tuple[str, ...] = ("bank_account_last4", "claimant_address")


class _UnionFind:
    """Standard disjoint-set with path compression, keyed by claim id."""

    def __init__(self) -> None:
        self._parent: dict[str, str] = {}

    def add(self, item: str) -> None:
        self._parent.setdefault(item, item)

    def find(self, item: str) -> str:
        root = item
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[item] != root:
            self._parent[item], item = root, self._parent[item]
        return root

    def union(self, a: str, b: str) -> None:
        root_a, root_b = self.find(a), self.find(b)
        if root_a != root_b:
            self._parent[root_a] = root_b


def _cluster_claims(rows: list[dict], signal_columns: tuple[str, ...] = _SIGNAL_COLUMNS) -> list[dict]:
    """Groups claims into connected components over shared-attribute edges.

    `rows` must contain `id` plus each column in `signal_columns`, plus
    whatever display fields the caller wants echoed back per claim. Pure
    function - no I/O - so the graph logic is testable without a database.
    """
    uf = _UnionFind()
    for row in rows:
        uf.add(row["id"])

    edges: list[dict] = []
    for column in signal_columns:
        groups: dict[object, list[dict]] = {}
        for row in rows:
            value = row.get(column)
            if value is None:
                continue
            groups.setdefault(value, []).append(row)
        for value, members in groups.items():
            if len(members) < 2:
                continue
            anchor = members[0]["id"]
            for member in members[1:]:
                uf.union(anchor, member["id"])
                edges.append({"from": anchor, "to": member["id"], "kind": column, "value": value})

    components: dict[str, list[dict]] = {}
    for row in rows:
        components.setdefault(uf.find(row["id"]), []).append(row)

    display_fields = ("id", "claimant_name", "amount_cents", "status", "created_at")
    rings = []
    for members in components.values():
        if len(members) < 2:
            continue
        member_ids = {m["id"] for m in members}
        ring_edges = [e for e in edges if e["from"] in member_ids]
        rings.append(
            {
                "claims": [{f: m[f] for f in display_fields} for m in members],
                "edges": ring_edges,
                "total_amount_cents": sum(m["amount_cents"] for m in members),
            }
        )

    rings.sort(key=lambda r: len(r["claims"]), reverse=True)
    return rings


def find_fraud_rings() -> list[dict]:
    """Live version of `_cluster_claims` against the real claims table."""
    with read_only_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, claimant_name, amount_cents, status, created_at,
                   {", ".join(_SIGNAL_COLUMNS)}
            FROM claims
            WHERE {" OR ".join(f"{c} IS NOT NULL" for c in _SIGNAL_COLUMNS)}
            """
        )
        columns = [d.name for d in cur.description]
        rows = []
        for record in cur.fetchall():
            row = dict(zip(columns, record))
            row["id"] = str(row["id"])
            rows.append(row)

    return _cluster_claims(rows)
