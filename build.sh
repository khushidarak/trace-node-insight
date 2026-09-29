#!/usr/bin/env bash
# Build the BitTrace AI frontend into frontend-dist/ (static files served by
# the FastAPI backend, so one process runs everything offline).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "▸ Installing frontend dependencies…"
  npm install
fi

echo "▸ Building frontend…"
npm run build

# TanStack Start (SPA mode) prerenders the shell to .output/public/_shell.html.
# Normalise it to frontend-dist/ with an index.html that the FastAPI backend
# serves as plain static files (fully offline, no node process needed).
SRC=".output/public"
if [ ! -f "$SRC/_shell.html" ] && [ ! -f "$SRC/index.html" ]; then
  for candidate in build/client dist build; do
    if [ -e "$candidate/index.html" ]; then SRC="$candidate"; break; fi
  done
fi
if [ ! -d "$SRC" ]; then
  echo "✗ frontend build output not found" >&2
  exit 1
fi
rm -rf frontend-dist
mkdir -p frontend-dist
cp -R "$SRC"/. frontend-dist/
if [ -f frontend-dist/_shell.html ] && [ ! -f frontend-dist/index.html ]; then
  mv frontend-dist/_shell.html frontend-dist/index.html
fi
echo "✓ frontend built → frontend-dist/ ($(du -sh frontend-dist | cut -f1))"
