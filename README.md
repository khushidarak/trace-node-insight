# BitTrace AI

**AI-Powered Bitcoin Transaction Traffic Monitoring & Analysis**

A complete, offline forensic investigation platform built for **Smart India Hackathon 2026 — Problem Statement SIH26146** (Organisation: National Technical Research Organisation · Category: Software · Theme: Cryptocurrency).

BitTrace AI ingests bulk Bitcoin transaction/network metadata, correlates network-layer observations (IP/port/timing) with blockchain-layer data (wallet/TXID/amount), applies AI/ML to detect anomalies, clusters related entities, and produces **prioritized, explainable investigative leads** — all rendered in a SOC-style investigation console.

> ⚠️ BitTrace AI is a blockchain-forensics and network-traffic-analysis tool — **not** a crypto price tracker or trading app. It reports *investigation leads*, never verdicts: every score is an investigative prioritization signal that requires human review.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Quick Start](#quick-start)
5. [Backend API Reference](#backend-api-reference)
6. [ML Pipeline](#ml-pipeline)
7. [Dataset & Schema](#dataset--schema)
8. [Project Structure](#project-structure)
9. [Demo Flow](#demo-flow)
10. [Testing](#testing)
11. [Design Principles & Limitations](#design-principles--limitations)
12. [Roadmap](#roadmap)

---

## Features

### 🔍 Investigation Console (React + TanStack Start)

| View | What it does |
| --- | --- |
| **Dashboard** | KPI cards (transactions, wallets, IPs, suspicious entities, high-risk alerts, avg anomaly score), activity-over-time chart, risk-distribution donut, model reason-code bars, top suspicious entities table |
| **Data Ingestion** | Drag-and-drop upload for CSV/JSON/XML (20 MB limit), live schema-validated dataset summary, sample-dataset download, processing pipeline visualization |
| **Transaction Explorer** | Searchable/filterable transaction table (risk, country, ASN, free text across TXID/wallet/IP/ASN), click-through investigation drawer |
| **Transaction Detail** | Flow diagram (source → TX → destination), full metadata grid, **"Why was this flagged?"** panel with per-feature contribution bars |
| **Entity Graph** | Force-directed link-analysis canvas: wallets (blue circles), transactions (orange squares), IPs (yellow diamonds), ASN nodes. Node size ∝ connectivity, risk halos on flagged nodes, type filters, click-to-inspect |
| **Entity Investigation** | Risk score, anomaly score, connected-entity table, AI risk explanation, one-click "Open in Graph" |
| **AI Anomaly Detection** | Model card (Isolation Forest, unsupervised), all engineered features, risk-band scale, entity score distribution |
| **Entity Clusters** | DBSCAN candidate groups with wallet/IP/transaction counts, risk level, behavioural signature, member countries |
| **Investigation Alerts** | Prioritized lead table sorted by risk/confidence, full status workflow (New → Investigating → Reviewed → Dismissed), evidence drawer with linked TXIDs/IPs |
| **Geo Network** | Country-level IP/transaction/wallet associations with risk context and the explicit note that *a country is never suspicious* |
| **Reports** | Investigation report generation + working exports: **PDF** (print-formatted case file), **JSON** (machine-readable), **CSV** (transaction record set) |
| **Global Search** | Categorized results: Transactions, Wallets, IP Addresses, Alerts, Clusters |

### ⚙️ Backend Intelligence (FastAPI + scikit-learn)

- **Format-agnostic ingestion** — CSV, JSON, XML with field aliasing (`country` → `geo_country`, `tx_id` → `txid`, …), flexible timestamps (ISO 8601 / epoch seconds / milliseconds / common formats), list fields as arrays or delimited strings. Malformed rows are rejected with a count, never crashing the pipeline.
- **Real ML, not static rules** — Isolation Forest anomaly detection over 31 engineered features, DBSCAN entity clustering, networkx graph construction with multi-round risk propagation.
- **Explainability by default** — every alert ships per-feature contribution scores (robust z-scores × model deviation), rendered as "why" bars in the UI.
- **Backend-optional resilience** — the frontend auto-detects the backend and falls back to bundled mock data, so the demo never breaks.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  FRONTEND — React 19 · TypeScript · TanStack Start · Tailwind v4   │
│  SOC-dark console · Recharts · SVG force-directed graph            │
│  Service layer: src/lib/api.ts (backend probe + mock fallback)     │
└──────────────────────────────┬─────────────────────────────────────┘
                               │  REST/JSON  (auto-detected)
┌──────────────────────────────▼─────────────────────────────────────┐
│  BACKEND — FastAPI (backend/app/main.py)                           │
│  In-process state: one dataset + one analysis per session          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│  ML PIPELINE (backend/app/pipeline.py)                             │
│                                                                    │
│  CSV/JSON/XML → ingestion.py (validate, alias, reject)             │
│       ↓                                                            │
│  Feature engineering (13 tx · 11 wallet · 7 IP features)           │
│       ↓                                                            │
│  Isolation Forest (200 trees, contamination 0.08)                  │
│       ↓  scores normalised to 0.00–1.00                            │
│  DBSCAN entity clustering (wallet behaviour space)                 │
│       ↓                                                            │
│  Graph construction (networkx: IP↔TX↔Wallet edges)                 │
│       ↓                                                            │
│  Risk propagation (3 rounds, keep-weight 0.70)                     │
│       ↓                                                            │
│  Explainable risk scoring → prioritized alerts (capped at 60)      │
│       ↓                                                            │
│  Dashboard · Explorer · Graph · Clusters · Geo · Reports           │
└────────────────────────────────────────────────────────────────────┘
```

**Intended production evolution** (per the problem statement): this prototype's pipeline maps 1:1 onto a Pandas/scikit-learn batch service; the REST contract below is stable, so the mock/UI layer needs no redesign when the backend scales up.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript (strict), TanStack Start + React Router + React Query, Tailwind CSS v4, shadcn/ui (Radix), Recharts, Lucide icons, IBM Plex Mono + Space Grotesk |
| Backend | Python 3.9+, FastAPI, Uvicorn, python-multipart |
| ML / Data | pandas, NumPy, scikit-learn (Isolation Forest, DBSCAN, StandardScaler), networkx |
| Build | Vite 8, Nitro, ESLint 9 + Prettier |

---

## Quick Start

### Prerequisites

- **Node.js 20+** and npm
- **Python 3.9+** (3.11+ recommended)

### One command (frontend + backend together)

```sh
./dev.sh
```

First run creates the Python venv and installs everything automatically. Then:

- Frontend → http://localhost:8080
- Backend → http://localhost:8000
- The sidebar footer will show **"FastAPI backend · live"** when connected.

### Manual setup

```sh
# 1. Frontend dependencies
npm install

# 2. Backend virtualenv
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# 3. Run (two terminals)
npm run backend        # FastAPI on :8000
npm run dev            # Vite on :8080
```

### Frontend without the backend

`npm run dev` alone works — the app runs in **mock mode** with bundled synthetic data (badge: "mock mode"). Every feature stays functional; the graph is seeded from the highest-risk mock transactions instead of live pipeline output.

> **Configuration:** the backend URL defaults to `http://localhost:8000`. Override with `VITE_API_URL=http://host:port npm run dev`.

---

## Backend API Reference

Base URL: `http://localhost:8000`

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service status, dataset/analysis flags |
| `POST` | `/api/upload` | Ingest CSV/JSON/XML (`multipart/form-data`, field `file`) |
| `POST` | `/api/analyze` | Run the full ML pipeline on the loaded dataset |
| `GET` | `/api/dashboard` | KPIs, activity series, risk distribution, top entities |
| `GET` | `/api/dashboard-full` | Complete analysis payload in one response |
| `GET` | `/api/transactions` | Search (`q`), filter (`risk`, `country`, `asn`), paginate (`limit`, `offset`) |
| `GET` | `/api/transactions/{txid}` | Single transaction with contribution detail |
| `GET` | `/api/entities` | Scored wallets/IPs (`type`, `q`, `limit`, `offset`) |
| `GET` | `/api/entities/{id}` | Single entity with evidence + neighbours |
| `GET` | `/api/graph` | Nodes + edges for link analysis (`limit`) |
| `GET` | `/api/alerts` | Prioritized leads (`status`, `risk` filters) |
| `PATCH` | `/api/alerts/{id}?status=` | Status workflow: `New` / `Investigating` / `Reviewed` / `Dismissed` |
| `GET` | `/api/clusters` | DBSCAN entity clusters |
| `GET` | `/api/geo` | Country-level network context |
| `GET` | `/api/reports` | Report payload (summary, alert stats, top leads, limitations) |
| `GET` | `/api/sample-dataset?records=N` | Download synthetic dataset CSV (100–20,000 records) |

Error semantics: `409` when analyzing without a dataset · `422` for unparseable uploads · `404` for unknown TXIDs/entities/alerts.

---

## ML Pipeline

### Risk bands

| Score | Level |
| --- | --- |
| 0.00 – 0.39 | 🟢 Low |
| 0.40 – 0.69 | 🟡 Medium |
| 0.70 – 0.89 | 🟠 High |
| 0.90 – 1.00 | 🔴 Critical |

Scores are percentile-normalised with a linear remap so the bulk of normal activity lands in the Low band; only genuinely extreme behaviour reaches High/Critical.

### Engineered features

- **Transaction (13)** — amount mean/max, fee ratio, I/O ratio, input/output counts, burst score (share of <5-minute-arrival transactions), wallet degree, IP degree, country/ASN diversity, repeated IP↔wallet pairs, off-peak-hour flag
- **Wallet (11)** — degree, in/out volume, transaction frequency, IP partners, wallet co-participants (via shared TXIDs), burst score, amount std/max, off-peak ratio, cluster-risk reserve
- **IP (7)** — wallet partners, transaction count, volume, country diversity, ASN concentration, burst score, fan-out degree

### Models

- **Isolation Forest** — unsupervised (the dataset carries no reliable labels), 200 trees, contamination 0.08. Chosen because it isolates anomalies by random partitioning rather than modelling "normal" explicitly — well suited to sparse, high-dimensional behavioural features.
- **DBSCAN** — density clustering over standardised wallet features; ε=1.15, min_samples=4. Finds laundering groups *and* labels noise (isolated wallets) without fixing the cluster count upfront.
- **Risk propagation** — seed scores diffuse 3 rounds across the transaction graph (70 % own score / 30 % neighbourhood mean), so a wallet connected to flagged entities is elevated — surfacing downstream exposure that single-entity scoring misses.
- **Alert blending** — final lead score = 0.6 × entity score + 0.4 × propagated score; only High/Critical become leads, capped at 60 so the list stays investigable.

### Explainability

Every flagged entity stores its **top-5 feature contributions** — per-feature robust z-scores weighted by the model's anomaly deviation. These render as the horizontal "why" bars in the transaction drawer and as the detection factors in alert evidence. Reason codes are human-readable (`burst_score`, `asn_concentration`, `wallet_partners`, …).

### Why this is honest ML

- No labels are invented; detection is genuinely unsupervised
- The UI never claims criminality — wording everywhere is "suspicious pattern", "requires review", "investigation lead"
- Limitations are printed in every generated report

---

## Dataset & Schema

The problem statement mandates **synthetic data** (no real seized or live-intercept data). Two options:

**1. Generate one (recommended for demos):**
```sh
curl "http://localhost:8000/api/sample-dataset?records=2000" -o bitcoin_network_metadata.csv
# …or click "Sample dataset" on the Data Ingestion page
```
The generator (`backend/app/synthetic.py`) injects known laundering behaviours — peeling chains (4–8 hops), transaction bursts, layering hubs (6–12 fan-out), CoinJoin-style equal outputs, and geographic anomalies — so the ML pipeline has real structure to find (~10 % anomalous rows).

**2. Bring your own** CSV/JSON/XML with the required fields:

| Field | Type | Notes |
| --- | --- | --- |
| `timestamp` | datetime | ISO 8601, epoch s/ms, or common formats |
| `src_ip` / `dst_ip` | string | network-layer endpoints |
| `src_port` / `dst_port` | int | |
| `txid` | string | transaction identifier |
| `input_addresses[]` / `output_addresses[]` | list | wallet addresses |
| `input_amounts[]` / `output_amounts[]` | list[float] | aligned with the address lists |
| `fee` | float | |
| `script_type` | string | P2WPKH, P2SH, P2TR, … |
| `geo_country` / `asn` | string | geographic/ASN metadata |

Lists may arrive as JSON arrays or `;`/`,`-delimited strings; common field aliases are auto-mapped; rows failing validation are counted and skipped (the upload response reports `rejectedRecords` and any `missingFields`).

---

## Project Structure

```
├── dev.sh                      # one-command launcher (backend + frontend)
├── package.json                # frontend scripts & dependencies
├── src/
│   ├── components/
│   │   ├── bittrace/
│   │   │   └── BitTraceApp.tsx # full console: shell + all 10 views
│   │   └── ui/                 # shadcn/ui primitives
│   ├── lib/
│   │   ├── api.ts              # service layer: backend probe, mock fallback
│   │   ├── bittrace-api.ts     # types + bundled synthetic mock data
│   │   └── utils.ts
│   ├── routes/                 # TanStack Start file routes
│   └── styles.css              # SOC-dark design tokens (Tailwind v4 theme)
├── backend/
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py             # FastAPI endpoints + analysis orchestration
│   │   ├── pipeline.py         # features · Isolation Forest · DBSCAN · graph · alerts
│   │   ├── ingestion.py        # CSV/JSON/XML parsing, aliases, validation
│   │   ├── synthetic.py        # synthetic dataset generator
│   │   └── config.py           # all tunables (thresholds, seeds, limits)
│   └── tests/
│       ├── test_pipeline.py    # end-to-end pipeline smoke test
│       ├── api_smoke.sh        # full HTTP contract test (boots server)
│       └── api_edge.sh         # 409/422 guards, JSON + XML ingestion
└── .freebuff/run.md            # sandbox/preview run procedures
```

---

## Demo Flow

The end-to-end story: **Raw Metadata → Correlation → AI/ML → Graph → Explainable Alert → Investigation Lead**

1. Open BitTrace AI — dashboard shows the empty state
2. **Data Ingestion** → click **Sample dataset** (downloads `bitcoin_network_metadata.csv`)
3. Drop the file into the upload zone — schema summary populates
4. Click **Run AI Analysis** — the 10-stage processing pipeline animates
5. Dashboard fills with live KPIs, charts, and top suspicious entities
6. **Entity Graph** — explore the force-directed canvas; click any node
7. Click a high-risk alert in **Investigation Alerts** → evidence drawer (confidence, detection factors, linked TXIDs/IPs)
8. **Open in Graph** — the flagged entity's neighbourhood lights up
9. **Reports** → Generate → export the case file as PDF/JSON/CSV

With the backend running, everything above reflects genuine Isolation Forest + DBSCAN + risk-propagation output (~330+ node graph from a 1,000-record dataset).

---

## Testing

```sh
# Backend pipeline (synthetic data → full analysis payload)
cd backend && .venv/bin/python tests/test_pipeline.py

# Full HTTP contract (boots its own server, hits every endpoint)
backend/tests/api_smoke.sh

# Edge cases: 409 guard, JSON/XML uploads, malformed-file 422
backend/tests/api_edge.sh

# Frontend
npx tsc --noEmit     # strict typecheck
npm run lint         # ESLint + Prettier
npm run build        # production build
```

---

## Design Principles & Limitations

**Principles**
- Offline-first: no live blockchain APIs, no external wallet tracking; files never leave the local system
- Investigative language only — the system flags patterns, humans decide
- Explainability is a first-class output, not an afterthought
- Country-level context, never country-level accusation

**Known limitations (stated in every report)**
- Scores are prioritization signals, **not** proof of criminal activity
- Synthetic dataset — demonstrates the pipeline, not real-world calibrated rates
- Unsupervised models may flag rare-but-benign behaviour for review
- In-process state: one dataset/analysis per backend session (persistence is roadmap work)

---

## Roadmap

- [ ] Persist datasets, analyses, and alert statuses (SQLite) across restarts
- [ ] peeling-chain / CoinJoin pattern detectors as first-class reason codes with sequence visualization
- [ ] GeoIP database integration (offline MaxMind) for precise ASN/country enrichment
- [ ] Graph zoom, pan, and node dragging; alert-aware neighbourhood focus
- [ ] Multi-dataset sessions with dataset comparison views
- [ ] Dockerized one-command deployment
- [ ] Export formats: STIX/TAXII for intel-sharing interoperability

---

## Team & Acknowledgements

Built for **Smart India Hackathon 2026** (SIH26146). Thanks to the open-source communities behind FastAPI, scikit-learn, networkx, React, TanStack, and Tailwind CSS.

*BitTrace AI — Offline Analysis Mode · Synthetic Dataset · No Live Blockchain Monitoring*
