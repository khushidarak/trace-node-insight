/**
 * BitTrace API service layer — the single boundary between the UI and the
 * FastAPI analysis backend. No mock data: every call hits the real offline
 * pipeline at VITE_API_URL (default http://localhost:8000).
 */

export const API_URL: string =
  (import.meta.env as Record<string, string | undefined>)?.["VITE_API_URL"] ??
  "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types (mirroring backend payloads, snake_case)
// ---------------------------------------------------------------------------
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export type AlertStatus = "New" | "Investigating" | "Closed";

export interface DatasetSummary {
  name: string;
  file_type: string;
  rows_parsed: number;
  rows_rejected: number;
  rejection_reasons: Record<string, number>;
  fields_detected: string[];
  time_range: [string, string];
  unique_ips: number;
  unique_wallets: number;
  unique_txids: number;
  planted_patterns?: Record<string, unknown>;
}

export interface Contribution {
  feature: string;
  contribution: number;
}

export interface Transaction {
  txid: string;
  timestamp: string;
  src_ip: string;
  dst_ip: string;
  src_port: number;
  dst_port: number;
  input_addresses: string[];
  output_addresses: string[];
  input_amount: number;
  output_amount: number;
  fee: number;
  script_type: string;
  country: string;
  asn: string;
  anomaly_score: number;
  risk: RiskLevel;
  flagged: boolean;
  in_peeling_chain: string | null;
  in_mixing_round: number | null;
  contributions: Contribution[];
}

export interface Wallet {
  id: string;
  type: "wallet";
  anomaly_score: number;
  risk_score: number;
  risk: RiskLevel;
  seed: boolean;
  ppr: number;
  bfs: number;
  ips: string[];
  first_seen: string;
  last_seen: string;
  tx_count: number;
  cluster_ids: string[];
  contributions: Contribution[];
}

export interface Chain {
  id: string;
  hops: number;
  start: string;
  end: string;
  wallets: string[];
  value_start: number;
  value_end: number;
  decay_ratio: number;
  start_time: string;
  end_time: string;
  txids: string[];
}

export interface MixingHit {
  id: string;
  txid: string;
  timestamp: string;
  inputs: number;
  outputs: number;
  equal_outputs: number;
  value_btc: number;
  uniform_script: boolean;
  score: number;
  input_wallets: string[];
  output_wallets: string[];
}

export interface Cluster {
  id: string;
  members: string[];
  shared_ips: string[];
  transactions: number;
  countries: string[];
  heuristic: string;
  embedding_label: boolean | null;
  size: number;
  risk: number;
  avg_anomaly: number;
}

export interface Evidence {
  txids: string[];
  ips: string[];
  wallets: string[];
  chain: Chain | null;
  mixing: MixingHit | null;
}

export interface Alert {
  id: string;
  entity: { type: string; id: string };
  type: string;
  risk_score: number;
  risk: RiskLevel;
  anomaly_score: number;
  propagated_risk: number;
  confidence: number;
  reasons: string[];
  evidence: Evidence;
  timestamp: string;
  status: AlertStatus;
}

export interface GraphNode {
  id: string;
  type: "wallet" | "tx" | "ip";
  score: number;
  risk: RiskLevel;
  cluster: string | null;
  seed: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

export interface ModelMetrics {
  transaction: {
    available: boolean;
    precision?: number;
    recall?: number;
    f1?: number;
    roc_auc?: number | null;
    true_positives?: number;
    false_positives?: number;
    false_negatives?: number;
    labelled_rows?: number;
    illicit_rows?: number;
    threshold_rate?: number;
    reason?: string;
  };
  wallet: ModelMetrics["transaction"];
  patterns: {
    planted_chains: number;
    detected_chains: number;
    chains_recovered: number;
    planted_rounds: number;
    detected_rounds: number;
    rounds_recovered: number;
  };
}

export interface ModelInfo {
  anomaly_model: string;
  params: { n_estimators: number; contamination: number; random_state: number };
  comparison: { name: string; outliers: number; agreement: number } | null;
  explainer: string;
  clustering: string;
  risk_propagation: string;
  features: { transaction: string[]; wallet: string[] };
}

export interface Charts {
  activity: { day: string; total: number; flagged: number }[];
  risk_distribution: { name: RiskLevel; value: number }[];
  alert_types: { name: string; value: number }[];
  score_distribution: { bucket: string; count: number }[];
}

export interface GeoRow {
  country: string;
  transactions: number;
  ips: number;
  wallets: number;
  asns: string[];
  mean_anomaly: number;
  risk: RiskLevel;
}

export interface Analysis {
  generated_at: string;
  settings: Record<string, number>;
  dataset: DatasetSummary;
  kpis: {
    transactions: number;
    wallets: number;
    ips: number;
    clusters: number;
    flagged_entities: number;
    high_risk_alerts: number;
    peeling_chains: number;
    mixing_rounds: number;
  };
  model: ModelInfo;
  metrics: ModelMetrics;
  transactions: Transaction[];
  wallets: Wallet[];
  peeling_chains: Chain[];
  mixing_hits: MixingHit[];
  clusters: Cluster[];
  alerts: Alert[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  charts: Charts;
  geo: GeoRow[];
}

export interface AppSettings {
  contamination: number;
  risk_propagation_decay: number;
  peeling_min_hops: number;
  mixing_min_outputs: number;
  dbscan_eps: number;
  dbscan_min_samples: number;
  risk_high_threshold: number;
  risk_critical_threshold: number;
}

export interface Health {
  status: string;
  version: string;
  dataset_loaded: boolean;
  analysis_ready: boolean;
  dataset_name: string | null;
  offline: boolean;
}

// ---------------------------------------------------------------------------
// Core fetch helpers with clear error propagation
// ---------------------------------------------------------------------------
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) => {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return request<T>(path, init);
};

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------
export const api = {
  health: () => get<Health>("/api/health"),

  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ status: string; summary: DatasetSummary }>("/api/upload", {
      method: "POST",
      body: form,
    });
  },

  loadSample: (rows = 5000) =>
    post<{ status: string; summary: DatasetSummary }>(`/api/sample?rows=${rows}`),

  analyze: () =>
    post<{
      status: string;
      records: number;
      alerts: number;
      clusters: number;
      peeling_chains: number;
      mixing_rounds: number;
    }>("/api/analyze"),

  dashboard: () =>
    get<{
      dataset: DatasetSummary;
      kpis: Analysis["kpis"];
      model: ModelInfo;
      metrics: ModelMetrics;
      charts: Charts;
      top_wallets: Wallet[];
      recent_alerts: Alert[];
      mini_graph: { nodes: GraphNode[]; edges: GraphEdge[] };
      generated_at: string;
    }>("/api/dashboard"),

  fullAnalysis: () => get<Analysis>("/api/analysis"),

  transactions: (params: {
    q?: string | undefined;
    risk?: string | undefined;
    country?: string | undefined;
    flagged?: boolean | undefined;
    min_amount?: number | undefined;
    max_amount?: number | undefined;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "" && v !== false) qs.set(k, String(v));
    });
    return get<{ total: number; items: Transaction[]; countries: string[] }>(
      `/api/transactions?${qs.toString()}`,
    );
  },

  transactionDetail: (txid: string) =>
    get<
      Transaction & {
        related_transactions: Transaction[];
        related_alerts: Alert[];
      }
    >(`/api/transactions/${encodeURIComponent(txid)}`),

  graph: (params: {
    risk_min?: number | undefined;
    cluster?: string | undefined;
    node_type?: string | undefined;
    q?: string | undefined;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    return get<{ nodes: GraphNode[]; edges: GraphEdge[]; total_available: number }>(
      `/api/graph?${qs.toString()}`,
    );
  },

  anomalies: (entityType: "wallet" | "transaction", limit = 100) =>
    get<{
      entity_type: string;
      model: ModelInfo;
      items: {
        id: string;
        timestamp?: string;
        anomaly_score: number;
        risk: RiskLevel;
        contributions: Contribution[];
        risk_score?: number;
        seed?: boolean;
        tx_count?: number;
      }[];
      score_distribution: Charts["score_distribution"];
    }>(`/api/anomalies?entity_type=${entityType}&limit=${limit}`),

  clusters: () => get<{ total: number; items: Cluster[] }>("/api/clusters"),

  alerts: (params: { status?: string; risk?: string; type?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<{ total: number; items: Alert[] }>(`/api/alerts${suffix}`);
  },

  alertDetail: (id: string) =>
    get<Alert & { evidence_transactions: Transaction[] }>(
      `/api/alerts/${encodeURIComponent(id)}`,
    ),

  setAlertStatus: (id: string, status: AlertStatus) =>
    request<Alert>(`/api/alerts/${encodeURIComponent(id)}?status=${status}`, {
      method: "PATCH",
    }),

  geo: () => get<{ items: GeoRow[]; source: string }>("/api/geo"),

  modelMetrics: () =>
    get<{ model: ModelInfo; transaction: ModelMetrics["transaction"]; wallet: ModelMetrics["transaction"]; patterns: ModelMetrics["patterns"]; dataset: DatasetSummary }>(
      "/api/model-metrics",
    ),

  settings: () => get<AppSettings>("/api/settings"),

  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>("/api/settings", { method: "PUT", body: JSON.stringify(patch), headers: { "Content-Type": "application/json" } }),

  reportUrl: (format: "csv" | "json" | "pdf") => `${API_URL}/api/report?format=${format}`,
};