"""BitTrace AI FastAPI backend.

Offline analysis service exposing the endpoints the frontend API layer uses:

    POST /api/upload           → ingest CSV/JSON/XML dataset
    POST /api/sample           → load the built-in synthetic dataset
    POST /api/analyze          → run the full ML pipeline
    GET  /api/dashboard        → KPIs + chart data
    GET  /api/transactions     → paginated/searchable transaction list
    GET  /api/transactions/{txid}
    GET  /api/graph            → link-analysis nodes + edges
    GET  /api/anomalies        → anomaly scores + top contributing features
    GET  /api/clusters         → entity clusters
    GET  /api/alerts           → ranked explainable alerts
    GET  /api/alerts/{id}      → full evidence detail
    PATCH /api/alerts/{id}     → status update (New/Investigating/Closed)
    GET  /api/geo              → offline country/ASN aggregation
    GET  /api/report?format=…  → CSV / JSON / PDF export
    GET  /api/model-metrics    → precision/recall/F1 vs planted ground truth
    GET/PUT /api/settings      → pipeline tunables

State is held in-process: one dataset + one analysis at a time, which matches
the offline single-investigator model of the prototype. The built frontend is
served from disk so a single `./run.sh` runs the whole app offline.
"""

from __future__ import annotations

import csv
import io
import json
import os
from datetime import datetime, timezone

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import orchestrator
from .config import (
    API_VERSION, MODEL_NAME, PERSIST_DIR, SETTINGS, AnalysisSettings,
    load_settings, save_settings,
)
from pipeline import ingest
from pipeline.ingest import IngestionError, load_upload

app = FastAPI(title="BitTrace AI — Bitcoin Forensics Backend", version=API_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # offline tool; the UI is served from this same origin
    allow_methods=["*"],
    allow_headers=["*"],
)

STATE: dict = {
    "records": None,       # canonical records list
    "meta": None,          # dataset summary metadata
    "analysis": None,      # full analysis payload
}


def _require_dataset() -> list[dict]:
    if STATE["records"] is None:
        raise HTTPException(409, "No dataset loaded. POST /api/upload or /api/sample first.")
    return STATE["records"]


def _require_analysis() -> dict:
    if STATE["analysis"] is None:
        raise HTTPException(409, "No analysis yet. POST /api/analyze first.")
    return STATE["analysis"]


def load_records(records: list[dict], rejection_reasons: list[str],
                 detected: list[str], name: str, file_type: str) -> dict:
    """Install a parsed dataset into STATE and return the summary."""
    STATE["records"] = records
    STATE["analysis"] = None  # stale analysis
    meta = orchestrator.summarize_dataset(records, rejection_reasons, name, file_type, detected)
    STATE["meta"] = meta
    return meta


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------
@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    payload = await file.read()
    try:
        records, reasons, detected, file_type = load_upload(file.filename or "dataset.csv", payload)
    except IngestionError as exc:
        raise HTTPException(422, str(exc)) from exc
    meta = load_records(records, reasons, detected, file.filename or "dataset.csv", file_type)
    return {"status": "ingested", "summary": meta, "preview": records[:3]}


def _project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@app.post("/api/sample")
def sample(rows: int = 5000):
    """Generate + load the built-in synthetic dataset (with ground truth)."""
    import sys

    sys.path.insert(0, os.path.join(_project_root(), "backend"))
    from generate_data import Generator

    gen = Generator(rows=min(max(rows, 100), 50000), seed=42)
    raw_records, labels, planted = gen.generate()
    # attach ground truth so /api/model-metrics has something to score against
    for rec, label in zip(raw_records, labels):
        rec["ground_truth"] = label
    # normalise through the real ingest path (validates the generator output too)
    records, reasons = ingest.parse_records(raw_records)
    detected = ingest.detected_fields(raw_records[:50])
    meta = load_records(records, reasons, detected, f"synthetic_sample_{len(records)}", "synthetic")
    # keep the generator's planted facts for the pattern-recovery metrics
    meta["planted_patterns"] = planted
    return {"status": "loaded", "summary": meta, "preview": records[:3]}


@app.post("/api/analyze")
def analyze():
    records = _require_dataset()
    analysis = orchestrator.run_analysis(records, STATE["meta"] or {})
    STATE["analysis"] = analysis
    return {
        "status": "complete",
        "records": analysis["dataset"]["rows_parsed"],
        "alerts": len(analysis["alerts"]),
        "clusters": len(analysis["clusters"]),
        "peeling_chains": analysis["kpis"]["peeling_chains"],
        "mixing_rounds": analysis["kpis"]["mixing_rounds"],
        "flagged_entities": analysis["kpis"]["flagged_entities"],
        "elapsed_ms": analysis["generated_at"],
    }


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------
@app.get("/api/dashboard")
def dashboard():
    a = _require_analysis()
    return {
        "dataset": a["dataset"],
        "kpis": a["kpis"],
        "model": a["model"],
        "metrics": a["metrics"],
        "charts": a["charts"],
        "top_wallets": sorted(a["wallets"], key=lambda w: -(w["anomaly_score"] + w["risk_score"] / 100))[:8],
        "recent_alerts": a["alerts"][:8],
        "mini_graph": {"nodes": a["graph"]["nodes"][:80], "edges": a["graph"]["edges"][:200]},
        "generated_at": a["generated_at"],
    }


@app.get("/api/analysis")
def full_analysis():
    """Complete analysis payload in one response."""
    return _require_analysis()


@app.get("/api/transactions")
def transactions(
    q: str = "",
    risk: str = "",
    country: str = "",
    flagged: bool = False,
    min_amount: float | None = None,
    max_amount: float | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    a = _require_analysis()
    rows = a["transactions"]
    if q:
        needle = q.lower()
        rows = [
            r for r in rows
            if needle in r["txid"].lower()
            or any(needle in w.lower() for w in r["input_addresses"] + r["output_addresses"])
            or needle in r["src_ip"].lower()
            or needle in r["dst_ip"].lower()
            or needle in r["asn"].lower()
            or needle in r["country"].lower()
        ]
    if risk:
        rows = [r for r in rows if r["risk"].lower() == risk.lower()]
    if country:
        rows = [r for r in rows if r["country"].lower() == country.lower()]
    if flagged:
        rows = [r for r in rows if r["flagged"]]
    if min_amount is not None:
        rows = [r for r in rows if r["output_amount"] >= min_amount]
    if max_amount is not None:
        rows = [r for r in rows if r["output_amount"] <= max_amount]
    return {
        "total": len(rows),
        "items": rows[offset: offset + limit],
        "countries": sorted({r["country"] for r in a["transactions"]}),
    }


@app.get("/api/transactions/{txid}")
def transaction_detail(txid: str):
    a = _require_analysis()
    for row in a["transactions"]:
        if row["txid"] == txid:
            related = [
                x for x in a["transactions"]
                if x["txid"] != txid and (
                    set(x["input_addresses"]) & set(row["input_addresses"] + row["output_addresses"])
                    or set(x["output_addresses"]) & set(row["output_addresses"])
                )
            ][:10]
            related_alerts = [
                al for al in a["alerts"]
                if txid in al["evidence"].get("txids", [])
            ]
            return {**row, "related_transactions": related, "related_alerts": related_alerts}
    raise HTTPException(404, f"transaction {txid} not found")


@app.get("/api/graph")
def graph(
    risk_min: float = 0.0,
    cluster: str = "",
    node_type: str = "",
    q: str = "",
    limit: int = Query(400, ge=20, le=2000),
):
    a = _require_analysis()
    nodes, edges = a["graph"]["nodes"], a["graph"]["edges"]
    if q:
        needle = q.lower()
        nodes = [n for n in nodes if needle in n["id"].lower()]
    if cluster:
        nodes = [n for n in nodes if n.get("cluster") == cluster]
    if node_type:
        nodes = [n for n in nodes if n["type"] == node_type]
    nodes = [n for n in nodes if n["score"] >= risk_min][:limit]
    keep = {n["id"] for n in nodes}
    edges = [e for e in edges if e["source"] in keep and e["target"] in keep]
    return {"nodes": nodes, "edges": edges, "total_available": len(a["graph"]["nodes"])}


@app.get("/api/anomalies")
def anomalies(
    entity_type: str = "wallet",
    limit: int = Query(100, ge=1, le=1000),
):
    a = _require_analysis()
    if entity_type == "transaction":
        items = sorted(a["transactions"], key=lambda r: -r["anomaly_score"])
        return {
            "entity_type": "transaction",
            "model": a["model"],
            "items": [
                {
                    "id": r["txid"], "timestamp": r["timestamp"],
                    "anomaly_score": r["anomaly_score"], "risk": r["risk"],
                    "contributions": r["contributions"],
                } for r in items[:limit]
            ],
            "score_distribution": a["charts"]["score_distribution"],
        }
    items = sorted(a["wallets"], key=lambda w: -w["anomaly_score"])
    return {
        "entity_type": "wallet",
        "model": a["model"],
        "items": [
            {
                "id": w["id"], "anomaly_score": w["anomaly_score"], "risk": w["risk"],
                "risk_score": w["risk_score"], "seed": w["seed"],
                "contributions": w["contributions"], "tx_count": w["tx_count"],
            } for w in items[:limit]
        ],
        "score_distribution": a["charts"]["score_distribution"],
    }


@app.get("/api/clusters")
def clusters():
    a = _require_analysis()
    return {"total": len(a["clusters"]), "items": a["clusters"]}


@app.get("/api/alerts")
def alerts_list(status: str = "", risk: str = "", type_: str = Query("", alias="type")):
    a = _require_analysis()
    rows = a["alerts"]
    if status:
        rows = [r for r in rows if r["status"].lower() == status.lower()]
    if risk:
        rows = [r for r in rows if r["risk"].lower() == risk.lower()]
    if type_:
        rows = [r for r in rows if r["type"].lower() == type_.lower()]
    return {"total": len(rows), "items": rows}


@app.get("/api/alerts/{alert_id}")
def alert_detail(alert_id: str):
    a = _require_analysis()
    for row in a["alerts"]:
        if row["id"] == alert_id:
            txids = row["evidence"].get("txids", [])[:8]
            detail_txs = [t for t in a["transactions"] if t["txid"] in txids]
            return {**row, "evidence_transactions": detail_txs}
    raise HTTPException(404, f"alert {alert_id} not found")


@app.patch("/api/alerts/{alert_id}")
def alert_status(alert_id: str, status: str = Query(...)):
    a = _require_analysis()
    allowed = {"New", "Investigating", "Closed"}
    if status not in allowed:
        raise HTTPException(422, f"status must be one of {sorted(allowed)}")
    for row in a["alerts"]:
        if row["id"] == alert_id:
            row["status"] = status
            orchestrator._persist(a)
            return row
    raise HTTPException(404, f"alert {alert_id} not found")


@app.get("/api/geo")
def geo():
    a = _require_analysis()
    return {"items": a["geo"], "source": "offline: dataset geo_country/asn fields (no external GeoIP)"}


@app.get("/api/model-metrics")
def model_metrics():
    a = _require_analysis()
    return {
        "model": {
            "name": MODEL_NAME,
            "params": a["model"]["params"],
            "features": a["model"]["features"],
            "explainer": a["model"]["explainer"],
            "clustering": a["model"]["clustering"],
            "risk_propagation": a["model"]["risk_propagation"],
            "comparison": a["model"].get("comparison"),
        },
        "transaction": a["metrics"]["transaction"],
        "wallet": a["metrics"]["wallet"],
        "patterns": a["metrics"]["patterns"],
        "dataset": a["dataset"],
    }


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
@app.get("/api/settings")
def get_settings():
    return {k: getattr(SETTINGS, k) for k in (
        "contamination", "risk_propagation_decay", "peeling_min_hops",
        "mixing_min_outputs", "dbscan_eps", "dbscan_min_samples",
        "risk_high_threshold", "risk_critical_threshold")}


@app.put("/api/settings")
async def put_settings(payload: dict):
    global SETTINGS
    current = {k: getattr(SETTINGS, k) for k in (
        "contamination", "risk_propagation_decay", "peeling_min_hops",
        "mixing_min_outputs", "dbscan_eps", "dbscan_min_samples",
        "risk_high_threshold", "risk_critical_threshold")}
    try:
        SETTINGS = AnalysisSettings(**{**current, **payload}).normalized()
    except TypeError as exc:
        raise HTTPException(422, f"invalid setting key: {exc}") from exc
    save_settings(SETTINGS)
    return get_settings()


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
@app.get("/api/report")
def report(format: str = Query("json", pattern="^(csv|json|pdf)$")):
    a = _require_analysis()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "alert_id", "entity_type", "entity_id", "type", "risk_score", "confidence",
            "status", "reasons", "evidence_txids", "evidence_ips",
        ])
        for al in a["alerts"]:
            writer.writerow([
                al["id"], al["entity"]["type"], al["entity"]["id"], al["type"],
                al["risk_score"], al["confidence"], al["status"],
                " | ".join(al["reasons"]),
                " ".join(al["evidence"].get("txids", [])[:6]),
                " ".join(al["evidence"].get("ips", [])[:4]),
            ])
        return Response(
            content=buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="bittrace_alerts_{stamp}.csv"'},
        )
    if format == "json":
        payload = {
            "generated_at": a["generated_at"],
            "dataset": a["dataset"],
            "kpis": a["kpis"],
            "model": a["model"],
            "metrics": a["metrics"],
            "alerts": a["alerts"],
            "top_wallets": a["wallets"][:20],
            "clusters": a["clusters"][:12],
            "geo": a["geo"][:12],
            "limitations": [
                "Scores are investigative prioritisation signals, not proof of criminal activity.",
                "Synthetic dataset — generated locally, no live blockchain data involved.",
                "Unsupervised models (IsolationForest, DBSCAN) may flag rare-but-benign behaviour.",
                "Country-level metadata provides context only; a country is never 'suspicious'.",
            ],
        }
        return JSONResponse(payload, headers={
            "Content-Disposition": f'attachment; filename="bittrace_report_{stamp}.json"'})

    # PDF via reportlab (graceful message if the optional dep is missing)
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError:
        raise HTTPException(501, "PDF export requires the 'reportlab' package (pip install reportlab)")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="BitTrace AI — Investigation Report")
    styles = getSampleStyleSheet()
    flow = []
    flow.append(Paragraph("<b>BitTrace AI — Bitcoin Forensics Console</b>", styles["Title"]))
    flow.append(Paragraph("Investigation Report — generated offline", styles["Normal"]))
    flow.append(Spacer(1, 6 * mm))
    ds, k = a["dataset"], a["kpis"]
    flow.append(Paragraph(
        f"Dataset: {ds.get('name', '—')} ({ds.get('file_type', '').upper()}) · "
        f"{ds.get('rows_parsed', 0):,} rows parsed · {ds.get('rows_rejected', 0)} rejected<br/>"
        f"Time range: {ds.get('time_range', ['—', '—'])[0]} → {ds.get('time_range', ['—', '—'])[1]}<br/>"
        f"Transactions {k['transactions']:,} · Wallets {k['wallets']:,} · IPs {k['ips']:,} · "
        f"Clusters {k['clusters']} · Flagged entities {k['flagged_entities']} · "
        f"High-risk alerts {k['high_risk_alerts']}",
        styles["Normal"]))
    flow.append(Spacer(1, 4 * mm))
    m = a["metrics"]
    flow.append(Paragraph(
        f"Model: {MODEL_NAME} (contamination={a['model']['params']['contamination']}) · "
        f"Precision {m['transaction'].get('precision', 'n/a')} · Recall {m['transaction'].get('recall', 'n/a')} · "
        f"F1 {m['transaction'].get('f1', 'n/a')} · ROC-AUC {m['transaction'].get('roc_auc', 'n/a')}",
        styles["Normal"]))
    flow.append(Spacer(1, 6 * mm))
    flow.append(Paragraph("<b>Top investigation leads</b>", styles["Heading2"]))
    table_data = [["Alert", "Entity", "Type", "Risk", "Conf.", "Reasons"]]
    for al in a["alerts"][:15]:
        table_data.append([
            al["id"], al["entity"]["id"][:22] + "…", al["type"], str(al["risk_score"]),
            f"{al['confidence']:.2f}", al["reasons"][0][:70] if al["reasons"] else "",
        ])
    table = Table(table_data, colWidths=[18 * mm, 52 * mm, 24 * mm, 14 * mm, 14 * mm, 58 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#134e4a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    flow.append(table)
    flow.append(Spacer(1, 6 * mm))
    flow.append(Paragraph(
        "<b>Limitations:</b> prioritisation signals only; synthetic dataset; unsupervised models "
        "can flag rare-but-benign behaviour; country metadata is context, never a verdict.",
        styles["Normal"]))
    doc.build(flow)
    return Response(
        content=buf.getvalue(), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="bittrace_report_{stamp}.pdf"'},
    )


@app.get("/api/report/preview")
def report_preview():
    """HTML preview of the report payload (used by the Reports page)."""
    a = _require_analysis()
    return {"generated_at": a["generated_at"], "dataset": a["dataset"], "kpis": a["kpis"],
            "metrics": a["metrics"], "model": a["model"], "alerts": a["alerts"][:10]}


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "version": API_VERSION,
        "dataset_loaded": STATE["records"] is not None,
        "analysis_ready": STATE["analysis"] is not None,
        "dataset_name": (STATE["meta"] or {}).get("name"),
        "offline": True,
    }


# ---------------------------------------------------------------------------
# Static frontend (built by build.sh into frontend-dist/) — keeps deployment to
# a single uvicorn process with zero external network access.
# ---------------------------------------------------------------------------
_STATIC = os.path.join(_project_root(), "frontend-dist")
if os.path.isdir(_STATIC):
    app.mount("/", StaticFiles(directory=_STATIC, html=True), name="frontend")
else:  # dev fallback: the Vite dev server runs separately
    @app.get("/")
    def index() -> HTMLResponse:
        return HTMLResponse(
            "<html><body style='font-family:monospace;background:#0b0e16;color:#cbd5e1'>"
            "<h2>BitTrace AI backend is running.</h2>"
            "<p>API docs: <a href='/docs' style='color:#22d3ee'>/docs</a> · "
            "Start the frontend with <code>./dev.sh</code> or build it with "
            "<code>./build.sh</code> and restart.</p></body></html>"
        )
