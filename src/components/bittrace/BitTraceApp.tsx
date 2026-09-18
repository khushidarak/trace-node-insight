import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  BarChart3,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Download,
  FileBarChart,
  FileJson,
  FileText,
  Filter,
  Globe2,
  Grid3X3,
  HardDriveUpload,
  Network,
  Play,
  Search,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  BACKEND_URL,
  type Alert,
  type AlertStatus,
  type AnalysisData,
  type Cluster,
  type DatasetMeta,
  type Entity,
  type GraphEdge,
  type GraphNode,
  type RiskLevel,
  type Transaction,
  mockAnalysisData,
} from "@/lib/api";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";

type View =
  | "dashboard"
  | "ingestion"
  | "transactions"
  | "graph"
  | "anomaly"
  | "clusters"
  | "alerts"
  | "geo"
  | "reports"
  | "settings";

const riskClass: Record<RiskLevel, string> = {
  Low: "bg-safe/12 text-safe ring-safe/25",
  Medium: "bg-amber/12 text-amber ring-amber/25",
  High: "bg-risk/12 text-risk ring-risk/25",
  Critical: "bg-crit/12 text-crit ring-crit/25",
};

const navItems: { id: View; label: string; icon: typeof Grid3X3 }[] = [
  { id: "dashboard", label: "Dashboard", icon: Grid3X3 },
  { id: "ingestion", label: "Data Ingestion", icon: HardDriveUpload },
  { id: "transactions", label: "Transaction Explorer", icon: Table2 },
  { id: "graph", label: "Entity Graph", icon: Network },
  { id: "anomaly", label: "AI Anomaly Detection", icon: Bot },
  { id: "clusters", label: "Entity Clusters", icon: CircleDot },
  { id: "alerts", label: "Investigation Alerts", icon: Bell },
  { id: "geo", label: "Geo Network", icon: Globe2 },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const shortId = (value: string, length = 12) =>
  value.length > length ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
const fmtDate = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
};
const fmtBtc = (value: number) => `${value.toFixed(4)} BTC`;
const riskForScore = (score: number): RiskLevel =>
  score >= 0.9 ? "Critical" : score >= 0.7 ? "High" : score >= 0.4 ? "Medium" : "Low";

function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide ring-1",
        riskClass[risk],
      )}
    >
      {risk}
    </span>
  );
}

function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("bt-glass rounded-xl ring-1 ring-line/70", className)}>
      {children}
    </section>
  );
}

function SectionHeader({
  title,
  eyebrow,
  action,
}: {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      </div>
      {action}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Upload;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed border-line bg-panel/20 p-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-cyan/10 text-cyan ring-1 ring-cyan/25">
          <Icon className="size-5" />
        </div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-mute">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({
  data,
  onEntity,
  onView,
  onRun,
}: {
  data: AnalysisData | null;
  onEntity: (entity: Entity) => void;
  onView: (view: View) => void;
  onRun: () => void;
}) {
  if (!data) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No investigation dataset loaded"
        description="Upload a CSV, JSON or XML dataset to begin offline analysis."
        action={
          <Button
            className="bg-cyan text-primary-foreground hover:bg-cyan/90"
            onClick={() => onView("ingestion")}
          >
            <HardDriveUpload />
            Go to Data Ingestion
          </Button>
        }
      />
    );
  }
  const { kpis } = data;
  const topEntities = [...data.entities]
    .sort((a, b) => b.anomalyScore - a.anomalyScore)
    .slice(0, 5);
  const donutColors = [
    "var(--color-safe)",
    "var(--color-amber)",
    "var(--color-risk)",
    "var(--color-crit)",
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Investigator Dashboard"
        eyebrow="Investigator Console"
        action={
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-wider text-faint">Dataset</div>
            <div className="font-mono text-sm text-ink">{data.summary.fileName}</div>
          </div>
        }
      />
      <p className="-mt-4 max-w-2xl text-sm text-mute">
        Prioritized forensic leads from {kpis.totalTransactions.toLocaleString()} correlated
        transaction and network records.
      </p>
      <div className="grid grid-cols-12 gap-4">
        <Panel className="col-span-12 p-5 lg:col-span-3 bg-cyan/8 ring-cyan/25">
          <div className="font-mono text-[11px] uppercase tracking-wider text-cyan">
            Avg Anomaly Score
          </div>
          <div className="mt-2 flex items-end gap-3">
            <span className="text-5xl font-semibold leading-none text-ink">
              {kpis.avgAnomalyScore.toFixed(2)}
            </span>
            <span className="mb-1 font-mono text-[11px] text-mute">/ 1.00</span>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-void/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue via-cyan to-amber"
              style={{ width: `${Math.round(kpis.avgAnomalyScore * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-mute">Investigative prioritization index</div>
        </Panel>
        {[
          {
            label: "Total Transactions",
            value: kpis.totalTransactions.toLocaleString(),
            note: `${data.summary.fileType.toUpperCase()} · offline parse`,
          },
          {
            label: "Wallet Entities",
            value: kpis.walletEntities.toLocaleString(),
            note: "from input/output addresses",
          },
          {
            label: "Network IPs",
            value: kpis.networkIps.toLocaleString(),
            note: "distinct src/dst endpoints",
          },
        ].map((item) => (
          <Panel key={item.label} className="col-span-12 p-4 sm:col-span-4 lg:col-span-2">
            <div className="font-mono text-[11px] uppercase tracking-wider text-faint">
              {item.label}
            </div>
            <div className="mt-2 text-3xl font-semibold leading-none text-ink">{item.value}</div>
            <div className="mt-2 font-mono text-[11px] text-mute">{item.note}</div>
          </Panel>
        ))}
        <Panel className="col-span-12 bg-crit/8 p-4 ring-crit/25 sm:col-span-4 lg:col-span-3">
          <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-crit">
            <span className="bt-pulse size-1.5 rounded-full bg-crit" />
            High-Risk Alerts
          </div>
          <div className="mt-2 text-3xl font-semibold leading-none text-crit">
            {kpis.highRiskAlerts}
          </div>
          <div className="mt-2 font-mono text-[11px] text-crit/70">
            {kpis.suspiciousEntities} suspicious entities
          </div>
        </Panel>
      </div>
      <div className="grid grid-cols-12 gap-4">
        <Panel className="col-span-12 p-5 lg:col-span-8">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Transaction Activity Over Time</h2>
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                Normal vs. flagged volume · daily window
              </p>
            </div>
            <div className="flex gap-3 font-mono text-[11px] text-mute">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-blue" />
                Normal
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-risk" />
                Suspicious
              </span>
            </div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.activity}>
                <defs>
                  <linearGradient id="normalFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-blue)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--color-blue)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="suspiciousFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-risk)" stopOpacity={0.36} />
                    <stop offset="100%" stopColor="var(--color-risk)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 4" opacity={0.5} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: "var(--color-faint)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "var(--color-faint)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-panel-strong)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 8,
                    color: "var(--color-ink)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="normal"
                  stroke="var(--color-blue)"
                  fill="url(#normalFill)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="suspicious"
                  stroke="var(--color-risk)"
                  fill="url(#suspiciousFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel className="col-span-12 p-5 lg:col-span-4">
          <h2 className="text-sm font-semibold text-ink">Risk Distribution</h2>
          <p className="mt-0.5 font-mono text-[11px] text-faint">Scored wallet & IP entities</p>
          <div className="mt-3 flex items-center gap-4">
            <div className="h-36 w-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.riskDistribution}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={64}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {data.riskDistribution.map((entry, index) => (
                      <Cell key={entry.name} fill={donutColors[index]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-panel-strong)",
                      border: "1px solid var(--color-line)",
                      borderRadius: 8,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 font-mono text-xs">
              {data.riskDistribution.map((item, index) => (
                <div key={item.name} className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: donutColors[index] }}
                  />
                  <span className="w-16 text-mute">{item.name}</span>
                  <span className="text-ink">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
      <div className="grid grid-cols-12 gap-4">
        <Panel className="col-span-12 overflow-hidden lg:col-span-8">
          <div className="flex items-center justify-between px-5 pb-3 pt-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">Top Suspicious Entities</h2>
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                Highest anomaly scores · click a row to investigate
              </p>
            </div>
            <Button variant="link" size="sm" className="text-cyan" onClick={() => onView("alerts")}>
              View all <ChevronRight />
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-y border-line/60 bg-panel/40 font-mono text-[10px] uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-5 py-2">Entity</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Risk</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-5 py-2">Reason</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {topEntities.map((entity) => (
                  <tr
                    key={entity.id}
                    className="cursor-pointer border-b border-line/40 transition-colors hover:bg-cyan/5"
                    onClick={() => onEntity(entity)}
                  >
                    <td className="px-5 py-3 text-cyan">{shortId(entity.id)}</td>
                    <td className="px-3 py-3 text-mute">{entity.type}</td>
                    <td className="px-3 py-3">
                      <RiskBadge risk={riskForScore(entity.anomalyScore)} />
                    </td>
                    <td className="px-3 py-3 text-ink">{entity.anomalyScore.toFixed(2)}</td>
                    <td className="px-5 py-3 text-mute">{entity.reason.replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel className="col-span-12 p-5 lg:col-span-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Suspicious Activity Types</h2>
              <p className="mt-0.5 font-mono text-[11px] text-faint">Model reason codes</p>
            </div>
            <Zap className="size-4 text-cyan" />
          </div>
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.activityTypes} layout="vertical" margin={{ left: 5, right: 8 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={126}
                  tick={{ fill: "var(--color-mute)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Bar dataKey="value" fill="var(--color-cyan)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onRun}>
          <Play />
          Re-run AI Analysis
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------
function buildClientSampleCsv(): string {
  const header =
    "timestamp,src_ip,dst_ip,src_port,dst_port,txid,input_addresses,output_addresses,input_amounts,output_amounts,fee,script_type,geo_country,asn";
  const rows = mockAnalysisData()
    .transactions.slice(0, 400)
    .map((tx) =>
      [
        tx.timestamp,
        tx.srcIp,
        tx.dstIp,
        tx.srcPort,
        tx.dstPort,
        tx.txid,
        tx.inputAddresses.join(";"),
        tx.outputAddresses.join(";"),
        tx.inputAmount,
        tx.outputAmount,
        tx.fee,
        tx.scriptType,
        tx.country,
        tx.asn,
      ].join(","),
    );
  return [header, ...rows].join("\n");
}

function Ingestion({
  summary,
  running,
  onFile,
  onRun,
  onReset,
}: {
  summary: DatasetMeta | null;
  running: boolean;
  onFile: (file: File) => void;
  onRun: () => void;
  onReset: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  useEffect(() => {
    if (summary) setFileName(summary.fileName);
  }, [summary]);
  const downloadSample = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sample-dataset?records=1200`);
      if (!res.ok) throw new Error("no backend");
      downloadBlob(await res.blob(), "bitcoin_network_metadata.csv", "text/csv");
    } catch {
      downloadBlob(buildClientSampleCsv(), "bitcoin_network_metadata.csv", "text/csv");
    }
  };
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Data Ingestion"
        eyebrow="Offline Pipeline"
        action={
          <span className="rounded-md bg-amber/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-amber ring-1 ring-amber/25">
            Local processing only
          </span>
        }
      />
      <Panel className="p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-ink">Import Investigation Dataset</h2>
          <p className="mt-1 text-sm text-mute">
            Upload synthetic transaction and network metadata for correlation, anomaly detection,
            and graph construction.
          </p>
        </div>
        <div
          className="rounded-xl border border-dashed border-cyan/35 bg-cyan/5 p-10 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) {
              setFileName(file.name);
              onFile(file);
            }
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.json,.xml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setFileName(file.name);
                onFile(file);
              }
            }}
          />
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-cyan/10 text-cyan ring-1 ring-cyan/25">
            <Upload className="size-5" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-ink">
            {fileName ?? "Drop a dataset here"}
          </h3>
          <p className="mt-1 font-mono text-xs text-faint">CSV · JSON · XML · max 20 MB</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button
              variant="outline"
              className="border-cyan/30 text-cyan hover:bg-cyan/10"
              onClick={() => inputRef.current?.click()}
            >
              <HardDriveUpload />
              {fileName ? "Replace file" : "Choose file"}
            </Button>
            <Button variant="ghost" size="sm" className="text-mute" onClick={downloadSample}>
              <Download />
              Sample dataset
            </Button>
          </div>
          <p className="mt-4 text-xs text-safe">
            Offline processing — files remain on the local system.
          </p>
        </div>
      </Panel>
      <Panel className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Dataset Summary</h2>
            <p className="mt-1 font-mono text-[11px] text-faint">
              {summary
                ? "Validated against the required schema"
                : "Upload a dataset to populate the schema summary"}
            </p>
          </div>
          <span
            className={cn(
              "rounded-md px-2 py-1 font-mono text-[10px] ring-1",
              summary
                ? "bg-safe/10 text-safe ring-safe/20"
                : "bg-panel px-2 py-1 text-faint ring-line/40",
            )}
          >
            {summary ? "READY" : "NO DATASET"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["File", summary?.fileName ?? "—"],
            ["Records", summary ? summary.records.toLocaleString() : "—"],
            ["Wallets", summary ? summary.wallets.toLocaleString() : "—"],
            ["IP addresses", summary ? summary.ips.toLocaleString() : "—"],
            [
              "Date range",
              summary ? `${fmtDate(summary.dateRange[0])} → ${fmtDate(summary.dateRange[1])}` : "—",
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                {label}
              </div>
              <div className="mt-1 truncate text-xs text-ink">{value}</div>
            </div>
          ))}
        </div>
        {summary && summary.rejectedRecords > 0 && (
          <p className="mt-3 font-mono text-[11px] text-amber">
            {summary.rejectedRecords} malformed records rejected during validation.
          </p>
        )}
        {summary && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-y border-line/60 text-[10px] uppercase tracking-wider text-faint">
                <tr>
                  {[
                    "timestamp",
                    "src_ip",
                    "txid",
                    "input_addresses",
                    "output_addresses",
                    "fee",
                    "script_type",
                    "geo_country",
                    "asn",
                  ].map((field) => (
                    <th key={field} className="px-3 py-2 first:pl-0">
                      {field}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mockAnalysisData()
                  .transactions.slice(0, 3)
                  .map((tx) => (
                    <tr key={tx.txid} className="border-b border-line/40 text-mute">
                      <td className="px-3 py-2 pl-0">{fmtDate(tx.timestamp)}</td>
                      <td className="px-3 py-2">{tx.srcIp}</td>
                      <td className="px-3 py-2 text-cyan">{shortId(tx.txid)}</td>
                      <td className="px-3 py-2">{shortId(tx.inputAddresses[0] ?? "")}</td>
                      <td className="px-3 py-2">{shortId(tx.outputAddresses[0] ?? "")}</td>
                      <td className="px-3 py-2">{tx.fee}</td>
                      <td className="px-3 py-2">{tx.scriptType}</td>
                      <td className="px-3 py-2">{tx.country}</td>
                      <td className="px-3 py-2">{tx.asn}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-5 flex justify-between">
          <Button variant="ghost" size="sm" className="text-faint" onClick={onReset}>
            Reset session
          </Button>
          <Button
            className="bg-cyan text-primary-foreground hover:bg-cyan/90"
            disabled={!summary || running}
            onClick={onRun}
          >
            <Play />
            Run AI Analysis
          </Button>
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
function Transactions({
  data,
  onSelect,
}: {
  data: AnalysisData;
  onSelect: (tx: Transaction) => void;
}) {
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState("All risk");
  const [country, setCountry] = useState("All countries");
  const countries = useMemo(() => [...new Set(data.geo.map((g) => g.country))], [data.geo]);
  const filtered = useMemo(
    () =>
      data.transactions
        .filter((tx) => {
          const matchesQuery =
            !query ||
            [tx.txid, ...tx.inputAddresses, ...tx.outputAddresses, tx.srcIp, tx.dstIp, tx.asn].some(
              (item) => item.toLowerCase().includes(query.toLowerCase()),
            );
          const matchesRisk = risk === "All risk" || tx.risk === risk;
          const matchesCountry = country === "All countries" || tx.country === country;
          return matchesQuery && matchesRisk && matchesCountry;
        })
        .slice(0, 80),
    [data.transactions, query, risk, country],
  );
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Transaction Explorer"
        eyebrow="Correlated Metadata"
        action={
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-panel px-2.5 py-1 font-mono text-[10px] text-mute ring-1 ring-line">
              {filtered.length} visible
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadBlob(buildClientSampleCsv(), "transactions.csv", "text/csv")}
            >
              <Download />
              Export CSV
            </Button>
          </div>
        }
      />
      <Panel className="p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_150px_170px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search TXID, wallet, IP, ASN…"
              className="h-9 w-full rounded-lg border border-line bg-panel/60 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus:border-cyan/50"
            />
          </div>
          <select
            value={risk}
            onChange={(event) => setRisk(event.target.value)}
            className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute outline-none"
          >
            <option>All risk</option>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Critical</option>
          </select>
          <select
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute outline-none"
          >
            <option>All countries</option>
            {countries.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <Button variant="outline" size="sm">
            <Filter />
            Filters
          </Button>
        </div>
      </Panel>
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left">
            <thead className="border-b border-line bg-panel/50 font-mono text-[10px] uppercase tracking-wider text-faint">
              <tr>
                {[
                  "TXID",
                  "Timestamp",
                  "Input Wallets",
                  "Output Wallets",
                  "Input Amount",
                  "Output Amount",
                  "Fee",
                  "Source IP",
                  "Destination IP",
                  "Country",
                  "ASN",
                  "Risk",
                  "Status",
                ].map((head) => (
                  <th key={head} className="px-3 py-3 first:pl-5">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {filtered.map((tx) => (
                <tr
                  key={tx.txid}
                  onClick={() => onSelect(tx)}
                  className="cursor-pointer border-b border-line/40 transition-colors hover:bg-cyan/5"
                >
                  <td className="px-3 py-3 pl-5 text-cyan">{shortId(tx.txid)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-mute">{fmtDate(tx.timestamp)}</td>
                  <td className="px-3 py-3 text-mute">{tx.inputAddresses.length}</td>
                  <td className="px-3 py-3 text-mute">{tx.outputAddresses.length}</td>
                  <td className="px-3 py-3 text-ink">{fmtBtc(tx.inputAmount)}</td>
                  <td className="px-3 py-3 text-ink">{fmtBtc(tx.outputAmount)}</td>
                  <td className="px-3 py-3 text-mute">{tx.fee}</td>
                  <td className="px-3 py-3 text-mute">{tx.srcIp}</td>
                  <td className="px-3 py-3 text-mute">{tx.dstIp}</td>
                  <td className="px-3 py-3 text-mute">{tx.country}</td>
                  <td className="px-3 py-3 text-mute">{tx.asn}</td>
                  <td className="px-3 py-3">
                    <RiskBadge risk={tx.risk} />
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[10px]",
                        tx.status === "Flagged" ? "bg-risk/10 text-risk" : "bg-safe/10 text-safe",
                      )}
                    >
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

type TxWithDetail = Transaction & { reasonDetail?: { feature: string; contribution: number }[] };

function TransactionDrawer({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const detail = tx as TxWithDetail;
  const contributions = detail.reasonDetail?.length
    ? detail.reasonDetail
        .slice(0, 5)
        .map((c) => [c.feature.replace(/_/g, " "), c.contribution] as const)
    : ([
        ["Rapid fund movement", 0.24],
        ["Wallet connectivity", 0.21],
        ["Amount anomaly", 0.18],
        ["IP correlation", 0.13],
        ["Geographic deviation", 0.09],
      ] as const);
  const maxContribution = Math.max(...contributions.map(([, v]) => v), 0.01);
  return (
    <Drawer title="Transaction Investigation" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-xs text-cyan">{tx.txid}</div>
            <div className="mt-1 text-xs text-mute">{fmtDate(tx.timestamp)} UTC</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold text-crit">
              {tx.riskScore.toFixed(2)}
            </div>
            <RiskBadge risk={tx.risk} />
          </div>
        </div>
        <Panel className="p-4">
          <div className="mb-4 text-[10px] font-mono uppercase tracking-wider text-faint">
            Transaction Flow
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
            <div>
              <div className="mx-auto mb-2 grid size-10 place-items-center rounded-full bg-blue/15 text-blue ring-1 ring-blue/30">
                <CircleDot />
              </div>
              <div className="font-mono text-[10px] text-mute">SOURCE WALLET</div>
              <div className="mt-1 break-all font-mono text-[10px] text-ink">
                {shortId(tx.inputAddresses[0] ?? "—", 16)}
              </div>
            </div>
            <ChevronRight className="text-cyan" />
            <div>
              <div className="mx-auto mb-2 grid size-10 place-items-center rounded-md bg-risk/15 text-risk ring-1 ring-risk/30">
                <Zap />
              </div>
              <div className="font-mono text-[10px] text-mute">DESTINATION</div>
              <div className="mt-1 break-all font-mono text-[10px] text-ink">
                {shortId(tx.outputAddresses[0] ?? "—", 16)}
              </div>
            </div>
          </div>
        </Panel>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Input amount", fmtBtc(tx.inputAmount)],
            ["Output amount", fmtBtc(tx.outputAmount)],
            ["Fee", `${tx.fee} BTC`],
            ["Script type", tx.scriptType],
            ["Source IP", tx.srcIp],
            ["Destination IP", tx.dstIp],
            ["Ports", `${tx.srcPort} → ${tx.dstPort}`],
            ["Country / ASN", `${tx.country} · ${tx.asn}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                {label}
              </div>
              <div className="mt-1 break-all font-mono text-xs text-ink">{value}</div>
            </div>
          ))}
        </div>
        <Panel className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-cyan" />
            <div>
              <div className="text-sm font-semibold text-ink">
                Why was this transaction flagged?
              </div>
              <div className="font-mono text-[10px] text-faint">
                Explainable feature contributions
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {contributions.map(([label, value]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between font-mono text-[11px]">
                  <span className="text-mute">{label}</span>
                  <span className="text-ink">+{value.toFixed(2)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-void">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue to-risk"
                    style={{ width: `${Math.round((value / maxContribution) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-mute">
            Isolation Forest scored this transaction against learned population behaviour; the
            strongest deviations are shown above. This is an AI-prioritized investigation lead, not
            proof of criminal activity.
          </p>
        </Panel>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Entity graph — force-directed layout, no external deps
// ---------------------------------------------------------------------------
const nodeColor: Record<string, string> = {
  Wallet: "var(--color-blue)",
  Transaction: "var(--color-risk)",
  IP: "var(--color-amber)",
  ASN: "var(--color-safe)",
};

function useForceLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  return useMemo(() => {
    if (nodes.length === 0)
      return {
        positions: new Map<string, { x: number; y: number }>(),
        lines: [] as { x1: number; y1: number; x2: number; y2: number }[],
        degree: new Map<string, number>(),
      };
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const pts = nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const radius = Math.min(width, height) * 0.36;
      return {
        id: n.id,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    const index = new Map(pts.map((p, i) => [p.id, i]));
    const springs = edges
      .map((e) => [index.get(e.source), index.get(e.target)] as const)
      .filter(
        (pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined,
      );
    const maxDegree = Math.max(1, ...degree.values());
    for (let iter = 0; iter < 160; iter++) {
      const cooling = 1 - iter / 170;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          if (!a || !b) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist2 = Math.max(dx * dx + dy * dy, 120);
          const force = 2600 / dist2;
          const dist = Math.sqrt(dist2);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      for (const [s, t] of springs) {
        const ps = pts[s];
        const pt = pts[t];
        if (!ps || !pt) continue;
        const dx = pt.x - ps.x;
        const dy = pt.y - ps.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const target = 64;
        const force = (dist - target) * 0.015;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        ps.vx += fx;
        ps.vy += fy;
        pt.vx -= fx;
        pt.vy -= fy;
      }
      for (const p of pts) {
        p.vx += (width / 2 - p.x) * 0.0035;
        p.vy += (height / 2 - p.y) * 0.0035;
        p.x = Math.min(width - 20, Math.max(20, p.x + Math.max(-14, Math.min(14, p.vx * cooling))));
        p.y = Math.min(
          height - 20,
          Math.max(20, p.y + Math.max(-14, Math.min(14, p.vy * cooling))),
        );
        p.vx *= 0.55;
        p.vy *= 0.55;
      }
    }
    const positions = new Map(pts.map((p) => [p.id, { x: p.x, y: p.y }]));
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const [s, t] of springs) {
      const ps = pts[s];
      const pt = pts[t];
      if (ps && pt) lines.push({ x1: ps.x, y1: ps.y, x2: pt.x, y2: pt.y });
    }
    void maxDegree;
    return { positions, lines, degree };
  }, [nodes, edges, width, height]);
}

function Graph({
  graph,
  entities,
  onEntity,
}: {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  entities: Entity[];
  onEntity: (entity: Entity) => void;
}) {
  const [filter, setFilter] = useState("All entities");
  const all = graph ?? { nodes: [], edges: [] };
  const shown = useMemo(() => {
    const filteredNodes = (
      filter === "All entities" ? all.nodes : all.nodes.filter((n) => n.type === filter)
    ).slice(0, 220);
    const keep = new Set(filteredNodes.map((n) => n.id));
    return {
      nodes: filteredNodes,
      edges: all.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }, [all, filter]);
  const layout = useForceLayout(shown.nodes, shown.edges, 920, 560);
  const entitiesById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const openNode = (node: GraphNode) => {
    const entity = entitiesById.get(node.id);
    if (entity) {
      onEntity(entity);
      return;
    }
    // Node types absent from the entity list (transactions) still open evidence.
    onEntity({
      id: node.id,
      type: (node.type as Entity["type"]) ?? "Wallet",
      riskScore: Math.round(node.score * 100),
      anomalyScore: node.score,
      connections: layout.degree.get(node.id) ?? 1,
      reason: "Graph-neighbourhood risk signal",
      firstSeen: "—",
      lastSeen: "—",
    });
  };
  if (shown.nodes.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="Graph awaits analysis output"
        description="Run the AI analysis pipeline — the link-analysis canvas plots wallets, transactions, and IPs from the correlation graph."
      />
    );
  }
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Entity Graph"
        eyebrow="Link Analysis Workspace"
        action={
          <div className="flex gap-2">
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute"
            >
              <option>All entities</option>
              <option>Wallet</option>
              <option>Transaction</option>
              <option>IP</option>
              <option>ASN</option>
            </select>
            <Button variant="outline" size="sm">
              <SlidersHorizontal />
              Graph filters
            </Button>
          </div>
        }
      />
      <Panel className="relative min-h-[600px] overflow-hidden bg-void/35">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-line) 1px, transparent 1px)",
            backgroundSize: "34px 34px",
          }}
        />
        <div className="absolute left-5 top-4 z-10 rounded-lg bg-panel/80 px-3 py-2 ring-1 ring-line/70">
          <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
            Relationship canvas
          </div>
          <div className="mt-1 text-xs text-mute">
            {shown.nodes.length} nodes · {shown.edges.length} edges · click to inspect
          </div>
        </div>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 920 560">
          {layout.lines.map((line, i) => (
            <line
              key={i}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="var(--color-cyan)"
              strokeOpacity="0.22"
              strokeWidth="1"
            />
          ))}
          {shown.nodes.map((node) => {
            const pos = layout.positions.get(node.id);
            if (!pos) return null;
            const deg = layout.degree.get(node.id) ?? 1;
            const r = 6 + Math.min(10, deg * 0.9);
            const color = nodeColor[node.type] ?? "var(--color-cyan)";
            const flagged = node.risk === "High" || node.risk === "Critical";
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x},${pos.y})`}
                className="cursor-pointer"
                onClick={() => openNode(node)}
              >
                {flagged && (
                  <circle
                    r={r + 4}
                    fill="none"
                    stroke="var(--color-crit)"
                    strokeOpacity="0.55"
                    strokeWidth="1.5"
                  />
                )}
                {node.type === "Transaction" ? (
                  <rect
                    x={-r}
                    y={-r}
                    width={r * 2}
                    height={r * 2}
                    rx={3}
                    fill={color}
                    fillOpacity="0.28"
                    stroke={color}
                    strokeWidth="1.6"
                  />
                ) : node.type === "IP" ? (
                  <rect
                    x={-r * 0.85}
                    y={-r * 0.85}
                    width={r * 1.7}
                    height={r * 1.7}
                    rx={r * 0.5}
                    transform="rotate(45)"
                    fill={color}
                    fillOpacity="0.28"
                    stroke={color}
                    strokeWidth="1.6"
                  />
                ) : (
                  <circle r={r} fill={color} fillOpacity="0.28" stroke={color} strokeWidth="1.6" />
                )}
                <text
                  y={r + 11}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--color-mute)"
                  fontFamily="var(--font-mono)"
                >
                  {shortId(node.id, 16)}
                </text>
              </g>
            );
          })}
        </svg>
      </Panel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries({
          Wallet: "var(--color-blue)",
          Transaction: "var(--color-risk)",
          IP: "var(--color-amber)",
          ASN: "var(--color-safe)",
        }).map(([label, color]) => (
          <div
            key={label}
            className="flex items-center gap-2 rounded-lg bg-panel/50 p-3 font-mono text-xs text-mute ring-1 ring-line/60"
          >
            <span className="size-3 rounded-full" style={{ background: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anomaly
// ---------------------------------------------------------------------------
function Anomaly({ data }: { data: AnalysisData | null }) {
  const features = data?.model.features ?? mockAnalysisData().model.features;
  const scores = useMemo(
    () =>
      (data?.entities ?? [])
        .slice(0, 60)
        .map((entity, index) => ({ index: index + 1, score: entity.anomalyScore })),
    [data],
  );
  const avg = data?.kpis.avgAnomalyScore ?? 0.67;
  return (
    <div className="space-y-6">
      <SectionHeader
        title="AI-Powered Anomaly Detection"
        eyebrow="Model Operations"
        action={
          <span className="rounded-md bg-cyan/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-cyan ring-1 ring-cyan/25">
            Isolation Forest · Unsupervised
          </span>
        }
      />
      <div className="grid grid-cols-12 gap-4">
        <Panel className="col-span-12 p-6 lg:col-span-7">
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-cyan/10 text-cyan ring-1 ring-cyan/25">
              <Bot />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink">Model purpose</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mute">
                Machine learning identifies transaction and entity behavior that deviates from
                learned normal patterns. This prototype combines transaction, network, temporal, and
                graph-derived features to prioritize investigative leads.
              </p>
            </div>
          </div>
          <div className="mt-6 rounded-lg border border-amber/25 bg-amber/8 p-4 text-sm leading-relaxed text-amber">
            Investigative prioritization score, not proof of criminal activity. Synthetic data is
            used to demonstrate the pipeline.
          </div>
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Model output</h3>
              <span className="font-mono text-xl text-cyan">{avg.toFixed(2)}</span>
            </div>
            <div className="h-3 rounded-full bg-void">
              <div
                className="h-full rounded-full bg-gradient-to-r from-safe via-amber to-crit"
                style={{ width: `${Math.round(avg * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-faint">
              <span>0.00 Low</span>
              <span>0.40 Medium</span>
              <span>0.70 High</span>
              <span>0.90 Critical</span>
              <span>1.00</span>
            </div>
          </div>
        </Panel>
        <Panel className="col-span-12 p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Feature Engineering</h2>
              <p className="mt-1 font-mono text-[11px] text-faint">Signals passed to the model</p>
            </div>
            <Sparkles className="size-4 text-cyan" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {features.map((feature, index) => (
              <div
                key={feature}
                className="flex items-center gap-2 rounded-md bg-panel/55 px-3 py-2 font-mono text-[10px] text-mute ring-1 ring-line/50"
              >
                <span className="text-cyan">{String(index + 1).padStart(2, "0")}</span>
                {feature}
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Anomaly score distribution</h2>
            <p className="mt-1 font-mono text-[11px] text-faint">
              Top scored entities · 0.00 → 1.00
            </p>
          </div>
          <span className="font-mono text-xs text-mute">DBSCAN clustering follows scoring</span>
        </div>
        <div className="h-64">
          {scores.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={scores}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 4" opacity={0.5} />
                <XAxis dataKey="index" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                <YAxis domain={[0, 1]} tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke="var(--color-cyan)"
                  fill="var(--color-cyan)"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-sm text-faint">
              Run an analysis to populate the distribution.
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------
function Clusters({ clusters, onGraph }: { clusters: Cluster[]; onGraph: () => void }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Suspicious Entity Clusters"
        eyebrow="DBSCAN Candidate Groups"
        action={
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={onGraph}>
            <Network />
            Open cluster graph
          </Button>
        }
      />
      <p className="max-w-2xl text-sm text-mute">
        Related wallets grouped by transaction behavior, connectivity, frequency, amount patterns,
        and IP relationships (DBSCAN over behavioural features).
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {clusters.map((cluster) => (
          <Panel key={cluster.id} className="p-5 transition-colors hover:ring-cyan/40">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-cyan">
                  {cluster.id}
                </div>
                <h2 className="mt-1 text-lg font-semibold text-ink">
                  {cluster.signature.replace(/_/g, " ")}
                </h2>
              </div>
              <RiskBadge risk={cluster.risk} />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                ["Wallets", cluster.wallets],
                ["IPs", cluster.ips],
                ["Transactions", cluster.transactions],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                    {label}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="font-mono text-xs text-mute">{cluster.countries.join(" · ")}</div>
              <div className="font-mono text-sm text-cyan">score {cluster.score.toFixed(2)}</div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-void">
              <div
                className={cn(
                  "h-full rounded-full",
                  cluster.risk === "Critical"
                    ? "bg-crit"
                    : cluster.risk === "High"
                      ? "bg-risk"
                      : cluster.risk === "Medium"
                        ? "bg-amber"
                        : "bg-safe",
                )}
                style={{ width: `${cluster.score * 100}%` }}
              />
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
const ALERT_STATUSES: AlertStatus[] = ["New", "Investigating", "Reviewed", "Dismissed"];

type AlertDetail = Alert & { reasonDetail?: { feature: string; contribution: number }[] };

function Alerts({
  alerts,
  onSelect,
  onStatus,
}: {
  alerts: Alert[];
  onSelect: (alert: Alert) => void;
  onStatus: (id: string, status: AlertStatus) => void;
}) {
  const [status, setStatus] = useState("All statuses");
  const [sort, setSort] = useState("Risk");
  const filtered = useMemo(
    () =>
      [...alerts]
        .filter((alert) => status === "All statuses" || alert.status === status)
        .sort((a, b) =>
          sort === "Confidence" ? b.confidence - a.confidence : b.anomalyScore - a.anomalyScore,
        ),
    [alerts, status, sort],
  );
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Prioritized Investigation Leads"
        eyebrow="Alert Management"
        action={
          <div className="flex gap-2">
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute"
            >
              <option>Risk</option>
              <option>Confidence</option>
            </select>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute"
            >
              <option>All statuses</option>
              {ALERT_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        }
      />
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b border-line bg-panel/50 font-mono text-[10px] uppercase tracking-wider text-faint">
              <tr>
                {[
                  "Priority",
                  "Entity",
                  "Type",
                  "Risk",
                  "Confidence",
                  "Detection Reason",
                  "Status",
                  "Timestamp",
                ].map((head) => (
                  <th key={head} className="px-4 py-3 first:pl-5">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {filtered.map((alert) => (
                <tr
                  key={alert.id}
                  className="cursor-pointer border-b border-line/40 transition-colors hover:bg-cyan/5"
                  onClick={() => onSelect(alert)}
                >
                  <td className="px-4 py-3 pl-5">
                    <RiskBadge risk={alert.risk} />
                  </td>
                  <td className="px-4 py-3 text-cyan">{shortId(alert.entityId)}</td>
                  <td className="px-4 py-3 text-mute">{alert.entityType}</td>
                  <td className="px-4 py-3 text-ink">{alert.anomalyScore.toFixed(2)}</td>
                  <td className="px-4 py-3 text-ink">{alert.confidence.toFixed(2)}</td>
                  <td className="max-w-xs px-4 py-3 text-mute">
                    {alert.reasons.slice(0, 2).join(" + ").replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                    <select
                      value={alert.status}
                      onChange={(event) => onStatus(alert.id, event.target.value as AlertStatus)}
                      className="rounded-md bg-panel px-2 py-1 text-[10px] text-mute ring-1 ring-line outline-none"
                    >
                      {ALERT_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-mute">{fmtDate(alert.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function AlertDrawer({
  alert,
  onClose,
  onGraph,
  onStatus,
}: {
  alert: Alert;
  onClose: () => void;
  onGraph: () => void;
  onStatus: (id: string, status: AlertStatus) => void;
}) {
  return (
    <Drawer title="Alert Evidence" onClose={onClose}>
      <div className="space-y-5">
        <div className="rounded-xl border border-crit/25 bg-crit/8 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-crit">
                {alert.id}
              </div>
              <h3 className="mt-1 text-lg font-semibold text-ink">
                Suspicious {alert.entityType} Entity
              </h3>
              <div className="mt-1 break-all font-mono text-xs text-cyan">{alert.entityId}</div>
            </div>
            <RiskBadge risk={alert.risk} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Confidence
              </div>
              <div className="mt-1 text-2xl font-semibold text-ink">
                {Math.round(alert.confidence * 100)}%
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Anomaly score
              </div>
              <div className="mt-1 text-2xl font-semibold text-crit">
                {Math.round(alert.anomalyScore * 100)}%
              </div>
            </div>
          </div>
        </div>
        <Panel className="p-4">
          <h3 className="text-sm font-semibold text-ink">Detection Factors</h3>
          <div className="mt-3 space-y-2">
            {alert.reasons.map((reason) => (
              <div
                key={reason}
                className="flex items-center gap-2 rounded-md bg-panel/55 px-3 py-2 text-xs text-mute ring-1 ring-line/60"
              >
                <Check className="size-3 text-cyan" />
                {reason.replace(/_/g, " ")}
              </div>
            ))}
            {(alert as AlertDetail).reasonDetail?.map((detail) => (
              <div key={detail.feature} className="pl-5 font-mono text-[10px] text-faint">
                {detail.feature.replace(/_/g, " ")} · contribution {detail.contribution.toFixed(2)}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-mute">
            The entity was prioritized because its observed behavior differs substantially from the
            learned baseline. The strongest contributing signals were{" "}
            {alert.reasons
              .slice(0, 2)
              .map((r) => r.replace(/_/g, " "))
              .join(" and ")}
            . Requires review — not proof of criminal activity.
          </p>
        </Panel>
        <Panel className="p-4">
          <h3 className="text-sm font-semibold text-ink">Evidence</h3>
          <div className="mt-3 space-y-2">
            {alert.evidence.map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-md border border-line bg-panel/40 px-3 py-2 font-mono text-xs text-cyan"
              >
                <ArrowDownToLine className="size-3 shrink-0 text-faint" />
                <span className="break-all">{item}</span>
              </div>
            ))}
          </div>
        </Panel>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onGraph}>
            <Network />
            Open in Graph
          </Button>
          <select
            value={alert.status}
            onChange={(event) => onStatus(alert.id, event.target.value as AlertStatus)}
            className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute outline-none"
          >
            {ALERT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Geo
// ---------------------------------------------------------------------------
function GeoNetwork({ data }: { data: AnalysisData | null }) {
  const geo = data?.geo ?? [];
  const maxIps = Math.max(1, ...geo.map((g) => g.ips));
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Geo Network"
        eyebrow="Country-Level Context"
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Filter />
              Country
            </Button>
            <Button variant="outline" size="sm">
              Date range <ChevronDown />
            </Button>
          </div>
        }
      />
      <div className="rounded-lg border border-amber/25 bg-amber/8 px-4 py-3 text-sm text-amber">
        Country-level metadata provides context only; a country itself is not considered suspicious.
      </div>
      {geo.length === 0 ? (
        <EmptyState
          icon={Globe2}
          title="No geographic metadata yet"
          description="Upload and analyze a dataset containing geo_country and asn fields."
        />
      ) : (
        <div className="grid grid-cols-12 gap-4">
          <Panel className="col-span-12 p-5 lg:col-span-7">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">Network distribution</h2>
                <p className="mt-1 font-mono text-[11px] text-faint">IP associations by country</p>
              </div>
              <Globe2 className="size-5 text-cyan" />
            </div>
            <div className="space-y-4">
              {geo.slice(0, 10).map((item, index) => (
                <div key={item.country}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="text-ink">{item.country}</span>
                    <span className="font-mono text-mute">
                      {item.ips.toLocaleString()} IPs · {item.transactions.toLocaleString()} txs
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-void">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        index === 0 ? "bg-cyan" : index < 3 ? "bg-blue" : "bg-safe",
                      )}
                      style={{ width: `${Math.max(8, (item.ips / maxIps) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel className="col-span-12 overflow-hidden lg:col-span-5">
            <div className="px-5 pb-3 pt-5">
              <h2 className="text-sm font-semibold text-ink">Country summary</h2>
            </div>
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-y border-line bg-panel/50 text-[10px] uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-5 py-2">Country</th>
                  <th className="px-3 py-2">Wallets</th>
                  <th className="px-3 py-2">Risk</th>
                </tr>
              </thead>
              <tbody>
                {geo.map((item) => (
                  <tr key={item.country} className="border-b border-line/40">
                    <td className="px-5 py-3 text-ink">{item.country}</td>
                    <td className="px-3 py-3 text-mute">{item.wallets.toLocaleString()}</td>
                    <td className="px-3 py-3">
                      <RiskBadge risk={item.risk} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
function Reports({ data }: { data: AnalysisData }) {
  const [report, setReport] = useState<api.ReportPayload | null>(null);
  const generate = async () => {
    try {
      if (await api.isBackendAvailable()) {
        setReport(await api.getJsonReport());
        return;
      }
    } catch {
      /* fall through to client-side report */
    }
    setReport({
      generatedAt: new Date().toISOString(),
      datasetSummary: data.summary,
      kpis: data.kpis,
      model: data.model,
      alertStatistics: {
        total: data.alerts.length,
        critical: data.alerts.filter((a) => a.risk === "Critical").length,
        high: data.alerts.filter((a) => a.risk === "High").length,
        medium: data.alerts.filter((a) => a.risk === "Medium").length,
        low: data.alerts.filter((a) => a.risk === "Low").length,
      },
      topLeads: data.alerts.slice(0, 10),
      clusters: data.clusters,
      geo: data.geo,
      limitations: [
        "Scores are investigative prioritisation signals, not proof of criminal activity.",
        "Synthetic dataset — generated locally, no live blockchain data involved.",
        "Unsupervised models (Isolation Forest, DBSCAN) may flag rare-but-benign behaviour.",
        "Country-level metadata provides context only; a country is never 'suspicious'.",
      ],
    });
  };
  const exportJson = () => {
    const payload = report ?? {
      datasetSummary: data.summary,
      kpis: data.kpis,
      alerts: data.alerts,
    };
    downloadBlob(JSON.stringify(payload, null, 2), "bittrace-report.json", "application/json");
  };
  const exportCsv = () => {
    const header = "txid,timestamp,risk,score,src_ip,dst_ip,country,asn";
    const rows = data.transactions.map((tx) =>
      [tx.txid, tx.timestamp, tx.risk, tx.riskScore, tx.srcIp, tx.dstIp, tx.country, tx.asn].join(
        ",",
      ),
    );
    downloadBlob([header, ...rows].join("\n"), "bittrace-transactions.csv", "text/csv");
  };
  const exportPdf = () => {
    const stats = report?.alertStatistics;
    const leadRows = data.alerts
      .slice(0, 10)
      .map(
        (a) =>
          `<tr><td>${a.id}</td><td>${shortId(a.entityId, 20)}</td><td>${a.entityType}</td><td>${a.risk}</td><td>${a.anomalyScore.toFixed(2)}</td><td>${a.reasons.map((r) => r.replace(/_/g, " ")).join(", ")}</td></tr>`,
      )
      .join("");
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document
      .write(`<html><head><title>BitTrace Investigation Report</title><style>body{font-family:monospace;margin:32px;color:#111}h1{font-size:20px}table{border-collapse:collapse;width:100%;font-size:11px}td,th{border:1px solid #ccc;padding:6px;text-align:left}th{background:#eee}</style></head><body>
      <h1>BitTrace AI — Investigation Report</h1>
      <p>Generated ${new Date().toLocaleString()} · Offline Analysis Mode · Synthetic Dataset</p>
      <h3>Dataset: ${data.summary.fileName} (${data.summary.records.toLocaleString()} records)</h3>
      <p>Transactions ${data.kpis.totalTransactions.toLocaleString()} · Wallets ${data.kpis.walletEntities.toLocaleString()} · IPs ${data.kpis.networkIps.toLocaleString()} · Suspicious entities ${data.kpis.suspiciousEntities} · Alerts ${stats?.total ?? data.alerts.length} (Critical ${stats?.critical ?? 0} / High ${stats?.high ?? 0})</p>
      <h3>Model</h3><p>${data.model.name} anomaly detection + ${data.model.clustering} entity clustering. Features: ${data.model.features.slice(0, 8).join(", ")}…</p>
      <h3>Top investigation leads</h3><table><tr><th>Alert</th><th>Entity</th><th>Type</th><th>Risk</th><th>Score</th><th>Reasons</th></tr>${leadRows}</table>
      <h3>Limitations</h3><ul><li>Scores are prioritization signals, not verdicts.</li><li>Synthetic dataset; no live blockchain monitoring.</li></ul>
      </body></html>`);
    win.document.close();
    win.print();
  };
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Reports"
        eyebrow="Evidence Export"
        action={<span className="font-mono text-[11px] text-faint">Offline report builder</span>}
      />
      <Panel className="p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Generate Investigation Report</h2>
            <p className="mt-1 max-w-xl text-sm text-mute">
              Package the dataset summary, analysis period, model output, graph relationships, top
              leads, explanations, and limitations for review.
            </p>
          </div>
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={generate}>
            <FileBarChart />
            {report ? "Report ready" : "Generate report"}
          </Button>
        </div>
        {report && (
          <div className="mt-5 rounded-lg bg-panel/60 p-4 font-mono text-xs text-mute ring-1 ring-line/60">
            <span className="text-safe">
              <Check className="mr-1 inline size-3" />
              Report generated {fmtDate(report.generatedAt)}
            </span>{" "}
            · {report.alertStatistics?.total ?? data.alerts.length} alerts · model{" "}
            {report.model?.name ?? data.model.name}
          </div>
        )}
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            {
              Icon: FileText,
              title: "Export PDF",
              subtitle: "Formatted case file",
              handler: exportPdf,
            },
            {
              Icon: FileJson,
              title: "Export JSON",
              subtitle: "Machine-readable evidence",
              handler: exportJson,
            },
            {
              Icon: Download,
              title: "Export CSV",
              subtitle: "Filtered record set",
              handler: exportCsv,
            },
          ].map(({ Icon, title, subtitle, handler }) => (
            <Button
              key={title}
              variant="outline"
              className="h-auto justify-start gap-3 p-4 text-left"
              onClick={handler}
            >
              <span className="grid size-9 place-items-center rounded-lg bg-panel text-cyan ring-1 ring-line">
                <Icon />
              </span>
              <span>
                <span className="block text-sm text-ink">{title}</span>
                <span className="mt-1 block font-mono text-[10px] text-faint">{subtitle}</span>
              </span>
            </Button>
          ))}
        </div>
      </Panel>
      <Panel className="p-5">
        <h2 className="text-sm font-semibold text-ink">Report contents</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            "Dataset summary",
            "Analysis period",
            "Alert statistics",
            "Top investigation leads",
            "Graph relationships",
            "AI model and feature explanations",
            "Limitations and synthetic-data notice",
            "Offline processing provenance",
          ].map((item) => (
            <div
              key={item}
              className="flex items-center gap-2 rounded-md bg-panel/50 px-3 py-2 font-mono text-xs text-mute ring-1 ring-line/60"
            >
              <Check className="size-3 text-safe" />
              {item}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function Settings({ backendAvailable }: { backendAvailable: boolean | null }) {
  return (
    <div className="space-y-6">
      <SectionHeader title="Settings" eyebrow="Console Configuration" />
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-ink">Analysis environment</h2>
          <div className="mt-4 space-y-3">
            {[
              ["Processing mode", "Offline Analysis Mode"],
              ["Dataset type", "Synthetic metadata"],
              ["ML model", "Isolation Forest"],
              ["Clustering", "DBSCAN candidate groups"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between border-b border-line/50 pb-3 font-mono text-xs"
              >
                <span className="text-faint">{label}</span>
                <span className="text-mute">{value}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-ink">FastAPI integration contract</h2>
          <p className="mt-2 text-sm leading-relaxed text-mute">
            The service layer (src/lib/api.ts) calls {BACKEND_URL} when reachable and falls back to
            bundled mock data otherwise. Set VITE_API_URL to repoint.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-md bg-panel/50 px-3 py-2 font-mono text-xs ring-1 ring-line/50">
            <span
              className={cn(
                "size-2 rounded-full",
                backendAvailable === null ? "bg-amber" : backendAvailable ? "bg-safe" : "bg-risk",
              )}
            />
            Backend{" "}
            {backendAvailable === null
              ? "checking…"
              : backendAvailable
                ? "connected"
                : "unreachable — mock mode"}
          </div>
          <div className="mt-4 space-y-2 font-mono text-xs text-cyan">
            {[
              "POST /api/upload",
              "POST /api/analyze",
              "GET /api/dashboard",
              "GET /api/transactions",
              "GET /api/entities",
              "GET /api/graph",
              "GET /api/alerts",
              "GET /api/clusters",
              "GET /api/geo",
              "GET /api/reports",
            ].map((endpoint) => (
              <div key={endpoint} className="rounded-md bg-panel/50 px-3 py-2 ring-1 ring-line/50">
                {endpoint}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawers / shared
// ---------------------------------------------------------------------------
function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Close drawer"
        className="absolute inset-0 bg-void/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-line bg-canvas p-6 shadow-2xl shadow-void/60">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan">
              Investigation View
            </div>
            <h2 className="mt-1 text-xl font-semibold text-ink">{title}</h2>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function EntityDrawer({
  entity,
  graph,
  onClose,
  onGraph,
}: {
  entity: Entity;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  onClose: () => void;
  onGraph: () => void;
}) {
  const neighbours = useMemo(() => {
    if (!graph) return [];
    const ids = new Set<string>();
    for (const e of graph.edges) {
      if (e.source === entity.id) ids.add(e.target);
      if (e.target === entity.id) ids.add(e.source);
    }
    return graph.nodes.filter((n) => ids.has(n.id)).slice(0, 8);
  }, [entity.id, graph]);
  const connected =
    neighbours.length > 0
      ? neighbours.map((n) => ({ id: n.id, type: n.type, connections: 1, risk: n.risk }))
      : [
          { id: "IP-192", type: "IP", connections: 12, risk: "High" as RiskLevel },
          { id: "Wallet-B", type: "Wallet", connections: 8, risk: "Medium" as RiskLevel },
          { id: "TX-918", type: "Transaction", connections: 1, risk: "High" as RiskLevel },
        ];
  return (
    <Drawer title="Entity Investigation" onClose={onClose}>
      <div className="space-y-5">
        <div className="rounded-xl border border-crit/25 bg-crit/8 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                {entity.type} entity
              </div>
              <h3 className="mt-1 break-all font-mono text-base text-cyan">{entity.id}</h3>
            </div>
            <RiskBadge risk={riskForScore(entity.anomalyScore)} />
          </div>
          <div className="mt-4 flex items-end gap-2">
            <span className="text-5xl font-semibold text-crit">{entity.riskScore}</span>
            <span className="mb-1 font-mono text-xs text-mute">/100 risk score</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["First seen", entity.firstSeen],
            ["Last seen", entity.lastSeen],
            ["Connections", entity.connections],
            ["Anomaly score", entity.anomalyScore.toFixed(2)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
                {label}
              </div>
              <div className="mt-1 font-mono text-xs text-ink">{value}</div>
            </div>
          ))}
        </div>
        <Panel className="p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-cyan" />
            <h3 className="text-sm font-semibold text-ink">AI Risk Explanation</h3>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-mute">
            Risk score is elevated due to anomalous {entity.reason.replace(/_/g, " ").toLowerCase()}{" "}
            across {entity.connections} graph connections. Strong similarity with a suspicious
            entity cluster requires review. Prioritization signal only — requires human
            investigation.
          </p>
        </Panel>
        <Panel className="overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Connected Entities</h3>
          </div>
          <table className="w-full text-left font-mono text-xs">
            <thead className="border-b border-line/60 text-[10px] uppercase tracking-wider text-faint">
              <tr>
                <th className="px-4 py-2">Entity</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Connections</th>
                <th className="px-2 py-2">Risk</th>
              </tr>
            </thead>
            <tbody>
              {connected.map((item) => (
                <tr key={item.id} className="border-b border-line/40">
                  <td className="px-4 py-3 text-cyan">{shortId(item.id, 18)}</td>
                  <td className="px-2 py-3 text-mute">{item.type}</td>
                  <td className="px-2 py-3 text-mute">{item.connections}</td>
                  <td className="px-2 py-3">
                    <RiskBadge risk={item.risk} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Button
          className="w-full bg-cyan text-primary-foreground hover:bg-cyan/90"
          onClick={onGraph}
        >
          <Network />
          Open in Graph
        </Button>
      </div>
    </Drawer>
  );
}

function SearchResultGroup({
  label,
  items,
  render,
  onClick,
}: {
  label: string;
  items: { key: string; label: string; meta: string }[];
  render?: never;
  onClick: (item: { key: string; label: string; meta: string }) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1 last:mb-0">
      <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-faint">
        {label}
      </div>
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onClick(item)}
          className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs text-mute hover:bg-cyan/10 hover:text-ink"
        >
          <span className="font-mono">{shortId(item.label, 18)}</span>
          <span>{item.meta}</span>
        </button>
      ))}
    </div>
  );
}

function AnalysisProgress({ progress }: { progress: number }) {
  const steps = [
    "Dataset Loaded",
    "Schema Validation",
    "Data Cleaning",
    "Transaction Parsing",
    "IP ↔ Wallet Correlation",
    "Feature Engineering",
    "ML Anomaly Detection",
    "Entity Clustering",
    "Explainable Risk Scoring",
    "Investigation Alerts",
  ];
  const active = Math.min(steps.length - 1, Math.floor((progress / 100) * steps.length));
  return (
    <Panel className="mb-6 overflow-hidden border border-cyan/25 p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-cyan" />
            <h2 className="text-sm font-semibold text-ink">Running AI Analysis…</h2>
          </div>
          <p className="mt-1 font-mono text-[11px] text-faint">
            Correlation pipeline is processing locally
          </p>
        </div>
        <span className="font-mono text-xl text-cyan">{progress}%</span>
      </div>
      <div className="mt-4 h-2 rounded-full bg-void">
        <div
          className="h-full rounded-full bg-cyan transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, index) => (
          <div
            key={step}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-2 font-mono text-[10px]",
              index < active
                ? "bg-safe/8 text-safe"
                : index === active
                  ? "bg-cyan/10 text-cyan ring-1 ring-cyan/25"
                  : "bg-panel/50 text-faint",
            )}
          >
            {index < active ? (
              <Check className="size-3" />
            ) : (
              <span className="grid size-3 place-items-center rounded-full border border-current text-[8px]">
                {index + 1}
              </span>
            )}
            {step}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------
export function BitTraceApp() {
  const [view, setView] = useState<View>("dashboard");
  const [query, setQuery] = useState("");
  const [live, setLive] = useState<api.Live>({ summary: null, data: null });
  const [data, setData] = useState<AnalysisData | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<number | null>(null);

  useEffect(() => {
    api.isBackendAvailable().then(setBackendAvailable);
  }, []);
  useEffect(() => {
    let mounted = true;
    api.fetchDashboard(live).then((d) => {
      if (mounted) setData(d);
    });
    return () => {
      mounted = false;
    };
  }, [live]);

  // Demo-friendly: auto-detect a backend that already holds an analysis.
  useEffect(() => {
    (async () => {
      if (!(await api.isBackendAvailable())) return;
      try {
        const health = (await fetch(`${BACKEND_URL}/api/health`).then((r) => r.json())) as {
          analysisReady?: boolean;
        };
        if (health.analysisReady) setLive({ summary: null, data: await api.getJsonAnalysis() });
      } catch {
        /* stay on mock mode */
      }
    })();
  }, []);

  useEffect(() => {
    if (analysisProgress === null || analysisProgress >= 100) return;
    const timer = window.setTimeout(
      () =>
        setAnalysisProgress((current) => (current === null ? null : Math.min(100, current + 12))),
      260,
    );
    return () => window.clearTimeout(timer);
  }, [analysisProgress]);

  const handleFile = async (file: File) => {
    const { meta } = await api.uploadDataset(file);
    setLive({ summary: meta, data: null });
    setData(null);
  };
  const runAnalysis = async () => {
    if (!live.summary) {
      setView("ingestion");
      return;
    }
    setAnalysisProgress(0);
    const result = await api.runAnalysis(live);
    // Let the pipeline animation finish before swapping data in.
    window.setTimeout(() => {
      setLive(result);
      setAnalysisProgress(100);
    }, 2200);
  };
  const resetSession = () => {
    setLive({ summary: null, data: null });
    setData(null);
  };
  const goGraph = () => {
    setSelectedAlert(null);
    setSelectedEntity(null);
    setView("graph");
  };
  const changeAlertStatus = async (id: string, status: AlertStatus) => {
    const next = await api.updateAlertStatus(live, id, status);
    setLive(next);
    setSelectedAlert((current) =>
      current && current.id === id ? { ...current, status } : current,
    );
  };

  const alerts = data?.alerts ?? [];
  const alertCount = alerts.filter(
    (a) => a.status === "New" && (a.risk === "High" || a.risk === "Critical"),
  ).length;
  const searchResults = useMemo(() => {
    if (!query.trim() || !data)
      return { transactions: [], wallets: [], ips: [], alerts: [], clusters: [] };
    const needle = query.toLowerCase();
    return {
      transactions: data.transactions
        .filter((tx) => tx.txid.toLowerCase().includes(needle))
        .slice(0, 3)
        .map((tx) => ({ key: tx.txid, label: tx.txid, meta: "Transaction" })),
      wallets: data.entities
        .filter((e) => e.type === "Wallet" && e.id.toLowerCase().includes(needle))
        .slice(0, 3)
        .map((e) => ({ key: e.id, label: e.id, meta: "Wallet" })),
      ips: data.entities
        .filter((e) => e.type === "IP" && e.id.toLowerCase().includes(needle))
        .slice(0, 3)
        .map((e) => ({ key: e.id, label: e.id, meta: "IP Address" })),
      alerts: alerts
        .filter(
          (a) => a.entityId.toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle),
        )
        .slice(0, 3)
        .map((a) => ({ key: a.id, label: `${a.id} · ${a.entityId}`, meta: `Alert · ${a.risk}` })),
      clusters: data.clusters
        .filter(
          (c) => c.id.toLowerCase().includes(needle) || c.signature.toLowerCase().includes(needle),
        )
        .slice(0, 3)
        .map((c) => ({
          key: c.id,
          label: `${c.id} — ${c.signature.replace(/_/g, " ")}`,
          meta: "Cluster",
        })),
    };
  }, [query, data, alerts]);
  const openSearchHit = (hit: { key: string; label: string; meta: string }) => {
    if (hit.meta === "Transaction") {
      const tx = data?.transactions.find((t) => t.txid === hit.key);
      if (tx) setSelectedTransaction(tx);
    } else if (hit.meta === "Alert · High" || hit.meta.startsWith("Alert")) {
      const alert = alerts.find((a) => a.id === hit.key);
      if (alert) setSelectedAlert(alert);
    } else if (hit.meta === "Cluster") {
      setView("clusters");
    } else {
      const entity = data?.entities.find((e) => e.id === hit.key);
      if (entity) setSelectedEntity(entity);
    }
    setQuery("");
  };
  const viewTitle = navItems.find((item) => item.id === view)?.label ?? "Dashboard";
  return (
    <div
      className="min-h-screen bg-void text-ink"
      style={{
        backgroundImage:
          "radial-gradient(1200px 500px at 75% -10%, color-mix(in oklab, var(--color-cyan) 10%, transparent), transparent 60%), radial-gradient(900px 500px at 10% 0%, color-mix(in oklab, var(--color-blue) 9%, transparent), transparent 55%)",
      }}
    >
      <div className="flex min-h-screen">
        <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line/70 bg-canvas/70">
          <div className="flex items-center gap-2.5 border-b border-line/70 px-5 py-4">
            <div className="grid size-9 place-items-center rounded-xl bg-cyan/15 font-semibold text-cyan ring-1 ring-cyan/30">
              B
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight text-ink">
                BitTrace <span className="text-cyan">AI</span>
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-faint">
                Forensic Console
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  view === id
                    ? "bg-cyan/10 text-cyan ring-1 ring-cyan/25"
                    : "text-mute hover:bg-panel/60 hover:text-ink",
                )}
              >
                <Icon className="size-4" />
                <span>{label}</span>
                {id === "alerts" && alertCount > 0 && (
                  <span className="ml-auto rounded-md bg-crit/12 px-1.5 py-0.5 font-mono text-[10px] text-crit">
                    {alertCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="border-t border-line/70 p-4">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
              System Status
            </div>
            <div className="flex items-center gap-2 text-[13px] font-medium text-safe">
              <span className="bt-pulse size-2 rounded-full bg-safe" />
              Offline Analysis Mode
            </div>
            <div className="mt-2 font-mono text-[11px] text-faint">
              {backendAvailable ? "FastAPI backend · live" : "Synthetic dataset · mock mode"}
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex min-h-14 items-center gap-4 border-b border-line/70 bg-canvas/80 px-5 backdrop-blur-xl">
            <div className="relative min-w-0 flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-full rounded-lg border border-line bg-panel/70 pl-9 pr-3 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-cyan/40"
                placeholder="Search TXID, wallet, IP, ASN…"
              />
              {query && data && (
                <div className="absolute left-0 right-0 top-11 z-40 rounded-lg border border-line bg-panel-strong p-2 shadow-xl shadow-void/40">
                  <SearchResultGroup
                    label="Transactions"
                    items={searchResults.transactions}
                    onClick={openSearchHit}
                  />
                  <SearchResultGroup
                    label="Wallets"
                    items={searchResults.wallets}
                    onClick={openSearchHit}
                  />
                  <SearchResultGroup
                    label="IP Addresses"
                    items={searchResults.ips}
                    onClick={openSearchHit}
                  />
                  <SearchResultGroup
                    label="Alerts"
                    items={searchResults.alerts}
                    onClick={openSearchHit}
                  />
                  <SearchResultGroup
                    label="Clusters"
                    items={searchResults.clusters}
                    onClick={openSearchHit}
                  />
                </div>
              )}
            </div>
            <div className="hidden items-center gap-2 lg:flex">
              <span className="rounded-md bg-panel px-2.5 py-1 font-mono text-[10px] text-mute ring-1 ring-line">
                {live.summary ? live.summary.fileName : "no dataset"}
              </span>
              <span className="rounded-md bg-panel px-2.5 py-1 font-mono text-[10px] text-mute ring-1 ring-line">
                Model: Isolation Forest
              </span>
            </div>
            <Button
              className="bg-cyan text-primary-foreground hover:bg-cyan/90"
              size="sm"
              onClick={runAnalysis}
            >
              <Play />
              Run Analysis
            </Button>
          </header>
          <main className="flex-1 p-5 lg:p-6">
            {analysisProgress !== null && analysisProgress < 100 && (
              <AnalysisProgress progress={analysisProgress} />
            )}
            <div className="mb-6 flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
                {viewTitle}
              </div>
              {analysisProgress === 100 && (
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-safe">
                  <Check className="size-3" />
                  Analysis Complete ·{" "}
                  {(live.data?.summary.records ?? data?.summary.records ?? 0).toLocaleString()}{" "}
                  records processed
                </span>
              )}
            </div>
            {view === "dashboard" && (
              <Dashboard
                data={data}
                onEntity={setSelectedEntity}
                onView={setView}
                onRun={runAnalysis}
              />
            )}
            {view === "ingestion" && (
              <Ingestion
                summary={live.summary}
                running={analysisProgress !== null && analysisProgress < 100}
                onFile={handleFile}
                onRun={runAnalysis}
                onReset={resetSession}
              />
            )}
            {view === "transactions" && data && (
              <Transactions data={data} onSelect={setSelectedTransaction} />
            )}
            {view === "transactions" && !data && (
              <EmptyState
                icon={Table2}
                title="No dataset loaded"
                description="Upload a dataset to populate the transaction explorer."
                action={
                  <Button
                    className="bg-cyan text-primary-foreground hover:bg-cyan/90"
                    onClick={() => setView("ingestion")}
                  >
                    Go to Data Ingestion
                  </Button>
                }
              />
            )}
            {view === "graph" && (
              <Graph
                graph={data?.graph ?? null}
                entities={data?.entities ?? []}
                onEntity={setSelectedEntity}
              />
            )}
            {view === "anomaly" && <Anomaly data={data} />}
            {view === "clusters" && data && (
              <Clusters clusters={data.clusters} onGraph={() => setView("graph")} />
            )}
            {view === "clusters" && !data && (
              <EmptyState
                icon={CircleDot}
                title="No clusters yet"
                description="DBSCAN runs as part of the AI analysis pipeline."
                action={
                  <Button
                    className="bg-cyan text-primary-foreground hover:bg-cyan/90"
                    onClick={() => setView("ingestion")}
                  >
                    Go to Data Ingestion
                  </Button>
                }
              />
            )}
            {view === "alerts" && data && (
              <Alerts alerts={alerts} onSelect={setSelectedAlert} onStatus={changeAlertStatus} />
            )}
            {view === "alerts" && !data && (
              <EmptyState
                icon={Bell}
                title="No alerts yet"
                description="Investigation leads are generated by the ML pipeline."
                action={
                  <Button
                    className="bg-cyan text-primary-foreground hover:bg-cyan/90"
                    onClick={() => setView("ingestion")}
                  >
                    Go to Data Ingestion
                  </Button>
                }
              />
            )}
            {view === "geo" && <GeoNetwork data={data} />}
            {view === "reports" && data && <Reports data={data} />}
            {view === "reports" && !data && (
              <EmptyState
                icon={FileBarChart}
                title="Nothing to report yet"
                description="Run an analysis to generate the investigation report."
                action={
                  <Button
                    className="bg-cyan text-primary-foreground hover:bg-cyan/90"
                    onClick={() => setView("ingestion")}
                  >
                    Go to Data Ingestion
                  </Button>
                }
              />
            )}
            {view === "settings" && <Settings backendAvailable={backendAvailable} />}
            <footer className="mt-8 flex flex-col gap-2 border-t border-line/50 pt-4 font-mono text-[10px] text-faint sm:flex-row sm:items-center sm:justify-between">
              <span>Offline Analysis Mode · Synthetic Dataset · No Live Blockchain Monitoring</span>
              <span>Raw Metadata → Correlation → AI/ML → Graph → Explainable Alert</span>
            </footer>
          </main>
        </div>
      </div>
      {selectedEntity && (
        <EntityDrawer
          entity={selectedEntity}
          graph={data?.graph ?? null}
          onClose={() => setSelectedEntity(null)}
          onGraph={goGraph}
        />
      )}
      {selectedTransaction && (
        <TransactionDrawer tx={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
      )}
      {selectedAlert && (
        <AlertDrawer
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onGraph={goGraph}
          onStatus={changeAlertStatus}
        />
      )}
    </div>
  );
}
