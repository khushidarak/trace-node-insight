#!/usr/bin/env bash
# Edge cases: 409 guard, JSON + XML ingestion, malformed upload rejection.
set -u
cd "$(dirname "$0")/.."
PORT=8602
.venv/bin/python -m uvicorn app.main:app --port "$PORT" > /tmp/bittrace-edge.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -sf --max-time 2 "localhost:$PORT/api/health" > /dev/null && break; sleep 1; done

echo "== analyze before upload (expect 409) ==" && curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:$PORT/api/analyze"; echo
# JSON upload
.venv/bin/python -c "
import json, urllib.request
rows = urllib.request.urlopen('http://localhost:$PORT/api/sample-dataset?records=120').read().decode().splitlines()
header = rows[0].split(',')
recs = [dict(zip(header, r.split(','))) for r in rows[1:3]]
for r in recs:
    for f in ('input_addresses','output_addresses','input_amounts','output_amounts'):
        r[f] = r[f].split(';')
json.dump(recs, open('/tmp/sample.json','w'))
"
echo "== upload JSON ==" && curl -s -F "file=@/tmp/sample.json" "localhost:$PORT/api/upload" | head -c 200; echo
# XML upload
.venv/bin/python -c "
import urllib.request
rows = urllib.request.urlopen('http://localhost:$PORT/api/sample-dataset?records=60').read().decode().splitlines()
header = rows[0].split(',')
items = []
for r in rows[1:4]:
    vals = r.split(',')
    fields = ''.join(f'<{h}>{v}</{h}>' for h, v in zip(header, vals))
    items.append(f'<row>{fields}</row>')
open('/tmp/sample.xml','w').write('<?xml version=\"1.0\"?><rows>' + ''.join(items) + '</rows>')
"
echo "== upload XML ==" && curl -s -F "file=@/tmp/sample.xml" "localhost:$PORT/api/upload" | head -c 200; echo
echo "== upload garbage (expect 422) ==" && echo "not,a,dataset" > /tmp/bad.csv && curl -s -o /dev/null -w "%{http_code}" -F "file=@/tmp/bad.csv" "localhost:$PORT/api/upload"; echo
kill $PID 2>/dev/null
echo "EDGE TESTS DONE"
