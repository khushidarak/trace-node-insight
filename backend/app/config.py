"""Pipeline configuration and thresholds.

All tunables live here so the ML behaviour can be adjusted without touching
pipeline logic. Scores are normalised to 0.00–1.00 and mapped to risk bands:

    0.00–0.39 Low · 0.40–0.69 Medium · 0.70–0.89 High · 0.90–1.00 Critical
"""

API_VERSION = "0.4.1"
MODEL_NAME = "Isolation Forest"
CLUSTERING_NAME = "DBSCAN"

# --- Isolation Forest -----------------------------------------------------
ISOLATION_TREES = 200
ISOLATION_CONTAMINATION = 0.08
ISOLATION_SEED = 42
# Percentile ranks are sharpened so the bulk of normal transactions sits in
# the Low band instead of clustering around 0.5.
SCORE_SHARPENING = 1.8

# --- Risk bands -----------------------------------------------------------
MEDIUM_THRESHOLD = 0.40
HIGH_THRESHOLD = 0.70
CRITICAL_THRESHOLD = 0.90
ALERT_MIN_SCORE = 0.70

# --- DBSCAN entity clustering --------------------------------------------
DBSCAN_EPS = 1.15
DBSCAN_MIN_SAMPLES = 4

# --- Graph risk propagation ----------------------------------------------
PROPAGATION_ROUNDS = 3
PROPAGATION_KEEP = 0.70  # weight of a node's own score vs. its neighbours

# --- Synthetic dataset defaults ------------------------------------------
SYNTHETIC_RECORDS = 1200
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB, mirrors the UI contract

REQUIRED_FIELDS = [
    "timestamp",
    "src_ip",
    "dst_ip",
    "src_port",
    "dst_port",
    "txid",
    "input_addresses",
    "output_addresses",
    "input_amounts",
    "output_amounts",
    "fee",
    "script_type",
    "geo_country",
    "asn",
]
