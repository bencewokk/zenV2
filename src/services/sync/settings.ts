/**
 * Sync backend config. The base URL ships baked in from VITE_SYNC_API_URL for
 * released builds, but stays overridable at runtime (Settings → Connections) like
 * the Google client id and AI key.
 */
// Public sync backend URL. Not a secret — it's just an endpoint. Overridable at
// build time (VITE_SYNC_API_URL) and at runtime (Settings → Connections).
const DEFAULT_URL = import.meta.env.VITE_SYNC_API_URL ?? "https://zen-v2-plum.vercel.app";

const KEY = "zen.sync.settings.v1";

export interface SyncSettings {
  /** Base URL of the deployed sync API, e.g. https://zen-sync.vercel.app */
  baseUrl: string;
  /** User toggle: sync only runs when enabled and signed in to Google. */
  enabled: boolean;
}

const DEFAULTS: SyncSettings = {
  baseUrl: DEFAULT_URL,
  enabled: false,
};

export function loadSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SyncSettings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function saveSyncSettings(s: SyncSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
