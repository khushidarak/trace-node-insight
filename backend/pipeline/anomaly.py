"""Anomaly detection: feature engineering + IsolationForest + explainability.

Features are engineered per transaction and per wallet (amount, fee, fee
ratio, input/output counts, output-value entropy, time gaps, degree, IP
fan-out, round-value flag). The main model is a real trained
``sklearn.ensemble.IsolationForest``; an optional LocalOutlierFactor is fitted
as a comparison model. Explainability uses per-feature contributions: SHAP
TreeExplainer values when the ``shap`` package is installed, otherwise a
normalised absolute robust z-score deviation profile.

Every score is remapped to 0–1 by population percentile so risk bands are
interpretable regardless of the raw IsolationForest scale.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import StandardScaler

from .config import ISOLATION_SEED, ISOLATION_TREES, SETTINGS


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------
TX_FEATURES = [
    "amount", "amount_max", "fee", "fee_ratio", "input_count", "output_count",
    "output_entropy", "time_gap", "degree", "ip_fanout", "round_value",
]
WALLET_FEATURES = [
    "tx_count", "in_volume", "out_volume", "mean_amt", "max_amt", "amt_z",
    "amt_std", "mean_gap", "peer_count", "ip_fanout", "ip_sharers", "degree",
    "volume_share", "round_ratio", "output_entropy",
]

FEATURE_SETS = {"transaction": TX_FEATURES, "wallet": WALLET_FEATURES}


def _entropy(values: list[float]) -> float:
    """Normalised Shannon entropy of the output-value split (0 = all in one output)."""
    total = float(sum(values))
    if total <= 0 or not values:
        return 0.0
    shares = [v / total for v in values if v > 0]
    if len(shares) <= 1:
        return 0.0
    return float(-sum(s * math.log(s) for s in shares) / math.log(len(shares)))


def _gap_minutes(ts_sorted: pd.Series) -> float:
    """Mean gap in minutes between an entity's consecutive transactions."""
    ordered = ts_sorted.sort_values()
    if len(ordered) < 2:
        return 24 * 60.0
    gaps = ordered.diff().dt.total_seconds().dropna() / 60.0
    return float(gaps.mean()) if len(gaps) else 24 * 60.0


def build_transaction_features(df: pd.DataFrame) -> pd.DataFrame:
    """Per-transaction behavioural features for the anomaly model."""
    feats = pd.DataFrame(index=df.index)
    in_amt = df["input_amounts"].apply(lambda v: float(sum(v)) if v else 0.0)
    out_amt = df["output_amounts"].apply(lambda v: float(sum(v)) if v else 0.0)
    feats["amount"] = out_amt
    feats["amount_max"] = df["output_amounts"].apply(lambda v: max(v) if v else 0.0)
    feats["fee"] = df["fee"].astype(float)
    total_out = out_amt.replace(0, np.nan)
    feats["fee_ratio"] = (df["fee"] / total_out).fillna(0.0).clip(upper=0.5)
    feats["input_count"] = df["input_addresses"].apply(len)
    feats["output_count"] = df["output_addresses"].apply(len)
    feats["output_entropy"] = df["output_amounts"].apply(_entropy)
    ts = pd.to_datetime(df["timestamp"], utc=True)
    feats["time_gap"] = df.groupby("src_ip")["timestamp"].transform(_gap_minutes)
    feats["degree"] = (df["input_addresses"].apply(len) + df["output_addresses"].apply(len)).astype(float)
    feats["ip_fanout"] = df.groupby("src_ip")["txid"].transform("count").astype(float)
    feats["round_value"] = df["output_amounts"].apply(
        lambda v: float(any(abs(x - round(x, 2)) < 1e-9 and x > 0 for x in v))
    )
    return feats


def build_wallet_features(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Per-wallet behavioural features. Returns (features, wallet→ip map)."""
    from .correlate import correlate_ip_wallets

    ip_map: dict[str, set[str]] = {}
    events: dict[str, dict] = {}
    for _, row in df.iterrows():
        for side, addrs, amts in (
            ("in", row["input_addresses"], row["input_amounts"]),
            ("out", row["output_addresses"], row["output_amounts"]),
        ):
            for w, amt in zip(addrs, amts + [0.0] * len(addrs)):
                ev = events.setdefault(w, {"amts": [], "out_amts": [], "ts": [], "peers": set(), "ips": set()})
                ev["amts"].append(float(amt))
                if side == "out":
                    ev["out_amts"].append(float(amt))
                ev["ts"].append(row["timestamp"])
                ev["ips"].add(row["src_ip"])
                ev["peers"].update(a for a in row["input_addresses"] + row["output_addresses"] if a != w)
        ip_map.setdefault(row["src_ip"], set()).update(row["input_addresses"] + row["output_addresses"])
    ip_map = correlate_ip_wallets(df)

    ip_partners: dict[str, set[str]] = {}
    for ip, wallets in ip_map.items():
        for w in wallets:
            ip_partners.setdefault(w, set()).add(ip)

    rows = {}
    all_amts = [a for ev in events.values() for a in ev["amts"]]
    global_mean = float(np.mean(all_amts)) if all_amts else 1.0
    global_std = float(np.std(all_amts)) or 1.0
    n_wallets = max(len(events), 1)
    for w, ev in events.items():
        amts = ev["amts"]
        out_amts = ev["out_amts"] or amts
        rows[w] = {
            "tx_count": float(len(ev["amts"])),
            "in_volume": float(sum(a for a in amts if a > 0)),
            "out_volume": float(sum(out_amts)),
            "mean_amt": float(np.mean(amts)),
            "max_amt": float(max(amts)),
            # deviation from the population's typical amount — comparable across wallets
            "amt_z": float((np.mean(amts) - global_mean) / global_std),
            "amt_std": float(np.std(amts)),
            "mean_gap": _gap_minutes(pd.Series(ev["ts"])),
            "peer_count": float(len(ev["peers"])),
            "ip_fanout": float(len(ev["ips"])),
            # wallets sharing this wallet's IPs (co-location signal)
            "ip_sharers": float(max(0, len(ip_partners.get(w, ())) - 1)),
            "degree": float(len(ev["peers"]) + len(ev["ips"])),
            # share of the network's tx volume handled by this wallet
            "volume_share": float(sum(amts) / (sum(all_amts) or 1.0)) * n_wallets,
            "round_ratio": float(sum(1 for a in amts if abs(a - round(a, 2)) < 1e-9) / len(amts)),
            "output_entropy": _entropy(out_amts),
        }
    feats = pd.DataFrame.from_dict(rows, orient="index")
    return feats, ip_map


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def _percentile_scores(raw: np.ndarray) -> np.ndarray:
    """Percentile-rank raw scores to 0–1 (higher = more anomalous)."""
    ranked = pd.Series(raw).rank(pct=True).to_numpy()
    return np.clip((ranked - 0.30) / 0.70, 0.0, 1.0)


def score_frame(features: pd.DataFrame, contamination: float | None = None) -> dict:
    """Train IsolationForest, score rows, return scores + explainability payload.

    Returns {scores, contributions (n×f matrix), model, comparison, explainer}.
    Contributions are SHAP values when shap is importable, else absolute robust
    z-scores normalised per row — either way higher = pushed toward anomaly.
    """
    contamination = SETTINGS.contamination if contamination is None else contamination
    if features.empty:
        return {"scores": np.zeros(0), "contributions": np.zeros((0, 0)), "model": None, "comparison": None, "explainer": "none"}
    X = features.to_numpy(dtype=float)
    X = StandardScaler().fit_transform(X)
    model = IsolationForest(
        n_estimators=ISOLATION_TREES, contamination=contamination,
        random_state=ISOLATION_SEED, n_jobs=-1,
    )
    model.fit(X)
    raw = -model.score_samples(X)  # higher = more anomalous
    scores = _percentile_scores(raw)

    # --- per-feature contributions: SHAP if available, else z-scores ------
    contributions = None
    explainer_kind = "zscore_deviation"
    try:
        import shap  # type: ignore

        explainer = shap.TreeExplainer(model)
        contributions = np.abs(explainer.shap_values(X)).astype(float)
        explainer_kind = "shap_treeexplainer"
    except Exception:
        med = np.median(X, axis=0)
        scale = np.where(X.std(axis=0) == 0, 1.0, X.std(axis=0))
        z = np.abs((X - med) / scale)
        row_sums = z.sum(axis=1, keepdims=True)
        contributions = np.divide(z, np.where(row_sums == 0, 1, row_sums))  # rows sum to 1

    comparison = None
    if len(X) >= 50:
        try:
            lof = LocalOutlierFactor(n_neighbors=20, contamination=contamination)
            lof_labels = lof.fit_predict(X)
            comparison = {
                "name": "LocalOutlierFactor",
                "outliers": int((lof_labels == -1).sum()),
                "agreement": round(float(np.mean((lof_labels == -1) == (model.predict(X) == -1))), 4),
            }
        except Exception:
            comparison = None

    return {
        "scores": scores,
        "contributions": contributions,
        "model": model,
        "comparison": comparison,
        "explainer": explainer_kind,
    }


def top_contributions(contribs: np.ndarray, index: int, feature_names: list[str], top: int = 6) -> list[dict]:
    """Per-feature contribution list for one row (sorted, descending)."""
    if contribs.size == 0 or index >= contribs.shape[0]:
        return []
    vals = contribs[index]
    pairs = sorted(zip(feature_names, vals), key=lambda kv: float(kv[1]), reverse=True)[:top]
    total = float(sum(v for _, v in pairs)) or 1.0
    return [
        {"feature": name, "contribution": round(float(v) / total, 4)}
        for name, v in pairs
    ]


# ---------------------------------------------------------------------------
# Optional autoencoder comparison (kept small; torch is an optional dep)
# ---------------------------------------------------------------------------
def autoencoder_comparison(features: pd.DataFrame, contamination: float) -> dict | None:
    """Tiny PyTorch autoencoder trained for a few epochs; returns recon-error outliers."""
    try:
        import torch
        from torch import nn
    except ImportError:
        return None
    X = StandardScaler().fit_transform(features.to_numpy(dtype=float))
    n, d = X.shape
    torch.manual_seed(ISOLATION_SEED)
    model = nn.Sequential(
        nn.Linear(d, max(4, d // 2)), nn.ReLU(), nn.Linear(max(4, d // 2), 2), nn.ReLU(),
        nn.Linear(2, max(4, d // 2)), nn.ReLU(), nn.Linear(max(4, d // 2), d),
    )
    opt = torch.optim.Adam(model.parameters(), lr=1e-2)
    tensor = torch.tensor(X, dtype=torch.float32)
    for _ in range(120):
        opt.zero_grad()
        loss = ((model(tensor) - tensor) ** 2).mean()
        loss.backward()
        opt.step()
    with torch.no_grad():
        recon = ((model(tensor) - tensor) ** 2).mean(dim=1).numpy()
    threshold = np.quantile(recon, 1 - contamination)
    return {"name": "Autoencoder", "outliers": int((recon > threshold).sum())}
