"""End-to-end pipeline smoke test: synthetic data → full analysis payload."""

import sys

from app.main import run_full_analysis
from app.synthetic import generate_synthetic_dataset

rows = generate_synthetic_dataset(400)
meta = {
    "fileName": "synthetic_test.csv",
    "fileType": "csv",
    "records": len(rows),
    "wallets": 0,
    "transactions": len(rows),
    "ips": 0,
    "dateRange": [rows[0]["timestamp"], rows[-1]["timestamp"]],
    "rejectedRecords": 0,
    "missingFields": [],
}

analysis = run_full_analysis(rows, meta)

print("kpis:", analysis["kpis"])
print("alerts:", len(analysis["alerts"]), "| clusters:", len(analysis["clusters"]),
      "| entities:", len(analysis["entities"]), "| graph nodes:", len(analysis["graph"]["nodes"]))
print("sample alert:", analysis["alerts"][0] if analysis["alerts"] else None)
print("sample cluster:", analysis["clusters"][0] if analysis["clusters"] else None)
print("geo rows:", len(analysis["geo"]), "| activity days:", len(analysis["activity"]))

issues = []
if not analysis["alerts"]:
    issues.append("no alerts generated")
if analysis["kpis"]["suspiciousEntities"] == 0:
    issues.append("no suspicious entities")
if not analysis["clusters"]:
    issues.append("no clusters found")
if not analysis["graph"]["nodes"]:
    issues.append("empty graph")
if issues:
    print("ISSUES:", issues)
    sys.exit(1)
print("PIPELINE SMOKE TEST PASSED")
