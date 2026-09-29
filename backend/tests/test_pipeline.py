"""End-to-end pipeline test: synthetic generator → full analysis payload."""

from __future__ import annotations

import os
import sys

from generate_data import Generator
from pipeline import ingest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.orchestrator import run_analysis, summarize_dataset  # noqa: E402


def _analysis(rows: int = 3000):
    gen = Generator(rows=rows, seed=42)
    raw, labels, planted = gen.generate()
    for rec, label in zip(raw, labels):
        rec["ground_truth"] = label
    records, reasons = ingest.parse_records(raw)
    meta = summarize_dataset(records, reasons, "test", "synthetic", ingest.detected_fields(raw[:50]))
    meta["planted_patterns"] = planted
    return run_analysis(records, meta)


def test_generator_plants_ground_truth():
    gen = Generator(rows=2000, seed=7)
    raw, labels, planted = gen.generate()
    assert len(raw) == len(labels) == 2000
    assert sum(labels) > 0, "expected illicit rows"
    assert any(k.startswith("chain_ID_") for k in planted)
    assert any(k.startswith("ID_CJ-") for k in planted)
    assert planted.get("seed_wallets")


def test_full_analysis_payload_shape():
    analysis = _analysis()
    assert analysis["kpis"]["transactions"] == 3000
    assert analysis["kpis"]["peeling_chains"] >= 1
    assert analysis["kpis"]["mixing_rounds"] >= 1
    assert analysis["alerts"], "expected alerts"
    assert analysis["graph"]["nodes"], "expected graph nodes"
    node_types = {n["type"] for n in analysis["graph"]["nodes"]}
    assert node_types <= {"wallet", "tx", "ip"}


def test_analysis_detects_planted_patterns():
    analysis = _analysis()
    types = {a["type"] for a in analysis["alerts"]}
    assert "Peeling chain" in types, "planted peel chain must surface in alerts"
    assert "Mixing" in types, "planted CoinJoin-like round must surface in alerts"
    assert analysis["metrics"]["patterns"]["chains_recovered"] >= 1
    assert analysis["metrics"]["patterns"]["rounds_recovered"] >= 1


def test_metrics_computed_against_ground_truth():
    analysis = _analysis()
    tx = analysis["metrics"]["transaction"]
    assert tx["available"] and tx["labelled_rows"] > 0
    assert tx["roc_auc"] is not None and tx["roc_auc"] > 0.9  # rows are strongly separable
    for alert in analysis["alerts"]:
        assert alert["reasons"] and alert["confidence"] > 0
