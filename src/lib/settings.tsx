/**
 * BitTrace AI settings context — model tunables + alert statuses, shared by
 * every page. Settings persist server-side; alert statuses persist in-memory
 * (single-investigator offline model).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type AlertStatus, type AppSettings, type Health } from "@/lib/api";

interface SettingsContextValue {
  settings: AppSettings | null;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  health: Health | null;
  refreshHealth: () => Promise<void>;
  alertStatuses: Record<string, AlertStatus>;
  setAlertStatus: (id: string, status: AlertStatus) => Promise<void>;
  datasetLoaded: boolean;
  analysisReady: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: null,
  saveSettings: async () => {},
  health: null,
  refreshHealth: async () => {},
  alertStatuses: {},
  setAlertStatus: async () => {},
  datasetLoaded: false,
  analysisReady: false,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [alertStatuses, setAlertStatuses] = useState<Record<string, AlertStatus>>({});

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    api.settings().then(setSettings).catch(() => setSettings(null));
  }, [refreshHealth]);

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await api.updateSettings(patch);
    setSettings(next);
  }, []);

  const setAlertStatus = useCallback(async (id: string, status: AlertStatus) => {
    await api.setAlertStatus(id, status);
    setAlertStatuses((current) => ({ ...current, [id]: status }));
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      saveSettings,
      health,
      refreshHealth,
      alertStatuses,
      setAlertStatus,
      datasetLoaded: health?.dataset_loaded ?? false,
      analysisReady: health?.analysis_ready ?? false,
    }),
    [settings, saveSettings, health, refreshHealth, alertStatuses, setAlertStatus],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppSettings() {
  return useContext(SettingsContext);
}
