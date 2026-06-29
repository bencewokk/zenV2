import { invoke } from "@tauri-apps/api/core";
import { loadGoogleSettings, GOOGLE_SCOPES } from "./settings";

/**
 * In the Tauri desktop build, OAuth runs in Rust (real refresh token in the OS
 * secure store), reached via these commands. In a plain browser we fall back to
 * the Google Identity Services token flow below.
 */
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
interface TauriToken {
  access_token: string;
  expires_in: number;
}

/**
 * Browser-only Google OAuth via Google Identity Services (GIS) token client.
 * No backend needed for the prototype: we obtain a short-lived access token
 * client-side and call the REST APIs directly (they allow CORS).
 * Production (Tauri) will move this server-side for refresh + secure storage.
 */

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
  callback: (resp: TokenResponse) => void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        callback: (resp: TokenResponse) => void;
      }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";

let scriptPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

let accessToken: string | null = null;
let expiresAt = 0;
let tokenClient: TokenClient | null = null;
let refreshTimer: number | null = null;

/** Desktop only: push the OAuth credentials from in-app Settings into Rust before
 *  any login/refresh, so the code flow uses what the user entered. */
async function applyCredentials(): Promise<void> {
  if (!IS_TAURI) return;
  const { clientId, clientSecret } = loadGoogleSettings();
  if (!clientId || !clientSecret) return;
  try {
    await invoke("google_set_credentials", { clientId: clientId.trim(), clientSecret: clientSecret.trim() });
  } catch {
    /* Rust will surface a clearer error on the actual login attempt */
  }
}

// Persist the short-lived token so reloads within its ~1h life stay connected.
const TOKEN_KEY = "zen.google.token.v1";
(function restore() {
  if (IS_TAURI) {
    // Desktop: ask Rust whether a session is stored, and prime an access token.
    void (async () => {
      try {
        await applyCredentials();
        if (await invoke<boolean>("google_is_signed_in")) {
          const t = await invoke<TauriToken>("google_access_token");
          accessToken = t.access_token;
          expiresAt = Date.now() + t.expires_in * 1000;
          scheduleRefresh();
          emit();
        }
      } catch {
        /* not signed in yet */
      }
    })();
    return;
  }
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (raw) {
      const t = JSON.parse(raw) as { accessToken: string; expiresAt: number };
      if (t.expiresAt > Date.now() + 5000) {
        accessToken = t.accessToken;
        expiresAt = t.expiresAt;
        scheduleRefresh();
      } else {
        // Token lapsed while away — try to renew it silently so the session
        // survives across reloads without showing the connect gate again.
        void silentRefresh();
      }
    }
  } catch {
    /* ignore */
  }
})();

/**
 * Re-arm a background refresh to fire shortly before the current token expires,
 * so an active session never lapses into the "Connect" gate (the ~1h timer).
 */
function scheduleRefresh(): void {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!accessToken) return;
  const lead = 60_000; // renew a minute before expiry
  const delay = Math.max(0, expiresAt - Date.now() - lead);
  refreshTimer = window.setTimeout(() => void silentRefresh(), delay);
}

/** Renew the access token without any popup (no-op if Google can't do it silently). */
async function silentRefresh(): Promise<void> {
  if (IS_TAURI) {
    try {
      const t = await invoke<TauriToken>("google_access_token");
      accessToken = t.access_token;
      expiresAt = Date.now() + t.expires_in * 1000;
      emit();
      scheduleRefresh();
    } catch {
      /* leave it to the next gapiFetch to recover */
    }
    return;
  }
  try {
    const client = await ensureClient();
    await new Promise<void>((resolve) => {
      client.callback = (resp) => {
        if (!resp.error && resp.access_token) {
          accessToken = resp.access_token;
          expiresAt = Date.now() + resp.expires_in * 1000;
          persistToken();
          emit();
          scheduleRefresh();
        }
        resolve();
      };
      client.requestAccessToken({ prompt: "" });
    });
  } catch {
    /* leave it to the next gapiFetch to recover */
  }
}

function persistToken() {
  if (IS_TAURI) return; // Rust keyring is the durable store in the desktop build.
  if (accessToken) localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken, expiresAt }));
  else localStorage.removeItem(TOKEN_KEY);
}

const listeners = new Set<(signedIn: boolean) => void>();
export function onAuthChange(fn: (signedIn: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  const ok = isSignedIn();
  listeners.forEach((l) => l(ok));
}

export function isSignedIn(): boolean {
  return !!accessToken && Date.now() < expiresAt - 5000;
}

export function isConfigured(): boolean {
  // The desktop build always has a usable client (bundled default in Rust, plus any
  // user override from Settings/env/file). The browser build needs a Client ID, which
  // also ships with a bundled default — so a client is effectively always configured.
  if (IS_TAURI) return true;
  return !!loadGoogleSettings().clientId;
}

async function ensureClient(): Promise<TokenClient> {
  await loadGis();
  const { clientId } = loadGoogleSettings();
  if (!clientId) throw new Error("No Google Client ID set (open Settings).");
  if (!tokenClient) {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: () => {}, // replaced per-request
    });
  }
  return tokenClient;
}

/** Interactive sign-in (opens Google consent popup). */
export async function signIn(): Promise<void> {
  if (IS_TAURI) {
    await applyCredentials();
    const t = await invoke<TauriToken>("google_login");
    accessToken = t.access_token;
    expiresAt = Date.now() + t.expires_in * 1000;
    emit();
    scheduleRefresh();
    return;
  }
  const client = await ensureClient();
  await new Promise<void>((resolve, reject) => {
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      accessToken = resp.access_token;
      expiresAt = Date.now() + resp.expires_in * 1000;
      persistToken();
      emit();
      scheduleRefresh();
      resolve();
    };
    client.requestAccessToken({ prompt: "consent" });
  });
}

export function signOut(): void {
  if (IS_TAURI) {
    void invoke("google_logout");
    accessToken = null;
    expiresAt = 0;
    emit();
    return;
  }
  if (accessToken) window.google?.accounts.oauth2.revoke(accessToken);
  accessToken = null;
  expiresAt = 0;
  persistToken();
  emit();
}

/** Get a valid token, silently refreshing if expired. */
async function getToken(): Promise<string> {
  if (isSignedIn()) return accessToken!;
  if (IS_TAURI) {
    const t = await invoke<TauriToken>("google_access_token");
    accessToken = t.access_token;
    expiresAt = Date.now() + t.expires_in * 1000;
    emit();
    scheduleRefresh();
    return accessToken;
  }
  const client = await ensureClient();
  return new Promise<string>((resolve, reject) => {
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      accessToken = resp.access_token;
      expiresAt = Date.now() + resp.expires_in * 1000;
      persistToken();
      emit();
      scheduleRefresh();
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: "" }); // silent if possible
  });
}

/** Authenticated fetch against a Google REST API. */
export async function gapiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google ${res.status}: ${body.slice(0, 200)}`);
  }
  // A successful DELETE (and some PATCH/PUT) returns 204 / an empty body — calling
  // res.json() on that throws. Treat empty bodies as success (undefined) so real
  // HTTP/network failures still surface to callers.
  if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
