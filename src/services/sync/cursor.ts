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
function dirtyGenerationKey(collection: string): string {
  return `zen.sync.dirty-generation.${collection}`;
}

interface DirtyGenerationState {
  next: number;
  byId: Record<string, number>;
}

function readDirtyGenerations(collection: string): DirtyGenerationState {
  try {
    const raw = localStorage.getItem(dirtyGenerationKey(collection));
    if (!raw) return { next: 0, byId: {} };
    const parsed = JSON.parse(raw) as Partial<DirtyGenerationState>;
    const byId: Record<string, number> = {};
    if (parsed.byId && typeof parsed.byId === "object") {
      for (const [id, generation] of Object.entries(parsed.byId)) {
        if (Number.isSafeInteger(generation) && generation >= 0) byId[id] = generation;
      }
    }
    const next = Number.isSafeInteger(parsed.next) && Number(parsed.next) >= 0
      ? Number(parsed.next)
      : Math.max(0, ...Object.values(byId));
    return { next, byId };
  } catch {
    return { next: 0, byId: {} };
  }
}

function writeDirtyGenerations(collection: string, state: DirtyGenerationState): void {
  try {
    localStorage.setItem(dirtyGenerationKey(collection), JSON.stringify(state));
  } catch {
    /* ignore */
  }
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
  const generations = readDirtyGenerations(collection);
  generations.next += 1;
  generations.byId[id] = generations.next;
  writeDirty(collection, ids);
  writeDirtyGenerations(collection, generations);
  notifyDirty();
}

/**
 * Capture the local edit generation for each dirty id just before a push. Legacy
 * dirty arrays have no generation metadata, so their ids start at generation 0.
 */
export function snapshotDirtyGenerations(
  collection: string,
  ids: Iterable<string>,
): Map<string, number> {
  const dirty = getDirty(collection);
  const generations = readDirtyGenerations(collection);
  const snapshot = new Map<string, number>();
  for (const id of ids) {
    if (dirty.has(id)) snapshot.set(id, generations.byId[id] ?? 0);
  }
  return snapshot;
}

/** Return only ids that are still dirty at the exact generation we pushed. */
export function unchangedDirtyIds(
  collection: string,
  snapshot: ReadonlyMap<string, number>,
  ids: Iterable<string>,
): string[] {
  const dirty = getDirty(collection);
  const generations = readDirtyGenerations(collection);
  const unchanged = new Set<string>();
  for (const id of ids) {
    if (
      snapshot.has(id)
      && dirty.has(id)
      && (generations.byId[id] ?? 0) === snapshot.get(id)
    ) {
      unchanged.add(id);
    }
  }
  return [...unchanged];
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
  const generations = readDirtyGenerations(collection);
  for (const id of accepted) {
    ids.delete(id);
    delete generations.byId[id];
  }
  writeDirty(collection, ids);
  // Keep the monotonic counter so clearing and re-dirtying an id cannot reuse a
  // generation while an older request is still in flight.
  writeDirtyGenerations(collection, generations);
}

/** Reset all sync state (used on sign-out / disable). */
export function resetSyncState(collections: string[]): void {
  for (const c of collections) {
    try {
      localStorage.removeItem(cursorKey(c));
      localStorage.removeItem(dirtyKey(c));
      localStorage.removeItem(dirtyGenerationKey(c));
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
