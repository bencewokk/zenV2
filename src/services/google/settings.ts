/**
 * Google integration config. The OAuth Client ID is not a secret (it's a public
 * web client id), but we keep it overridable at runtime like the AI key.
 */
// Optional build-time default; normally set in-app (Settings → Connections) or via a
// gitignored .env. Empty string when unset.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

export interface GoogleSettings {
  clientId: string;
  /** Desktop (Tauri) build only: OAuth client secret for the code flow.
   *  Unused by the browser GIS flow. Stored locally + mirrored to the OS keyring. */
  clientSecret: string;
}

const KEY = "zen.google.settings.v1";

const DEFAULTS: GoogleSettings = {
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: "",
};

export function loadGoogleSettings(): GoogleSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function saveGoogleSettings(s: GoogleSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

// Scopes requested. Read + write so the AI-tooling phase can act on them later.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");
