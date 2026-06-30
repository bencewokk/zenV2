/**
 * Per-collection sync bookkeeping in localStorage: the server high-water cursor
 * (`serverSeq` of the last pulled doc) and the set of locally-dirty ids awaiting
 * push. Kept tiny and synchronous so adapters can mark dirty from hot paths.
 */
function cursorKey(collection: string): string {
  return `zen.sync.cursor.${collection}`;
}
function dirtyKey(collection: string): string {
  return `zen.sync.dirty.${collection}`;
}

export function getCursor(collection: string): number {
  try {
    return Number(localStorage.getItem(cursorKey(collection))) || 0;
  } catch {
    return 0;
  }
}

export function setCursor(collection: string, value: number): void {
  try {
    localStorage.setItem(cursorKey(collection), String(value));
  } catch {
    /* ignore */
  }
}

export function getDirty(collection: string): Set<string> {
  try {
    const raw = localStorage.getItem(dirtyKey(collection));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDirty(collection: string, ids: Set<string>): void {
  try {
    localStorage.setItem(dirtyKey(collection), JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/** Mark one id dirty for a collection. Called from store mutation paths. */
export function markDirty(collection: string, id: string): void {
  const ids = getDirty(collection);
  ids.add(id);
  writeDirty(collection, ids);
  notifyDirty();
}

// ── Singleton-blob collections ──────────────────────────────────────────────
// Some stores persist as one localStorage blob with no per-record id/updatedAt.
// They sync as a single document keyed by the collection name, with a blob-level
// timestamp bumped on each local change.
const BLOB_ID = "_blob";

function blobTsKey(collection: string): string {
  return `zen.sync.blobts.${collection}`;
}

export function getBlobTs(collection: string): number {
  try {
    return Number(localStorage.getItem(blobTsKey(collection))) || 0;
  } catch {
    return 0;
  }
}

export function setBlobTs(collection: string, at: number): void {
  try {
    localStorage.setItem(blobTsKey(collection), String(at));
  } catch {
    /* ignore */
  }
}

export const BLOB_DOC_ID = BLOB_ID;

/** Mark a singleton-blob collection dirty, bumping its timestamp to now. */
export function markBlobDirty(collection: string): void {
  setBlobTs(collection, Date.now());
  markDirty(collection, BLOB_ID);
}

/** Clear ids the server has accepted. */
export function clearDirty(collection: string, accepted: string[]): void {
  if (accepted.length === 0) return;
  const ids = getDirty(collection);
  for (const id of accepted) ids.delete(id);
  writeDirty(collection, ids);
}

/** Reset all sync state (used on sign-out / disable). */
export function resetSyncState(collections: string[]): void {
  for (const c of collections) {
    try {
      localStorage.removeItem(cursorKey(c));
      localStorage.removeItem(dirtyKey(c));
    } catch {
      /* ignore */
    }
  }
}

// A lightweight signal so the engine can debounce a push when something goes dirty.
const dirtyListeners = new Set<() => void>();
export function onDirty(fn: () => void): () => void {
  dirtyListeners.add(fn);
  return () => dirtyListeners.delete(fn);
}
function notifyDirty(): void {
  dirtyListeners.forEach((l) => l());
}
