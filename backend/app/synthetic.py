"""Synthetic dataset generator.

Creates realistic Bitcoin transaction/network metadata with injected laundering
behaviours (peeling chains, bursts, layering, CoinJoin-like rounds) so the ML
pipeline has known anomalies to surface. Mirrors the SIH26146 field contract:

    timestamp, src_ip, dst_ip, src_port, dst_port, txid, input_addresses[],
    output_addresses[], input_amounts[], output_amounts[], fee, script_type,
    geo_country, asn
"""

from __future__ import annotations

import random
import string
from datetime import datetime, timedelta, timezone

from .config import SYNTHETIC_RECORDS

COUNTRIES = [
    "India", "United States", "Germany", "Singapore", "Netherlands",
    "Japan", "Canada", "United Kingdom", "Brazil", "Australia",
]
ASNS = ["AS4755", "AS7922", "AS3320", "AS9506", "AS45102", "AS16509", "AS13335", "AS6939"]
SCRIPTS = ["P2WPKH", "P2SH", "P2PKH", "P2TR", "P2WSH"]
PORTS = [8333, 8334, 18333, 9050, 9150]


def _txid(rng: random.Random) -> str:
    return "".join(rng.choice(string.hexdigits.lower()) for _ in range(64))


def _wallet(rng: random.Random) -> str:
    return "bc1q" + "".join(rng.choice("023456789acdefghjklmnpqrstuvwxyz") for _ in range(38))


def generate_synthetic_dataset(records: int = SYNTHETIC_RECORDS, seed: int = 7) -> list[dict]:
    """Build a synthetic metadata dataset with ~7% anomalous behaviour."""
    rng = random.Random(seed)
    start = datetime(2026, 3, 12, 7, 12, 0, tzinfo=timezone.utc)
    rows: list[dict] = []

    ip_pool = [f"103.{18 + (i % 201)}.{10 + (i % 190)}.{4 + (i % 241)}" for i in range(140)]
    wallet_pool = [_wallet(rng) for _ in range(320)]

    def base_row(ts: datetime) -> dict:
        src_ip, dst_ip = rng.choice(ip_pool), rng.choice(ip_pool)
        src_w = rng.choice(wallet_pool)
        dst_w = rng.choice(wallet_pool)
        amount = round(rng.uniform(0.005, 0.9), 4)
        return {
            "timestamp": ts.isoformat(),
            "src_ip": src_ip,
            "dst_ip": dst_ip,
            "src_port": rng.choice(PORTS),
            "dst_port": rng.choice(PORTS),
            "txid": _txid(rng),
            "input_addresses": [src_w],
            "output_addresses": [dst_w],
            "input_amounts": [amount],
            "output_amounts": [round(amount * rng.uniform(0.965, 0.995), 4)],
            "fee": round(rng.uniform(2_000, 40_000)),
            "script_type": rng.choice(SCRIPTS),
            "geo_country": rng.choice(COUNTRIES),
            "asn": rng.choice(ASNS),
        }

    normal_count = int(records * 0.9)
    anomaly_budget = records - normal_count

    # --- Normal traffic ---------------------------------------------------
    for i in range(normal_count):
        ts = start + timedelta(minutes=rng.randint(0, 16 * 24 * 60))
        rows.append(base_row(ts))

    # --- Anomaly 1: peeling chains ---------------------------------------
    for _ in range(max(1, anomaly_budget // 5)):
        ts = start + timedelta(minutes=rng.randint(0, 16 * 24 * 60))
        value = round(rng.uniform(1.5, 6.0), 4)
        src_w = rng.choice(wallet_pool)
        src_ip = rng.choice(ip_pool)
        hops = rng.randint(4, 8)
        for hop in range(hops):
            dst_w = rng.choice(wallet_pool)
            peel = round(value * rng.uniform(0.82, 0.92), 4)
            row = base_row(ts + timedelta(minutes=hop * rng.randint(1, 9)))
            row.update({
                "input_addresses": [src_w],
                "output_addresses": [dst_w],
                "input_amounts": [value],
                "output_amounts": [peel],
                "src_ip": src_ip,
                "dst_ip": rng.choice(ip_pool),
            })
            rows.append(row)
            src_w, value = dst_w, peel

    # --- Anomaly 2: transaction bursts ------------------------------------
    for _ in range(max(1, anomaly_budget // 5)):
        ts = start + timedelta(minutes=rng.randint(0, 16 * 24 * 60))
        src_w = rng.choice(wallet_pool)
        src_ip = rng.choice(ip_pool)
        for _burst in range(rng.randint(8, 14)):
            row = base_row(ts)
            row.update({
                "input_addresses": [src_w],
                "src_ip": src_ip,
                "input_amounts": [round(rng.uniform(0.8, 3.2), 4)],
            })
            rows.append(row)
            ts += timedelta(seconds=rng.randint(4, 45))

    # --- Anomaly 3: layering / high fan-out hubs --------------------------
    for _ in range(max(1, anomaly_budget // 5)):
        ts = start + timedelta(minutes=rng.randint(0, 16 * 24 * 60))
        hub = rng.choice(wallet_pool)
        hub_ip = rng.choice(ip_pool)
        value = round(rng.uniform(2.0, 8.0), 4)
        row = base_row(ts)
        outs = [rng.choice(wallet_pool) for _ in range(rng.randint(6, 12))]
        row.update({
            "input_addresses": [hub],
            "output_addresses": outs,
            "input_amounts": [value],
            "output_amounts": [round(value / len(outs), 4)] * len(outs),
            "src_ip": hub_ip,
        })
        rows.append(row)

    # --- Anomaly 4: CoinJoin-like equal outputs ---------------------------
    for _ in range(max(1, anomaly_budget // 5)):
        ts = start + timedelta(minutes=rng.randint(0, 16 * 24 * 60))
        value = round(rng.uniform(0.5, 2.5), 4)
        row = base_row(ts)
        outs = [rng.choice(wallet_pool) for _ in range(rng.randint(5, 10))]
        row.update({
            "input_addresses": [rng.choice(wallet_pool) for _ in range(rng.randint(3, 8))],
            "output_addresses": outs,
            "input_amounts": [value] * len(row["input_addresses"]),
            "output_amounts": [round(value / len(outs), 4)] * len(outs),
        })
        rows.append(row)

    # --- Anomaly 5: geographic anomalies ----------------------------------
    for _ in range(max(1, anomaly_budget - 4 * (anomaly_budget // 5))):
        row = base_row(start + timedelta(minutes=rng.randint(0, 16 * 24 * 60)))
        row.update({"geo_country": rng.choice(["Nigeria", "Russia", "Iran"]), "asn": "AS45102"})
        rows.append(row)

    rows.sort(key=lambda r: r["timestamp"])
    return rows
