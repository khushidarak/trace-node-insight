#!/usr/bin/env bash
# BitTrace AI — run the FastAPI ML backend and the TanStack frontend together.
# Usage: ./dev.sh            (backend on :8000, frontend on the Vite port)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  echo "▸ Creating Python virtualenv (first run)…"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi

cleanup() { kill ${BACK_PID:-} 2>/dev/null || true; }
trap cleanup EXIT

echo "▸ Starting FastAPI backend on http://localhost:8000"
(cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000) &
BACK_PID=$!

# Wait for the backend to answer /api/health.
for i in $(seq 1 30); do
  curl -sf --max-time 2 http://localhost:8000/api/health > /dev/null && break
  sleep 1
done

echo "▸ Starting frontend (Vite dev server)"
npm run dev
