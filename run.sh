#!/usr/bin/env bash
# BitTrace AI — one-command offline run for Linux.
#   ./run.sh [--rows N]     build (if needed) + start on http://localhost:8000
#
# The script:
#   1. creates backend/.venv and installs pinned Python deps (offline-friendly,
#      set PIP_FIND_LINKS to a local wheelhouse if you have no internet at all)
#   2. builds the frontend into frontend-dist/ when it is missing
#   3. generates the synthetic sample dataset into data/
#   4. starts uvicorn on :8000 serving both the API and the built frontend
set -euo pipefail
cd "$(dirname "$0")"

ROWS="${ROWS:-5000}"

# --- 1. Python virtualenv ---------------------------------------------------
if [ ! -x backend/.venv/bin/python ]; then
  echo "▸ Creating Python virtualenv (first run)…"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q --upgrade pip
fi
if ! backend/.venv/bin/python -c "import fastapi, pandas, sklearn, networkx, reportlab" 2>/dev/null; then
  echo "▸ Installing backend dependencies…"
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi

# --- 2. Frontend build -------------------------------------------------------
if [ ! -d frontend-dist ] || [ -z "$(ls -A frontend-dist 2>/dev/null)" ]; then
  echo "▸ Building frontend (first run)…"
  ./build.sh
fi

# --- 3. Sample data ----------------------------------------------------------
if [ ! -f data/sample.csv ]; then
  echo "▸ Generating sample dataset (${ROWS} rows)…"
  mkdir -p data
  (cd backend && .venv/bin/python generate_data.py --rows "$ROWS" --seed 42 --out ../data/sample)
fi

# --- 4. Serve -----------------------------------------------------------------
echo "▸ Starting BitTrace AI on http://localhost:8000  (Ctrl+C to stop)"
exec backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
