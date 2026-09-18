# Run doc — BitTrace AI (frontend + FastAPI ML backend)

## How to reproduce the artifacts

A fresh checkout needs two runtimes. Nothing else to copy (no `.env` files used).

1. Frontend deps (Node 20+, npm):
   ```sh
   npm ci   # or npm install
   ```
2. Backend venv (Python 3.9+; repo pins nothing beyond requirements.txt):
   ```sh
   python3 -m venv backend/.venv
   backend/.venv/bin/pip install -r backend/requirements.txt
   ```

## How to run the server

Dev preview runs BOTH processes. Ports: frontend **8080** (sandbox default; the
Vite config picks it up automatically), backend **8000** (the frontend's
service layer in `src/lib/api.ts` probes `http://localhost:8000/api/health`
and falls back to mock data if absent — no env vars needed).

Simplest:

```sh
./dev.sh
```

Manual equivalent:

```sh
# terminal 1 — FastAPI backend
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000

# terminal 2 — Vite frontend
npm run dev
```

### Sandboxed/previews (this thread)

Plain `nohup &` gets reaped here; use launchd with an explicit PATH
(launchd's default PATH lacks homebrew node):

```sh
launchctl submit -l bittrace-backend -- /bin/sh -c \
  "exec /Users/khushidarak/trace-node-insight/backend/.venv/bin/python -m uvicorn app.main:app --app-dir /Users/khushidarak/trace-node-insight/backend --port 8000 > /Users/khushidarak/trace-node-insight/.freebuff/backend-preview.log 2>&1"

launchctl submit -l bittrace-frontend -- /bin/sh -c \
  "cd /Users/khushidarak/trace-node-insight && PATH=/opt/homebrew/bin:\$PATH exec npm run dev > /Users/khushidarak/trace-node-insight/.freebuff/preview-052a720d-6e76-4110-bdf2-fe852794ac8b.log 2>&1"
```

Pids: `launchctl print gui/$(id -u)/bittrace-frontend | grep pid` (and
`.../bittrace-backend`). Stop with `launchctl remove bittrace-frontend
bittrace-backend`. Logs: the two files under `.freebuff/` named above.

Verify: `curl localhost:8000/api/health` → `{"status":"ok",...}` and
`curl -o /dev/null -w '%{http_code}' localhost:8080` → `200`.
