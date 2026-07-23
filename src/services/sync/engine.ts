import { useStatus } from "@/shared/stores/status";
import { isSignedIn, onAuthChange } from "@/services/google/auth";
import { loadSyncSettings } from "./settings";
import { pull, push } from "./client";
import {
  getCursor,
  getDirty,
  setCursor,
  onDirty,
  resetSyncState,
  snapshotDirtyGenerations,
  unchangedDirtyIds,
} from "./cursor";
import { notesAdapter } from "./adapters/notes";
import { pdfsAdapter } from "./adapters/pdfs";
import { assistantCapturesAdapter } from "./adapters/assistantCaptures";
import { assistantTasksAdapter } from "./adapters/assistantTasks";
import { assistantRoutinesAdapter } from "@/services/assistantRoutines";
import { assistantReceiptsAdapter } from "@/services/assistantReceipts";
import { makeBlobAdapter } from "./adapters/blob";
import { makeFilteredBlobAdapter } from "./adapters/filteredBlob";
import { WORKSPACE_KEY, hydrateWorkspace } from "@/shared/stores/workspace";
import { ROUTE_KEY, hydrateRoute } from "@/shared/stores/route";
import { STUDYLOG_KEY, hydrateStudyLog } from "@/features/home/deepwork/studyLog";
import { DEEPWORK_KEY, hydrateDeepWork } from "@/features/home/deepwork/deepworkStore";
import { COURSES_KEY, hydrateCourses } from "@/features/home/deepwork/courseStore";
import { QUIZ_KEY, hydrateQuiz } from "@/features/home/deepwork/quizStore";
import { AI_CONV_KEY, hydrateAI } from "@/features/ai/store";
import { PROFILE_KEY, hydrateProfile } from "@/services/memory/profile";
import { MEMORY_ENTRIES_KEY, hydrateMemories } from "@/services/memory/store";
import { APPEARANCE_KEY, hydrateAppearance } from "@/services/appearance";
import { TOOL_POLICY_KEY, hydrateToolPolicy } from "@/services/ai/toolPolicy";
import { AI_SETTINGS_KEY, AI_SETTINGS_SECRET_FIELDS, hydrateAiSettings } from "@/services/ai/settings";
import { GOOGLE_SETTINGS_KEY, GOOGLE_SETTINGS_SECRET_FIELDS, hydrateGoogleSettings } from "@/services/google/settings";
import { CANVAS_SETTINGS_KEY, CANVAS_SETTINGS_SECRET_FIELDS, hydrateCanvasSettings } from "@/services/canvas/settings";
import { EXTERNAL_CONNECTIONS_KEY, EXTERNAL_CONNECTIONS_SECRET_FIELDS, hydrateExternalConnectionSettings } from "@/services/connections/settings";
import type { SyncAdapter, WireDoc } from "./types";

/** Registered adapters. Notes sync per-record; the rest are singleton blobs (Part 4). */
const adapters: SyncAdapter[] = [
  notesAdapter,
  pdfsAdapter,
  assistantCapturesAdapter,
  assistantTasksAdapter,
  assistantRoutinesAdapter,
  assistantReceiptsAdapter,
  makeBlobAdapter("workspace", WORKSPACE_KEY, hydrateWorkspace),
  makeBlobAdapter("route", ROUTE_KEY, hydrateRoute),
  makeBlobAdapter("studylog", STUDYLOG_KEY, hydrateStudyLog),
  makeBlobAdapter("deepwork", DEEPWORK_KEY, hydrateDeepWork),
  makeBlobAdapter("courses", COURSES_KEY, hydrateCourses),
  makeBlobAdapter("quiz", QUIZ_KEY, hydrateQuiz),
  makeBlobAdapter("ai", AI_CONV_KEY, hydrateAI),
  makeBlobAdapter("memoryProfile", PROFILE_KEY, hydrateProfile),
  makeBlobAdapter("memoryEntries", MEMORY_ENTRIES_KEY, hydrateMemories),
  makeBlobAdapter("appearance", APPEARANCE_KEY, hydrateAppearance),
  makeBlobAdapter("toolPolicy", TOOL_POLICY_KEY, hydrateToolPolicy),
  makeFilteredBlobAdapter("aiSettings", AI_SETTINGS_KEY, hydrateAiSettings, [...AI_SETTINGS_SECRET_FIELDS]),
  makeFilteredBlobAdapter("googleSettings", GOOGLE_SETTINGS_KEY, hydrateGoogleSettings, [...GOOGLE_SETTINGS_SECRET_FIELDS]),
  makeFilteredBlobAdapter("canvasSettings", CANVAS_SETTINGS_KEY, hydrateCanvasSettings, [...CANVAS_SETTINGS_SECRET_FIELDS]),
  makeFilteredBlobAdapter("externalConnections", EXTERNAL_CONNECTIONS_KEY, hydrateExternalConnectionSettings, [...EXTERNAL_CONNECTIONS_SECRET_FIELDS]),
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
async function syncAdapter(a: SyncAdapter, onError: (e: unknown) => void): Promise<boolean> {
  try {
    // Pull and drain pages, but hold back records that still have local edits.
    // Persisting the cursor waits until those conflicts are resolved so any
    // failed pass can safely replay the same server changes.
    let pulledCursor = getCursor(a.collection);
    const deferred = new Map<string, WireDoc>();
    for (;;) {
      const res = await pull(a.collection, pulledCursor);
      const dirtyNow = getDirty(a.collection);
      const ready: WireDoc[] = [];
      for (const doc of res.docs) {
        if (dirtyNow.has(doc.id)) deferred.set(doc.id, doc);
        else ready.push(doc);
      }
      if (ready.length) {
        await a.apply(ready);
        // An edit can begin while an IndexedDB adapter is awaiting storage. The
        // adapter leaves that id untouched; move its pulled copy into the same
        // deferred path used for ids that were already dirty at classification.
        const dirtyAfterApply = getDirty(a.collection);
        for (const doc of ready) {
          if (dirtyAfterApply.has(doc.id)) deferred.set(doc.id, doc);
        }
      }
      pulledCursor = res.cursor;
      if (!res.hasMore) break;
    }

    // Snapshot before listDirty(): materializing a document may await storage or
    // a PDF upload, and an edit during that work must survive this sync pass.
    const generations = snapshotDirtyGenerations(a.collection, getDirty(a.collection));
    const dirty = await a.listDirty();
    const clearCandidates = new Set<string>();
    const winnerDocs = new Map<string, WireDoc>();
    const deferredThatMustStayUnchanged = new Set<string>();
    let canCommitPullCursor = true;
    let resetPullCursor = false;

    if (dirty.length) {
      const pushedIds = new Set(dirty.map((doc) => doc.id));
      const res = await push(a.collection, dirty);
      const accepted = new Set(res.accepted.filter((id) => pushedIds.has(id)));
      const rejected = new Set(res.rejected.filter((id) => pushedIds.has(id)));
      const unchangedAfterPush = new Set(
        unchangedDirtyIds(a.collection, generations, pushedIds),
      );
      const conflicts = new Map<string, WireDoc>();
      for (const doc of res.conflicts ?? []) {
        if (rejected.has(doc.id)) conflicts.set(doc.id, doc);
      }

      // Accepted local candidates are now authoritative, so any older pulled
      // version for the same id can be discarded even if another edit followed.
      for (const id of accepted) {
        clearCandidates.add(id);
        deferred.delete(id);
      }

      for (const id of rejected) {
        const deferredWinner = deferred.get(id);
        deferred.delete(id);
        const conflict = conflicts.get(id);

        if (!unchangedAfterPush.has(id)) {
          // Never apply a server winner over an edit made during materialization
          // or the request. Replaying a deferred pull on the next pass is safe.
          if (deferredWinner) canCommitPullCursor = false;
          if (!conflict && !deferredWinner) resetPullCursor = true;
          continue;
        }

        const winner = conflict ?? deferredWinner;
        if (winner) {
          winnerDocs.set(id, winner);
          clearCandidates.add(id);
          if (deferredWinner) deferredThatMustStayUnchanged.add(id);
        } else {
          // Older servers do not return conflict documents. Rewind so a winner
          // whose serverSeq is behind our cursor is pulled on the next pass.
          resetPullCursor = true;
        }
      }

      // A malformed/older response that omits an outcome cannot resolve a
      // deferred pull. Leave the cursor untouched so it replays.
      for (const id of pushedIds) {
        if (!accepted.has(id) && !rejected.has(id) && deferred.delete(id)) {
          canCommitPullCursor = false;
        }
      }
    }

    // A dirty marker can occasionally outlive its materialized record. If there
    // is a pulled server copy and no POST candidate, it is the only usable value.
    const dirtyAfterPush = getDirty(a.collection);
    const unchangedDeferred = new Set(
      unchangedDirtyIds(a.collection, generations, deferred.keys()),
    );
    for (const [id, doc] of deferred) {
      if (!dirtyAfterPush.has(id)) {
        winnerDocs.set(id, doc);
      } else if (unchangedDeferred.has(id)) {
        winnerDocs.set(id, doc);
        clearCandidates.add(id);
        deferredThatMustStayUnchanged.add(id);
      } else {
        canCommitPullCursor = false;
      }
    }

    if (winnerDocs.size) {
      await a.apply([...winnerDocs.values()], {
        canApplyDirty: (id) => (
          unchangedDirtyIds(a.collection, generations, [id]).length === 1
        ),
      });
    }

    const resolvedIds = unchangedDirtyIds(a.collection, generations, clearCandidates);
    if (resolvedIds.length) a.markPushed(resolvedIds);
    const resolved = new Set(resolvedIds);
    for (const id of deferredThatMustStayUnchanged) {
      if (!resolved.has(id) && getDirty(a.collection).has(id)) canCommitPullCursor = false;
    }

    if (resetPullCursor) setCursor(a.collection, 0);
    else if (canCommitPullCursor) setCursor(a.collection, pulledCursor);
    return true;
  } catch (e) {
    console.warn(`[sync] ${a.collection} failed`, e);
    onError(e);
    return false;
  }
}

/**
 * Run a full sync pass across all adapters; drives the status badge. Throws with
 * a user-facing message on failure or when sync can't run yet, so callers (e.g.
 * the Settings "Sync now" button) can show an accurate success/error toast
 * instead of always reporting success.
 */
export async function syncOnce(): Promise<void> {
  if (running) throw new Error("A sync is already in progress.");
  if (!canSync()) {
    throw new Error(
      !loadSyncSettings().baseUrl.trim()
        ? "Set the Sync API URL first."
        : !isSignedIn()
          ? "Connect Google first to sync."
          : "Sync is turned off.",
    );
  }
  running = true;
  useStatus.getState().set({ sync: "connecting" });
  let ok = true;
  let firstError: unknown = null;
  try {
    for (const a of adapters) {
      if (!(await syncAdapter(a, (e) => (firstError ??= e)))) ok = false;
    }
  } finally {
    running = false;
    useStatus.getState().set({ sync: ok ? "on" : "error" });
  }
  if (!ok) {
    const reason = firstError instanceof Error ? firstError.message : String(firstError ?? "");
    throw new Error(reason ? `Sync failed: ${reason}` : "Sync failed.");
  }
}

/** Fire-and-forget sync for internal triggers (poll, dirty-debounce, auth change) —
 *  errors are already reflected in the status badge, so just keep them out of the console. */
function syncOnceQuiet(): void {
  void syncOnce().catch(() => {});
}

function schedulePush(): void {
  if (pushTimer !== null) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    syncOnceQuiet();
  }, PUSH_DEBOUNCE_MS);
}

/** Start background sync: initial pass, debounced push on local change, periodic poll. */
export function startSync(): void {
  if (started) return;
  started = true;

  unsubDirty = onDirty(schedulePush);
  unsubAuth = onAuthChange(() => {
    if (canSync()) syncOnceQuiet();
    else useStatus.getState().set({ sync: "off" });
  });

  pollTimer = window.setInterval(syncOnceQuiet, POLL_MS);

  if (canSync()) syncOnceQuiet();
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
