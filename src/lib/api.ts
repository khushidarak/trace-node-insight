/**
 * BitTrace API service layer.
 *
 * Single boundary between the UI and the analysis backend.
 *
 * Offline Docker setup:
 *   Frontend  -> http://localhost:3000
 *   Backend   -> http://localhost:8000
 *
 * When the FastAPI backend is available, the app uses live ML output.
 * If the backend is unavailable, the app automatically falls back
 * to the built-in synthetic mock data.
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

/**
 * FastAPI backend URL.
 *
 * Docker setup:
 *   Frontend: http://localhost:3000
 *   Backend:  http://localhost:8000
 *
 * VITE_API_URL can still override this value if required.
 */
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
  model: {
    name: string;
    clustering: string;
    features: string[];
  };
  transactions: Transaction[];
  entities: Entity[];
  alerts: Alert[];
  clusters: Cluster[];
  geo: {
    country: string;
    ips: number;
    transactions: number;
    wallets: number;
    risk: RiskLevel;
  }[];
  activity: {
    day: string;
    normal: number;
    suspicious: number;
  }[];
  riskDistribution: {
    name: string;
    value: number;
  }[];
  activityTypes: {
    name: string;
    value: number;
  }[];
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
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
  model: {
    name: string;
    clustering: string;
    features: string[];
  };
  kpis: Kpis;
  alertStatistics: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  topLeads: Alert[];
  clusters: Cluster[];
  geo: unknown[];
  limitations: string[];
}

/**
 * --------------------------------------------------------------------------
 * BACKEND AVAILABILITY
 * --------------------------------------------------------------------------
 *
 * Checks whether the local FastAPI backend is running.
 *
 * Default timeout is intentionally short because localhost should respond
 * quickly. If it doesn't, we use mock/offline data.
 */

let backendProbe: Promise<boolean> | null = null;

export function isBackendAvailable(
  timeoutMs = 3000,
): Promise<boolean> {
  if (!backendProbe) {
    backendProbe = fetch(`${BACKEND_URL}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
      .then((res) => {
        if (!res.ok) {
          backendProbe = null;
        }

        return res.ok;
      })
      .catch(() => {
        backendProbe = null;
        return false;
      });
  }

  return backendProbe;
}

/**
 * --------------------------------------------------------------------------
 * LIVE DATA
 * --------------------------------------------------------------------------
 *
 * Carries live backend results.
 * Empty when application is running in mock/offline fallback mode.
 */

export interface Live {
  summary: DatasetMeta | null;
  data: AnalysisData | null;
}

async function getJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, init);

  if (!res.ok) {
    throw new Error(`${path} → ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function emptyLive(): Live {
  return {
    summary: null,
    data: null,
  };
}

/**
 * --------------------------------------------------------------------------
 * DATASET UPLOAD
 * --------------------------------------------------------------------------
 */

export async function uploadDataset(
  file: File,
): Promise<{
  meta: DatasetMeta;
  live: Live;
}> {
  if (await isBackendAvailable()) {
    const form = new FormData();

    form.append("file", file);

    const meta = await getJson<DatasetMeta>(
      "/api/upload",
      {
        method: "POST",
        body: form,
      },
    );

    return {
      meta,
      live: {
        summary: meta,
        data: null,
      },
    };
  }

  /**
   * Mock fallback.
   *
   * Used when FastAPI is not reachable.
   */
  return {
    meta: {
      fileName: file.name,
      fileType:
        file.name.split(".").pop() ?? "csv",

      records: mockTransactions.length,

      wallets: 224,

      transactions: mockTransactions.length,

      ips: 128,

      dateRange: [
        "2026-03-12T07:12:00Z",
        "2026-03-28T07:12:00Z",
      ],

      rejectedRecords: 0,

      missingFields: [],
    },

    live: emptyLive(),
  };
}

/**
 * --------------------------------------------------------------------------
 * RUN ANALYSIS
 * --------------------------------------------------------------------------
 */

export async function runAnalysis(
  live: Live,
): Promise<Live> {
  if (
    live.summary &&
    (await isBackendAvailable())
  ) {
    await getJson<{ status: string }>(
      "/api/analyze",
      {
        method: "POST",
      },
    );

    const data =
      await getJson<AnalysisData>(
        "/api/dashboard-full",
      );

    return {
      summary: live.summary,
      data,
    };
  }

  /**
   * Mock mode:
   * UI continues using bundled synthetic data.
   */
  return live;
}

/**
 * --------------------------------------------------------------------------
 * DASHBOARD
 * --------------------------------------------------------------------------
 */

export async function fetchDashboard(
  live: Live,
): Promise<AnalysisData> {
  if (live.data) {
    return live.data;
  }

  return mockAnalysisData();
}

/**
 * --------------------------------------------------------------------------
 * TRANSACTIONS
 * --------------------------------------------------------------------------
 */

export async function fetchTransactions(
  live: Live,
): Promise<Transaction[]> {
  if (live.data) {
    return live.data.transactions;
  }

  return mockTransactions;
}

/**
 * --------------------------------------------------------------------------
 * ENTITIES
 * --------------------------------------------------------------------------
 */

export async function fetchEntities(
  live: Live,
): Promise<Entity[]> {
  if (live.data) {
    return live.data.entities;
  }

  return mockEntities;
}

/**
 * --------------------------------------------------------------------------
 * ALERTS
 * --------------------------------------------------------------------------
 */

export async function fetchAlerts(
  live: Live,
): Promise<Alert[]> {
  if (live.data) {
    return live.data.alerts;
  }

  return mockAlerts;
}

/**
 * --------------------------------------------------------------------------
 * CLUSTERS
 * --------------------------------------------------------------------------
 */

export async function fetchClusters(
  live: Live,
): Promise<Cluster[]> {
  if (live.data) {
    return live.data.clusters;
  }

  return mockClusters;
}

/**
 * --------------------------------------------------------------------------
 * GRAPH
 * --------------------------------------------------------------------------
 */

export function mockGraph(): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  return {
    nodes: [],
    edges: [],
  };
}

export async function fetchGraph(
  live: Live,
): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  if (live.data) {
    return live.data.graph;
  }

  return {
    nodes: [],
    edges: [],
  };
}

/**
 * --------------------------------------------------------------------------
 * ALERT STATUS
 * --------------------------------------------------------------------------
 */

export async function updateAlertStatus(
  live: Live,
  alertId: string,
  status: AlertStatus,
): Promise<Live> {
  if (
    live.data &&
    (await isBackendAvailable())
  ) {
    try {
      await fetch(
        `${BACKEND_URL}/api/alerts/${alertId}?status=${encodeURIComponent(
          status,
        )}`,
        {
          method: "PATCH",
        },
      );
    } catch {
      /**
       * Status change still applies locally.
       */
    }

    const data = live.data;

    return {
      ...live,

      data: {
        ...data,

        alerts: data.alerts.map(
          (alert) =>
            alert.id === alertId
              ? {
                  ...alert,
                  status,
                }
              : alert,
        ),
      },
    };
  }

  /**
   * Mock mode.
   * Caller handles local state.
   */
  return live;
}

/**
 * --------------------------------------------------------------------------
 * FULL BACKEND ANALYSIS
 * --------------------------------------------------------------------------
 *
 * Used when the frontend wants the complete analysis payload directly
 * from FastAPI.
 */

export async function getJsonAnalysis(): Promise<AnalysisData> {
  return getJson<AnalysisData>(
    "/api/dashboard-full",
  );
}

/**
 * --------------------------------------------------------------------------
 * INVESTIGATION REPORT
 * --------------------------------------------------------------------------
 */

export async function getJsonReport(): Promise<ReportPayload> {
  return getJson<ReportPayload>(
    "/api/reports",
  );
}

/**
 * --------------------------------------------------------------------------
 * MOCK GRAPH
 * --------------------------------------------------------------------------
 *
 * Creates a graph from the most suspicious mock transactions.
 *
 * This allows the prototype to work even when the backend is offline.
 */

export function buildMockGraph(): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const seeds = [
    ...mockTransactions,
  ]
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore,
    )
    .slice(0, 40);

  const nodeScore =
    new Map<string, number>();

  const nodeType =
    new Map<string, string>();

  const seenEdges =
    new Set<string>();

  const edges: GraphEdge[] = [];

  const addNode = (
    id: string,
    type: string,
    score: number,
  ) => {
    nodeType.set(id, type);

    nodeScore.set(
      id,
      Math.max(
        nodeScore.get(id) ?? 0,
        score,
      ),
    );
  };

  const addEdge = (
    source: string,
    target: string,
    kind: string,
  ) => {
    const key =
      `${source}->${target}`;

    if (
      source &&
      target &&
      !seenEdges.has(key)
    ) {
      seenEdges.add(key);

      edges.push({
        source,
        target,
        kind,
      });
    }
  };

  for (const tx of seeds) {
    /**
     * Transaction node
     */
    addNode(
      tx.txid,
      "Transaction",
      tx.riskScore,
    );

    /**
     * Input wallets
     */
    for (
      const wallet of tx.inputAddresses
    ) {
      addNode(
        wallet,
        "Wallet",
        tx.riskScore * 0.9,
      );

      addEdge(
        wallet,
        tx.txid,
        "spent",
      );
    }

    /**
     * Output wallets
     */
    for (
      const wallet of tx.outputAddresses
    ) {
      addNode(
        wallet,
        "Wallet",
        tx.riskScore * 0.9,
      );

      addEdge(
        tx.txid,
        wallet,
        "received",
      );
    }

    /**
     * Source IP
     */
    addNode(
      tx.srcIp,
      "IP",
      tx.riskScore * 0.85,
    );

    addEdge(
      tx.srcIp,
      tx.txid,
      "sent",
    );
  }

  /**
   * Convert numeric score into risk level.
   */
  const riskFor = (
    score: number,
  ): RiskLevel => {
    if (score >= 0.9) {
      return "Critical";
    }

    if (score >= 0.7) {
      return "High";
    }

    if (score >= 0.4) {
      return "Medium";
    }

    return "Low";
  };

  const nodes: GraphNode[] =
    [...nodeScore.entries()].map(
      ([id, score]) => ({
        id,

        type:
          nodeType.get(id) ??
          "Wallet",

        risk:
          riskFor(score),

        score:
          Number(
            score.toFixed(4),
          ),
      }),
    );

  return {
    nodes,
    edges,
  };
}

/**
 * --------------------------------------------------------------------------
 * MOCK ANALYSIS DATA
 * --------------------------------------------------------------------------
 *
 * Complete offline prototype dataset.
 */

export function mockAnalysisData(): AnalysisData {
  return {
    summary: {
      fileName:
        "bitcoin_network_metadata.csv",

      fileType: "csv",

      records:
        mockTransactions.length,

      wallets: 224,

      transactions:
        mockTransactions.length,

      ips: 128,

      dateRange: [
        "2026-03-12T07:12:00Z",
        "2026-03-28T07:12:00Z",
      ],

      rejectedRecords: 0,

      missingFields: [],
    },

    /**
     * KPI cards
     */
    kpis: {
      totalTransactions: 24581,

      walletEntities: 8942,

      networkIps: 3216,

      suspiciousEntities: 184,

      highRiskAlerts:
        mockAlerts.filter(
          (alert) =>
            alert.risk === "High" ||
            alert.risk === "Critical",
        ).length,

      avgAnomalyScore: 0.67,
    },

    /**
     * ML model information
     */
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

    /**
     * Core datasets
     */
    transactions:
      mockTransactions,

    entities:
      mockEntities,

    alerts:
      mockAlerts,

    clusters:
      mockClusters,

    /**
     * Geographic information
     */
    geo: mockGeo.map(
      (g) => ({
        country:
          g.country,

        ips:
          g.ips ?? 0,

        transactions:
          g.transactions ?? 0,

        wallets:
          g.wallets ?? 0,

        risk:
          g.risk ??
          ("Low" as RiskLevel),
      }),
    ),

    /**
     * Activity timeline
     */
    activity:
      mockActivity,

    /**
     * Risk distribution
     */
    riskDistribution:
      mockRiskDistribution,

    /**
     * Activity types
     */
    activityTypes:
      mockActivityTypes,

    /**
     * Investigation graph
     */
    graph:
      buildMockGraph(),
  };
}

/**
 * Re-export API types.
 */
export type {
  Alert,
  AlertStatus,
  Cluster,
  Entity,
  RiskLevel,
  Transaction,
};
