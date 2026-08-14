import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from verity.fraud_ring import _cluster_claims


def _claim(cid, name, amount=100_000, status="pending", bank=None, address=None):
    return {
        "id": cid,
        "claimant_name": name,
        "amount_cents": amount,
        "status": status,
        "created_at": "2026-01-01T00:00:00Z",
        "bank_account_last4": bank,
        "claimant_address": address,
    }


def test_no_shared_attributes_produces_no_rings():
    rows = [_claim("a", "Alice"), _claim("b", "Bob")]
    assert _cluster_claims(rows) == []


def test_two_claims_sharing_a_bank_account_form_a_ring():
    rows = [
        _claim("a", "Alice", bank="1111"),
        _claim("b", "Bob", bank="1111"),
    ]
    rings = _cluster_claims(rows)
    assert len(rings) == 1
    assert {c["id"] for c in rings[0]["claims"]} == {"a", "b"}
    assert rings[0]["edges"] == [{"from": "a", "to": "b", "kind": "bank_account_last4", "value": "1111"}]


def test_two_claims_sharing_an_address_form_a_ring():
    rows = [
        _claim("a", "Alice", address="1 Main St"),
        _claim("b", "Bob", address="1 Main St"),
    ]
    rings = _cluster_claims(rows)
    assert len(rings) == 1
    assert {c["id"] for c in rings[0]["claims"]} == {"a", "b"}


def test_transitive_bridge_merges_two_attribute_groups_into_one_ring():
    """A-B share a bank account; B-C share an address. A and C share nothing
    directly, but must end up in the same ring because B bridges them - the
    whole point of using connected components instead of one GROUP BY."""
    rows = [
        _claim("a", "Alice", bank="1111"),
        _claim("b", "Bob", bank="1111", address="1 Main St"),
        _claim("c", "Carol", address="1 Main St"),
    ]
    rings = _cluster_claims(rows)
    assert len(rings) == 1
    assert {c["id"] for c in rings[0]["claims"]} == {"a", "b", "c"}
    kinds = {e["kind"] for e in rings[0]["edges"]}
    assert kinds == {"bank_account_last4", "claimant_address"}


def test_unrelated_claim_does_not_join_an_existing_ring():
    rows = [
        _claim("a", "Alice", bank="1111"),
        _claim("b", "Bob", bank="1111"),
        _claim("c", "Carol", bank="2222"),
    ]
    rings = _cluster_claims(rows)
    assert len(rings) == 1
    assert {c["id"] for c in rings[0]["claims"]} == {"a", "b"}


def test_two_independent_rings_are_both_reported():
    rows = [
        _claim("a", "Alice", bank="1111"),
        _claim("b", "Bob", bank="1111"),
        _claim("c", "Carol", address="1 Main St"),
        _claim("d", "Dave", address="1 Main St"),
    ]
    rings = _cluster_claims(rows)
    assert len(rings) == 2
    ring_id_sets = {frozenset(c["id"] for c in ring["claims"]) for ring in rings}
    assert ring_id_sets == {frozenset({"a", "b"}), frozenset({"c", "d"})}


def test_total_amount_cents_sums_the_ring():
    rows = [
        _claim("a", "Alice", amount=100_000, bank="1111"),
        _claim("b", "Bob", amount=250_000, bank="1111"),
    ]
    rings = _cluster_claims(rows)
    assert rings[0]["total_amount_cents"] == 350_000


def test_claim_display_fields_exclude_raw_identity_attributes():
    rows = [
        _claim("a", "Alice", bank="1111"),
        _claim("b", "Bob", bank="1111"),
    ]
    rings = _cluster_claims(rows)
    for claim in rings[0]["claims"]:
        assert "bank_account_last4" not in claim
        assert "claimant_address" not in claim
