/**
 * BitTrace API service layer.
 *
 * Single boundary between the UI and the analysis backend. When the FastAPI
 * backend (backend/, README §18) is reachable the app runs on live ML output;
 * otherwise every call transparently falls back to the built-in synthetic mock
 * data so the prototype always demos. Swap BACKEND_URL / set
 * VITE_API_URL to repoint without touching any component.
 */

import {
  activity as mockActivity,
  activityTypes as mockActivityTypes,
  alerts as mockAlerts,
  clusters as mockClusters,
  entities as mockEntities,
  geo as mockGeo,
  riskDistribution as mockRiskDistribution,
  transactions as mockTransactions,
  type Alert,
  type AlertStatus,
  type Cluster,
  type Entity,
  type RiskLevel,
  type Transaction,
} from "./bittrace-api";

export const BACKEND_URL: string =
  (import.meta.env as Record<string, string | undefined>)?.["VITE_API_URL"] ??
  "http://localhost:8000";

export interface DatasetMeta {
  fileName: string;
  fileType: string;
  records: number;
  wallets: number;
  transactions: number;
  ips: number;
  dateRange: [string, string];
  rejectedRecords: number;
  missingFields: string[];
}

export interface Kpis {
  totalTransactions: number;
  walletEntities: number;
  networkIps: number;
  suspiciousEntities: number;
  highRiskAlerts: number;
  avgAnomalyScore: number;
}

export interface AnalysisData {
  summary: DatasetMeta;
  kpis: Kpis;
  model: { name: string; clustering: string; features: string[] };
  transactions: Transaction[];
  entities: Entity[];
  alerts: Alert[];
  clusters: Cluster[];
  geo: { country: string; ips: number; transactions: number; wallets: number; risk: RiskLevel }[];
  activity: { day: string; normal: number; suspicious: number }[];
  riskDistribution: { name: string; value: number }[];
  activityTypes: { name: string; value: number }[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export interface GraphNode {
  id: string;
  type: string;
  risk: RiskLevel;
  score: number;
}
export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

export interface ReportPayload {
  generatedAt: string;
  datasetSummary: DatasetMeta;
  model: { name: string; clustering: string; features: string[] };
  kpis: Kpis;
  alertStatistics: { total: number; critical: number; high: number; medium: number; low: number };
  topLeads: Alert[];
  clusters: Cluster[];
  geo: unknown[];
  limitations: string[];
}

/** Probe whether the FastAPI backend answers within `timeoutMs`. Cached. */
let backendProbe: Promise<boolean> | null = null;
export function isBackendAvailable(timeoutMs = 1500): Promise<boolean> {
  if (!backendProbe) {
    backendProbe = fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
      .then((res) => res.ok)
      .catch(() => false);
  }
  return backendProbe;
}

/** Options that carry live results; empty when running on mock fallback. */
export interface Live {
  summary: DatasetMeta | null;
  data: AnalysisData | null;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, init);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

function emptyLive(): Live {
  return { summary: null, data: null };
}

// ---------------------------------------------------------------------------
// Public API — each call prefers the backend, falls back to mock data
// ---------------------------------------------------------------------------
export async function uploadDataset(file: File): Promise<{ meta: DatasetMeta; live: Live }> {
  if (await isBackendAvailable()) {
    const form = new FormData();
    form.append("file", file);
    const meta = await getJson<DatasetMeta>("/api/upload", { method: "POST", body: form });
    return { meta, live: { summary: meta, data: null } };
  }
  // Mock fallback: pretend the parse worked with plausible numbers.
  return {
    meta: {
      fileName: file.name,
      fileType: file.name.split(".").pop() ?? "csv",
      records: mockTransactions.length,
      wallets: 224,
      transactions: mockTransactions.length,
      ips: 128,
      dateRange: ["2026-03-12T07:12:00Z", "2026-03-28T07:12:00Z"],
      rejectedRecords: 0,
      missingFields: [],
    },
    live: emptyLive(),
  };
}

export async function runAnalysis(live: Live): Promise<Live> {
  if (live.summary && (await isBackendAvailable())) {
    const result = await getJson<{ status: string }>("/api/analyze", { method: "POST" });
    const data = await getJson<AnalysisData>("/api/dashboard-full");
    return { summary: live.summary, data };
  }
  return live; // mock mode: UI keeps using bundled synthetic data
}

export async function fetchDashboard(live: Live): Promise<AnalysisData> {
  if (live.data) return live.data;
  return mockAnalysisData();
}

export async function fetchTransactions(live: Live): Promise<Transaction[]> {
  if (live.data) return live.data.transactions;
  return mockTransactions;
}

export async function fetchEntities(live: Live): Promise<Entity[]> {
  if (live.data) return live.data.entities;
  return mockEntities;
}

export async function fetchAlerts(live: Live): Promise<Alert[]> {
  if (live.data) return live.data.alerts;
  return mockAlerts;
}

export async function fetchClusters(live: Live): Promise<Cluster[]> {
  if (live.data) return live.data.clusters;
  return mockClusters;
}

export function mockGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return { nodes: [], edges: [] };
}

export async function fetchGraph(live: Live): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  if (live.data) return live.data.graph;
  return { nodes: [], edges: [] };
}

export async function updateAlertStatus(
  live: Live,
  alertId: string,
  status: AlertStatus,
): Promise<Live> {
  if (live.data && (await isBackendAvailable())) {
    try {
      await fetch(`${BACKEND_URL}/api/alerts/${alertId}?status=${encodeURIComponent(status)}`, {
        method: "PATCH",
      });
    } catch {
      /* status change still applies locally */
    }
    const data = live.data;
    return {
      ...live,
      data: { ...data, alerts: data.alerts.map((a) => (a.id === alertId ? { ...a, status } : a)) },
    };
  }
  return live; // mock mode handled by the caller's local state
}

/** Full analysis payload straight from the backend (after /api/analyze). */
export async function getJsonAnalysis(): Promise<AnalysisData> {
  return getJson<AnalysisData>("/api/dashboard-full");
}

/** Investigation report payload from the backend. */
export async function getJsonReport(): Promise<ReportPayload> {
  return getJson<ReportPayload>("/api/reports");
}

/**
 * Graph for mock mode: seeds the canvas with the most suspicious mock
 * transactions and their wallet/IP neighbourhoods, mirroring the compact
 * subgraph the backend returns.
 */
export function buildMockGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const seeds = [...mockTransactions].sort((a, b) => b.riskScore - a.riskScore).slice(0, 40);
  const nodeScore = new Map<string, number>();
  const nodeType = new Map<string, string>();
  const seenEdges = new Set<string>();
  const edges: GraphEdge[] = [];
  const addNode = (id: string, type: string, score: number) => {
    nodeType.set(id, type);
    nodeScore.set(id, Math.max(nodeScore.get(id) ?? 0, score));
  };
  const addEdge = (source: string, target: string, kind: string) => {
    const key = `${source}->${target}`;
    if (source && target && !seenEdges.has(key)) {
      seenEdges.add(key);
      edges.push({ source, target, kind });
    }
  };
  for (const tx of seeds) {
    addNode(tx.txid, "Transaction", tx.riskScore);
    for (const w of tx.inputAddresses) {
      addNode(w, "Wallet", tx.riskScore * 0.9);
      addEdge(w, tx.txid, "spent");
    }
    for (const w of tx.outputAddresses) {
      addNode(w, "Wallet", tx.riskScore * 0.9);
      addEdge(tx.txid, w, "received");
    }
    addNode(tx.srcIp, "IP", tx.riskScore * 0.85);
    addEdge(tx.srcIp, tx.txid, "sent");
  }
  const riskFor = (score: number): RiskLevel =>
    score >= 0.9 ? "Critical" : score >= 0.7 ? "High" : score >= 0.4 ? "Medium" : "Low";
  const nodes: GraphNode[] = [...nodeScore.entries()].map(([id, score]) => ({
    id,
    type: nodeType.get(id) ?? "Wallet",
    risk: riskFor(score),
    score: Number(score.toFixed(4)),
  }));
  return { nodes, edges };
}

/** Build the AnalysisData shape from bundled mocks (offline prototype mode). */
export function mockAnalysisData(): AnalysisData {
  return {
    summary: {
      fileName: "bitcoin_network_metadata.csv",
      fileType: "csv",
      records: mockTransactions.length,
      wallets: 224,
      transactions: mockTransactions.length,
      ips: 128,
      dateRange: ["2026-03-12T07:12:00Z", "2026-03-28T07:12:00Z"],
      rejectedRecords: 0,
      missingFields: [],
    },
    kpis: {
      totalTransactions: 24581,
      walletEntities: 8942,
      networkIps: 3216,
      suspiciousEntities: 184,
      highRiskAlerts: mockAlerts.filter((a) => a.risk === "High" || a.risk === "Critical").length,
      avgAnomalyScore: 0.67,
    },
    model: {
      name: "Isolation Forest",
      clustering: "DBSCAN",
      features: [
        "Transaction amount",
        "Fee ratio",
        "Input/output count",
        "Transaction frequency",
        "Time between transactions",
        "Wallet degree",
        "IP degree",
        "Connected wallets",
        "Connected IPs",
        "Geographic diversity",
        "ASN diversity",
        "Incoming/outgoing volume",
        "Burst activity",
        "Repeated IP-wallet relationships",
      ],
    },
    transactions: mockTransactions,
    entities: mockEntities,
    alerts: mockAlerts,
    clusters: mockClusters,
    geo: mockGeo.map((g) => ({
      country: g.country,
      ips: g.ips ?? 0,
      transactions: g.transactions ?? 0,
      wallets: g.wallets ?? 0,
      risk: g.risk ?? ("Low" as RiskLevel),
    })),
    activity: mockActivity,
    riskDistribution: mockRiskDistribution,
    activityTypes: mockActivityTypes,
    graph: buildMockGraph(),
  };
}

export type { Alert, AlertStatus, Cluster, Entity, RiskLevel, Transaction };
