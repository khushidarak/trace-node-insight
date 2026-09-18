"""BitTrace AI FastAPI backend.

Offline analysis service exposing the endpoints the frontend API layer
expects (README §18):

    POST /api/upload          → ingest CSV/JSON/XML dataset
    POST /api/analyze         → run the full ML pipeline
    GET  /api/dashboard       → KPIs, charts, top suspicious entities
    GET  /api/transactions    → searchable transaction list
    GET  /api/transactions/{txid}
    GET  /api/entities        → scored entities
    GET  /api/entities/{id}
    GET  /api/graph           → nodes + edges for link analysis
    GET  /api/alerts          → prioritized explainable leads
    GET  /api/clusters        → DBSCAN entity clusters
    GET  /api/geo             → country-level network context
    GET  /api/reports         → investigation report payload
    GET  /api/sample-dataset  → download the synthetic generator output

State is held in-process: one dataset + one analysis at a time, which matches
the offline single-investigator model of the prototype.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import pipeline as ml
from .config import API_VERSION
from .ingestion import IngestionError, load_upload
from .synthetic import generate_synthetic_dataset

app = FastAPI(title="BitTrace AI — Bitcoin Forensics Backend", version=API_VERSION)

# The frontend runs on a different port during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:5173", "http://127.0.0.1:8080", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATE: dict = {
    "dataset": None,        # canonical records
    "meta": None,           # dataset summary metadata
    "analysis": None,       # full analysis payload
}


def _require_dataset() -> pd.DataFrame:
    if STATE["dataset"] is None:
        raise HTTPException(409, "No dataset loaded. POST /api/upload first.")
    return pd.DataFrame(STATE["dataset"])


def _require_analysis() -> dict:
    if STATE["analysis"] is None:
        raise HTTPException(409, "No analysis yet. POST /api/analyze first.")
    return STATE["analysis"]


# ---------------------------------------------------------------------------
# Pipeline runner
# ---------------------------------------------------------------------------
def run_full_analysis(records: list[dict], meta: dict) -> dict:
    df = pd.DataFrame(records)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    # 1. Transaction-level scoring
    tx_feats = ml.build_transaction_features(df)
    tx_scores, tx_contribs = ml.score_frame(tx_feats)
    df["anomalyScore"] = tx_scores

    # 2. Wallet-level scoring
    wallet_feats = ml.build_wallet_features(df)
    wallet_scores, wallet_contribs = ml.score_frame(wallet_feats[ml.WALLET_FEATURES[:-1]])

    # 3. IP-level scoring
    ip_feats = ml.build_ip_features(df)
    ip_scores, ip_contribs = ml.score_frame(ip_feats)

    # 4. Graph + risk propagation
    graph = ml.build_graph(df)
    seed = {}
    for txid, score in zip(df["txid"], tx_scores):
        seed[("tx", txid)] = float(score)
    for wid, score in zip(wallet_feats.index, wallet_scores):
        seed[("wallet", wid)] = float(score)
    for ip, score in zip(ip_feats.index, ip_scores):
        seed[("ip", ip)] = float(score)
    risk_by_node = ml.propagate_risk(graph, seed)

    # 5. Cluster wallets (DBSCAN)
    labels, coords = ml.cluster_wallets(wallet_feats)

    # --- Assemble entity payloads -----------------------------------------
    tx_rows = []
    for idx, row in df.iterrows():
        tx_rows.append({
            "txid": row["txid"],
            "timestamp": row["timestamp"].isoformat(),
            "inputAddresses": row["input_addresses"],
            "outputAddresses": row["output_addresses"],
            "inputAmount": round(float(sum(row["input_amounts"])), 6),
            "outputAmount": round(float(sum(row["output_amounts"])), 6),
            "fee": round(float(row["fee"]), 2),
            "scriptType": row["script_type"],
            "srcIp": row["src_ip"],
            "dstIp": row["dst_ip"],
            "srcPort": row["src_port"],
            "dstPort": row["dst_port"],
            "country": row["geo_country"],
            "asn": row["asn"],
            "riskScore": round(float(tx_scores[idx]), 4),
            "risk": ml.risk_for(float(tx_scores[idx])),
            "status": "Flagged" if tx_scores[idx] >= ml.HIGH_THRESHOLD else "Normal",
            "reasonDetail": ml.top_contributions(tx_contribs, idx, ml.TX_FEATURES),
        })

    def entity_rows(index, scores, contribs, feature_names, entity_type):
        rows = []
        for i, entity_id in enumerate(index):
            score = float(scores[i])
            neighbours = [n for n in graph.predecessors((entity_type, entity_id))] + [
                n for n in graph.successors((entity_type, entity_id))
            ]
            evidence = [n[1] for n in neighbours if n[0] == "tx"][:8]
            rows.append({
                "id": entity_id,
                "type": entity_type.capitalize() if entity_type != "ip" else "IP",
                "riskScore": round(score * 100),
                "anomalyScore": round(score, 4),
                "connections": len(neighbours),
                "reason": ml.top_contributions(contribs, i, feature_names, top=1)[0]["feature"],
                "reasonDetail": ml.top_contributions(contribs, i, feature_names),
                "firstSeen": str(df["timestamp"].min().date()),
                "lastSeen": str(df["timestamp"].max().date()),
                "evidence": evidence,
            })
        return rows

    wallet_rows = entity_rows(wallet_feats.index, wallet_scores, wallet_contribs, ml.WALLET_FEATURES[:-1], "wallet")
    ip_rows = entity_rows(ip_feats.index, ip_scores, ip_contribs, ml.IP_FEATURES, "ip")

    # 6. Alerts from blended scores
    scored = {"tx": tx_rows, "wallet": wallet_rows, "ip": ip_rows}
    alerts = ml.build_alerts(scored, risk_by_node)

    # 7. Clusters
    clusters = []
    for label in sorted(set(labels)):
        if label == -1:
            continue
        members = [str(w) for w, l in zip(wallet_feats.index, labels) if l == label]
        if len(members) < 2:
            continue
        ips = set()
        txs = set()
        countries = set()
        for w in members:
            node = ("wallet", w)
            for nb in graph.successors(node):
                if nb[0] == "tx":
                    txs.add(nb[1])
        member_set = set(members)
        for _, row in df.iterrows():
            if member_set & set(row["input_addresses"]) or member_set & set(row["output_addresses"]):
                ips.add(row["src_ip"])
                countries.add(row["geo_country"])
                txs.add(row["txid"])
        cluster_scores = [next((e["anomalyScore"] for e in wallet_rows if e["id"] == w), 0.0) for w in members]
        avg = sum(cluster_scores) / len(cluster_scores)
        clusters.append({
            "id": f"Cluster #{len(clusters) + 1:02d}",
            "wallets": len(members),
            "ips": len(ips),
            "transactions": len(txs),
            "risk": ml.risk_for(avg),
            "score": round(avg, 4),
            "signature": ml.top_contributions(wallet_contribs, list(wallet_feats.index).index(members[0]), ml.WALLET_FEATURES[:-1], top=2)[0]["feature"],
            "countries": sorted(countries)[:4],
            "members": members,
        })
    clusters.sort(key=lambda c: c["score"], reverse=True)

    # 8. Geo summary
    geo = []
    for country, sub in df.groupby("geo_country"):
        geo.append({
            "country": country,
            "ips": int(sub["src_ip"].nunique()),
            "transactions": int(len(sub)),
            "wallets": int(len(set().union(*sub["input_addresses"]) | set().union(*sub["output_addresses"]))),
            "risk": ml.risk_for(float(sub["anomalyScore"].mean())),
        })
    geo.sort(key=lambda g: g["transactions"], reverse=True)

    # 9. Activity over time
    daily = df.set_index("timestamp").resample("D").agg(
        total=("txid", "count"), mean_score=("anomalyScore", "mean")
    )
    activity = [
        {
            "day": str(day.date()),
            "normal": int(row["total"] - round(row["total"] * row["mean_score"])),
            "suspicious": int(round(row["total"] * row["mean_score"])),
        }
        for day, row in daily.iterrows()
    ]

    risk_distribution = [
        {"name": level, "value": sum(1 for e in wallet_rows + ip_rows if ml.risk_for(e["anomalyScore"]) == level)}
        for level in ("Low", "Medium", "High", "Critical")
    ]

    reason_counter: dict[str, int] = {}
    for alert in alerts:
        for reason in alert["reasons"]:
            reason_counter[reason] = reason_counter.get(reason, 0) + 1
    activity_types = [
        {"name": name.replace("_", " ").title(), "value": value}
        for name, value in sorted(reason_counter.items(), key=lambda kv: kv[1], reverse=True)[:7]
    ]

    # 10. Graph payload (compact: top leads + their transaction neighbourhoods)
    hot_ids = {("wallet", a["entityId"]) for a in alerts[:16] if a["entityType"] == "Wallet"}
    hot_ids |= {("ip", a["entityId"]) for a in alerts[:16] if a["entityType"] == "IP"}
    frontier = set()
    for node in list(hot_ids)[:32]:
        frontier |= set(graph.predecessors(node)) | set(graph.successors(node))
    keep = hot_ids | frontier
    nodes = []
    for node in keep:
        ntype, nid = node
        nodes.append({
            "id": nid,
            "type": {"tx": "Transaction", "wallet": "Wallet", "ip": "IP"}.get(ntype, nid),
            "risk": ml.risk_for(risk_by_node.get(node, 0.0)),
            "score": round(float(risk_by_node.get(node, 0.0)), 4),
        })
    node_keys = {n["id"] for n in nodes}
    edges = []
    for src, dst, data in graph.edges(data=True):
        if src[1] in node_keys and dst[1] in node_keys:
            edges.append({"source": src[1], "target": dst[1], "kind": data.get("kind", "")})

    analysis = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": meta,
        "kpis": {
            "totalTransactions": len(df),
            "walletEntities": len(wallet_feats),
            "networkIps": len(ip_feats),
            "suspiciousEntities": sum(1 for e in wallet_rows + ip_rows if e["anomalyScore"] >= ml.MEDIUM_THRESHOLD),
            "highRiskAlerts": sum(1 for a in alerts if a["risk"] in ("High", "Critical")),
            "avgAnomalyScore": round(float(df["anomalyScore"].mean()), 4),
        },
        "model": {
            "name": "Isolation Forest",
            "clustering": "DBSCAN",
            "features": ml.TX_FEATURES + ml.WALLET_FEATURES[:-1] + ml.IP_FEATURES,
        },
        "transactions": tx_rows,
        "entities": wallet_rows + ip_rows,
        "alerts": alerts,
        "clusters": clusters,
        "geo": geo,
        "activity": activity,
        "riskDistribution": risk_distribution,
        "activityTypes": activity_types,
        "graph": {"nodes": nodes, "edges": edges},
    }
    return analysis


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "version": API_VERSION,
        "datasetLoaded": STATE["dataset"] is not None,
        "analysisReady": STATE["analysis"] is not None,
    }


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    payload = await file.read()
    try:
        records, rejected, missing, file_type = load_upload(file.filename or "dataset.csv", payload)
    except IngestionError as exc:
        raise HTTPException(422, str(exc)) from exc

    STATE["dataset"] = records
    STATE["analysis"] = None  # stale analysis
    timestamps = [r["timestamp"] for r in records]
    wallets = set()
    ips = set()
    for r in records:
        wallets.update(r["input_addresses"])
        wallets.update(r["output_addresses"])
        ips.add(r["src_ip"])
        ips.add(r["dst_ip"])
    STATE["meta"] = {
        "fileName": file.filename,
        "fileType": file_type,
        "records": len(records),
        "wallets": len(wallets),
        "transactions": len({r["txid"] for r in records}),
        "ips": len(ips),
        "dateRange": [min(timestamps), max(timestamps)],
        "rejectedRecords": rejected,
        "missingFields": missing,
    }
    return {"status": "ingested", **STATE["meta"]}


@app.post("/api/analyze")
def analyze():
    if STATE["dataset"] is None:
        raise HTTPException(409, "No dataset loaded. POST /api/upload first.")
    analysis = run_full_analysis(STATE["dataset"], STATE["meta"])
    STATE["analysis"] = analysis
    return {
        "status": "complete",
        "records": analysis["summary"]["records"],
        "alerts": len(analysis["alerts"]),
        "clusters": len(analysis["clusters"]),
        "suspiciousEntities": analysis["kpis"]["suspiciousEntities"],
    }


@app.get("/api/dashboard")
def dashboard():
    a = _require_analysis()
    return {
        "summary": a["summary"],
        "kpis": a["kpis"],
        "activity": a["activity"],
        "riskDistribution": a["riskDistribution"],
        "activityTypes": a["activityTypes"],
        "topEntities": sorted(a["entities"], key=lambda e: e["anomalyScore"], reverse=True)[:10],
        "recentAlerts": a["alerts"][:10],
        "model": a["model"],
    }


@app.get("/api/dashboard-full")
def dashboard_full():
    """Complete analysis payload in one response (used right after analyze)."""
    return _require_analysis()


@app.get("/api/transactions")
def transactions(
    q: str = "", risk: str = "", country: str = "", asn: str = "",
    limit: int = 100, offset: int = 0,
):
    a = _require_analysis()
    rows = a["transactions"]
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in r["txid"].lower()
                or any(needle in w.lower() for w in r["inputAddresses"] + r["outputAddresses"])
                or needle in r["srcIp"].lower() or needle in r["dstIp"].lower() or needle in r["asn"].lower()]
    if risk:
        rows = [r for r in rows if r["risk"].lower() == risk.lower()]
    if country:
        rows = [r for r in rows if r["country"].lower() == country.lower()]
    if asn:
        rows = [r for r in rows if r["asn"].lower() == asn.lower()]
    return {"total": len(rows), "items": rows[offset:offset + limit]}


@app.get("/api/transactions/{txid}")
def transaction_detail(txid: str):
    a = _require_analysis()
    for row in a["transactions"]:
        if row["txid"] == txid:
            return row
    raise HTTPException(404, f"transaction {txid} not found")


@app.get("/api/entities")
def entities(type: str = "", q: str = "", limit: int = 200, offset: int = 0):
    a = _require_analysis()
    rows = a["entities"]
    if type:
        rows = [r for r in rows if r["type"].lower() == type.lower()]
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in r["id"].lower()]
    rows = sorted(rows, key=lambda r: r["anomalyScore"], reverse=True)
    return {"total": len(rows), "items": rows[offset:offset + limit]}


@app.get("/api/entities/{entity_id:path}")
def entity_detail(entity_id: str):
    a = _require_analysis()
    for row in a["entities"]:
        if row["id"] == entity_id:
            return row
    raise HTTPException(404, f"entity {entity_id} not found")


@app.get("/api/graph")
def graph(limit: int = 400):
    a = _require_analysis()
    nodes, edges = a["graph"]["nodes"], a["graph"]["edges"]
    return {"nodes": nodes[:limit], "edges": [e for e in edges if e["source"] in {n["id"] for n in nodes[:limit]} and e["target"] in {n["id"] for n in nodes[:limit]}]}


@app.get("/api/alerts")
def alerts(status: str = "", risk: str = "", limit: int = 100):
    a = _require_analysis()
    rows = a["alerts"]
    if status:
        rows = [r for r in rows if r["status"].lower() == status.lower()]
    if risk:
        rows = [r for r in rows if r["risk"].lower() == risk.lower()]
    return {"total": len(rows), "items": rows[:limit]}


@app.patch("/api/alerts/{alert_id}")
def update_alert(alert_id: str, status: str):
    a = _require_analysis()
    for row in a["alerts"]:
        if row["id"] == alert_id:
            if status not in ("New", "Investigating", "Reviewed", "Dismissed"):
                raise HTTPException(422, "invalid status")
            row["status"] = status
            return row
    raise HTTPException(404, f"alert {alert_id} not found")


@app.get("/api/clusters")
def clusters():
    a = _require_analysis()
    return {"total": len(a["clusters"]), "items": a["clusters"]}


@app.get("/api/geo")
def geo():
    return _require_analysis()["geo"]


@app.get("/api/reports")
def reports():
    a = _require_analysis()
    kpis, alerts_ = a["kpis"], a["alerts"]
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "datasetSummary": a["summary"],
        "model": a["model"],
        "kpis": kpis,
        "alertStatistics": {
            "total": len(alerts_),
            "critical": sum(1 for x in alerts_ if x["risk"] == "Critical"),
            "high": sum(1 for x in alerts_ if x["risk"] == "High"),
            "medium": sum(1 for x in alerts_ if x["risk"] == "Medium"),
            "low": sum(1 for x in alerts_ if x["risk"] == "Low"),
        },
        "topLeads": alerts_[:10],
        "clusters": a["clusters"][:6],
        "geo": a["geo"][:10],
        "limitations": [
            "Scores are investigative prioritisation signals, not proof of criminal activity.",
            "Synthetic dataset — generated locally, no live blockchain data involved.",
            "Unsupervised models (Isolation Forest, DBSCAN) may flag rare-but-benign behaviour.",
            "Country-level metadata provides context only; a country is never 'suspicious'.",
        ],
    }


@app.get("/api/sample-dataset")
def sample_dataset(records: int = 1200):
    """Download a synthetic dataset (CSV) matching the required schema."""
    rows = generate_synthetic_dataset(min(max(records, 100), 20_000))
    df = pd.DataFrame(rows)
    df["input_addresses"] = df["input_addresses"].apply(lambda v: ";".join(v))
    df["output_addresses"] = df["output_addresses"].apply(lambda v: ";".join(v))
    df["input_amounts"] = df["input_amounts"].apply(lambda v: ";".join(str(x) for x in v))
    df["output_amounts"] = df["output_amounts"].apply(lambda v: ";".join(str(x) for x in v))
    csv_text = df.to_csv(index=False)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=bitcoin_network_metadata.csv"},
    )
