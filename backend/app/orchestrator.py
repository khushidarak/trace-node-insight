"""Full analysis orchestrator: ingest → correlate → AI/ML → graph → alerts.

Runs every pipeline stage, merges the results into one analysis payload, and
persists it in memory plus on disk (``data/state/analysis.json``).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .config import SETTINGS, PERSIST_DIR
from pipeline import alerts as alerts_mod
from pipeline import anomaly, clustering, correlate, metrics, patterns, risk

# Nodes/labels kept out of per-row payloads sent to the browser.
GROUND_TRUTH_COL = "ground_truth"


def to_dataframe(records: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(records)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    if GROUND_TRUTH_COL not in df.columns:
        df[GROUND_TRUTH_COL] = None
    return df


def summarize_dataset(records: list[dict], rejection_reasons: list[str],
                      name: str, file_type: str, detected: list[str]) -> dict:
    reasons_count: dict[str, int] = {}
    for reason in rejection_reasons:
        if reason:
            reasons_count[reason] = reasons_count.get(reason, 0) + 1
    ips: set[str] = set()
    wallets: set[str] = set()
    txids: set[str] = set()
    ts_min, ts_max = "", ""
    if records:
        ts_min = min(r["timestamp"] for r in records)
        ts_max = max(r["timestamp"] for r in records)
        for r in records:
            ips.add(r["src_ip"])
            ips.add(r["dst_ip"])
            wallets.update(r["input_addresses"])
            wallets.update(r["output_addresses"])
            txids.add(r["txid"])
    return {
        "name": name,
        "file_type": file_type,
        "rows_parsed": len(records),
        "rows_rejected": len(rejection_reasons) - sum(1 for r in rejection_reasons if not r),
        "rejection_reasons": reasons_count,
        "fields_detected": detected,
        "time_range": [ts_min, ts_max],
        "unique_ips": len(ips),
        "unique_wallets": len(wallets),
        "unique_txids": len(txids),
    }


def _last_seen(df: pd.DataFrame, wallet: str) -> str:
    mask = df["input_addresses"].apply(lambda ws: wallet in ws) | df["output_addresses"].apply(lambda ws: wallet in ws)
    if not mask.any():
        return ""
    return str(df.loc[mask, "timestamp"].max())


def run_analysis(records: list[dict], dataset_meta: dict, overrides: dict | None = None) -> dict:
    """Execute the full pipeline and return the cached analysis payload."""
    global SETTINGS
    if overrides:
        data = {**SETTINGS.__dict__, **overrides}
        SETTINGS = type(SETTINGS)(**data).normalized()
        # modules imported `from .config import SETTINGS`; refresh them too
        import pipeline.config as _pc
        import pipeline.anomaly as _pa
        import pipeline.clustering as _pcl
        import pipeline.risk as _pr
        _pc.SETTINGS = SETTINGS
        _pa.SETTINGS = SETTINGS
        _pcl.SETTINGS = SETTINGS
        _pr.SETTINGS = SETTINGS
    df = to_dataframe(records)
    graph = correlate.build_graph(df)
    ip_map = correlate.correlate_ip_wallets(df)

    # --- anomaly models -----------------------------------------------------
    tx_feats = anomaly.build_transaction_features(df)
    tx_result = anomaly.score_frame(tx_feats)
    wallet_feats, _ = anomaly.build_wallet_features(df)
    wallet_result = anomaly.score_frame(wallet_feats)

    # --- patterns ------------------------------------------------------------
    peeling_chains, peeling_assignment = patterns.detect_peeling_chains(
        df, min_hops=SETTINGS.peeling_min_hops
    )
    mixing_hits, mixing_assignment = patterns.detect_mixing_rounds(
        df, min_outputs=SETTINGS.mixing_min_outputs
    )

    # --- clusters --------------------------------------------------------------
    clusters = clustering.build_entity_clusters(df)

    # --- risk propagation -------------------------------------------------------
    wallet_anom = {w: float(s) for w, s in zip(wallet_feats.index, wallet_result["scores"])}
    seeds = risk.pick_seed_wallets(wallet_anom, top=12)
    for s in seeds:
        node = ("wallet", s)
        if node in graph:
            graph.nodes[node]["seed"] = True
    wallet_risk = risk.propagate(graph, wallet_anom, decay=SETTINGS.risk_propagation_decay)

    # --- transactions + wallets payloads -------------------------------------
    contrib_by_idx = {
        i: anomaly.top_contributions(tx_result["contributions"], i, anomaly.TX_FEATURES)
        for i in range(len(df))
    }
    tx_rows: list[dict] = []
    for idx, (_, row) in enumerate(df.iterrows()):
        score = float(tx_result["scores"][idx])
        tx_rows.append({
            "txid": row["txid"],
            "timestamp": row["timestamp"].isoformat(),
            "src_ip": row["src_ip"],
            "dst_ip": row["dst_ip"],
            "src_port": int(row["src_port"]),
            "dst_port": int(row["dst_port"]),
            "input_addresses": list(row["input_addresses"]),
            "output_addresses": list(row["output_addresses"]),
            "input_amount": round(float(sum(row["input_amounts"])), 8),
            "output_amount": round(float(sum(row["output_amounts"])), 8),
            "fee": float(row["fee"]),
            "script_type": row["script_type"],
            "country": row["geo_country"],
            "asn": row["asn"],
            "anomaly_score": round(score, 4),
            "risk": alerts_mod.risk_band(score),
            "flagged": bool(score >= SETTINGS.risk_high_threshold),
            "in_peeling_chain": peeling_assignment.get(row["txid"], {}).get("chain_id"),
            "in_mixing_round": mixing_assignment.get(row["txid"], {}).get("round"),
            "contributions": contrib_by_idx.get(idx, []),
        })

    cluster_by_wallet: dict[str, list[dict]] = {}
    for c in clusters:
        c["risk"] = round(risk.cluster_risk(c["members"], wallet_risk), 4)
        c["avg_anomaly"] = round(float(np.mean([wallet_anom.get(m, 0.0) for m in c["members"]])), 4)
        for m in c["members"]:
            cluster_by_wallet.setdefault(m, []).append(c)

    wallet_rows: list[dict] = []
    for wallet, info in wallet_risk.items():
        widx = list(wallet_feats.index).index(wallet) if wallet in wallet_feats.index else None
        wscore = wallet_anom.get(wallet, 0.0)
        contribs = (
            anomaly.top_contributions(wallet_result["contributions"], widx, anomaly.WALLET_FEATURES)
            if widx is not None else []
        )
        wallet_rows.append({
            "id": wallet,
            "type": "wallet",
            "anomaly_score": round(wscore, 4),
            "risk_score": int(round(info["risk"] * 100)),
            "risk": alerts_mod.risk_band(info["risk"]),
            "seed": info["seed"],
            "ppr": info["ppr"],
            "bfs": info["bfs"],
            "ips": sorted(ip_map.get(wallet, set()))[:8],
            "first_seen": str(df["timestamp"].min()),
            "last_seen": _last_seen(df, wallet),
            "tx_count": int(wallet_feats.loc[wallet, "tx_count"]) if widx is not None else 0,
            "cluster_ids": [c["id"] for c in cluster_by_wallet.get(wallet, [])],
            "contributions": contribs,
        })
    wallet_rows.sort(key=lambda w: -(0.5 * w["anomaly_score"] + 0.5 * w["risk_score"] / 100))
    wallet_risk_full = {w["id"]: w for w in wallet_rows}

    # --- alerts -----------------------------------------------------------------
    alert_list = alerts_mod.build_alerts(
        wallets={w["id"]: {
            "anomaly": w["anomaly_score"], "risk": w["risk_score"] / 100,
            "seed": w["seed"], "contributions": w["contributions"],
            "last_seen": w["last_seen"], "ips": w["ips"], "hops": wallet_risk[w["id"]]["hops"],
        } for w in wallet_rows},
        clusters_by_wallet=cluster_by_wallet,
        peeling_chains=peeling_chains,
        peeling_assignment=peeling_assignment,
        mixing_hits=mixing_hits,
        tx_rows=tx_rows,
        graph=graph,
        min_alert_score=min(0.5, SETTINGS.risk_high_threshold - 0.2),
    )

    # --- metrics vs planted ground truth ----------------------------------------
    tx_scores = np.array([r["anomaly_score"] for r in tx_rows])
    if GROUND_TRUTH_COL in df.columns and df[GROUND_TRUTH_COL].notna().any():
        gt_tx = metrics.classification_metrics(tx_scores, df[GROUND_TRUTH_COL].astype(float).to_numpy())
        gt_wallets, wallet_gt_arr = metrics.wallet_labels_from_rows(df)
        # blended investigative score (same blend the alert ranking uses)
        w_scores = np.array([
            min(1.0, 0.45 * wallet_anom.get(w, 0.0)
                + 0.55 * wallet_risk.get(w, {}).get("risk", 0.0))
            for w in gt_wallets
        ])
        gt_wallet = (
            metrics.classification_metrics(w_scores, np.array(wallet_gt_arr))
            if len(gt_wallets) else {"available": False}
        )
    else:
        gt_tx, gt_wallet = {"available": False}, {"available": False}
    gt_map = df[GROUND_TRUTH_COL].to_dict() if GROUND_TRUTH_COL in df.columns else {}
    pattern_stats = metrics.pattern_metrics(peeling_chains, mixing_hits, dataset_meta.get("planted_patterns", {}))

    # --- graph payload (risk-capped subgraph around hot entities) ---------------
    graph_nodes, graph_edges = _graph_payload(graph, alert_list, wallet_risk, clusters)

    # --- KPIs / charts ------------------------------------------------------------
    activity = _activity(df, tx_rows)
    risk_distribution = _risk_distribution(wallet_rows)
    alert_types = _alert_type_breakdown(alert_list)

    model_info = {
        "anomaly_model": "IsolationForest",
        "params": {
            "n_estimators": 200,
            "contamination": SETTINGS.contamination,
            "random_state": 42,
        },
        "comparison": wallet_result.get("comparison"),
        "explainer": wallet_result.get("explainer"),
        "clustering": "union-find common-input + DBSCAN over node2vec-style embeddings",
        "risk_propagation": "personalised PageRank + decay BFS",
        "features": {
            "transaction": anomaly.TX_FEATURES,
            "wallet": anomaly.WALLET_FEATURES,
        },
    }

    analysis = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "settings": {k: getattr(SETTINGS, k) for k in (
            "contamination", "risk_propagation_decay", "peeling_min_hops",
            "mixing_min_outputs", "dbscan_eps", "dbscan_min_samples",
            "risk_high_threshold", "risk_critical_threshold")},
        "dataset": dataset_meta,
        "kpis": {
            "transactions": len(df),
            "wallets": len(wallet_feats),
            "ips": df["src_ip"].nunique(),
            "clusters": len(clusters),
            "flagged_entities": sum(1 for w in wallet_rows if w["risk_score"] >= 50),
            "high_risk_alerts": sum(1 for a in alert_list if a["risk"] in ("High", "Critical")),
            "peeling_chains": len(peeling_chains),
            "mixing_rounds": len(mixing_hits),
        },
        "model": model_info,
        "metrics": {
            "transaction": gt_tx,
            "wallet": gt_wallet,
            "patterns": pattern_stats,
        },
        "transactions": tx_rows,
        "wallets": wallet_rows,
        "peeling_chains": peeling_chains,
        "mixing_hits": mixing_hits,
        "clusters": clusters,
        "alerts": alert_list,
        "graph": {"nodes": graph_nodes, "edges": graph_edges},
        "charts": {
            "activity": activity,
            "risk_distribution": risk_distribution,
            "alert_types": alert_types,
            "score_distribution": [
                {"bucket": f"{b / 10:.1f}", "count": int((tx_scores >= b / 10).sum() - (tx_scores >= (b + 1) / 10).sum())}
                for b in range(10)
            ],
        },
        "geo": _geo_summary(df, tx_rows),
    }

    _persist(analysis)
    return analysis


def _activity(df: pd.DataFrame, tx_rows: list[dict]) -> list[dict]:
    by_day: dict[str, dict] = {}
    for row in tx_rows:
        day = row["timestamp"][:10]
        slot = by_day.setdefault(day, {"day": day, "total": 0, "flagged": 0})
        slot["total"] += 1
        if row["flagged"]:
            slot["flagged"] += 1
    return sorted(by_day.values(), key=lambda d: d["day"])


def _risk_distribution(wallet_rows: list[dict]) -> list[dict]:
    counts = {k: 0 for k in ("Low", "Medium", "High", "Critical")}
    for w in wallet_rows:
        counts[w["risk"]] += 1
    return [{"name": k, "value": v} for k, v in counts.items()]


def _alert_type_breakdown(alerts: list[dict]) -> list[dict]:
    counts: dict[str, int] = {}
    for a in alerts:
        counts[a["type"]] = counts.get(a["type"], 0) + 1
    return [{"name": k, "value": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])]


def _geo_summary(df: pd.DataFrame, tx_rows: list[dict]) -> list[dict]:
    agg: dict[str, dict] = {}
    for row in tx_rows:
        slot = agg.setdefault(row["country"], {
            "country": row["country"], "transactions": 0, "ips": set(), "wallets": set(),
            "scores": [], "asns": set(),
        })
        slot["transactions"] += 1
        slot["ips"].update({row["src_ip"], row["dst_ip"]})
        slot["wallets"].update(row["input_addresses"] + row["output_addresses"])
        slot["scores"].append(row["anomaly_score"])
        slot["asns"].add(row["asn"])
    out = []
    for slot in agg.values():
        mean_score = float(np.mean(slot["scores"]))
        out.append({
            "country": slot["country"],
            "transactions": slot["transactions"],
            "ips": len(slot["ips"]),
            "wallets": len(slot["wallets"]),
            "asns": sorted(slot["asns"]),
            "mean_anomaly": round(mean_score, 4),
            "risk": alerts_mod.risk_band(mean_score),
        })
    out.sort(key=lambda g: -g["transactions"])
    return out


def _graph_payload(graph, alerts: list[dict], wallet_risk: dict, clusters: list[dict]) -> tuple[list[dict], list[dict]]:
    """Subgraph: alerts' wallets + 1-hop tx/ip neighbours, capped for the UI."""
    hot_wallets = [a["entity"]["id"] for a in alerts[:15]]
    seen: set = set()
    nodes: list[dict] = []
    edges: list[dict] = []
    cluster_of: dict[str, str] = {}
    for c in clusters:
        for m in c["members"]:
            cluster_of[m] = c["id"]

    def push(node) -> None:
        if node in seen or len(nodes) >= 900:
            return
        seen.add(node)
        ntype, nid = node
        if ntype == "wallet":
            info = wallet_risk.get(nid, {})
            score = float(info.get("risk", 0.0))
        elif ntype == "tx":
            score = min(1.0, sum(wallet_risk.get(p[1], {}).get("risk", 0.0) for p in graph.predecessors(node) if p[0] == "wallet") or 0.0)
        else:
            score = min(1.0, sum(wallet_risk.get(s[1], {}).get("risk", 0.0) for s in graph.successors(node) if s[0] == "wallet") or 0.0)
        nodes.append({
            "id": nid, "type": ntype, "score": round(score, 4),
            "risk": alerts_mod.risk_band(score),
            "cluster": cluster_of.get(nid) if ntype == "wallet" else None,
            "seed": bool(graph.nodes[node].get("seed")) if node in graph else False,
        })

    from pipeline.correlate import neighbours

    for wallet in hot_wallets:
        node = ("wallet", wallet)
        if node not in graph:
            continue
        push(node)
        for nb in neighbours(graph, node):
            push(nb)
    keep = seen
    for src, dst, data in graph.edges(data=True):
        if src in keep and dst in keep:
            edges.append({"source": src[1], "target": dst[1], "kind": data.get("kind", "")})
    return nodes, edges


def _persist(analysis: dict) -> None:
    os.makedirs(PERSIST_DIR, exist_ok=True)
    path = os.path.join(PERSIST_DIR, "analysis.json")
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(analysis, fh)
    except OSError as exc:  # non-fatal: in-memory copy still works
        print(f"[bittrace] warning: could not persist analysis: {exc}")
