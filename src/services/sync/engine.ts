import { useStatus } from "@/shared/stores/status";
import { isSignedIn, onAuthChange } from "@/services/google/auth";
import { loadSyncSettings } from "./settings";
import { pull, push } from "./client";
import { getCursor, setCursor, onDirty, resetSyncState } from "./cursor";
import { notesAdapter } from "./adapters/notes";
import { pdfsAdapter } from "./adapters/pdfs";
import { makeBlobAdapter } from "./adapters/blob";
import { WORKSPACE_KEY, hydrateWorkspace } from "@/shared/stores/workspace";
import { STUDYLOG_KEY, hydrateStudyLog } from "@/features/home/deepwork/studyLog";
import { DEEPWORK_KEY, hydrateDeepWork } from "@/features/home/deepwork/deepworkStore";
import { AI_CONV_KEY, hydrateAI } from "@/features/ai/store";
import type { SyncAdapter } from "./types";

/** Registered adapters. Notes sync per-record; the rest are singleton blobs (Part 4). */
const adapters: SyncAdapter[] = [
  notesAdapter,
  pdfsAdapter,
  makeBlobAdapter("workspace", WORKSPACE_KEY, hydrateWorkspace),
  makeBlobAdapter("studylog", STUDYLOG_KEY, hydrateStudyLog),
  makeBlobAdapter("deepwork", DEEPWORK_KEY, hydrateDeepWork),
  makeBlobAdapter("ai", AI_CONV_KEY, hydrateAI),
];

const POLL_MS = 30_000;
const PUSH_DEBOUNCE_MS = 1_500;

let started = false;
let pollTimer: number | null = null;
let pushTimer: number | null = null;
let running = false;
let unsubDirty: (() => void) | null = null;
let unsubAuth: (() => void) | null = null;

function canSync(): boolean {
  const s = loadSyncSettings();
  return s.enabled && !!s.baseUrl.trim() && isSignedIn();
}

/** Pull then push one adapter, advancing its cursor. Returns false on failure. */
async function syncAdapter(a: SyncAdapter): Promise<boolean> {
  try {
    // Pull (drain pages) so inbound changes land before we push ours.
    let cursor = getCursor(a.collection);
    for (;;) {
      const res = await pull(a.collection, cursor);
      if (res.docs.length) await a.apply(res.docs);
      cursor = res.cursor;
      setCursor(a.collection, cursor);
      if (!res.hasMore) break;
    }
    // Push local changes.
    const dirty = await a.listDirty();
    if (dirty.length) {
      const res = await push(a.collection, dirty);
      a.markPushed([...res.accepted, ...res.rejected]); // rejected = server already newer
      if (res.cursor > getCursor(a.collection)) setCursor(a.collection, res.cursor);
    }
    return true;
  } catch (e) {
    console.warn(`[sync] ${a.collection} failed`, e);
    return false;
  }
}

/** Run a full sync pass across all adapters; drives the status badge. */
export async function syncOnce(): Promise<void> {
  if (running || !canSync()) return;
  running = true;
  useStatus.getState().set({ sync: "connecting" });
  let ok = true;
  try {
    for (const a of adapters) {
      if (!(await syncAdapter(a))) ok = false;
    }
  } finally {
    running = false;
    useStatus.getState().set({ sync: ok ? "on" : "error" });
  }
}

function schedulePush(): void {
  if (pushTimer !== null) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void syncOnce();
  }, PUSH_DEBOUNCE_MS);
}

/** Start background sync: initial pass, debounced push on local change, periodic poll. */
export function startSync(): void {
  if (started) return;
  started = true;

  unsubDirty = onDirty(schedulePush);
  unsubAuth = onAuthChange(() => {
    if (canSync()) void syncOnce();
    else useStatus.getState().set({ sync: "off" });
  });

  pollTimer = window.setInterval(() => void syncOnce(), POLL_MS);

  if (canSync()) void syncOnce();
  else useStatus.getState().set({ sync: "off" });
}

export function stopSync(): void {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  if (pushTimer !== null) window.clearTimeout(pushTimer);
  pollTimer = pushTimer = null;
  unsubDirty?.();
  unsubAuth?.();
  unsubDirty = unsubAuth = null;
  started = false;
}

/** Forget all sync cursors/dirty state (sign-out or disable). */
export function clearSyncState(): void {
  resetSyncState(adapters.map((a) => a.collection));
  useStatus.getState().set({ sync: "off" });
}
