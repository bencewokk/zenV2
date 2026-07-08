import type { Note } from "@/shared/lib/types";
import { localStore, type NoteStore } from "@/services/storage";

/**
 * Full local backup — everything a tester would cry about losing: notes (from
 * IndexedDB) plus all zen.* localStorage content (Deep Work sessions, quizzes,
 * memory, study log, conversations, settings, onboarding flags).
 *
 * Deliberately excluded:
 * - `zen.google.token.v1` — session auth secret; the user just signs in again.
 * - `zen.sync.*` — machine-local sync cursors; restoring them on another
 *   machine (or after remote changes) would silently skip syncing records.
 * - PDF binaries — can be hundreds of MB; PDFs re-download via sync, and the
 *   backup stays a small, mailable JSON file.
 */

export interface BackupFile {
  kind: "zen-backup";
  version: 1;
  exportedAt: string;
  appVersion: string;
  notes: Note[];
  /** Raw localStorage values by key (unparsed, round-trips exactly). */
  local: Record<string, string>;
}

const EXCLUDED_KEYS = new Set(["zen.google.token.v1"]);
const EXCLUDED_PREFIXES = ["zen.sync."];

function isBackupKey(key: string): boolean {
  if (!key.startsWith("zen.")) return false;
  if (EXCLUDED_KEYS.has(key)) return false;
  return !EXCLUDED_PREFIXES.some((p) => key.startsWith(p));
}

export async function collectBackup(appVersion: string, store: NoteStore = localStore): Promise<BackupFile> {
  const local: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isBackupKey(key)) {
      const raw = localStorage.getItem(key);
      if (raw != null) local[key] = raw;
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
    if (!Array.isArray(parsed.notes) || typeof parsed.local !== "object" || parsed.local === null) return null;
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
      localStorage.setItem(key, raw);
      keys++;
    }
  }
  return { notes, keys };
}
