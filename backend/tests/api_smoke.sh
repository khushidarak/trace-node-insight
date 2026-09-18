#!/usr/bin/env bash
# BitTrace API smoke test: boots uvicorn, runs the demo flow, hits every endpoint.
set -u
cd "$(dirname "$0")/.."
PORT=8601
.venv/bin/python -m uvicorn app.main:app --port "$PORT" > /tmp/bittrace-api.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT

for i in $(seq 1 30); do
  curl -sf --max-time 2 "localhost:$PORT/api/health" > /dev/null && break
  sleep 1
done

echo "== health ==" && curl -s "localhost:$PORT/api/health"; echo
echo "== sample ==" && curl -s -o /tmp/sample.csv -w "%{http_code} %{size_download}B" "localhost:$PORT/api/sample-dataset?records=800"; echo
echo "== upload ==" && curl -s -F "file=@/tmp/sample.csv" "localhost:$PORT/api/upload"; echo
echo "== analyze ==" && curl -s -X POST "localhost:$PORT/api/analyze"; echo
echo "== dashboard ==" && curl -s "localhost:$PORT/api/dashboard" | head -c 420; echo
echo "== transactions ==" && curl -s "localhost:$PORT/api/transactions?limit=2" | head -c 300; echo
echo "== tx detail ==" && TX=$(curl -s "localhost:$PORT/api/transactions?limit=1" | .venv/bin/python -c "import sys,json;print(json.load(sys.stdin)['items'][0]['txid'])") && curl -s "localhost:$PORT/api/transactions/$TX" | head -c 220; echo
echo "== entities ==" && curl -s "localhost:$PORT/api/entities?limit=2" | head -c 300; echo
echo "== alerts ==" && curl -s "localhost:$PORT/api/alerts?limit=2" | head -c 300; echo
echo "== alert patch ==" && curl -s -X PATCH "localhost:$PORT/api/alerts/ALT-0001?status=Investigating" | head -c 160; echo
echo "== clusters ==" && curl -s "localhost:$PORT/api/clusters" | head -c 260; echo
echo "== geo ==" && curl -s "localhost:$PORT/api/geo" | head -c 220; echo
echo "== graph ==" && curl -s "localhost:$PORT/api/graph" | .venv/bin/python -c "import sys,json;d=json.load(sys.stdin);print('nodes',len(d['nodes']),'edges',len(d['edges']))"
echo "== reports ==" && curl -s "localhost:$PORT/api/reports" | head -c 300; echo
echo "== pre-upload guard ==" && curl -s -o /dev/null -w "upload-less analyze -> %{http_code}" -X POST "localhost:$PORT/api/analyze2" 2>/dev/null; echo
kill $PID 2>/dev/null
echo "API SMOKE DONE"
