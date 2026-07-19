import type { Note } from "@/shared/lib/types";
import { localStore, type NoteStore } from "@/services/storage";
import { AI_SETTINGS_KEY } from "@/services/ai/settings";
import { GOOGLE_SETTINGS_KEY } from "@/services/google/settings";
import { CANVAS_SETTINGS_KEY } from "@/services/canvas/settings";
import { EXTERNAL_CONNECTIONS_KEY } from "@/services/connections/settings";
import {
  mergeIncomingWithLocalCredentials,
  sanitizeCredentialStorageValue,
} from "@/services/settingsCredentials";
import { markBlobDirty } from "@/services/sync/cursor";

/**
 * Portable local backup: notes (from IndexedDB) plus non-secret zen.*
 * localStorage content (Deep Work sessions, quizzes, memory, study log,
 * conversations, settings, onboarding flags).
 *
 * Deliberately excluded:
 * - Authentication and provider secrets; the user reconnects those services.
 * - `zen.sync.*` — machine-local sync cursors; restoring them on another
 *   machine (or after remote changes) would silently skip syncing records.
 * - PDF binaries and connected-source caches — they can be large and live in
 *   separate IndexedDB stores. Keep originals or use sync for PDF recovery.
 */

export interface BackupFile {
  kind: "zen-backup";
  version: 1;
  exportedAt: string;
  appVersion: string;
  notes: Note[];
  /** LocalStorage values by key; known settings objects have secrets removed. */
  local: Record<string, string>;
}

const EXCLUDED_KEYS = new Set(["zen.google.token.v1"]);
const EXCLUDED_PREFIXES = ["zen.sync."];
// Keep these non-sensitive keys local so this lightweight service does not
// import toolPolicy -> the full AI tool/runtime graph merely to name a key.
const TOOL_POLICY_KEY = "zen.ai.toolPolicy.v1";
const APPEARANCE_KEY = "zen.appearance.v1";

/** Settings-only transfer uses an explicit allowlist and the same sanitizer as
 * full backups, so neither export path can accidentally carry credentials. */
export const PORTABLE_SETTINGS_KEYS = [
  AI_SETTINGS_KEY,
  GOOGLE_SETTINGS_KEY,
  CANVAS_SETTINGS_KEY,
  EXTERNAL_CONNECTIONS_KEY,
  TOOL_POLICY_KEY,
  APPEARANCE_KEY,
] as const;

const SYNC_COLLECTION_BY_KEY = new Map<string, string>([
  [AI_SETTINGS_KEY, "aiSettings"],
  [GOOGLE_SETTINGS_KEY, "googleSettings"],
  [CANVAS_SETTINGS_KEY, "canvasSettings"],
  [EXTERNAL_CONNECTIONS_KEY, "externalConnections"],
  [TOOL_POLICY_KEY, "toolPolicy"],
  [APPEARANCE_KEY, "appearance"],
]);

function isBackupKey(key: string): boolean {
  if (!key.startsWith("zen.")) return false;
  if (EXCLUDED_KEYS.has(key)) return false;
  return !EXCLUDED_PREFIXES.some((p) => key.startsWith(p));
}

function markPortableSettingDirty(key: string): void {
  const collection = SYNC_COLLECTION_BY_KEY.get(key);
  if (collection) markBlobDirty(collection);
}

export async function collectBackup(appVersion: string, store: NoteStore = localStore): Promise<BackupFile> {
  const local: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isBackupKey(key)) {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        const safe = sanitizeCredentialStorageValue(key, raw);
        if (safe != null) local[key] = safe;
      }
    }
  }
  return {
    kind: "zen-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion,
    notes: await store.all(),
    local,
  };
}

/** Parse + validate a backup file's JSON text. Returns null if not a Zen backup. */
export function parseBackup(text: string): BackupFile | null {
  try {
    const parsed = JSON.parse(text) as Partial<BackupFile>;
    if (parsed?.kind !== "zen-backup" || parsed.version !== 1) return null;
    if (typeof parsed.exportedAt !== "string" || !Number.isFinite(Date.parse(parsed.exportedAt))) return null;
    if (typeof parsed.appVersion !== "string" || !parsed.appVersion.trim()) return null;
    if (!Array.isArray(parsed.notes) || typeof parsed.local !== "object" || parsed.local === null || Array.isArray(parsed.local)) return null;
    return parsed as BackupFile;
  } catch {
    return null;
  }
}

/**
 * Restore a backup into local state. Notes are written through the note store
 * (marking them dirty so they push to sync); localStorage keys are overwritten.
 * Existing notes not present in the backup are left alone — a restore never
 * deletes anything. Caller should reload the app afterwards.
 */
export async function applyBackup(
  backup: BackupFile,
  store: NoteStore = localStore,
): Promise<{ notes: number; keys: number }> {
  let notes = 0;
  for (const note of backup.notes) {
    if (note && typeof note.id === "string") {
      await store.put(note);
      notes++;
    }
  }
  let keys = 0;
  for (const [key, raw] of Object.entries(backup.local)) {
    if (isBackupKey(key) && typeof raw === "string") {
      const safe = sanitizeCredentialStorageValue(key, raw);
      if (safe != null) {
        localStorage.setItem(
          key,
          mergeIncomingWithLocalCredentials(key, safe, localStorage.getItem(key)),
        );
        markPortableSettingDirty(key);
        keys++;
      }
    }
  }
  return { notes, keys };
}

/** Collect the small settings-only transfer object shown in Settings. */
export function collectPortableSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PORTABLE_SETTINGS_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw == null) continue;
    const safe = sanitizeCredentialStorageValue(key, raw);
    if (safe == null) continue;
    try { out[key] = JSON.parse(safe) as unknown; }
    catch { out[key] = safe; }
  }
  return out;
}

/** Apply a parsed settings-only transfer through the same secret sanitizer used
 * by backup restore. Returns the number of recognized settings written. */
export function applyPortableSettings(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const incoming = value as Record<string, unknown>;
  let written = 0;
  for (const key of PORTABLE_SETTINGS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    let raw: string | undefined;
    try { raw = JSON.stringify(incoming[key]); }
    catch { raw = undefined; }
    if (raw == null) continue;
    const safe = sanitizeCredentialStorageValue(key, raw);
    if (safe == null) continue;
    localStorage.setItem(
      key,
      mergeIncomingWithLocalCredentials(key, safe, localStorage.getItem(key)),
    );
    markPortableSettingDirty(key);
    written++;
  }
  return written;
}
