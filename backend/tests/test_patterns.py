"""Tests for the peeling-chain detector and mixing-round detector."""

from __future__ import annotations

import pandas as pd

from pipeline.patterns import detect_mixing_rounds, detect_peeling_chains


def _chain_df(hops: int, start_value: float = 10.0, peel_frac: float = 0.06):
    """A synthetic peel chain: each hop forwards ~90% and sheds a small payout."""
    rows = []
    carry = start_value
    ts = pd.Timestamp("2026-03-01T06:00:00Z")
    for hop in range(hops):
        peel = round(carry * peel_frac, 6)
        forward = round(carry - peel, 6)
        rows.append({
            "txid": f"tx{hop:02d}",
            "timestamp": ts + pd.Timedelta(minutes=20 * hop),
            "src_ip": "10.0.0.9",
            "input_addresses": [f"w{hop}"],
            "output_addresses": [f"w{hop + 1}", f"cash{hop}"],
            "input_amounts": [carry],
            "output_amounts": [forward, peel],
        })
        carry = forward
    return pd.DataFrame(rows)


def test_detects_planted_chain():
    df = _chain_df(hops=6)
    chains, assignment = detect_peeling_chains(df, min_hops=4)
    assert len(chains) == 1
    chain = chains[0]
    assert chain["hops"] >= 4
    assert chain["wallets"][0] == "w0"
    assert chain["wallets"][-1] == f"w{chain['hops']}"
    assert chain["value_end"] < chain["value_start"]
    # every chain txid is tagged with its hop
    assert set(assignment) == {row["txid"] for row in df.itertuples()}


def test_ignores_short_flows_below_min_hops():
    df = _chain_df(hops=2)
    chains, _ = detect_peeling_chains(df, min_hops=4)
    assert chains == []


def test_two_chains_stay_separate():
    df = pd.concat([_chain_df(hops=5), _chain_df(hops=5)], ignore_index=True)
    df["txid"] = [f"{t}-{i // 5}" for i, t in enumerate(df["txid"])]
    # give the second chain its own wallets
    for idx in range(5, 10):
        row = df.loc[idx]
        df.at[idx, "input_addresses"] = [w + "b" for w in row["input_addresses"]]
        df.at[idx, "output_addresses"] = [w + "b" for w in row["output_addresses"]]
    chains, _ = detect_peeling_chains(df, min_hops=4)
    assert len(chains) == 2


def test_detects_coinjoin_round():
    ts = pd.Timestamp("2026-03-01T07:00:00Z")
    join = {
        "txid": "cj1",
        "timestamp": ts,
        "src_ip": "10.0.0.5",
        "input_addresses": [f"in{i}" for i in range(9)],
        "output_addresses": [f"out{i}" for i in range(9)],
        "input_amounts": [0.25] * 9,
        "output_amounts": [0.25] * 9,
        "script_type": "P2WPKH",
    }
    normal = {
        "txid": "n1",
        "timestamp": ts,
        "src_ip": "10.0.0.5",
        "input_addresses": ["a"],
        "output_addresses": ["b", "c", "d"],
        "input_amounts": [0.6],
        "output_amounts": [0.3, 0.2, 0.1],
        "script_type": "P2WPKH",
    }
    df = pd.DataFrame([normal, join])
    hits, assignment = detect_mixing_rounds(df, min_outputs=5)
    assert len(hits) == 1
    hit = hits[0]
    assert hit["txid"] == "cj1"
    assert hit["inputs"] == 9 and hit["outputs"] == 9
    assert hit["equal_outputs"] == 9
    assert hit["score"] > 0.8
    assert "cj1" in assignment


def test_mixed_output_tx_is_not_mixing():
    ts = pd.Timestamp("2026-03-01T07:00:00Z")
    df = pd.DataFrame([{
        "txid": "n1",
        "timestamp": ts,
        "src_ip": "10.0.0.5",
        "input_addresses": ["a"],
        "output_addresses": ["b", "c", "d", "e", "f", "g"],
        "input_amounts": [1.0],
        "output_amounts": [0.5, 0.2, 0.1, 0.08, 0.07, 0.05],  # all different
        "script_type": "P2WPKH",
    }])
    hits, _ = detect_mixing_rounds(df, min_outputs=5)
    assert hits == []
