import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Download,
  FileBarChart,
  Filter,
  Globe2,
  Grid3X3,
  HardDriveUpload,
  Loader2,
  Network,
  Play,
  Search,
  Settings2,
  ShieldAlert,
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
  ApiError,
  api,
  type Alert,
  type AlertStatus,
  type Analysis,
  type Chain,
  type Cluster,
  type Contribution,
  type DatasetSummary,
  type GeoRow,
  type GraphEdge,
  type GraphNode,
  type RiskLevel,
  type Transaction,
  type Wallet,
} from "@/lib/api";
import { SettingsProvider, useAppSettings } from "@/lib/settings";
import type { AppSettings } from "@/lib/api";
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
const donutColors: Record<RiskLevel, string> = {
  Low: "var(--color-safe)",
  Medium: "var(--color-amber)",
  High: "var(--color-risk)",
  Critical: "var(--color-crit)",
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

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Panel className="flex items-center justify-between gap-4 border border-crit/30 bg-crit/8 p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-crit" />
        <div>
          <div className="text-sm font-semibold text-ink">Request failed</div>
          <div className="mt-0.5 font-mono text-xs text-mute">{message}</div>
        </div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Panel>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="grid min-h-[240px] place-items-center gap-3 text-center">
      <Loader2 className="mx-auto size-6 animate-spin text-cyan" />
      <div className="font-mono text-xs text-mute">{label}</div>
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
        {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

function ContributionsBars({ contributions }: { contributions: Contribution[] }) {
  const max = Math.max(...contributions.map((c) => c.contribution), 0.0001);
  return (
    <div className="space-y-3">
      {contributions.slice(0, 6).map((c) => (
        <div key={c.feature}>
          <div className="mb-1 flex justify-between font-mono text-[11px]">
            <span className="text-mute">{c.feature.replace(/_/g, " ")}</span>
            <span className="text-ink">{(c.contribution * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-void">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue to-risk"
              style={{ width: `${Math.round((c.contribution / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------
export function BitTraceApp() {
  return (
    <SettingsProvider>
      <Console />
    </SettingsProvider>
  );
}

function Console() {
  const { health, refreshHealth, alertStatuses, setAlertStatus } = useAppSettings();
  const [view, setView] = useState<View>("dashboard");
  const [query, setQuery] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "sample" | "analyze" | "upload">(null);
  const [progressStep, setProgressStep] = useState(0);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const selectedAlert = useMemo(
    () => analysis?.alerts.find((a) => a.id === selectedAlertId) ?? null,
    [analysis, selectedAlertId],
  );

  const refreshAnalysis = useCallback(async () => {
    try {
      setAnalysisError(null);
      setAnalysis(await api.fullAnalysis());
    } catch (err) {
      setAnalysisError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  // Auto-adopt an analysis the backend already holds (page reloads, restarted UI).
  useEffect(() => {
    (async () => {
      try {
        const h = await api.health();
        if (h.analysis_ready) await refreshAnalysis();
      } catch {
        /* backend offline; pages show their own errors/empty states */
      }
    })();
  }, [refreshAnalysis]);

  const runPipeline = useCallback(
    async (steps: number, fn: () => Promise<void>) => {
      setBusy("analyze");
      setProgressStep(0);
      const timer = window.setInterval(
        () => setProgressStep((s) => Math.min(steps - 1, s + 1)),
        450,
      );
      try {
        await fn();
        setProgressStep(steps);
        await refreshAnalysis();
        await refreshHealth();
      } catch (err) {
        setAnalysisError(err instanceof ApiError ? err.message : String(err));
      } finally {
        window.clearInterval(timer);
        window.setTimeout(() => {
          setBusy(null);
          setProgressStep(0);
        }, 350);
      }
    },
    [refreshAnalysis, refreshHealth],
  );

  const loadSample = useCallback(
    (rows = 5000) =>
      runPipeline(2, async () => {
        setBusy("sample");
        await api.loadSample(rows);
        await api.analyze();
      }),
    [runPipeline],
  );

  const upload = useCallback(
    async (file: File) =>
      runPipeline(2, async () => {
        await api.upload(file);
        await api.analyze();
      }),
    [runPipeline],
  );

  const firstLoad = !health?.dataset_loaded && !analysis;

  return (
    <div
      className="min-h-screen bg-void text-ink"
      style={{
        backgroundImage:
          "radial-gradient(1200px 500px at 75% -10%, color-mix(in oklab, var(--color-cyan) 10%, transparent), transparent 60%), radial-gradient(900px 500px at 10% 0%, color-mix(in oklab, var(--color-blue) 9%, transparent), transparent 55%)",
      }}
    >
      <div className="flex min-h-screen">
        <Sidebar
          view={view}
          setView={setView}
          alertCount={
            analysis?.alerts.filter(
              (a) =>
                (alertStatuses[a.id] ?? a.status) === "New" &&
                (a.risk === "High" || a.risk === "Critical"),
            ).length ?? 0
          }
          health={health}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            query={query}
            setQuery={setQuery}
            analysis={analysis}
            health={health}
            busy={busy}
            onLoadSample={() => loadSample()}
            setView={setView}
            onOpenAlert={(id) => {
              setSelectedAlertId(id);
            }}
          />
          <main className="flex-1 p-5 lg:p-6">
            {analysisError && (
              <div className="mb-5">
                <ErrorNote message={analysisError} onRetry={refreshAnalysis} />
              </div>
            )}
            {busy && <AnalysisProgress step={progressStep} mode={busy} />}
            {view === "dashboard" && (
              <Dashboard
                analysis={analysis}
                loading={busy !== null}
                firstLoad={firstLoad}
                onLoadSample={() => loadSample()}
                onView={setView}
              />
            )}
            {view === "ingestion" && (
              <Ingestion
                analysis={analysis}
                busy={busy}
                onUpload={upload}
                onLoadSample={loadSample}
                onRun={() => runPipeline(4, async () => { await api.analyze(); })}
                onReset={async () => {
                  setAnalysis(null);
                  await refreshHealth();
                }}
              />
            )}
            {view === "transactions" && (
              <Transactions analysis={analysis} setView={setView} />
            )}
            {view === "graph" && <GraphView analysis={analysis} setView={setView} />}
            {view === "anomaly" && <Anomaly analysis={analysis} setView={setView} onRerun={(patch) => runPipeline(4, async () => { await api.updateSettings(patch); await api.analyze(); })} />}
            {view === "clusters" && <Clusters analysis={analysis} setView={setView} />}
            {view === "alerts" && (
              <Alerts
                analysis={analysis}
                alertStatuses={alertStatuses}
                setAlertStatus={setAlertStatus}
                onSelect={setSelectedAlertId}
                setView={setView}
              />
            )}
            {view === "geo" && <GeoNetwork analysis={analysis} setView={setView} />}
            {view === "reports" && <Reports analysis={analysis} setView={setView} />}
            {view === "settings" && <Settings />}
            <footer className="mt-8 flex flex-col gap-2 border-t border-line/50 pt-4 font-mono text-[10px] text-faint sm:flex-row sm:items-center sm:justify-between">
              <span>Offline Analysis · Local Synthetic Dataset · No Live Blockchain Monitoring</span>
              <span>Raw Metadata → Correlation → AI/ML → Graph → Explainable Alert</span>
            </footer>
          </main>
        </div>
      </div>
      {selectedAlert && (
        <AlertDrawer
          alert={selectedAlert}
          onClose={() => setSelectedAlertId(null)}
          alertStatuses={alertStatuses}
          setAlertStatus={setAlertStatus}
          onOpenGraph={() => {
            setSelectedAlertId(null);
            setView("graph");
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell pieces
// ---------------------------------------------------------------------------
function Sidebar({
  view,
  setView,
  alertCount,
  health,
}: {
  view: View;
  setView: (v: View) => void;
  alertCount: number;
  health: ReturnType<typeof useAppSettings>["health"];
}) {
  return (
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
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span
            className={cn(
              "bt-pulse size-2 rounded-full",
              health ? "bg-safe" : "bg-crit",
            )}
          />
          <span className={health ? "text-safe" : "text-crit"}>
            {health ? "Backend connected" : "Backend unreachable"}
          </span>
        </div>
        <div className="mt-2 font-mono text-[11px] text-faint">
          {health?.dataset_name
            ? `dataset: ${health.dataset_name}`
            : health?.dataset_loaded
              ? "dataset loaded"
              : "no dataset"}
        </div>
        <div className="font-mono text-[11px] text-faint">
          offline mode · v{health?.version ?? "—"}
        </div>
      </div>
    </aside>
  );
}

function TopBar({
  query,
  setQuery,
  analysis,
  health,
  busy,
  onLoadSample,
  setView,
  onOpenAlert,
}: {
  query: string;
  setQuery: (v: string) => void;
  analysis: Analysis | null;
  health: ReturnType<typeof useAppSettings>["health"];
  busy: null | "sample" | "analyze" | "upload";
  onLoadSample: () => void;
  setView: (v: View) => void;
  onOpenAlert: (id: string) => void;
}) {
  const hits = useMemo(() => {
    if (!analysis || query.trim().length < 4) return [];
    const needle = query.toLowerCase();
    const out: { id: string; label: string; meta: string }[] = [];
    for (const w of analysis.wallets) {
      if (w.id.toLowerCase().includes(needle)) {
        out.push({ id: w.id, label: w.id, meta: "Wallet" });
        if (out.length >= 4) return out;
      }
    }
    for (const t of analysis.transactions.slice(0, 500)) {
      if (t.txid.toLowerCase().includes(needle)) {
        out.push({ id: t.txid, label: t.txid, meta: "Transaction" });
        if (out.length >= 7) return out;
      }
    }
    for (const a of analysis.alerts) {
      if (a.entity.id.toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle)) {
        out.push({ id: a.id, label: `${a.id} · ${shortId(a.entity.id, 18)}`, meta: `Alert · ${a.risk}` });
        if (out.length >= 9) return out;
      }
    }
    return out;
  }, [analysis, query]);

  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-4 border-b border-line/70 bg-canvas/80 px-5 backdrop-blur-xl">
      <div className="relative min-w-0 max-w-md flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-full rounded-lg border border-line bg-panel/70 pl-9 pr-3 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-cyan/40"
          placeholder="Search wallet, TXID, alert…"
        />
        {hits.length > 0 && (
          <div className="absolute left-0 right-0 top-11 z-40 rounded-lg border border-line bg-panel-strong p-2 shadow-xl shadow-void/40">
            {hits.map((hit) => (
              <button
                key={`${hit.meta}-${hit.id}`}
                onClick={() => {
                  if (hit.meta.startsWith("Alert")) onOpenAlert(hit.id);
                  else if (hit.meta === "Transaction") setView("transactions");
                  else setView("clusters");
                  setQuery("");
                }}
                className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs text-mute hover:bg-cyan/10 hover:text-ink"
              >
                <span className="font-mono">{shortId(hit.label, 22)}</span>
                <span className="font-mono text-[10px] text-faint">{hit.meta}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hidden items-center gap-2 lg:flex">
        <span className="rounded-md bg-panel px-2.5 py-1 font-mono text-[10px] text-mute ring-1 ring-line">
          {health?.dataset_name ?? "no dataset"}
        </span>
        <span className="rounded-md bg-panel px-2.5 py-1 font-mono text-[10px] text-mute ring-1 ring-line">
          IsolationForest
        </span>
        <span
          className={cn(
            "rounded-md px-2.5 py-1 font-mono text-[10px] ring-1",
            analysis
              ? "bg-safe/10 text-safe ring-safe/20"
              : "bg-amber/10 text-amber ring-amber/25",
          )}
        >
          {busy
            ? "running…"
            : analysis
              ? `analysis ${fmtDate(analysis.generated_at)}`
              : "no analysis yet"}
        </span>
      </div>
      {health?.dataset_loaded ? (
        <Button
          className="bg-cyan text-primary-foreground hover:bg-cyan/90"
          size="sm"
          disabled={busy !== null}
          onClick={() => setView("ingestion")}
        >
          <Play />
          Run Analysis
        </Button>
      ) : (
        <Button
          className="bg-cyan text-primary-foreground hover:bg-cyan/90"
          size="sm"
          disabled={busy !== null}
          onClick={onLoadSample}
        >
          <HardDriveUpload />
          Load Sample Dataset
        </Button>
      )}
    </header>
  );
}

const PIPELINE_STEPS = ["Ingest", "Correlate", "AI/ML", "Graph", "Alert"];

function AnalysisProgress({ step, mode }: { step: number; mode: string }) {
  const label =
    mode === "sample" ? "Loading sample dataset…" : mode === "upload" ? "Uploading dataset…" : "Running AI analysis…";
  return (
    <Panel className="mb-6 overflow-hidden border border-cyan/25 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-cyan" />
          <h2 className="text-sm font-semibold text-ink">{label}</h2>
        </div>
        <span className="font-mono text-[11px] text-faint">
          IsolationForest · offline pipeline
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-5">
        {PIPELINE_STEPS.map((name, index) => (
          <div
            key={name}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-2 font-mono text-[10px]",
              index < step
                ? "bg-safe/8 text-safe"
                : index === step
                  ? "bg-cyan/10 text-cyan ring-1 ring-cyan/25"
                  : "bg-panel/50 text-faint",
            )}
          >
            {index < step ? (
              <Check className="size-3" />
            ) : (
              <span className="grid size-3 place-items-center rounded-full border border-current text-[8px]">
                {index + 1}
              </span>
            )}
            {name}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({
  analysis,
  loading,
  firstLoad,
  onLoadSample,
  onView,
}: {
  analysis: Analysis | null;
  loading: boolean;
  firstLoad: boolean;
  onLoadSample: () => void;
  onView: (v: View) => void;
}) {
  if (loading && !analysis) return <Spinner label="Running the analysis pipeline…" />;
  if (!analysis) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No analysis loaded yet"
        description="Load the built-in sample dataset to explore the full pipeline in one click, or upload your own CSV/JSON/XML."
        action={
          <>
            <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={onLoadSample}>
              <HardDriveUpload />
              Load Sample Dataset
            </Button>
            <Button variant="outline" onClick={() => onView("ingestion")}>
              <Upload />
              Upload Data
            </Button>
          </>
        }
      />
    );
  }
  const { kpis, charts, metrics } = analysis;
  const kpiCards = [
    { label: "Transactions", value: kpis.transactions.toLocaleString(), note: `${analysis.dataset.file_type.toUpperCase()} · parsed` },
    { label: "Wallets", value: kpis.wallets.toLocaleString(), note: "input/output addresses" },
    { label: "IPs", value: kpis.ips.toLocaleString(), note: "distinct endpoints" },
    { label: "Clusters", value: String(kpis.clusters), note: "ownership + embedding" },
    { label: "Flagged entities", value: String(kpis.flagged_entities), note: "risk ≥ 50 / 100" },
    { label: "High-risk alerts", value: String(kpis.high_risk_alerts), note: "High + Critical" },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Investigator Dashboard"
        eyebrow="Investigator Console"
        action={
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-wider text-faint">Dataset</div>
            <div className="font-mono text-sm text-ink">{analysis.dataset.name}</div>
            <div className="font-mono text-[10px] text-faint">
              {analysis.dataset.rows_parsed.toLocaleString()} rows · {fmtDate(analysis.generated_at)}
            </div>
          </div>
        }
      />
      {firstLoad && (
        <Panel className="flex items-center justify-between border border-cyan/25 bg-cyan/8 p-4">
          <div>
            <div className="text-sm font-semibold text-ink">Demo tip</div>
            <p className="mt-0.5 text-xs text-mute">
              This analysis was computed by the local AI pipeline — every score comes from a trained
              IsolationForest, not fixtures.
            </p>
          </div>
        </Panel>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((item) => (
          <Panel key={item.label} className="p-4">
            <div className="font-mono text-[11px] uppercase tracking-wider text-faint">
              {item.label}
            </div>
            <div className="mt-2 text-3xl font-semibold leading-none text-ink">{item.value}</div>
            <div className="mt-2 font-mono text-[11px] text-mute">{item.note}</div>
          </Panel>
        ))}
      </div>
      {metrics.transaction.available && (
        <Panel className="flex flex-wrap items-center gap-x-8 gap-y-2 p-4">
          <div className="font-mono text-[11px] uppercase tracking-wider text-cyan">
            Model metrics vs planted ground truth
          </div>
          {[
            ["Precision", metrics.transaction.precision],
            ["Recall", metrics.transaction.recall],
            ["F1", metrics.transaction.f1],
            ["ROC-AUC", metrics.transaction.roc_auc],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-faint">{String(label)}</span>
              <span className="font-mono text-lg text-ink">
                {value == null ? "—" : Number(value).toFixed(3)}
              </span>
            </div>
          ))}
          <div className="font-mono text-[11px] text-mute">
            patterns recovered: {metrics.patterns.chains_recovered}/{metrics.patterns.planted_chains} chains ·{" "}
            {metrics.patterns.rounds_recovered}/{metrics.patterns.planted_rounds} rounds
          </div>
        </Panel>
      )}
      <div className="grid grid-cols-12 gap-4">
        <Panel className="col-span-12 p-5 lg:col-span-8">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Transactions Over Time</h2>
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                total vs flagged · daily window
              </p>
            </div>
            <div className="flex gap-3 font-mono text-[11px] text-mute">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-blue" /> Total
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-risk" /> Flagged
              </span>
            </div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.activity}>
                <defs>
                  <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-blue)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--color-blue)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="flagFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-risk)" stopOpacity={0.36} />
                    <stop offset="100%" stopColor="var(--color-risk)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 4" opacity={0.5} />
                <XAxis dataKey="day" tick={{ fill: "var(--color-faint)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-panel-strong)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 8,
                    color: "var(--color-ink)",
                  }}
                />
                <Area type="monotone" dataKey="total" stroke="var(--color-blue)" fill="url(#totalFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="flagged" stroke="var(--color-risk)" fill="url(#flagFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel className="col-span-12 p-5 lg:col-span-4">
          <h2 className="text-sm font-semibold text-ink">Risk Distribution</h2>
          <p className="mt-0.5 font-mono text-[11px] text-faint">propagated wallet risk</p>
          <div className="mt-3 flex items-center gap-4">
            <div className="h-36 w-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={charts.risk_distribution.filter((r) => r.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={64}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {charts.risk_distribution
                      .filter((r) => r.value > 0)
                      .map((entry) => (
                        <Cell key={entry.name} fill={donutColors[entry.name]} />
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
              {charts.risk_distribution.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm" style={{ background: donutColors[item.name] }} />
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
              <h2 className="text-sm font-semibold text-ink">Top Risky Wallets</h2>
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                anomaly + propagated risk · click for alerts
              </p>
            </div>
            <Button variant="link" size="sm" className="text-cyan" onClick={() => onView("alerts")}>
              View alerts <ChevronRight />
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-y border-line/60 bg-panel/40 font-mono text-[10px] uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-5 py-2">Wallet</th>
                  <th className="px-3 py-2">Risk</th>
                  <th className="px-3 py-2">Anomaly</th>
                  <th className="px-3 py-2">Seed</th>
                  <th className="px-5 py-2">Tx count</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {analysis.wallets.slice(0, 6).map((wallet) => (
                  <tr key={wallet.id} className="border-b border-line/40 text-mute">
                    <td className="px-5 py-3 text-cyan">{shortId(wallet.id, 20)}</td>
                    <td className="px-3 py-3">
                      <RiskBadge risk={wallet.risk} />
                    </td>
                    <td className="px-3 py-3 text-ink">{wallet.anomaly_score.toFixed(2)}</td>
                    <td className="px-3 py-3">{wallet.seed ? "SEED" : "—"}</td>
                    <td className="px-5 py-3">{wallet.tx_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel className="col-span-12 p-5 lg:col-span-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Alert Type Breakdown</h2>
              <p className="mt-0.5 font-mono text-[11px] text-faint">detections by class</p>
            </div>
            <Zap className="size-4 text-cyan" />
          </div>
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.alert_types} layout="vertical" margin={{ left: 5, right: 8 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
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
      <MiniGraph nodes={analysis.graph.nodes.slice(0, 60)} edges={analysis.graph.edges.slice(0, 160)} />
    </div>
  );
}

function MiniGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const layout = useForceLayout(nodes, edges, 920, 240);
  const nodeColor: Record<string, string> = {
    wallet: "var(--color-blue)",
    tx: "var(--color-risk)",
    ip: "var(--color-amber)",
  };
  return (
    <Panel className="relative overflow-hidden bg-void/35 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Entity Graph Preview</h2>
        <span className="font-mono text-[11px] text-faint">
          {nodes.length} nodes · wallet / tx / ip
        </span>
      </div>
      <svg className="h-[240px] w-full" viewBox="0 0 920 240">
        {layout.lines.map((line, i) => (
          <line key={i} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="var(--color-cyan)" strokeOpacity="0.18" />
        ))}
        {nodes.map((node) => {
          const pos = layout.positions.get(node.id);
          if (!pos) return null;
          const r = 4 + Math.min(6, node.score * 6);
          return (
            <circle
              key={node.id}
              cx={pos.x}
              cy={pos.y}
              r={r}
              fill={nodeColor[node.type] ?? "var(--color-cyan)"}
              fillOpacity={0.35}
              stroke={nodeColor[node.type] ?? "var(--color-cyan)"}
              strokeOpacity={node.risk === "High" || node.risk === "Critical" ? 1 : 0.6}
            />
          );
        })}
      </svg>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------
function Ingestion({
  analysis,
  busy,
  onUpload,
  onLoadSample,
  onRun,
  onReset,
}: {
  analysis: Analysis | null;
  busy: null | "sample" | "analyze" | "upload";
  onUpload: (file: File) => void;
  onLoadSample: (rows?: number) => void;
  onRun: () => void;
  onReset: () => void;
}) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const summary: DatasetSummary | null = analysis?.dataset ?? null;

  const handleFile = async (file: File) => {
    setUploadError(null);
    try {
      onUpload(file);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : String(err));
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
      {uploadError && <ErrorNote message={uploadError} />}
      <Panel className="p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-ink">Import Investigation Dataset</h2>
          <p className="mt-1 text-sm text-mute">
            CSV, JSON or XML with the full metadata schema — analysis runs automatically after a
            successful parse.
          </p>
        </div>
        <div
          className={cn(
            "rounded-xl border border-dashed p-10 text-center transition-colors",
            dragging ? "border-cyan bg-cyan/10" : "border-cyan/35 bg-cyan/5",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.json,.xml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-cyan/10 text-cyan ring-1 ring-cyan/25">
            <Upload className="size-5" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-ink">Drop a dataset here</h3>
          <p className="mt-1 font-mono text-xs text-faint">CSV · JSON · XML · max 50 MB</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              className="border-cyan/30 text-cyan hover:bg-cyan/10"
              disabled={busy !== null}
              onClick={() => inputRef.current?.click()}
            >
              <HardDriveUpload />
              Choose file
            </Button>
            <Button variant="ghost" size="sm" className="text-mute" disabled={busy !== null} onClick={() => onLoadSample()}>
              <Download />
              Load Sample Dataset
            </Button>
          </div>
          <p className="mt-4 text-xs text-safe">
            Offline processing — files never leave this machine.
          </p>
        </div>
      </Panel>
      <Panel className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Parsing Summary</h2>
            <p className="mt-1 font-mono text-[11px] text-faint">
              {summary ? "validated against the required schema" : "load a dataset to populate the schema summary"}
            </p>
          </div>
          <span
            className={cn(
              "rounded-md px-2 py-1 font-mono text-[10px] ring-1",
              summary?.rows_rejected
                ? "bg-amber/10 text-amber ring-amber/20"
                : summary
                  ? "bg-safe/10 text-safe ring-safe/20"
                  : "bg-panel text-faint ring-line/40",
            )}
          >
            {!summary ? "NO DATASET" : summary.rows_rejected ? `${summary.rows_rejected} REJECTED` : "READY"}
          </span>
        </div>
        {summary && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              {[
                ["File", summary.name],
                ["Rows parsed", summary.rows_parsed.toLocaleString()],
                ["Rows rejected", String(summary.rows_rejected)],
                ["Wallets", summary.unique_wallets.toLocaleString()],
                ["IPs", summary.unique_ips.toLocaleString()],
                ["TXIDs", summary.unique_txids.toLocaleString()],
                ["Time range", `${fmtDate(summary.time_range[0])} → ${fmtDate(summary.time_range[1])}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
                  <div className="mt-1 truncate text-xs text-ink" title={value}>{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {summary.fields_detected.map((field) => (
                <span key={field} className="rounded bg-safe/10 px-2 py-0.5 font-mono text-[10px] text-safe">
                  {field}
                </span>
              ))}
            </div>
            {Object.keys(summary.rejection_reasons).length > 0 && (
              <div className="mt-3 space-y-1">
                {Object.entries(summary.rejection_reasons).map(([reason, count]) => (
                  <div key={reason} className="font-mono text-[11px] text-amber">
                    {count}× {reason}
                  </div>
                ))}
              </div>
            )}
            {analysis && (
              <div className="mt-5 overflow-x-auto">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-faint">
                  Preview (first transactions)
                </div>
                <table className="w-full text-left font-mono text-xs">
                  <thead className="border-y border-line/60 text-[10px] uppercase tracking-wider text-faint">
                    <tr>
                      {["timestamp", "src_ip", "txid", "in→out", "amount", "fee", "script", "country"].map((field) => (
                        <th key={field} className="px-3 py-2 first:pl-0">{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.transactions.slice(0, 4).map((tx) => (
                      <tr key={tx.txid} className="border-b border-line/40 text-mute">
                        <td className="px-3 py-2 pl-0">{fmtDate(tx.timestamp)}</td>
                        <td className="px-3 py-2">{tx.src_ip}</td>
                        <td className="px-3 py-2 text-cyan">{shortId(tx.txid)}</td>
                        <td className="px-3 py-2">{tx.input_addresses.length}→{tx.output_addresses.length}</td>
                        <td className="px-3 py-2">{tx.output_amount.toFixed(4)}</td>
                        <td className="px-3 py-2">{tx.fee}</td>
                        <td className="px-3 py-2">{tx.script_type}</td>
                        <td className="px-3 py-2">{tx.country}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <div className="mt-5 flex justify-between">
          <Button variant="ghost" size="sm" className="text-faint" onClick={onReset}>
            Reset session view
          </Button>
          <Button
            className="bg-cyan text-primary-foreground hover:bg-cyan/90"
            disabled={!healthReady(analysis) || busy !== null}
            onClick={onRun}
          >
            <Play />
            Re-run Analysis
          </Button>
        </div>
      </Panel>
    </div>
  );
}

const healthReady = (analysis: Analysis | null) => Boolean(analysis);

// ---------------------------------------------------------------------------
// Transaction Explorer
// ---------------------------------------------------------------------------
function Transactions({ analysis, setView }: { analysis: Analysis | null; setView: (v: View) => void }) {
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState("");
  const [country, setCountry] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; items: Transaction[]; countries: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const limit = 40;

  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;
    setError(null);
    api
      .transactions({
        q: query || undefined,
        risk: risk || undefined,
        country: country || undefined,
        flagged: flaggedOnly || undefined,
        limit,
        offset: page * limit,
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [analysis, query, risk, country, flaggedOnly, page]);

  if (!analysis) {
    return (
      <EmptyState
        icon={Table2}
        title="No dataset loaded"
        description="Load the sample dataset or upload your own to populate the explorer."
        action={
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={() => setView("ingestion")}>
            Go to Data Ingestion
          </Button>
        }
      />
    );
  }
  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Transaction Explorer"
        eyebrow="Correlated Metadata"
        action={
          <span className="rounded-md bg-panel px-2.5 py-1 font-mono text-[10px] text-mute ring-1 ring-line">
            {data ? `${data.total.toLocaleString()} matching` : "…"}
          </span>
        }
      />
      {error && <ErrorNote message={error} onRetry={() => setPage((p) => p)} />}
      <Panel className="p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_140px_170px_auto_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search TXID, wallet, IP, ASN, country…"
              className="h-9 w-full rounded-lg border border-line bg-panel/60 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus:border-cyan/50"
            />
          </div>
          <select
            value={risk}
            onChange={(event) => {
              setRisk(event.target.value);
              setPage(0);
            }}
            className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute outline-none"
          >
            <option value="">All risk</option>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Critical</option>
          </select>
          <select
            value={country}
            onChange={(event) => {
              setCountry(event.target.value);
              setPage(0);
            }}
            className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute outline-none"
          >
            <option value="">All countries</option>
            {(data?.countries ?? []).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(event) => {
                setFlaggedOnly(event.target.checked);
                setPage(0);
              }}
              className="accent-cyan"
            />
            Flagged only
          </label>
          <Button variant="outline" size="sm" disabled>
            <Filter />
            {`Page ${page + 1}/${totalPages}`}
          </Button>
        </div>
      </Panel>
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left">
            <thead className="border-b border-line bg-panel/50 font-mono text-[10px] uppercase tracking-wider text-faint">
              <tr>
                {["TXID", "Timestamp", "In/Out", "Amount", "Fee", "Src IP", "Country", "ASN", "Score", "Risk", "Flags"].map((head) => (
                  <th key={head} className="px-3 py-3 first:pl-5">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {(data?.items ?? []).map((tx) => (
                <tr
                  key={tx.txid}
                  onClick={() => setSelected(tx)}
                  className="cursor-pointer border-b border-line/40 transition-colors hover:bg-cyan/5"
                >
                  <td className="px-3 py-3 pl-5 text-cyan">{shortId(tx.txid)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-mute">{fmtDate(tx.timestamp)}</td>
                  <td className="px-3 py-3 text-mute">{tx.input_addresses.length}→{tx.output_addresses.length}</td>
                  <td className="px-3 py-3 text-ink">{fmtBtc(tx.output_amount)}</td>
                  <td className="px-3 py-3 text-mute">{tx.fee}</td>
                  <td className="px-3 py-3 text-mute">{tx.src_ip}</td>
                  <td className="px-3 py-3 text-mute">{tx.country}</td>
                  <td className="px-3 py-3 text-mute">{tx.asn}</td>
                  <td className="px-3 py-3 text-ink">{tx.anomaly_score.toFixed(2)}</td>
                  <td className="px-3 py-3"><RiskBadge risk={tx.risk} /></td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      {tx.flagged && (
                        <span className="rounded bg-risk/10 px-1.5 py-0.5 text-[10px] text-risk">FLAGGED</span>
                      )}
                      {tx.in_peeling_chain && (
                        <span className="rounded bg-amber/10 px-1.5 py-0.5 text-[10px] text-amber">{tx.in_peeling_chain}</span>
                      )}
                      {tx.in_mixing_round != null && (
                        <span className="rounded bg-cyan/10 px-1.5 py-0.5 text-[10px] text-cyan">CJ</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line/60 px-5 py-3">
          <span className="font-mono text-[11px] text-faint">
            page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Panel>
      {selected && <TransactionDrawer tx={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function TransactionDrawer({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const [detail, setDetail] = useState<
    (Transaction & { related_transactions: Transaction[]; related_alerts: Alert[] }) | null
  >(null);
  useEffect(() => {
    api
      .transactionDetail(tx.txid)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [tx.txid]);
  return (
    <Drawer title="Transaction Investigation" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="break-all font-mono text-xs text-cyan">{tx.txid}</div>
            <div className="mt-1 text-xs text-mute">{fmtDate(tx.timestamp)} UTC</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold text-crit">{tx.anomaly_score.toFixed(2)}</div>
            <RiskBadge risk={tx.risk} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Input amount", fmtBtc(tx.input_amount)],
            ["Output amount", fmtBtc(tx.output_amount)],
            ["Fee", `${tx.fee} sat`],
            ["Script type", tx.script_type],
            ["Source", `${tx.src_ip}:${tx.src_port}`],
            ["Destination", `${tx.dst_ip}:${tx.dst_port}`],
            ["Country / ASN", `${tx.country} · ${tx.asn}`],
            ["Pattern flags", [tx.in_peeling_chain, tx.in_mixing_round ? `CJ round ${tx.in_mixing_round}` : null].filter(Boolean).join(", ") || "—"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
              <div className="mt-1 break-all font-mono text-xs text-ink">{value}</div>
            </div>
          ))}
        </div>
        <Panel className="p-4">
          <div className="mb-1 text-sm font-semibold text-ink">Addresses</div>
          <div className="mt-2 grid gap-1 font-mono text-[11px]">
            {tx.input_addresses.map((w) => (
              <div key={w} className="text-blue">in · {w}</div>
            ))}
            {tx.output_addresses.map((w) => (
              <div key={w} className="text-safe">out · {w}</div>
            ))}
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-cyan" />
            <div>
              <div className="text-sm font-semibold text-ink">Why this score?</div>
              <div className="font-mono text-[10px] text-faint">feature contributions (IsolationForest)</div>
            </div>
          </div>
          <ContributionsBars contributions={tx.contributions} />
        </Panel>
        {detail && detail.related_alerts.length > 0 && (
          <Panel className="p-4">
            <div className="mb-2 text-sm font-semibold text-ink">Related alerts</div>
            {detail.related_alerts.map((al) => (
              <div key={al.id} className="flex items-center justify-between border-b border-line/40 py-2 font-mono text-xs">
                <span className="text-cyan">{al.id}</span>
                <span className="text-mute">{al.type}</span>
                <RiskBadge risk={al.risk} />
              </div>
            ))}
          </Panel>
        )}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Entity Graph
// ---------------------------------------------------------------------------
function useForceLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  return useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    if (nodes.length === 0) return { positions, lines: [], degree };
    const pts = nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const radius = Math.min(width, height) * 0.38;
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
      .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined);
    for (let iter = 0; iter < 150; iter++) {
      const cooling = 1 - iter / 160;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          if (!a || !b) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist2 = Math.max(dx * dx + dy * dy, 120);
          const force = 2400 / dist2;
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
        const force = (dist - 64) * 0.015;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        ps.vx += fx;
        ps.vy += fy;
        pt.vx -= fx;
        pt.vy -= fy;
      }
      for (const p of pts) {
        p.vx += (width / 2 - p.x) * 0.004;
        p.vy += (height / 2 - p.y) * 0.004;
        p.x = Math.min(width - 16, Math.max(16, p.x + Math.max(-14, Math.min(14, p.vx * cooling))));
        p.y = Math.min(height - 16, Math.max(16, p.y + Math.max(-14, Math.min(14, p.vy * cooling))));
        p.vx *= 0.55;
        p.vy *= 0.55;
      }
    }
    for (const p of pts) positions.set(p.id, { x: p.x, y: p.y });
    const lines = springs
      .map(([s, t]) => ({ a: pts[s], b: pts[t] }))
      .filter((pair) => pair.a && pair.b)
      .map((pair) => ({ x1: pair.a!.x, y1: pair.a!.y, x2: pair.b!.x, y2: pair.b!.y }));
    return { positions, lines, degree };
  }, [nodes, edges, width, height]);
}

const nodeColor: Record<string, string> = {
  wallet: "var(--color-blue)",
  tx: "var(--color-risk)",
  ip: "var(--color-amber)",
};

function GraphView({ analysis, setView }: { analysis: Analysis | null; setView: (v: View) => void }) {
  const [riskMin, setRiskMin] = useState(0);
  const [nodeType, setNodeType] = useState("");
  const [cluster, setCluster] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; total_available: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;
    setError(null);
    api
      .graph({
        risk_min: riskMin || undefined,
        node_type: nodeType || undefined,
        cluster: cluster || undefined,
        q: search || undefined,
        limit: 400,
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [analysis, riskMin, nodeType, cluster, search]);

  if (!analysis) {
    return (
      <EmptyState
        icon={Network}
        title="Graph awaits analysis output"
        description="Run the AI pipeline — the canvas plots wallets, transactions and IPs from the correlation graph."
        action={
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={() => setView("ingestion")}>
            Go to Data Ingestion
          </Button>
        }
      />
    );
  }
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const layout = useForceLayout(nodes, edges, 920, 560);
  const neighboursOf = (id: string) => {
    const ids = new Set<string>();
    for (const e of edges) {
      if (e.source === id) ids.add(e.target);
      if (e.target === id) ids.add(e.source);
    }
    return ids;
  };
  const highlight = selected ? neighboursOf(selected.id) : null;
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Entity Graph"
        eyebrow="Link Analysis Workspace"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find wallet / IP…"
              className="h-9 w-44 rounded-lg border border-line bg-panel/60 px-3 text-xs text-ink outline-none placeholder:text-faint focus:border-cyan/40"
            />
            <select value={nodeType} onChange={(event) => setNodeType(event.target.value)} className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute">
              <option value="">All types</option>
              <option value="wallet">Wallets</option>
              <option value="tx">Transactions</option>
              <option value="ip">IPs</option>
            </select>
            <select value={cluster} onChange={(event) => setCluster(event.target.value)} className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute">
              <option value="">All clusters</option>
              {analysis.clusters.map((c) => (
                <option key={c.id} value={c.id}>{c.id}</option>
              ))}
            </select>
          </div>
        }
      />
      {error && <ErrorNote message={error} />}
      <Panel className="flex items-center gap-4 p-4">
        <span className="font-mono text-[11px] text-faint">risk ≥ {riskMin.toFixed(2)}</span>
        <input
          type="range"
          min={0}
          max={0.95}
          step={0.05}
          value={riskMin}
          onChange={(event) => setRiskMin(Number(event.target.value))}
          className="w-56 accent-cyan"
        />
        <span className="font-mono text-[11px] text-mute">
          {nodes.length}/{data?.total_available ?? 0} nodes · {edges.length} edges
        </span>
      </Panel>
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
          <div className="font-mono text-[10px] uppercase tracking-wider text-faint">Relationship canvas</div>
          <div className="mt-1 text-xs text-mute">click a node to inspect & highlight neighbours</div>
        </div>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 920 560">
          {layout.lines.map((line, i) => (
            <line key={i} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="var(--color-cyan)" strokeOpacity={highlight ? 0.12 : 0.2} />
          ))}
          {nodes.map((node) => {
            const pos = layout.positions.get(node.id);
            if (!pos) return null;
            const deg = layout.degree.get(node.id) ?? 1;
            const r = 5 + Math.min(11, deg * 0.8 + node.score * 6);
            const color = nodeColor[node.type] ?? "var(--color-cyan)";
            const dim = highlight && !highlight.has(node.id) && selected?.id !== node.id;
            const hot = node.risk === "High" || node.risk === "Critical";
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x},${pos.y})`}
                className="cursor-pointer"
                opacity={dim ? 0.25 : 1}
                onClick={() => setSelected(node)}
              >
                {(hot || node.seed) && (
                  <circle r={r + 4} fill="none" stroke={node.seed ? "var(--color-crit)" : "var(--color-amber)"} strokeOpacity="0.6" strokeWidth="1.5" />
                )}
                {node.type === "tx" ? (
                  <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.5" />
                ) : node.type === "ip" ? (
                  <rect x={-r * 0.85} y={-r * 0.85} width={r * 1.7} height={r * 1.7} rx={r * 0.5} transform="rotate(45)" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.5" />
                ) : (
                  <circle r={r} fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.5" />
                )}
                <text y={r + 11} textAnchor="middle" fontSize="9" fill="var(--color-mute)" fontFamily="var(--font-mono)">
                  {shortId(node.id, 16)}
                </text>
              </g>
            );
          })}
        </svg>
      </Panel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries({ wallet: "var(--color-blue)", tx: "var(--color-risk)", ip: "var(--color-amber)", "seed wallet": "var(--color-crit)" }).map(
          ([label, color]) => (
            <div key={label} className="flex items-center gap-2 rounded-lg bg-panel/50 p-3 font-mono text-xs text-mute ring-1 ring-line/60">
              <span className="size-3 rounded-full" style={{ background: color }} />
              {label}
            </div>
          ),
        )}
      </div>
      {selected && (
        <Panel className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{selected.type} node</div>
              <div className="mt-1 break-all font-mono text-sm text-cyan">{selected.id}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
              <X />
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Risk", <RiskBadge key="r" risk={selected.risk} />],
              ["Score", selected.score.toFixed(3)],
              ["Degree", layout.degree.get(selected.id) ?? 0],
              ["Cluster", selected.cluster ?? "—"],
            ].map(([label, value], i) => (
              <div key={i} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
                <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{String(label)}</div>
                <div className="mt-1 font-mono text-xs text-ink">{value as React.ReactNode}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anomaly page
// ---------------------------------------------------------------------------
function Anomaly({
  analysis,
  setView,
  onRerun,
}: {
  analysis: Analysis | null;
  setView: (v: View) => void;
  onRerun: (patch: Record<string, number>) => void;
}) {
  const [entityType, setEntityType] = useState<"wallet" | "transaction">("wallet");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.anomalies>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contamination, setContamination] = useState(analysis?.model.params.contamination ?? 0.08);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;
    setError(null);
    api
      .anomalies(entityType, 120)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [analysis, entityType]);

  if (!analysis) {
    return (
      <EmptyState
        icon={Bot}
        title="No model output yet"
        description="Run an analysis to train the IsolationForest and view anomaly scores."
        action={
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={() => setView("ingestion")}>
            Go to Data Ingestion
          </Button>
        }
      />
    );
  }
  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === selectedItem) ?? items[0] ?? null;
  return (
    <div className="space-y-6">
      <SectionHeader
        title="AI-Powered Anomaly Detection"
        eyebrow="Model Operations"
        action={
          <span className="rounded-md bg-cyan/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-cyan ring-1 ring-cyan/25">
            {analysis.model.anomaly_model} · trained {fmtDate(analysis.generated_at)}
          </span>
        }
      />
      {error && <ErrorNote message={error} />}
      <div className="grid grid-cols-12 gap-4">
        <Panel className="col-span-12 p-6 lg:col-span-7">
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-cyan/10 text-cyan ring-1 ring-cyan/25">
              <Bot />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink">Model</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mute">
                A real <b>IsolationForest</b> ({analysis.model.params.n_estimators} trees,
                contamination {analysis.model.params.contamination}) trained on{" "}
                {analysis.model.features.wallet.length} wallet and{" "}
                {analysis.model.features.transaction.length} transaction features.{" "}
                {analysis.model.comparison
                  ? `A ${analysis.model.comparison.name} comparison agrees on ${Math.round(analysis.model.comparison.agreement * 100)}% of outliers.`
                  : ""}{" "}
                Explanations: {analysis.model.explainer.replace("_", " ")}.
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["n_estimators", analysis.model.params.n_estimators],
              ["contamination", analysis.model.params.contamination],
              ["random_state", analysis.model.params.random_state],
              ["explainer", analysis.model.explainer.replace("_", " ")],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
                <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{String(label)}</div>
                <div className="mt-1 font-mono text-xs text-ink">{String(value)}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-3 rounded-lg border border-cyan/25 bg-cyan/5 p-4">
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink">Contamination</div>
              <div className="font-mono text-[11px] text-faint">re-runs the analysis when changed</div>
            </div>
            <span className="font-mono text-sm text-cyan">{contamination.toFixed(2)}</span>
            <input
              type="range"
              min={0.02}
              max={0.3}
              step={0.01}
              value={contamination}
              onChange={(event) => setContamination(Number(event.target.value))}
              className="w-40 accent-cyan"
            />
            <Button
              size="sm"
              className="bg-cyan text-primary-foreground hover:bg-cyan/90"
              disabled={contamination === analysis.model.params.contamination}
              onClick={() => onRerun({ contamination })}
            >
              <Play />
              Re-run
            </Button>
          </div>
        </Panel>
        <Panel className="col-span-12 p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Score Distribution</h2>
              <p className="mt-1 font-mono text-[11px] text-faint">transactions per anomaly bucket</p>
            </div>
          </div>
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analysis.charts.score_distribution}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 4" opacity={0.5} />
                <XAxis dataKey="bucket" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={30} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-panel-strong)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="count" fill="var(--color-cyan)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Ranked Anomalies</h2>
            <p className="mt-1 font-mono text-[11px] text-faint">click a row for feature contributions</p>
          </div>
          <select
            value={entityType}
            onChange={(event) => setEntityType(event.target.value as "wallet" | "transaction")}
            className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute"
          >
            <option value="wallet">Wallets</option>
            <option value="transaction">Transactions</option>
          </select>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="sticky top-0 border-b border-line bg-panel/90 text-[10px] uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Risk</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedItem(item.id)}
                    className={cn(
                      "cursor-pointer border-b border-line/40 hover:bg-cyan/5",
                      selected?.id === item.id && "bg-cyan/10",
                    )}
                  >
                    <td className="px-3 py-2 text-faint">{i + 1}</td>
                    <td className="px-3 py-2 text-cyan">{shortId(item.id, 22)}</td>
                    <td className="px-3 py-2 text-ink">{item.anomaly_score.toFixed(3)}</td>
                    <td className="px-3 py-2"><RiskBadge risk={item.risk} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            {selected && (
              <div className="rounded-lg bg-panel/55 p-4 ring-1 ring-line/60">
                <div className="break-all font-mono text-xs text-cyan">{selected.id}</div>
                <div className="mt-1 font-mono text-[11px] text-faint">
                  anomaly score {selected.anomaly_score.toFixed(3)}
                </div>
                <div className="mt-4">
                  <ContributionsBars contributions={selected.contributions} />
                </div>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------
function Clusters({ analysis, setView }: { analysis: Analysis | null; setView: (v: View) => void }) {
  const [selected, setSelected] = useState<Cluster | null>(null);
  if (!analysis) {
    return (
      <EmptyState
        icon={CircleDot}
        title="No clusters yet"
        description="Entity clusters are produced by the AI pipeline (union-find common-input ownership + DBSCAN over node2vec-style embeddings)."
        action={
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={() => setView("ingestion")}>
            Go to Data Ingestion
          </Button>
        }
      />
    );
  }
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Entity Clusters"
        eyebrow="Common-Input Ownership + Graph Embeddings"
        action={
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={() => setView("graph")}>
            <Network />
            Open cluster graph
          </Button>
        }
      />
      <p className="max-w-3xl text-sm text-mute">
        Wallets are linked by the common-input-ownership heuristic (addresses spending together are
        one owner) and by DBSCAN over node2vec-style graph embeddings; each cluster shows the
        heuristic that formed it.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {analysis.clusters.map((cluster) => (
          <Panel
            key={cluster.id}
            className="cursor-pointer p-5 transition-colors hover:ring-cyan/40"
          >
            <div onClick={() => setSelected(cluster)}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-cyan">{cluster.id}</div>
                  <h2 className="mt-1 text-lg font-semibold text-ink">
                    {cluster.size} wallets · {cluster.transactions} txs
                  </h2>
                </div>
                <RiskBadge risk={cluster.risk >= 0.9 ? "Critical" : cluster.risk >= 0.7 ? "High" : cluster.risk >= 0.4 ? "Medium" : "Low"} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  ["Wallets", cluster.size],
                  ["Shared IPs", cluster.shared_ips.length],
                  ["Tx volume", cluster.transactions],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{String(label)}</div>
                    <div className="mt-1 text-2xl font-semibold text-ink">{String(value)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="rounded bg-panel px-2 py-1 font-mono text-[10px] text-amber ring-1 ring-amber/25">
                  linked by {cluster.heuristic.replace(/_/g, " ")}
                </span>
                <span className="font-mono text-xs text-cyan">
                  cluster risk {Math.round(cluster.risk * 100)}/100
                </span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-void">
                <div
                  className={cn(
                    "h-full rounded-full",
                    cluster.risk >= 0.9 ? "bg-crit" : cluster.risk >= 0.7 ? "bg-risk" : cluster.risk >= 0.4 ? "bg-amber" : "bg-safe",
                  )}
                  style={{ width: `${Math.round(cluster.risk * 100)}%` }}
                />
              </div>
            </div>
          </Panel>
        ))}
      </div>
      {selected && (
        <Panel className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-cyan">{selected.id} members</div>
              <div className="mt-1 text-sm text-mute">
                shared IPs: {selected.shared_ips.slice(0, 6).join(", ") || "—"}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
              <X />
            </Button>
          </div>
          <div className="mt-4 grid gap-1.5 md:grid-cols-2">
            {selected.members.slice(0, 40).map((wallet) => {
              const info = analysis.wallets.find((w) => w.id === wallet);
              return (
                <div key={wallet} className="flex items-center justify-between rounded-lg bg-panel/55 px-3 py-2 font-mono text-xs ring-1 ring-line/50">
                  <span className="text-cyan">{shortId(wallet, 24)}</span>
                  <span className="flex items-center gap-2 text-faint">
                    {info?.seed && <span className="text-crit">SEED</span>}
                    {info ? `risk ${info.risk_score}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
const ALERT_STATUSES: AlertStatus[] = ["New", "Investigating", "Closed"];

function Alerts({
  analysis,
  alertStatuses,
  setAlertStatus,
  onSelect,
  setView,
}: {
  analysis: Analysis | null;
  alertStatuses: Record<string, AlertStatus>;
  setAlertStatus: (id: string, status: AlertStatus) => Promise<void>;
  onSelect: (id: string) => void;
  setView: (v: View) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState<"risk" | "confidence">("risk");
  if (!analysis) {
    return (
      <EmptyState
        icon={Bell}
        title="No alerts yet"
        description="Investigation leads are generated by the ML pipeline from anomalies, detected patterns and propagated risk."
        action={
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={() => setView("ingestion")}>
            Go to Data Ingestion
          </Button>
        }
      />
    );
  }
  const types = [...new Set(analysis.alerts.map((a) => a.type))];
  const rows = analysis.alerts
    .filter((a) => !statusFilter || (alertStatuses[a.id] ?? a.status) === statusFilter)
    .filter((a) => !typeFilter || a.type === typeFilter)
    .sort((a, b) => (sort === "risk" ? b.risk_score - a.risk_score : b.confidence - a.confidence));
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Investigation Alerts"
        eyebrow="Ranked & Explainable Leads"
        action={
          <div className="flex gap-2">
            <select value={sort} onChange={(event) => setSort(event.target.value as "risk" | "confidence")} className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute">
              <option value="risk">Sort: Risk</option>
              <option value="confidence">Sort: Confidence</option>
            </select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute">
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute">
              <option value="">All statuses</option>
              {ALERT_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        }
      />
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left">
            <thead className="border-b border-line bg-panel/50 font-mono text-[10px] uppercase tracking-wider text-faint">
              <tr>
                {["Priority", "Alert", "Entity", "Type", "Risk", "Confidence", "Why flagged", "Status"].map((head) => (
                  <th key={head} className="px-4 py-3 first:pl-5">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {rows.map((alert) => (
                <tr
                  key={alert.id}
                  className="cursor-pointer border-b border-line/40 transition-colors hover:bg-cyan/5"
                  onClick={() => onSelect(alert.id)}
                >
                  <td className="px-4 py-3 pl-5"><RiskBadge risk={alert.risk} /></td>
                  <td className="px-4 py-3 text-cyan">{alert.id}</td>
                  <td className="px-4 py-3 text-mute">{shortId(alert.entity.id, 18)}</td>
                  <td className="px-4 py-3 text-mute">{alert.type}</td>
                  <td className="px-4 py-3 text-ink">{alert.risk_score}</td>
                  <td className="px-4 py-3 text-ink">{alert.confidence.toFixed(2)}</td>
                  <td className="max-w-sm px-4 py-3 text-mute">
                    {alert.reasons[0]?.slice(0, 90)}
                    {alert.reasons.length > 1 && ` +${alert.reasons.length - 1} more`}
                  </td>
                  <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                    <select
                      value={alertStatuses[alert.id] ?? alert.status}
                      onChange={(event) => setAlertStatus(alert.id, event.target.value as AlertStatus)}
                      className="rounded-md bg-panel px-2 py-1 text-[10px] text-mute ring-1 ring-line outline-none"
                    >
                      {ALERT_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
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

function AlertDrawer({
  alert,
  onClose,
  alertStatuses,
  setAlertStatus,
  onOpenGraph,
}: {
  alert: Alert;
  onClose: () => void;
  alertStatuses: Record<string, AlertStatus>;
  setAlertStatus: (id: string, status: AlertStatus) => Promise<void>;
  onOpenGraph: () => void;
}) {
  const [detail, setDetail] = useState<(Alert & { evidence_transactions: Transaction[] }) | null>(null);
  useEffect(() => {
    api
      .alertDetail(alert.id)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [alert.id]);
  const chain = alert.evidence.chain;
  const currentStatus = alertStatuses[alert.id] ?? alert.status;
  return (
    <Drawer title="Alert Evidence" onClose={onClose}>
      <div className="space-y-5">
        <div className="rounded-xl border border-crit/25 bg-crit/8 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-crit">{alert.id} · {alert.type}</div>
              <h3 className="mt-1 break-all font-mono text-sm text-cyan">{alert.entity.id}</h3>
            </div>
            <RiskBadge risk={alert.risk} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              ["Risk score", `${alert.risk_score}/100`],
              ["Confidence", `${Math.round(alert.confidence * 100)}%`],
              ["Anomaly", alert.anomaly_score.toFixed(2)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
                <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
              </div>
            ))}
          </div>
        </div>
        <Panel className="p-4">
          <h3 className="text-sm font-semibold text-ink">Why flagged</h3>
          <div className="mt-3 space-y-2">
            {alert.reasons.map((reason) => (
              <div key={reason} className="flex items-start gap-2 rounded-md bg-panel/55 px-3 py-2 text-xs text-mute ring-1 ring-line/60">
                <Check className="mt-0.5 size-3 shrink-0 text-cyan" />
                {reason}
              </div>
            ))}
          </div>
        </Panel>
        {chain && <ChainView chain={chain} />}
        {alert.evidence.mixing && (
          <Panel className="p-4">
            <h3 className="text-sm font-semibold text-ink">Mixing round {alert.evidence.mixing.id}</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] text-mute md:grid-cols-4">
              <div>inputs: {alert.evidence.mixing.inputs}</div>
              <div>outputs: {alert.evidence.mixing.outputs}</div>
              <div>equal-value: {alert.evidence.mixing.equal_outputs}</div>
              <div>score: {alert.evidence.mixing.score.toFixed(2)}</div>
            </div>
          </Panel>
        )}
        <Panel className="p-4">
          <h3 className="text-sm font-semibold text-ink">Evidence</h3>
          <EvidenceList label="Transactions" items={alert.evidence.txids} color="text-cyan" />
          <EvidenceList label="IPs" items={alert.evidence.ips} color="text-amber" />
          <EvidenceList label="Wallets" items={alert.evidence.wallets} color="text-blue" />
        </Panel>
        {detail && detail.evidence_transactions.length > 0 && (
          <Panel className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-ink">Evidence timeline</h3>
            <div className="space-y-2">
              {detail.evidence_transactions
                .slice()
                .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
                .map((tx) => (
                  <div key={tx.txid} className="flex items-center justify-between border-b border-line/40 py-2 font-mono text-[11px]">
                    <span className="text-faint">{fmtDate(tx.timestamp)}</span>
                    <span className="text-cyan">{shortId(tx.txid, 20)}</span>
                    <span className="text-mute">{fmtBtc(tx.output_amount)}</span>
                    <RiskBadge risk={tx.risk} />
                  </div>
                ))}
            </div>
          </Panel>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onOpenGraph}>
            <Network />
            Open in Graph
          </Button>
          <select
            value={currentStatus}
            onChange={(event) => setAlertStatus(alert.id, event.target.value as AlertStatus)}
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

function EvidenceList({ label, items, color }: { label: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item} className={cn("break-all rounded-md border border-line bg-panel/40 px-3 py-2 font-mono text-xs", color)}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChainView({ chain }: { chain: Chain }) {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Peeling chain {chain.id}</h3>
        <span className="font-mono text-[11px] text-faint">
          {chain.value_start.toFixed(3)} → {chain.value_end.toFixed(3)} BTC · decay{" "}
          {(chain.decay_ratio * 100).toFixed(1)}%
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1">
        {chain.wallets.slice(0, 12).map((wallet, i) => (
          <span key={`${wallet}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-cyan" />}
            <span className="rounded bg-panel px-2 py-1 font-mono text-[10px] text-mute ring-1 ring-line/60" title={wallet}>
              {shortId(wallet, 12)}
            </span>
          </span>
        ))}
        {chain.wallets.length > 12 && (
          <span className="font-mono text-[10px] text-faint">+{chain.wallets.length - 12} more</span>
        )}
      </div>
      <div className="mt-3 font-mono text-[11px] text-faint">
        {chain.hops} hops · {fmtDate(chain.start_time)} → {fmtDate(chain.end_time)}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Geo Network (offline SVG world map)
// ---------------------------------------------------------------------------
const COUNTRY_COORDS: Record<string, [number, number]> = {
  India: [71, 22], "United States": [-98, 39], Germany: [10, 51], Singapore: [104, 1.3],
  Netherlands: [5.3, 52.2], Japan: [138, 36], Canada: [-106, 56], "United Kingdom": [-2, 54],
  Brazil: [-52, -10], Australia: [134, -25], France: [2.5, 47], Russia: [90, 61],
};
const COUNTRY_ISO: Record<string, string> = {
  India: "IND", "United States": "USA", Germany: "DEU", Singapore: "SGP", Netherlands: "NLD",
  Japan: "JPN", Canada: "CAN", "United Kingdom": "GBR", Brazil: "BRA", Australia: "AUS",
  France: "FRA", Russia: "RUS",
};

function GeoNetwork({ analysis, setView }: { analysis: Analysis | null; setView: (v: View) => void }) {
  const [mapFeatures, setMapFeatures] = useState<{ path: string; name: string; id: string }[] | null>(null);
  const [metric, setMetric] = useState<"transactions" | "ips" | "risk">("transactions");

  useEffect(() => {
    // Bundled offline map — fetched from the same origin (public/vendor), no tiles.
    fetch("/vendor/world.geo.json")
      .then((res) => res.json())
      .then((geo) => {
        const proj = (lon: number, lat: number): [number, number] => [
          ((lon + 180) / 360) * 960,
          ((90 - lat) / 180) * 500,
        ];
        const pathFor = (geometry: { type: string; coordinates: unknown }): string => {
          const polys: number[][][][] =
            geometry.type === "Polygon"
              ? [geometry.coordinates as number[][][]]
              : (geometry.coordinates as number[][][][]);
          return polys
            .map((poly) =>
              poly
                .map((ring: number[][]) =>
                  "M" +
                  ring
                    .map((coord: number[]) => {
                      const [x, y] = proj(coord[0] ?? 0, coord[1] ?? 0);
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    })
                    .join("L") +
                  "Z",
                )
                .join(" "),
            )
            .join(" ");
        };
        setMapFeatures(
          geo.features.map((f: { properties: { name: string }; id: string; geometry: { type: string; coordinates: unknown } }) => ({
            path: pathFor(f.geometry),
            name: f.properties.name,
            id: f.id,
          })),
        );
      })
      .catch(() => setMapFeatures(null));
  }, []);

  if (!analysis) {
    return (
      <EmptyState
        icon={Globe2}
        title="No geographic metadata yet"
        description="Load and analyze a dataset containing geo_country and asn fields."
        action={
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={() => setView("ingestion")}>
            Go to Data Ingestion
          </Button>
        }
      />
    );
  }
  const geo = analysis.geo;
  const maxMetric = Math.max(
    1,
    ...geo.map((g) => (metric === "risk" ? g.mean_anomaly : metric === "ips" ? g.ips : g.transactions)),
  );
  const byIso = new Map(geo.map((g) => [COUNTRY_ISO[g.country], g]));
  const colorFor = (g: GeoRow | undefined) => {
    if (!g) return "var(--color-panel)";
    if (metric === "risk") {
      return g.risk === "Critical" ? "var(--color-crit)" : g.risk === "High" ? "var(--color-risk)" : g.risk === "Medium" ? "var(--color-amber)" : "var(--color-safe)";
    }
    const value = metric === "ips" ? g.ips : g.transactions;
    return `color-mix(in oklab, var(--color-cyan) ${Math.round(15 + (value / maxMetric) * 70)}%, var(--color-panel))`;
  };
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Geo Network"
        eyebrow="Offline Country / ASN Context"
        action={
          <select value={metric} onChange={(event) => setMetric(event.target.value as "transactions" | "ips" | "risk")} className="h-9 rounded-lg border border-line bg-panel/60 px-3 text-xs text-mute">
            <option value="transactions">Colour: transactions</option>
            <option value="ips">Colour: IPs</option>
            <option value="risk">Colour: risk</option>
          </select>
        }
      />
      <div className="rounded-lg border border-amber/25 bg-amber/8 px-4 py-3 text-sm text-amber">
        Country-level metadata provides context only; a country itself is not considered suspicious.
        Map data is bundled locally — no online tiles.
      </div>
      <Panel className="overflow-hidden bg-void/35 p-4">
        <svg viewBox="0 0 960 500" className="h-auto w-full">
          {(mapFeatures ?? []).map((feature) => {
            const row = byIso.get(feature.id);
            return (
              <path
                key={feature.id}
                d={feature.path}
                fill={colorFor(row)}
                stroke="var(--color-line)"
                strokeWidth={0.5}
              >
                <title>{`${feature.name}${row ? ` — ${row.transactions} txs, ${row.ips} IPs, risk ${row.risk}` : ""}`}</title>
              </path>
            );
          })}
          {geo.map((g) => {
            const coords = COUNTRY_COORDS[g.country];
            if (!coords) return null;
            const [lon, lat] = coords;
            const x = ((lon + 180) / 360) * 960;
            const y = ((90 - lat) / 180) * 500;
            const r = 3 + (metric === "risk" ? g.mean_anomaly : g.transactions / maxMetric) * 9;
            return (
              <circle
                key={g.country}
                cx={x}
                cy={y}
                r={r}
                fill={g.risk === "Critical" ? "var(--color-crit)" : g.risk === "High" ? "var(--color-risk)" : "var(--color-cyan)"}
                fillOpacity={0.75}
                stroke="var(--color-canvas)"
              >
                <title>{`${g.country}: ${g.transactions} txs · ${g.ips} IPs · ${g.risk}`}</title>
              </circle>
            );
          })}
        </svg>
        {!mapFeatures && <div className="p-4 font-mono text-xs text-faint">bundled map data not found (public/vendor/world.geo.json)</div>}
      </Panel>
      <div className="grid grid-cols-12 gap-4">
        <Panel className="col-span-12 p-5 lg:col-span-7">
          <h2 className="mb-4 text-sm font-semibold text-ink">Top countries</h2>
          <div className="space-y-4">
            {geo.slice(0, 10).map((item) => (
              <div key={item.country}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-ink">{item.country}</span>
                  <span className="font-mono text-mute">
                    {item.transactions.toLocaleString()} txs · {item.ips.toLocaleString()} IPs · {item.risk}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-void">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      item.risk === "Critical" ? "bg-crit" : item.risk === "High" ? "bg-risk" : item.risk === "Medium" ? "bg-amber" : "bg-safe",
                    )}
                    style={{ width: `${Math.max(6, (item.transactions / maxMetric) * 100)}%` }}
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
                <th className="px-3 py-2">ASNs</th>
                <th className="px-5 py-2">Risk</th>
              </tr>
            </thead>
            <tbody>
              {geo.map((item) => (
                <tr key={item.country} className="border-b border-line/40">
                  <td className="px-5 py-3 text-ink">{item.country}</td>
                  <td className="px-3 py-3 text-mute">{item.wallets.toLocaleString()}</td>
                  <td className="px-3 py-3 text-mute">{item.asns.slice(0, 2).join(", ")}</td>
                  <td className="px-5 py-3"><RiskBadge risk={item.risk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
function Reports({ analysis, setView }: { analysis: Analysis | null; setView: (v: View) => void }) {
  const [busyFormat, setBusyFormat] = useState<string | null>(null);
  if (!analysis) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="Nothing to report yet"
        description="Run an analysis to generate the investigation report."
        action={
          <Button className="bg-cyan text-primary-foreground hover:bg-cyan/90" onClick={() => setView("ingestion")}>
            Go to Data Ingestion
          </Button>
        }
      />
    );
  }
  const download = async (format: "csv" | "json" | "pdf") => {
    setBusyFormat(format);
    try {
      const res = await fetch(api.reportUrl(format));
      if (!res.ok) throw new Error(`report ${format} failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bittrace_report.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusyFormat(null);
    }
  };
  const m = analysis.metrics.transaction;
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Reports"
        eyebrow="Evidence Export"
        action={<span className="font-mono text-[11px] text-faint">generated by the backend · reportlab PDF</span>}
      />
      <Panel className="p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Investigation Report</h2>
            <p className="mt-1 max-w-xl text-sm text-mute">
              Ranked alerts with reasons and evidence, dataset summary, model metrics and
              limitations — exported as CSV, JSON or PDF.
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {([
            { format: "pdf", title: "Export PDF", subtitle: "Formatted case file (reportlab)" },
            { format: "json", title: "Export JSON", subtitle: "Machine-readable evidence" },
            { format: "csv", title: "Export CSV", subtitle: "Ranked alert table" },
          ] as const).map(({ format, title, subtitle }) => (
            <Button
              key={format}
              variant="outline"
              className="h-auto justify-start gap-3 p-4 text-left"
              disabled={busyFormat !== null}
              onClick={() => download(format)}
            >
              {busyFormat === format ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              <span>
                <span className="block text-sm text-ink">{title}</span>
                <span className="mt-1 block font-mono text-[10px] text-faint">{subtitle}</span>
              </span>
            </Button>
          ))}
        </div>
      </Panel>
      <Panel className="p-5">
        <h2 className="text-sm font-semibold text-ink">Report contents (live summary)</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Dataset", `${analysis.dataset.name} (${analysis.dataset.rows_parsed.toLocaleString()} rows)`],
            ["Alerts", `${analysis.alerts.length} (${analysis.kpis.high_risk_alerts} high-risk)`],
            ["Model", `${analysis.model.anomaly_model} · contamination ${analysis.model.params.contamination}`],
            [
              "Precision / Recall / F1",
              m.available ? `${m.precision?.toFixed(2)} / ${m.recall?.toFixed(2)} / ${m.f1?.toFixed(2)}` : "no labels",
            ],
            ["ROC-AUC", m.roc_auc != null ? m.roc_auc.toFixed(4) : "—"],
            ["Chains / rounds", `${analysis.kpis.peeling_chains} / ${analysis.kpis.mixing_rounds}`],
            ["Clusters", String(analysis.kpis.clusters)],
            ["Generated", fmtDate(analysis.generated_at)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-panel/55 p-3 ring-1 ring-line/60">
              <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
              <div className="mt-1 break-all font-mono text-xs text-ink">{value}</div>
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
function Settings() {
  const { settings, saveSettings, health } = useAppSettings();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return <Spinner label="Loading settings…" />;
  const fields: { key: keyof AppSettings; label: string; min: number; max: number; step: number; note: string }[] = [
    { key: "contamination", label: "IsolationForest contamination", min: 0.02, max: 0.3, step: 0.01, note: "expected share of anomalies" },
    { key: "risk_propagation_decay", label: "Risk-propagation decay", min: 0.1, max: 0.9, step: 0.05, note: "risk retained per hop from seed wallets" },
    { key: "peeling_min_hops", label: "Peeling-chain min hops", min: 2, max: 10, step: 1, note: "shorter chains are ignored" },
    { key: "mixing_min_outputs", label: "Mixing min outputs", min: 3, max: 20, step: 1, note: "minimum equal outputs for a CoinJoin-like round" },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader title="Settings" eyebrow="Console Configuration" />
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-ink">Model parameters</h2>
          <p className="mt-1 font-mono text-[11px] text-faint">applied on the next analysis run</p>
          <div className="mt-4 space-y-5">
            {fields.map((field) => (
              <div key={field.key}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-mute">{field.label}</span>
                  <span className="font-mono text-sm text-cyan">{String(draft[field.key])}</span>
                </div>
                <input
                  type="range"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={Number(draft[field.key])}
                  onChange={(event) => {
                    setSaved(false);
                    setDraft({ ...draft, [field.key]: Number(event.target.value) });
                  }}
                  className="mt-2 w-full accent-cyan"
                />
                <div className="font-mono text-[10px] text-faint">{field.note}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Button
              className="bg-cyan text-primary-foreground hover:bg-cyan/90"
              onClick={async () => {
                try {
                  await saveSettings(draft);
                  setSaved(true);
                  setError(null);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : String(err));
                }
              }}
            >
              <Check />
              Save settings
            </Button>
            {saved && <span className="font-mono text-xs text-safe">saved</span>}
            {error && <span className="font-mono text-xs text-crit">{error}</span>}
          </div>
        </Panel>
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-ink">System</h2>
          <div className="mt-4 space-y-3">
            {[
              ["Backend", health ? `connected · v${health.version}` : "unreachable"],
              ["Offline mode", health?.offline ? "active — no external calls" : "unknown"],
              ["Dataset", health?.dataset_name ?? "none loaded"],
              ["Analysis", health?.analysis_ready ? "ready" : "not run"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-line/50 pb-3 font-mono text-xs">
                <span className="text-faint">{label}</span>
                <span className="text-mute">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-md bg-panel/50 px-3 py-2 font-mono text-xs ring-1 ring-line/50">
            <span className={cn("size-2 rounded-full", health ? "bg-safe" : "bg-crit")} />
            {health ? "backend connected — real pipeline data" : "start the backend with ./run.sh"}
          </div>
          <h3 className="mt-5 text-sm font-semibold text-ink">API endpoints</h3>
          <div className="mt-2 space-y-1.5 font-mono text-[11px] text-cyan">
            {[
              "POST /api/upload", "POST /api/sample", "POST /api/analyze", "GET /api/dashboard",
              "GET /api/transactions", "GET /api/graph", "GET /api/anomalies", "GET /api/clusters",
              "GET /api/alerts", "GET /api/geo", "GET /api/report?format=csv|json|pdf", "GET /api/model-metrics",
            ].map((endpoint) => (
              <div key={endpoint} className="rounded-md bg-panel/50 px-3 py-2 ring-1 ring-line/50">{endpoint}</div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer shell
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
      <button aria-label="Close drawer" className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={onClose} />
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
