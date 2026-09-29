"""Tests for union-find common-input-ownership clustering."""

from __future__ import annotations

import pandas as pd

from pipeline.clustering import UnionFind, build_entity_clusters, common_input_groups


def _row(txid: str, inputs: list[str], outputs: list[str]) -> dict:
    return {
        "txid": txid,
        "input_addresses": inputs,
        "output_addresses": outputs,
        "input_amounts": [1.0] * len(inputs),
        "output_amounts": [1.0] * len(outputs),
        "src_ip": "10.0.0.1",
        "geo_country": "India",
        "timestamp": pd.Timestamp("2026-03-01T10:00:00Z"),
    }


def test_union_find_basic_groups():
    uf = UnionFind()
    uf.union("a", "b")
    uf.union("b", "c")
    uf.union("d", "e")
    groups = {frozenset(g) for g in uf.groups().values()}
    assert frozenset({"a", "b", "c"}) in groups
    assert frozenset({"d", "e"}) in groups


def test_union_find_idempotent_and_transitive():
    uf = UnionFind()
    uf.union("a", "b")
    uf.union("a", "b")  # idempotent
    uf.union("c", "d")
    uf.union("b", "c")  # transitive merge
    assert uf.find("a") == uf.find("d")


def test_common_input_groups_detects_co_spend():
    df = pd.DataFrame([
        _row("tx1", ["w1", "w2"], ["w3"]),
        _row("tx2", ["w2", "w4"], ["w5"]),  # links w4 into the same owner group
        _row("tx3", ["w6"], ["w7"]),        # single input → no ownership signal
    ])
    groups = common_input_groups(df)
    merged = set().union(*groups)
    assert {"w1", "w2", "w4"} <= merged
    assert "w6" not in merged


def test_build_entity_clusters_reports_heuristics():
    df = pd.DataFrame([
        _row("tx1", ["w1", "w2"], ["w3"]),
        _row("tx2", ["w1", "w2"], ["w4"]),
    ])
    clusters = build_entity_clusters(df)
    assert clusters, "expected at least one cluster"
    assert all(c["heuristic"] in {"common_input_ownership", "embedding_similarity"} for c in clusters)
    co_spent = next(c for c in clusters if {"w1", "w2"} <= set(c["members"]))
    assert co_spent["heuristic"] == "common_input_ownership"
    assert co_spent["shared_ips"] == ["10.0.0.1"]
