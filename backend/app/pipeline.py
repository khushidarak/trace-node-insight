"""BitTrace ML pipeline.

Raw metadata → cleaning → feature engineering → Isolation Forest →
DBSCAN entity clustering → graph construction → risk propagation →
explainable risk scoring → investigation alerts.

Every anomaly score is normalised to 0.00–1.00 and every alert carries
feature-level contributions so an investigator can see *why* an entity was
flagged. The pipeline is intentionally transparent: it produces
"investigation leads", never verdicts.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from .config import (
    CRITICAL_THRESHOLD,
    DBSCAN_EPS,
    DBSCAN_MIN_SAMPLES,
    HIGH_THRESHOLD,
    ISOLATION_CONTAMINATION,
    ISOLATION_SEED,
    ISOLATION_TREES,
    MEDIUM_THRESHOLD,
    PROPAGATION_KEEP,
    PROPAGATION_ROUNDS,
    SCORE_SHARPENING,  # kept for reference; superseded by the linear remap
)

# --- Risk bands -----------------------------------------------------------
def risk_for(score: float) -> str:
    if score >= CRITICAL_THRESHOLD:
        return "Critical"
    if score >= HIGH_THRESHOLD:
        return "High"
    if score >= MEDIUM_THRESHOLD:
        return "Medium"
    return "Low"


def _percentile_sharpen(values: np.ndarray) -> np.ndarray:
    """Map raw scores to 0–1 so the bulk of normal rows sit in the Low band.

    Linear remap of population percentile: ranked ≤ 0.35 → 0.00, ranked 1.0
    → 1.00. With ~8% contamination this lands Critical on the most extreme
    decile instead of saturating a fifth of the dataset.
    """
    ranked = pd.Series(values).rank(pct=True).to_numpy()
    return np.clip((ranked - 0.35) / 0.65, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------
TX_FEATURES = [
    "amount_mean", "amount_max", "fee_ratio", "io_ratio", "input_count",
    "output_count", "burst_score", "wallet_degree", "ip_degree",
    "country_diversity", "asn_diversity", "repeated_ip_wallet", "hour_offpeak",
]
WALLET_FEATURES = [
    "degree", "in_volume", "out_volume", "tx_frequency", "ip_partners",
    "wallet_partners", "burst_score", "amount_std", "amount_max",
    "peak_hour_ratio", "cluster_risk",
]
IP_FEATURES = [
    "wallet_partners", "tx_count", "volume", "country_diversity",
    "asn_concentration", "burst_score", "degree",
]
FEATURE_SETS = {"transaction": TX_FEATURES, "wallet": WALLET_FEATURES, "ip": IP_FEATURES}


def _burst_scores(times: pd.Series) -> pd.Series:
    """Fraction of an entity's transactions arriving within short windows."""
    ordered = times.sort_values()
    gaps = ordered.diff().dt.total_seconds().fillna(3600)
    return (gaps < 300).mean() if len(gaps) else 0.0


def build_transaction_features(df: pd.DataFrame) -> pd.DataFrame:
    feats = pd.DataFrame(index=df.index)
    in_amt = df["input_amounts"].apply(lambda v: float(np.sum(v)) if v else 0.0)
    out_amt = df["output_amounts"].apply(lambda v: float(np.sum(v)) if v else 0.0)
    feats["amount_mean"] = out_amt
    feats["amount_max"] = df["output_amounts"].apply(lambda v: max(v) if v else 0.0)
    total_out = out_amt.replace(0, np.nan)
    feats["fee_ratio"] = (df["fee"] / total_out).fillna(0.0).clip(upper=0.5)
    feats["io_ratio"] = (in_amt / total_out).fillna(1.0)
    feats["input_count"] = df["input_addresses"].apply(len)
    feats["output_count"] = df["output_addresses"].apply(len)
    ts = pd.to_datetime(df["timestamp"], utc=True)
    feats["burst_score"] = df.groupby("src_ip")["timestamp"].transform(_burst_scores)
    feats["wallet_degree"] = df["input_addresses"].apply(len) + df["output_addresses"].apply(len)
    feats["ip_degree"] = df.groupby("src_ip")["txid"].transform("count")
    feats["country_diversity"] = df.groupby("src_ip")["geo_country"].transform("nunique")
    feats["asn_diversity"] = df.groupby("src_ip")["asn"].transform("nunique")
    pair = df["src_ip"] + "|" + df["input_addresses"].str[0]
    feats["repeated_ip_wallet"] = pair.map(pair.value_counts())
    feats["hour_offpeak"] = ((ts.dt.hour >= 1) & (ts.dt.hour <= 5)).astype(int)
    return feats


def _explode_aligned(df: pd.DataFrame, cols: list[str], list_cols: list[str]) -> pd.DataFrame:
    """Explode paired list columns, clipping to the shorter length per row.

    User-uploaded datasets can have mismatched address/amount array lengths;
    clipping beats crashing mid-analysis.
    """
    trimmed = df[cols].copy()
    for row_idx in trimmed.index:
        lengths = [len(trimmed.at[row_idx, c]) if isinstance(trimmed.at[row_idx, c], list) else 0 for c in list_cols]
        n = min(lengths) if lengths else 0
        for c in list_cols:
            value = trimmed.at[row_idx, c]
            trimmed.at[row_idx, c] = value[:n] if isinstance(value, list) else value
    exploded = trimmed.explode(list_cols)
    for c in list_cols:
        if "amount" in c:
            exploded[c] = pd.to_numeric(exploded[c], errors="coerce")
    return exploded


def build_wallet_features(df: pd.DataFrame) -> pd.DataFrame:
    exploded_in = _explode_aligned(
        df, ["input_addresses", "input_amounts", "timestamp", "src_ip", "txid"],
        ["input_addresses", "input_amounts"],
    )
    exploded_out = _explode_aligned(
        df, ["output_addresses", "output_amounts", "timestamp", "src_ip", "txid"],
        ["output_addresses", "output_amounts"],
    )
    wallets = sorted(set(exploded_in["input_addresses"].dropna()) | set(exploded_out["output_addresses"].dropna()))
    feats = pd.DataFrame(index=pd.Series(wallets, name="wallet"))

    in_g = exploded_in.groupby("input_addresses")
    out_g = exploded_out.groupby("output_addresses")
    feats["degree"] = in_g.size().add(out_g.size(), fill_value=0).fillna(0.0).astype(float)
    feats["in_volume"] = pd.to_numeric(in_g["input_amounts"].sum(), errors="coerce").fillna(0.0)
    feats["out_volume"] = pd.to_numeric(out_g["output_amounts"].sum(), errors="coerce").fillna(0.0)
    feats["tx_frequency"] = feats["degree"]
    feats["ip_partners"] = in_g["src_ip"].nunique().add(
        out_g["src_ip"].nunique(), fill_value=0
    ).reindex(feats.index).fillna(0.0).astype(float)
    # Wallet co-participants: distinct wallets seen on the other side of shared txs.
    pairs = exploded_in[["input_addresses", "txid"]].merge(
        exploded_out[["output_addresses", "txid"]], on="txid"
    )
    partners = pd.concat([
        pairs.groupby("input_addresses")["output_addresses"].nunique(),
        pairs.groupby("output_addresses")["input_addresses"].nunique(),
    ]).groupby(level=0).sum()
    feats["wallet_partners"] = partners.reindex(feats.index).fillna(0.0).astype(float)
    feats["burst_score"] = exploded_in.groupby("input_addresses")["timestamp"].apply(_burst_scores).reindex(feats.index).fillna(0.0).astype(float)
    feats["amount_std"] = out_g["output_amounts"].std().reindex(feats.index).fillna(0.0).astype(float)
    feats["amount_max"] = out_g["output_amounts"].max().reindex(feats.index).fillna(0.0).astype(float)
    out_ts = exploded_out.copy()
    out_ts["hour"] = pd.to_datetime(out_ts["timestamp"], utc=True).dt.hour
    offpeak = out_ts.assign(offpeak=((out_ts["hour"] >= 1) & (out_ts["hour"] <= 5)).astype(float))
    feats["peak_hour_ratio"] = offpeak.groupby("output_addresses")["offpeak"].mean().reindex(feats.index).fillna(0.0).astype(float)
    feats["cluster_risk"] = 0.0  # reserved: filled by graph risk propagation
    return feats.fillna(0.0)


def build_ip_features(df: pd.DataFrame) -> pd.DataFrame:
    src = df.groupby("src_ip")
    feats = pd.DataFrame(index=pd.Index(sorted(df["src_ip"].unique()), name="ip"))
    feats["wallet_partners"] = df.groupby("src_ip")["input_addresses"].apply(
        lambda s: len(set().union(*s)) if len(s) else 0
    )
    feats["tx_count"] = src.size()
    feats["volume"] = df.assign(v=df["input_amounts"].apply(sum)).groupby("src_ip")["v"].sum()
    feats["country_diversity"] = src["geo_country"].nunique()
    asn_share = src["asn"].apply(lambda s: s.value_counts(normalize=True).max())
    feats["asn_concentration"] = asn_share
    feats["burst_score"] = src["timestamp"].apply(_burst_scores)
    feats["degree"] = src["dst_ip"].nunique()
    return feats.fillna(0.0)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def score_frame(features: pd.DataFrame) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Isolation Forest → 0–1 anomaly scores plus per-feature contributions.

    Contributions are derived from per-feature robust z-scores relative to the
    population median, weighted by the model's deviation. This gives every
    alert human-readable "why" numbers without needing labels.
    """
    scaler = StandardScaler()
    X = scaler.fit_transform(features.to_numpy(dtype=float))
    model = IsolationForest(
        n_estimators=ISOLATION_TREES,
        contamination=ISOLATION_CONTAMINATION,
        random_state=ISOLATION_SEED,
    )
    model.fit(X)
    raw = -model.score_samples(X)  # higher = more anomalous
    scores = _percentile_sharpen(raw)

    med = np.median(X, axis=0)
    scale = np.where(scaler.scale_ == 0, 1.0, scaler.scale_)
    z = (X - med) / scale
    contributions = {}
    for idx, col in enumerate(features.columns):
        contributions[col] = np.abs(z[:, idx]) * scores
    return scores, contributions


def top_contributions(
    contributions: dict[str, np.ndarray], index: int, feature_names: list[str], top: int = 5
) -> list[dict]:
    rows = sorted(
        ((name, float(contributions[name][index])) for name in feature_names),
        key=lambda item: item[1],
        reverse=True,
    )[:top]
    return [{"feature": name, "contribution": round(value, 4)} for name, value in rows]


# ---------------------------------------------------------------------------
# Graph + risk propagation
# ---------------------------------------------------------------------------
def build_graph(df: pd.DataFrame):
    import networkx as nx

    g = nx.DiGraph()
    for _, row in df.iterrows():
        tx = row["txid"]
        src_ip, dst_ip = row["src_ip"], row["dst_ip"]
        g.add_edge(("ip", src_ip), ("tx", tx), kind="sent")
        g.add_edge(("tx", tx), ("ip", dst_ip), kind="relayed")
        for w in row["input_addresses"]:
            g.add_edge(("wallet", w), ("tx", tx), kind="spent")
        for w in row["output_addresses"]:
            g.add_edge(("tx", tx), ("wallet", w), kind="received")
        g.add_edge(("ip", src_ip), ("wallet", row["input_addresses"][0]), kind="observed")
    return g


def propagate_risk(g, seed_scores: dict) -> dict:
    """Propagate risk from high-scoring nodes to their graph neighbourhood."""
    risk = dict(seed_scores)
    for _ in range(PROPAGATION_ROUNDS):
        nxt = {}
        for node in g.nodes:
            own = risk.get(node, 0.0)
            neighbours = [risk.get(nb, 0.0) for nb in g.successors(node)] + [
                risk.get(nb, 0.0) for nb in g.predecessors(node)
            ]
            dampened = (sum(neighbours) / len(neighbours)) if neighbours else 0.0
            nxt[node] = PROPAGATION_KEEP * own + (1 - PROPAGATION_KEEP) * dampened
        risk = nxt
    return risk


def cluster_wallets(wallet_feats: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """DBSCAN over wallet behaviour features. Returns (labels, PCA-ish 2D coords)."""
    scaler = StandardScaler()
    X = scaler.fit_transform(wallet_feats.to_numpy(dtype=float))
    labels = DBSCAN(eps=DBSCAN_EPS, min_samples=DBSCAN_MIN_SAMPLES).fit_predict(X)
    # Deterministic 2D projection for scatter views (no random state needed).
    top = np.argsort(np.var(X, axis=0))[::-1][:2]
    coords = X[:, top]
    return labels, coords


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
def build_alerts(
    scored: dict[str, list[dict]], risk_by_node: dict, cap: int = 60
) -> list[dict]:
    """Create prioritized, explainable alerts from scored entity frames.

    Only wallet and IP entities become leads — transactions feed the explorer
    and serve as evidence. Leads are capped so the list stays investigable.
    """
    alerts: list[dict] = []
    for entity_type in ("wallet", "ip"):
        rows = scored.get(entity_type, [])
        for row in rows:
            score = float(row.get("anomalyScore", row.get("riskScore", 0.0)))
            if score < HIGH_THRESHOLD:
                continue
            entity_id = row.get("id", row.get("txid"))
            node = (entity_type, entity_id)
            propagated = float(risk_by_node.get(node, score))
            blended = min(1.0, 0.6 * score + 0.4 * propagated)
            alerts.append({
                "id": f"ALT-{len(alerts) + 1:04d}",
                "entityId": entity_id,
                "entityType": entity_type.capitalize() if entity_type != "ip" else "IP",
                "risk": risk_for(blended),
                "confidence": round(min(1.0, 0.5 + 0.5 * blended), 4),
                "anomalyScore": round(blended, 4),
                "reasons": [c["feature"] for c in row.get("reasonDetail", [])[:3]],
                "reasonDetail": row.get("reasonDetail", []),
                "evidence": row.get("evidence", []),
                "timestamp": row.get("lastSeen", row.get("timestamp", "")),
                "status": "New",
            })
    alerts.sort(key=lambda a: a["anomalyScore"], reverse=True)
    alerts = alerts[:cap]
    for rank, alert in enumerate(alerts, start=1):
        alert["id"] = f"ALT-{rank:04d}"
    return alerts
