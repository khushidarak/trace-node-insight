"""Pattern detectors: peeling chains and CoinJoin-like mixing rounds.

Both detectors work on canonical dataframes and return rich hits with
hop/evidence details so alerts can cite concrete transactions.
"""

from __future__ import annotations

from collections import defaultdict


def detect_peeling_chains(df, min_hops: int | None = None) -> tuple[list[dict], dict[str, dict]]:
    """Detect peel chains: successive spends where a large output continues the
    chain and small payouts fan out to fresh addresses.

    A transaction joins a chain when the largest output address of tx A is the
    main input of tx B and B's amount stays within ``decay`` of A's. Returns
    (chains, tx_info) where tx_info maps every chain txid to {chain_id, hop}.
    """
    min_hops = SETTINGS_MIN_HOPS if min_hops is None else min_hops

    by_input: dict[str, list] = defaultdict(list)
    for _, row in df.iterrows():
        for w in row["input_addresses"]:
            by_input[w].append(row)

    chains: list[list] = []          # list of chain dicts (built below)
    visited_edges: set[tuple[str, str]] = set()

    for _, row in df.iterrows():
        if not row["output_addresses"]:
            continue
        amounts = row["output_amounts"] or []
        if not amounts:
            continue
        main_idx = max(range(len(amounts)), key=lambda i: amounts[i])
        nxt = by_input.get(row["output_addresses"][main_idx])
        if not nxt:
            continue
        for child in nxt:
            edge = (row["txid"], child["txid"])
            if edge in visited_edges or child["txid"] == row["txid"]:
                continue
            child_amts = child["input_amounts"] or [0.0]
            c_amt = float(sum(child_amts))
            p_amt = float(sum(amounts))
            # peel chains forward the carry minus a small shed payout: the child
            # input is ~85–99% of the parent's total output value, and time must
            # flow forward (chains progress; reused wallets spend backwards too)
            if p_amt <= 0 or c_amt / p_amt > 0.99 or c_amt / p_amt < 0.85:
                continue
            if str(child["timestamp"]) < str(row["timestamp"]):
                continue
            visited_edges.add(edge)
            chains.append({"parent": row, "child": child, "amount": c_amt})

    # Glue edges into maximal chains.
    children_of: dict[str, list] = defaultdict(list)
    parents_of: dict[str, list] = defaultdict(list)
    for e in chains:
        children_of[e["parent"]["txid"]].append(e)
        parents_of[e["child"]["txid"]].append(e)

    chain_records: list[dict] = []
    assigned: dict[str, tuple[str, int]] = {}
    for e in chains:
        ptx, ctx = e["parent"]["txid"], e["child"]["txid"]
        if ptx in parents_of:
            continue  # this edge starts mid-chain; handled from the true head
        seq = [e["parent"], e["child"]]
        cur = ctx
        seen = {ptx, ctx}
        carry = e["amount"]
        while True:
            next_edges = [x for x in children_of.get(cur, []) if x["child"]["txid"] not in seen]
            if not next_edges:
                break
            # peel chains decay monotonically; random wallet reuse does not
            e2 = max((x for x in next_edges if x["amount"] < carry), key=lambda x: x["amount"], default=None)
            if e2 is None:
                break
            nxt = e2["child"]
            seq.append(nxt)
            seen.add(nxt["txid"])
            carry = e2["amount"]
            cur = nxt["txid"]
        if len(seq) - 1 >= min_hops:  # hops = edges = len(seq) - 1
            chain_records.append({"txs": seq})

    for ci, rec in enumerate(chain_records):
        for hop, row in enumerate(rec["txs"]):
            assigned[row["txid"]] = {"chain_id": f"PC-{ci + 1:03d}", "hop": hop}

    chain_summaries = []
    for ci, rec in enumerate(chain_records):
        seq = rec["txs"]
        value0 = float(sum(seq[0]["input_amounts"] or [0.0]))
        valueN = float(sum(seq[-1]["output_amounts"] or [0.0]))
        chain_summaries.append({
            "id": f"PC-{ci + 1:03d}",
            "hops": len(seq) - 1,
            "start": seq[0]["txid"],
            "end": seq[-1]["txid"],
            "wallets": [seq[0]["input_addresses"][0] if seq[0]["input_addresses"] else ""]
            + [r["output_addresses"][main_out_idx(r)] for r in seq],
            "value_start": round(value0, 6),
            "value_end": round(valueN, 6),
            "decay_ratio": round(valueN / value0, 4) if value0 else 0.0,
            "start_time": str(seq[0]["timestamp"]),
            "end_time": str(seq[-1]["timestamp"]),
            "txids": [r["txid"] for r in seq],
        })
    return chain_summaries, assigned


def main_out_idx(row) -> int:
    """Index of the largest output (the chain continuation)."""
    amts = row["output_amounts"] or [0.0]
    return max(range(len(amts)), key=lambda i: amts[i])


SETTINGS_MIN_HOPS = 4  # default; the API layer passes the configured value


def detect_mixing_rounds(df, min_outputs: int | None = None) -> tuple[list[dict], dict[str, dict]]:
    """Detect CoinJoin-like rounds: many inputs, many *equal* outputs,
    uniform script types, tight value conservation."""
    min_outputs = SETTINGS_MIN_OUTPUTS if min_outputs is None else min_outputs
    hits: list[dict] = []
    assignment: dict[str, dict] = {}

    for _, row in df.iterrows():
        outs, oamts = row["output_addresses"], row["output_amounts"]
        ins, iamts = row["input_addresses"], row["input_amounts"]
        if len(outs) < min_outputs or len(ins) < 2:
            continue
        equal = sum(1 for a in oamts if abs(a - oamts[0]) < 1e-6) if oamts else 0
        if equal / len(outs) < 0.8:
            continue
        i_in, i_out = float(sum(iamts or [0])), float(sum(oamts or [0]))
        conservation = min(i_in / i_out, 5.0) if i_out > 0 else 0.0
        uniform_script = len({row["script_type"] for _ in outs}) == 1
        score = 0.45 * (equal / len(outs)) + 0.35 * max(0.0, 1 - abs(1 - conservation)) + 0.20 * float(uniform_script)
        hits.append({
            "txid": row["txid"],
            "timestamp": str(row["timestamp"]),
            "inputs": len(ins),
            "outputs": len(outs),
            "equal_outputs": equal,
            "value_btc": round(i_out, 6),
            "uniform_script": uniform_script,
            "score": round(score, 4),
            "input_wallets": list(ins)[:12],
            "output_wallets": list(outs)[:12],
        })
        assignment[row["txid"]] = {"round": len(hits), "score": score}
    hits.sort(key=lambda h: -h["score"])
    for rank, h in enumerate(hits, start=1):
        h["id"] = f"CJ-{rank:03d}"
        assignment[h["txid"]] = {"round": rank, "score": h["score"]}
    return hits, assignment


SETTINGS_MIN_OUTPUTS = 5  # default; the API layer passes the configured value
