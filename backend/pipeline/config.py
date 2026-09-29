"""Pipeline configuration and thresholds.

All tunables live here so the ML behaviour can be adjusted without touching
pipeline logic. Scores are normalised to 0.00–1.00 and mapped to risk bands:

    0.00–0.39 Low · 0.40–0.69 Medium · 0.70–0.89 High · 0.90–1.00 Critical
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict

API_VERSION = "1.0.0"
MODEL_NAME = "IsolationForest"
CLUSTERING_NAME = "DBSCAN"

# --- Isolation Forest ------------------------------------------------------
ISOLATION_TREES = 200
ISOLATION_SEED = 42

# --- Risk bands (fraction 0-1) --------------------------------------------
MEDIUM_THRESHOLD = 0.40
HIGH_THRESHOLD = 0.70
CRITICAL_THRESHOLD = 0.90
ALERT_MIN_SCORE = 0.70

# --- Synthetic generator defaults -----------------------------------------
SYNTHETIC_RECORDS = 5000
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB upload cap
PERSIST_DIR = os.environ.get("BITTRACE_DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "state"))

REQUIRED_FIELDS = [
    "timestamp", "src_ip", "dst_ip", "src_port", "dst_port", "txid",
    "input_addresses", "output_addresses", "input_amounts", "output_amounts",
    "fee", "script_type", "geo_country", "asn",
]

OPTIONAL_GROUND_TRUTH = "ground_truth"


@dataclass
class AnalysisSettings:
    """Tunable model/pipeline parameters, editable from the Settings page."""

    contamination: float = 0.08
    risk_propagation_decay: float = 0.70
    peeling_min_hops: int = 4
    mixing_min_outputs: int = 5
    dbscan_eps: float = 1.15
    dbscan_min_samples: int = 4
    risk_high_threshold: float = 0.70
    risk_critical_threshold: float = 0.90

    def normalized(self) -> "AnalysisSettings":
        s = AnalysisSettings(
            contamination=min(max(self.contamination, 0.01), 0.5),
            risk_propagation_decay=min(max(self.risk_propagation_decay, 0.0), 0.95),
            peeling_min_hops=min(max(self.peeling_min_hops, 2), 30),
            mixing_min_outputs=min(max(self.mixing_min_outputs, 2), 500),
            dbscan_eps=min(max(self.dbscan_eps, 0.2), 10.0),
            dbscan_min_samples=min(max(self.dbscan_min_samples, 2), 50),
            risk_high_threshold=min(max(self.risk_high_threshold, 0.3), 0.99),
            risk_critical_threshold=min(max(self.risk_critical_threshold, 0.5), 1.0),
        )
        if s.risk_critical_threshold <= s.risk_high_threshold:
            s.risk_critical_threshold = min(1.0, s.risk_high_threshold + 0.1)
        return s


def _settings_path() -> str:
    return os.path.join(PERSIST_DIR, "settings.json")


def load_settings() -> AnalysisSettings:
    """Load settings from disk if present, else defaults (also seeds the file)."""
    path = _settings_path()
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            return AnalysisSettings(**{k: data.get(k, v) for k, v in asdict(AnalysisSettings()).items()})
        except (OSError, ValueError, TypeError):
            pass
    return AnalysisSettings()


def save_settings(settings: AnalysisSettings) -> None:
    os.makedirs(PERSIST_DIR, exist_ok=True)
    with open(_settings_path(), "w", encoding="utf-8") as fh:
        json.dump(asdict(settings), fh, indent=2)


# Singleton used by the pipeline; replaced by the API layer when updated.
SETTINGS = load_settings()
