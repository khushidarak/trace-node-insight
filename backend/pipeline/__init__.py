"""BitTrace AI analysis pipeline.

Modules:
    ingest      — CSV/JSON/XML parsers, schema normalisation, validation
    correlate   — IP↔wallet correlation and multi-layer graph construction
    clustering  — union-find common-input ownership + embedding clustering
    anomaly     — feature engineering + IsolationForest scoring + explainability
    patterns    — peeling-chain and mixing/CoinJoin-like detectors
    risk        — personalised-PageRank risk propagation from seed wallets
    alerts      — ranked, explainable alert generation
    metrics     — precision/recall/F1/ROC-AUC against planted ground truth
"""

from __future__ import annotations
