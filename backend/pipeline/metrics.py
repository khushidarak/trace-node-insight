"""Evaluation against the ground truth planted by the synthetic generator.

The generator stores per-row illicit labels in a hidden ``ground_truth``
column (kept out of the API payloads). Metrics are computed for both the
raw anomaly score and the blended alert score.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score


def _threshold_scores(scores: np.ndarray, labels: np.ndarray, rate: float = 0.08) -> float:
    """Score cutoff marking the top `rate` of rows as predicted-positive."""
    if len(scores) == 0:
        return 0.0
    k = max(1, int(len(scores) * rate))
    return float(np.sort(scores)[-k])


def classification_metrics(scores: np.ndarray, labels: np.ndarray, rate: float = 0.08) -> dict:
    """Precision / recall / F1 at the top-`rate` threshold + ROC-AUC."""
    labels = np.asarray(labels, dtype=int)
    scores = np.asarray(scores, dtype=float)
    mask = labels >= 0  # -1 == unknown (user-uploaded data without labels)
    if mask.sum() == 0 or labels[mask].sum() == 0:
        return {"available": False, "reason": "no labelled rows in dataset"}
    s, y = scores[mask], labels[mask]
    cutoff = _threshold_scores(s, y, rate)
    preds = (s >= cutoff).astype(int)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y, preds, average="binary", zero_division=0
    )
    auc = None
    if len(np.unique(y)) == 2:
        auc = round(float(roc_auc_score(y, s)), 4)
    tp = int(((preds == 1) & (y == 1)).sum())
    fp = int(((preds == 1) & (y == 0)).sum())
    fn = int(((preds == 0) & (y == 1)).sum())
    return {
        "available": True,
        "labelled_rows": int(mask.sum()),
        "illicit_rows": int(y.sum()),
        "threshold_rate": rate,
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1": round(float(f1), 4),
        "roc_auc": auc,
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
    }


def pattern_metrics(peeling_chains: list[dict], mixing_hits: list[dict], planted: dict) -> dict:
    """Pattern recovery: do the detected chains/rounds cover the wallets that
    the generator planted? Matched by wallet-set overlap (chain/round ids are
    assigned independently by detector and generator, so ids cannot match)."""
    planted_chain_wallets = _groups(planted, "wallet_chain_")
    planted_round_wallets = _groups(planted, "wallet_cj_")

    def best_overlap(detected_wallet_sets: list[set[str]], planted_sets: list[set[str]]) -> int:
        hits = 0
        for ps in planted_sets:
            if any(len(ps & ds) / max(1, len(ps)) >= 0.5 for ds in detected_wallet_sets):
                hits += 1
        return hits

    detected_chain_sets = [set(c.get("wallets", [])) for c in peeling_chains]
    detected_round_sets = [set(h.get("input_wallets", [])) | set(h.get("output_wallets", [])) for h in mixing_hits]
    n_chain_planted = len({v for k, v in planted.items() if k.startswith("wallet_chain_")})
    n_round_planted = len({v for k, v in planted.items() if k.startswith("wallet_cj_")})
    return {
        "planted_chains": n_chain_planted,
        "detected_chains": len(peeling_chains),
        "chains_recovered": best_overlap(detected_chain_sets, planted_chain_wallets),
        "planted_rounds": n_round_planted,
        "detected_rounds": len(mixing_hits),
        "rounds_recovered": best_overlap(detected_round_sets, planted_round_wallets),
    }


def _groups(planted: dict, prefix: str) -> list[set[str]]:
    """{planted_id → set(wallets)} for a planted-facts prefix."""
    groups: dict[str, set[str]] = {}
    for key, cid in planted.items():
        if key.startswith(prefix):
            groups.setdefault(cid, set()).add(key[len(prefix):])
    return [v for v in groups.values() if len(v) >= 2]


def wallet_labels_from_rows(df) -> tuple[list[str], list[int]]:
    """Curated per-wallet ground truth (label 1 + explicit negatives).

    A wallet is illicit (1) when it participates in the illicit activity
    itself: as an input of an illicit row, or as the change (second, usually
    smaller) output — i.e. structure the wallet did choose. Every other wallet
    in the dataset becomes an explicit negative (0), including wallets that
    merely received an illicit payment (victims, first-hop receivers), so
    precision measures false accusations fairly.
    """
    labels: dict[str, int] = {}
    all_wallets: set[str] = set()
    for _, row in df.iterrows():
        all_wallets.update(row["input_addresses"])
        all_wallets.update(row["output_addresses"])
        gt = row.get("ground_truth")
        if gt is None or int(gt) != 1:
            continue
        for w in row["input_addresses"]:
            labels[w] = 1
        outs, amts = row["output_addresses"], row["output_amounts"]
        if len(outs) >= 2 and len(amts) == len(outs):
            main = max(range(len(amts)), key=lambda i: amts[i])
            for i, w in enumerate(outs):
                if i != main:
                    labels[w] = 1
    labels = {w: int(labels.get(w, 0)) for w in all_wallets}
    if not labels:
        return [], []
    wallets = sorted(labels)
    return wallets, [labels[w] for w in wallets]
