"""Tests for the alert ranking/explanation builder."""

from __future__ import annotations

import pandas as pd

from pipeline.alerts import build_alerts, risk_band


def _chain(cid="PC-001", hops=6):
    return {
        "id": cid,
        "hops": hops,
        "start": "tx0",
        "end": "tx5",
        "wallets": [f"w{i}" for i in range(hops + 1)],
        "value_start": 10.0,
        "value_end": 6.0,
        "decay_ratio": 0.6,
        "start_time": "2026-03-01T06:00:00+00:00",
        "end_time": "2026-03-01T08:00:00+00:00",
        "txids": [f"tx{i}" for i in range(hops)],
    }


def _wallets():
    return {
        "seed_wallet": {
            "anomaly": 0.98, "risk": 0.95, "seed": True,
            "contributions": [{"feature": "amt_z", "contribution": 0.5}],
            "last_seen": "2026-03-02T00:00:00+00:00", "ips": ["10.0.0.1"], "hops": 0,
        },
        "chain_wallet": {
            "anomaly": 0.7, "risk": 0.5, "seed": False,
            "contributions": [{"feature": "degree", "contribution": 0.4}],
            "last_seen": "2026-03-02T00:00:00+00:00", "ips": ["10.0.0.2"], "hops": 2,
        },
        "plain_wallet": {
            "anomaly": 0.05, "risk": 0.01, "seed": False, "contributions": [],
            "last_seen": "", "ips": ["10.0.0.3"], "hops": None,
        },
    }


def _clusters():
    return {
        "seed_wallet": [{"id": "CL-001", "members": ["seed_wallet", "other"], "size": 2,
                          "heuristic": "common_input_ownership", "shared_ips": ["10.0.0.1"]}],
        "chain_wallet": [],
        "plain_wallet": [],
    }


def test_risk_band_boundaries():
    assert risk_band(0.95) == "Critical"
    assert risk_band(0.90) == "Critical"
    assert risk_band(0.75) == "High"
    assert risk_band(0.5) == "Medium"
    assert risk_band(0.1) == "Low"


def test_alerts_have_reasons_confidence_evidence():
    chain = _chain()
    alerts = build_alerts(
        wallets=_wallets(),
        clusters_by_wallet=_clusters(),
        peeling_chains=[chain],
        peeling_assignment={},
        mixing_hits=[],
        tx_rows=[{"txid": "tx0", "input_addresses": ["chain_wallet"], "output_addresses": []}],
        graph=None,
        min_alert_score=0.5,
    )
    assert alerts, "expected alerts"
    for alert in alerts:
        assert alert["reasons"], alert
        assert 0 < alert["confidence"] <= 0.99
        assert 0 <= alert["risk_score"] <= 100
        evidence = alert["evidence"]
        assert evidence["txids"] or evidence["ips"] or evidence["wallets"], alert["id"]


def test_peeling_chain_wallet_is_typed_and_ranked():
    chain = _chain()
    alerts = build_alerts(
        wallets=_wallets(),
        clusters_by_wallet=_clusters(),
        peeling_chains=[chain],
        peeling_assignment={},
        mixing_hits=[],
        tx_rows=[],
        graph=None,
        min_alert_score=0.5,
    )
    chain_alert = next(a for a in alerts if a["entity"]["id"] == "chain_wallet")
    assert chain_alert["type"] == "Peeling chain"
    assert any("peeling chain" in r for r in chain_alert["reasons"])
    assert chain_alert["evidence"]["chain"]["id"] == "PC-001"


def test_seed_wallets_rank_above_plain_anomalies():
    chain = _chain()
    alerts = build_alerts(
        wallets=_wallets(),
        clusters_by_wallet=_clusters(),
        peeling_chains=[chain],
        peeling_assignment={},
        mixing_hits=[],
        tx_rows=[],
        graph=None,
        min_alert_score=0.5,
    )
    ids = [a["entity"]["id"] for a in alerts]
    assert ids.index("seed_wallet") < ids.index("chain_wallet")
    assert "plain_wallet" not in ids  # below the alert threshold
    assert alerts[0]["risk_score"] >= alerts[-1]["risk_score"]


def test_pattern_level_alerts_generated():
    chain = _chain()
    mix = {
        "id": "CJ-001", "txid": "cjtx", "timestamp": "2026-03-01T07:00:00+00:00",
        "inputs": 9, "outputs": 9, "equal_outputs": 9, "value_btc": 2.25,
        "uniform_script": True, "score": 0.95,
        "input_wallets": ["m1", "m2"], "output_wallets": ["m3"],
    }
    alerts = build_alerts(
        wallets={w: {"anomaly": 0.1, "risk": 0.1, "seed": False, "contributions": [],
                     "last_seen": "", "ips": [], "hops": None} for w in ("m1", "m2", "m3")},
        clusters_by_wallet={},
        peeling_chains=[chain],
        peeling_assignment={},
        mixing_hits=[mix],
        tx_rows=[],
        graph=None,
        min_alert_score=0.5,
    )
    types = {a["type"] for a in alerts}
    assert "Peeling chain" in types and "Mixing" in types
    mixing_alert = next(a for a in alerts if a["type"] == "Mixing")
    assert mixing_alert["evidence"]["txids"] == ["cjtx"]
    assert mixing_alert["entity"]["id"] == "CJ-001"


def test_sequential_alert_ids():
    alerts = build_alerts(
        wallets=_wallets(),
        clusters_by_wallet=_clusters(),
        peeling_chains=[_chain()],
        peeling_assignment={},
        mixing_hits=[],
        tx_rows=[],
        graph=None,
        min_alert_score=0.5,
        cap=50,
    )
    assert alerts[0]["id"] == "ALT-0001"
    assert all(a["id"] for a in alerts)
