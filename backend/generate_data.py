"""Synthetic dataset generator with planted ground-truth patterns.

Generates realistic Bitcoin transaction/network metadata (normal wallets,
exchanges, merchants) and plants forensic ground truth:

    * peeling chains (PC-01…) — large output hops with small side payouts
    * CoinJoin-style mixing rounds (CJ-01…)
    * seed illicit wallets (ransomware / darknet market / extortion)
    * wallet clusters sharing IPs (cash-out infrastructure)
    * layering/cash-out sequences

The ``ground_truth`` column (1 = illicit-involved row, 0 = normal) is exported
to a separate ``*_ground_truth.csv`` file used ONLY by the metrics module —
never by the models themselves.

CLI:
    python generate_data.py --rows 20000 --seed 42 --out data/sample.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import string
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

COUNTRIES = [
    ("India", "AS4755"), ("United States", "AS7922"), ("Germany", "AS3320"),
    ("Singapore", "AS9506"), ("Netherlands", "AS45102"), ("Japan", "AS2497"),
    ("Canada", "AS577"), ("United Kingdom", "AS2856"), ("Brazil", "AS28573"),
    ("Australia", "AS1221"), ("France", "AS3215"), ("Russia", "AS8359"),
]
SCRIPTS = ["P2WPKH", "P2SH", "P2PKH", "P2TR", "P2WSH"]
PORTS = [8333, 8334, 18333, 8332, 9050, 9150, 9051]

FIELDS = [
    "timestamp", "src_ip", "dst_ip", "src_port", "dst_port", "txid",
    "input_addresses", "output_addresses", "input_amounts", "output_amounts",
    "fee", "script_type", "geo_country", "asn",
]


def _txid(rng: random.Random) -> str:
    return "".join(rng.choice("0123456789abcdef") for _ in range(64))


def _wallet(rng: random.Random) -> str:
    return "bc1q" + "".join(rng.choice("023456789acdefghjklmnpqrstuvwxyz") for _ in range(38))


class Generator:
    def __init__(self, rows: int, seed: int):
        self.rng = random.Random(seed)
        self.rows = rows
        self.start = datetime(2026, 3, 1, 6, 0, 0, tzinfo=timezone.utc)
        self.span_minutes = 21 * 24 * 60  # three weeks of traffic
        self.records: list[dict] = []
        self.labels: list[int] = []          # parallel ground truth per record
        self.planted: dict[str, str] = {}    # extra label facts for metrics
        self.wallet_pool = [_wallet(self.rng) for _ in range(max(300, rows // 25))]
        self.exchange_wallets = [_wallet(self.rng) for _ in range(24)]
        self.merchant_wallets = [_wallet(self.rng) for _ in range(40)]
        self.seed_wallets = [_wallet(self.rng) for _ in range(6)]
        self.seed_names = ["ransomware", "darknet_market", "extortion", "ransomware", "darknet_market", "extortion"]
        self.chain_counter = 0
        self.cj_counter = 0
        self.illicit_wallets: set[str] = set()  # curated wallet-level ground truth

    # -- helpers ------------------------------------------------------------
    def _ts(self) -> str:
        off = self.rng.randint(0, self.span_minutes)
        return (self.start + timedelta(minutes=off)).isoformat()

    def _ip(self, private: bool = False) -> str:
        if private:
            return f"10.{self.rng.randint(0, 60)}.{self.rng.randint(0, 250)}.{self.rng.randint(2, 250)}"
        return f"{self.rng.choice([45, 51, 77, 89, 103, 114, 130, 147, 162, 176, 185, 190, 203])}." \
               f"{self.rng.randint(0, 250)}.{self.rng.randint(0, 250)}.{self.rng.randint(2, 250)}"

    def _row(self, ts: str, src_ip: str, dst_ip: str, inputs: list[str], outputs: list[str],
             in_amts: list[float], out_amts: list[float], label: int = 0,
             script: str | None = None) -> None:
        self.records.append({
            "timestamp": ts,
            "src_ip": src_ip,
            "dst_ip": dst_ip,
            "src_port": self.rng.choice(PORTS),
            "dst_port": self.rng.choice(PORTS),
            "txid": _txid(self.rng),
            "input_addresses": ";".join(inputs),
            "output_addresses": ";".join(outputs),
            "input_amounts": ";".join(f"{a:.6f}" for a in in_amts),
            "output_amounts": ";".join(f"{a:.6f}" for a in out_amts),
            "fee": str(self.rng.randint(500, 60000)),
            "script_type": script or self.rng.choice(SCRIPTS),
            "geo_country": self.rng.choice(COUNTRIES)[0],
            "asn": self.rng.choice(COUNTRIES)[1],
        })
        self.labels.append(label)

    # -- normal background traffic ------------------------------------------
    def background(self, count: int) -> None:
        for _ in range(count):
            roll = self.rng.random()
            ts = self._ts()
            if roll < 0.55:  # simple spends between normal wallets
                amt = round(self.rng.uniform(0.0005, 0.8), 6)
                change = round(amt * self.rng.uniform(0, 0.35), 6)
                out = round(amt - change, 6)
                self._row(ts, self._ip(), self._ip(),
                          [self.rng.choice(self.wallet_pool)],
                          [self.rng.choice(self.wallet_pool), self.rng.choice(self.wallet_pool)],
                          [amt], [out, change])
            elif roll < 0.75:  # exchange deposits/withdrawals (KYC IP, single-owner input)
                amt = round(self.rng.uniform(0.5, 12), 6)
                self._row(ts, self._ip(), "91.203.110.7",  # fixed exchange IP block
                          [self.rng.choice(self.wallet_pool)],
                          [self.rng.choice(self.exchange_wallets)],
                          [amt], [amt], script="P2SH")
            elif roll < 0.95:  # merchant payments
                amt = round(self.rng.choice([0.005, 0.01, 0.02, 0.025, 0.05, 0.1]), 6)
                self._row(ts, self._ip(), self._ip(),
                          [self.rng.choice(self.wallet_pool)],
                          [self.rng.choice(self.merchant_wallets)],
                          [amt], [amt])
            else:  # CoinJoin-adjacent noise: medium fan-out but NOT equal outputs
                outs = self.rng.sample(self.wallet_pool, self.rng.randint(3, 4))
                amt = round(self.rng.uniform(0.2, 1.0), 6)
                split = [round(amt * w, 6) for w in
                         (self.rng.uniform(0.2, 0.5), self.rng.uniform(0.2, 0.4), self.rng.uniform(0.05, 0.2))[:len(outs)]]
                self._row(ts, self._ip(), self._ip(),
                          [self.rng.choice(self.wallet_pool)], outs,
                          [amt], split[:len(outs)])

    # -- planted pattern 1: peeling chains -----------------------------------
    def peeling_chains(self, chains: int = 5) -> None:
        for _ in range(chains):
            self.chain_counter += 1
            chain_id = f"PC-{self.chain_counter:03d}"
            hops = self.rng.randint(6, 9)
            value = round(self.rng.uniform(8, 40), 4)
            carrier = self.rng.choice(self.seed_wallets)
            src_ip = self._ip(private=True)
            chain_wallets = [carrier]
            ts0 = self.start + timedelta(minutes=self.rng.randint(0, self.span_minutes - hops * 45))
            clock = ts0
            for hop in range(hops):
                nxt = self.rng.choice(self.wallet_pool)
                peel = round(self.rng.uniform(0.02, 0.08) * value, 6)
                forward = round(value - peel, 6)
                # strictly increasing time so the hop sequence is real (a peel
                # chain progresses; the detector walks forward in time)
                clock = clock + timedelta(minutes=self.rng.randint(12, 40))
                self._row(clock.isoformat(), src_ip, self._ip(), [carrier],
                          [nxt, self.rng.choice(self.wallet_pool)],
                          [value], [forward, peel], label=1)
                self.planted[f"chain_ID_{chain_id}_hop{hop}"] = "1"
                chain_wallets.append(nxt)
                self.illicit_wallets.add(nxt)
                carrier, value = nxt, forward
            self.planted[f"chain_ID_{chain_id}_hops"] = str(hops)
            self.planted[f"chain_ID_{chain_id}_seed"] = chain_wallets[0]
            for w in chain_wallets:
                self.planted[f"wallet_chain_{w}"] = chain_id

    # -- planted pattern 2: CoinJoin-like rounds ------------------------------
    def coinjoin_rounds(self, rounds: int = 6) -> None:
        for _ in range(rounds):
            self.cj_counter += 1
            cj_id = f"CJ-{self.cj_counter:03d}"
            n = self.rng.randint(8, 14)
            denom = self.rng.choice([0.1, 0.25, 0.5, 1.0])
            inputs = self.rng.sample(self.wallet_pool, n)
            # a seed wallet and some tainted wallets join the round
            inputs[self.rng.randrange(n)] = self.rng.choice(self.seed_wallets)
            outputs = self.rng.sample(self.wallet_pool, n)
            ts = self._ts()
            self._row(ts, self._ip(), self._ip(), inputs, outputs,
                      [denom] * n, [denom] * n, label=1, script="P2WPKH")
            self.planted[f"ID_{cj_id}_tx"] = "1"
            for w in inputs + outputs:
                self.planted[f"wallet_cj_{w}"] = cj_id

    # -- planted pattern 3: seed wallets + cash-out infrastructure ------------
    def seed_infrastructure(self, clusters: int = 3) -> None:
        """Ransomware/darknet/extortion seeds that share IPs and cash out.

        Members repeatedly co-spend (consolidation) before withdrawing, which
        is what the common-input-ownership heuristic should recover.
        """
        for c in range(clusters):
            shared_ip = self._ip(private=True)
            members = self.rng.sample(self.wallet_pool, self.rng.randint(4, 6))
            seed = self.seed_wallets[c]
            self.illicit_wallets.update(members)
            for w in [seed] + members:
                amt = round(self.rng.uniform(0.4, 6), 4)
                self._row(self._ts(), shared_ip, self._ip(), [w],
                          [self.rng.choice(self.exchange_wallets)],
                          [amt], [round(amt * 0.985, 6)], label=1)
            # repeated consolidations: members pool funds two at a time
            for pair in zip(members, members[1:]):
                for _rep in range(2):
                    amt = round(self.rng.uniform(0.8, 4), 4)
                    self._row(self._ts(), shared_ip, self._ip(), list(pair),
                              [self.rng.choice(self.exchange_wallets)],
                              [amt / 2, amt / 2], [round(amt * 0.99, 6)], label=1)
            self.illicit_wallets.add(seed)
            self.planted[f"ip_cluster_{c}"] = shared_ip

    # -- planted pattern 4: layering / burst cash-out ------------------------
    def layering_bursts(self, bursts: int = 4) -> None:
        for _ in range(bursts):
            src = self.rng.choice(self.seed_wallets)
            self.illicit_wallets.add(src)
            src_ip = self._ip(private=True)
            ts0 = self.rng.randint(0, self.span_minutes - 30)
            for _b in range(self.rng.randint(10, 16)):
                amt = round(self.rng.uniform(0.15, 2.5), 4)
                ts = (self.start + timedelta(minutes=ts0, seconds=self.rng.randint(0, 40 * 60))).isoformat()
                self._row(ts, src_ip, self._ip(), [src],
                          [self.rng.choice(self.wallet_pool)],
                          [amt], [amt], label=1)

    def generate(self) -> tuple[list[dict], list[int], dict[str, str]]:
        total = self.rows
        chains = max(3, total // 4000)
        rounds = max(3, total // 3000)
        bursts = max(2, total // 5000)
        clusters = 3
        reserved = 0
        # reserve space for planted rows (approximate, then fill with background)
        self.peeling_chains(chains)
        self.coinjoin_rounds(rounds)
        self.seed_infrastructure(clusters)
        self.layering_bursts(bursts)
        reserved = len(self.records)
        self.background(max(0, total - reserved))
        # chronological order
        order = sorted(range(len(self.records)), key=lambda i: self.records[i]["timestamp"])
        self.records = [self.records[i] for i in order]
        self.labels = [self.labels[i] for i in order]
        return self.records, self.labels, self.planted


def write_outputs(records: list[dict], labels: list[int], planted: dict[str, str],
                  out_base: str) -> dict[str, str]:
    """Write CSV/JSON/XML variants + separate ground-truth file. Returns paths."""
    base = Path(out_base)
    base.parent.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}

    csv_path = str(base) + ".csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(records)
    paths["csv"] = csv_path

    json_path = str(base) + ".json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(records, fh, indent=1)
    paths["json"] = json_path

    xml_path = str(base) + ".xml"
    root = ET.Element("rows")
    for rec in records:
        row_el = ET.SubElement(root, "row")
        for field in FIELDS:
            ET.SubElement(row_el, field).text = str(rec[field])
    ET.ElementTree(root).write(xml_path, encoding="utf-8", xml_declaration=True)
    paths["xml"] = xml_path

    gt_path = str(base) + "_ground_truth.csv"
    with open(gt_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["row_index", "txid", "ground_truth"])
        for i, (rec, label) in enumerate(zip(records, labels)):
            writer.writerow([i, rec["txid"], label])
    paths["ground_truth"] = gt_path

    meta_path = str(base) + "_planted.json"
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump({"planted": planted,
                   "seed_wallets": [],  # filled by caller when available
                   "illicit_rows": int(sum(labels)),
                   "rows": len(records)}, fh, indent=2)
    paths["planted"] = meta_path
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="BitTrace synthetic dataset generator")
    parser.add_argument("--rows", type=int, default=20000, help="total records to generate")
    parser.add_argument("--seed", type=int, default=42, help="PRNG seed for reproducibility")
    parser.add_argument("--out", type=str, default="data/sample.csv", help="output base path")
    args = parser.parse_args(argv)

    gen = Generator(rows=args.rows, seed=args.seed)
    records, labels, planted = gen.generate()
    planted["seed_wallets"] = ",".join(gen.seed_wallets)
    planted["seed_kinds"] = ",".join(gen.seed_names)
    paths = write_outputs(records, labels, planted, args.out)
    print(f"Generated {len(records):,} records "
          f"({sum(labels):,} illicit-involved rows, {chains_i(len(paths))})")
    for key, path in paths.items():
        print(f"  {key:12s} → {path}")
    return 0


def chains_i(_: int) -> str:
    return "CSV/JSON/XML + ground truth written"


if __name__ == "__main__":
    sys.exit(main())
