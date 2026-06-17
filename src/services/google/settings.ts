/**
 * Google integration config. The OAuth Client ID is not a secret (it's a public
 * web client id), but we keep it gitignored + overridable at runtime like the AI key.
 */
import { GOOGLE_CLIENT_ID } from "./secret";

export interface GoogleSettings {
  clientId: string;
}

const KEY = "zen.google.settings.v1";

const DEFAULTS: GoogleSettings = {
  clientId: GOOGLE_CLIENT_ID,
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
