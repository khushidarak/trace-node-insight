"""App-level re-export of the pipeline configuration (single source of truth
lives in pipeline/config.py)."""

from pipeline.config import (  # noqa: F401
    ALERT_MIN_SCORE,
    AnalysisSettings,
    API_VERSION,
    CLUSTERING_NAME,
    CRITICAL_THRESHOLD,
    HIGH_THRESHOLD,
    MAX_UPLOAD_BYTES,
    MEDIUM_THRESHOLD,
    MODEL_NAME,
    PERSIST_DIR,
    REQUIRED_FIELDS,
    SETTINGS,
    SYNTHETIC_RECORDS,
    load_settings,
    save_settings,
)

__all__ = [
    "ALERT_MIN_SCORE", "AnalysisSettings", "API_VERSION",
    "CLUSTERING_NAME", "CRITICAL_THRESHOLD", "HIGH_THRESHOLD", "MAX_UPLOAD_BYTES",
    "MEDIUM_THRESHOLD", "MODEL_NAME", "PERSIST_DIR", "REQUIRED_FIELDS", "SETTINGS",
    "SYNTHETIC_RECORDS", "load_settings", "save_settings",
]
