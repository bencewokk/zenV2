import { markBlobDirty } from "@/services/sync/cursor";

/**
 * Google integration config. The OAuth Client ID is not a secret (it's a public
 * web client id), but we keep it overridable at runtime like the AI key.
 */
// Default Web OAuth client id, baked in at build time from VITE_GOOGLE_CLIENT_ID
// (set via CI secrets for released builds). Empty in plain source builds, where the
// user supplies their own in Settings → Connections. The client id is public, not a secret.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface GoogleSettings {
  clientId: string;
  /** Desktop (Tauri) build only: OAuth client secret for the code flow.
   *  Unused by the browser GIS flow. Stored locally + mirrored to the OS keyring. */
  clientSecret: string;
}

const KEY = "zen.google.settings.v1";
export const GOOGLE_SETTINGS_KEY = KEY;
/** Fields that must never leave this device — stripped before sync push. */
export const GOOGLE_SETTINGS_SECRET_FIELDS = ["clientSecret"] as const;

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
  markBlobDirty("googleSettings");
}

/** No live store subscribes to this blob — callers re-read via `loadGoogleSettings()`
 *  on next mount, same as the memory profile blob. */
export function hydrateGoogleSettings(): void {
  /* no-op */
}

/**
 * Whether sign-in is currently using Zen's bundled Google client rather than one
 * the user supplied. Desktop: Rust only uses a saved custom client when BOTH a
 * client id and secret are present (see `valid()`/`load_credentials` in auth.rs) —
 * otherwise it falls through env/file to the build-time bundled default. Browser:
 * bundled whenever the client id still matches the build-time default.
 */
export function isUsingBundledCredentials(s: GoogleSettings): boolean {
  if (IS_TAURI) return !s.clientId.trim() || !s.clientSecret.trim();
  return s.clientId.trim() === GOOGLE_CLIENT_ID;
}

// Scopes requested. Read + write so the AI-tooling phase can act on them later.
// `openid email` make Google issue an ID token used to identify the user to the
// sync backend.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");
