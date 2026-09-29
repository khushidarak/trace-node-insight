"""Ranked, explainable alert generation.

Combines anomaly score, pattern hits (peeling chains / mixing rounds),
cluster membership and propagated seed risk into a single ranked alert list.
Every alert carries:

    id, entity (type + id), type, risk_score (0-100), confidence (0-1),
    reasons[] (human-readable), evidence (txids/ips/wallets/hops), timestamp.
"""

from __future__ import annotations

from .config import CRITICAL_THRESHOLD, HIGH_THRESHOLD, MEDIUM_THRESHOLD


def risk_band(score_01: float) -> str:
    if score_01 >= CRITICAL_THRESHOLD:
        return "Critical"
    if score_01 >= HIGH_THRESHOLD:
        return "High"
    if score_01 >= MEDIUM_THRESHOLD:
        return "Medium"
    return "Low"


def _blend(anomaly: float, propagated: float, pattern_boost: float) -> float:
    return min(1.0, 0.45 * anomaly + 0.35 * propagated + 0.20 * pattern_boost)


def _confidence(reason_count: int, patterned: bool, seed: bool) -> float:
    base = 0.45 + 0.08 * min(reason_count, 4)
    if patterned:
        base += 0.12
    if seed:
        base += 0.08
    return round(min(0.99, base), 4)


def build_alerts(
    wallets: dict[str, dict],
    clusters_by_wallet: dict[str, list[dict]],
    peeling_chains: list[dict],
    peeling_assignment: dict[str, dict],
    mixing_hits: list[dict],
    tx_rows: list[dict],
    graph=None,
    min_alert_score: float = 0.5,
    cap: int = 120,
) -> list[dict]:
    """Create the ranked alert list.

    wallets: {wallet_id: {anomaly (0-1), risk (0-1), seed, contributions,
    last_seen, ips, hops}}
    clusters_by_wallet: {wallet_id: [cluster dicts the wallet belongs to]}
    """
    alerts: list[dict] = []

    chain_by_wallet: dict[str, dict] = {}
    for chain in peeling_chains:
        for w in chain.get("wallets", []):
            if w:
                chain_by_wallet[w] = chain
    mixing_by_wallet: dict[str, dict] = {}
    for hit in mixing_hits:
        for w in hit.get("input_wallets", []) + hit.get("output_wallets", []):
            mixing_by_wallet[w] = hit

    seed_ids = sorted(
        (nid[1] for nid in graph.nodes if nid[0] == "wallet" and graph.nodes[nid].get("seed")),
    ) if graph is not None else []

    # --- pattern-level alerts: one per detected chain / mixing round --------
    for chain in peeling_chains:
        start_wallet = chain.get("wallets", [""])[0] if chain.get("wallets") else ""
        info = wallets.get(start_wallet, {})
        anomaly = float(info.get("anomaly", 0.6))
        blended = min(1.0, 0.35 + 0.09 * chain["hops"])
        if blended < min_alert_score:
            continue
        alerts.append({
            "id": "",
            "entity": {"type": "pattern", "id": chain["id"]},
            "type": "Peeling chain",
            "risk_score": int(round(blended * 100)),
            "risk": risk_band(blended),
            "anomaly_score": round(anomaly, 4),
            "propagated_risk": round(float(info.get("risk", 0.0)), 4),
            "confidence": _confidence(3, True, False),
            "reasons": [
                f"Automated {chain['hops']}-hop peeling chain: funds stepped down from "
                f"{chain['value_start']:.3f} to {chain['value_end']:.3f} BTC",
                f"{len(chain['wallets'])} sequential wallets, small payouts shed at each hop",
                f"Spans {str(chain['start_time'])[:16]} → {str(chain['end_time'])[:16]} UTC",
            ],
            "evidence": {
                "txids": chain["txids"][:12], "ips": [], "wallets": chain["wallets"][:10],
                "chain": chain, "mixing": None,
            },
            "timestamp": str(chain["end_time"]),
            "status": "New",
        })
    for mix in mixing_hits:
        blended = min(1.0, 0.3 + 0.5 * float(mix.get("score", 0.5)))
        if blended < min_alert_score:
            continue
        alerts.append({
            "id": "",
            "entity": {"type": "pattern", "id": mix["id"]},
            "type": "Mixing",
            "risk_score": int(round(blended * 100)),
            "risk": risk_band(blended),
            "anomaly_score": 0.0,
            "propagated_risk": 0.0,
            "confidence": _confidence(3, True, False),
            "reasons": [
                f"CoinJoin-like round: {mix['inputs']} inputs → {mix['outputs']} outputs "
                f"({mix['equal_outputs']} equal-value outputs of the same denomination)",
                f"Uniform script type: {mix['uniform_script']}",
                f"{len(set(mix['input_wallets']) | set(mix['output_wallets']))} distinct wallets break the "
                "input-to-output link in this single transaction",
            ],
            "evidence": {
                "txids": [mix["txid"]], "ips": [],
                "wallets": list(dict.fromkeys(mix["input_wallets"] + mix["output_wallets"]))[:10],
                "chain": None, "mixing": mix,
            },
            "timestamp": mix["timestamp"],
            "status": "New",
        })

    for wallet, info in wallets.items():
        anomaly = float(info.get("anomaly", 0.0))
        propagated = float(info.get("risk", 0.0))
        chain = chain_by_wallet.get(wallet)
        mix = mixing_by_wallet.get(wallet)
        cluster_memberships = clusters_by_wallet.get(wallet, [])
        pattern_boost = 0.0
        reasons: list[str] = []
        evidence_txids: list[str] = []
        evidence_ips: list[str] = []
        evidence_wallets: list[str] = []

        if chain is not None:
            hop = _hop_of(chain, wallet)
            pattern_boost = max(pattern_boost, min(1.0, chain["hops"] / 8))
            reasons.append(
                f"Part of a {chain['hops']}-hop peeling chain ({chain['id']})"
                + (f" at hop {hop}" if hop is not None else "")
            )
            evidence_txids.extend(chain["txids"][:10])
        if mix is not None:
            pattern_boost = max(pattern_boost, min(1.0, mix["score"]))
            reasons.append(
                f"CoinJoin-like mixing round {mix['id']}: {mix['inputs']} inputs → {mix['outputs']} outputs "
                f"({mix['equal_outputs']} equal-value)"
            )
            evidence_txids.append(mix["txid"])
        if info.get("seed"):
            pattern_boost = max(pattern_boost, 1.0)
            reasons.append("Flagged as a seed illicit wallet (top anomaly percentile)")
        elif not chain and propagated >= 0.25:
            hops = info.get("hops")
            if hops is not None and seed_ids:
                reasons.append(
                    f"Shares infrastructure with seed wallet {seed_ids[0][:16]}… "
                    f"({hops} hop{'s' if hops != 1 else ''} away on the transaction graph)"
                )
            elif seed_ids:
                reasons.append(
                    f"Risk propagated from seed wallet {seed_ids[0][:16]}… (personalised PageRank)"
                )
        if cluster_memberships:
            c = cluster_memberships[0]
            reasons.append(
                f"Belongs to entity cluster {c['id']} linked by {c['heuristic'].replace('_', ' ')} "
                f"({c['size']} wallets)"
            )
            evidence_wallets.extend([m for m in c["members"] if m != wallet][:5])
            for shared_ip in c.get("shared_ips", [])[:2]:
                evidence_ips.append(shared_ip)
        if info.get("ips"):
            evidence_ips.extend(info["ips"][:2])
        if wallet in chain_by_wallet and not chain:
            chain = chain_by_wallet[wallet]

        reasons.extend(_anomaly_reasons(info))
        if not reasons:
            continue

        blended = _blend(anomaly, propagated, pattern_boost)
        if blended < min_alert_score:
            continue
        alerts.append({
            "id": "",
            "entity": {"type": "wallet", "id": wallet},
            "type": _alert_type(chain, mix, info.get("seed", False), bool(cluster_memberships)),
            "risk_score": int(round(blended * 100)),
            "risk": risk_band(blended),
            "anomaly_score": round(anomaly, 4),
            "propagated_risk": round(propagated, 4),
            "confidence": _confidence(len(reasons), chain is not None or mix is not None, info.get("seed", False)),
            "reasons": reasons,
            "evidence": {
                "txids": list(dict.fromkeys(evidence_txids))[:12],
                "ips": list(dict.fromkeys(evidence_ips))[:6],
                "wallets": list(dict.fromkeys(evidence_wallets))[:8],
                "chain": chain,
                "mixing": mix,
            },
            "timestamp": info.get("last_seen", ""),
            "status": "New",
        })

    alerts.sort(key=lambda a: -a["risk_score"])
    # every alert must cite evidence — fall back to the wallet's own txs/ips
    tx_by_wallet: dict[str, list[str]] = {}
    for row in tx_rows:
        for w in row["input_addresses"] + row["output_addresses"]:
            tx_by_wallet.setdefault(w, []).append(row["txid"])
    for alert in alerts[:cap]:
        wallet = alert["entity"]["id"]
        if not alert["evidence"]["txids"]:
            alert["evidence"]["txids"] = tx_by_wallet.get(wallet, [])[:12]
        if not alert["evidence"]["ips"]:
            alert["evidence"]["ips"] = list(wallets.get(wallet, {}).get("ips", []))[:6]
        if not alert["evidence"]["wallets"]:
            alert["evidence"]["wallets"] = [
                w for w in (clusters_by_wallet.get(wallet, [{}])[0].get("members", []) if clusters_by_wallet.get(wallet) else [])
                if w != wallet
                ][:8]
    for rank, alert in enumerate(alerts[:cap], start=1):
        alert["id"] = f"ALT-{rank:04d}"
    return [a for a in alerts if a["id"]]


def _hop_of(chain: dict, wallet: str) -> int | None:
    try:
        return chain.get("wallets", []).index(wallet)
    except ValueError:
        return None


def _anomaly_reasons(info: dict) -> list[str]:
    out: list[str] = []
    contribs = info.get("contributions") or []
    if contribs and anomaly_notable(info.get("anomaly", 0.0)):
        feats = ", ".join(c["feature"].replace("_", " ") for c in contribs[:3])
        out.append(f"Anomaly: {feats} deviate strongly (top features)")
    return out


def anomaly_notable(anomaly: float) -> bool:
    return anomaly >= MEDIUM_THRESHOLD


def _alert_type(chain: dict | None, mix: dict | None, seed: bool, clustered: bool) -> str:
    if seed:
        return "Seed-linked"
    if chain:
        return "Peeling chain"
    if mix:
        return "Mixing"
    if clustered:
        return "Cluster risk"
    return "Anomaly"
