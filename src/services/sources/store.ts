import { create } from "zustand";
import type { ConnectedSource, SourceProvider } from "./types";

const DB_NAME = "zen-sources";
const STORE = "sources";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        const store = req.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("provider", "provider", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function allRecords(): Promise<ConnectedSource[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as ConnectedSource[]);
    req.onerror = () => reject(req.error);
  });
}

async function putRecords(records: ConnectedSource[]): Promise<void> {
  if (!records.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const record of records) store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function deleteRecord(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

interface SourceState {
  sources: Record<string, ConnectedSource>;
  loaded: boolean;
  selectedId: string | null;
  load: () => Promise<void>;
  upsertMany: (records: ConnectedSource[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearProvider: (provider: SourceProvider) => Promise<void>;
  replaceProvider: (provider: SourceProvider, records: ConnectedSource[]) => Promise<void>;
  select: (id: string | null) => void;
}

export const useSources = create<SourceState>((set, get) => ({
  sources: {},
  loaded: false,
  selectedId: null,
  async load() {
    const records = await allRecords();
    set({ sources: Object.fromEntries(records.map((record) => [record.id, record])), loaded: true });
  },
  async upsertMany(records) {
    await putRecords(records);
    set((state) => {
      const sources = { ...state.sources };
      for (const record of records) sources[record.id] = record;
      return { sources };
    });
  },
  async remove(id) {
    await deleteRecord(id);
    set((state) => {
      const sources = { ...state.sources };
      delete sources[id];
      return { sources };
    });
  },
  async clearProvider(provider) {
    const records = Object.values(get().sources).filter((source) => source.provider === provider);
    for (const record of records) await deleteRecord(record.id);
    set((state) => ({ sources: Object.fromEntries(Object.entries(state.sources).filter(([, source]) => source.provider !== provider)) }));
  },
  async replaceProvider(provider, records) {
    const keep = new Set(records.map((record) => record.id));
    const stale = Object.values(get().sources).filter((source) => source.provider === provider && !keep.has(source.id));
    for (const source of stale) await deleteRecord(source.id);
    await putRecords(records);
    set((state) => {
      const sources = Object.fromEntries(Object.entries(state.sources).filter(([, source]) => source.provider !== provider));
      for (const record of records) sources[record.id] = record;
      return { sources };
    });
  },
  select(id) { set({ selectedId: id }); },
}));

export function searchConnectedSources(query: string, limit = 12): ConnectedSource[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1);
  const sources = Object.values(useSources.getState().sources);
  if (!terms.length) return sources.sort((a, b) => b.syncedAt - a.syncedAt).slice(0, limit);
  return sources.map((source) => {
    const title = source.title.toLowerCase();
    const body = `${source.container ?? ""} ${(source.authors ?? []).join(" ")} ${source.citation ?? ""} ${source.text} ${(source.tags ?? []).join(" ")}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 4;
      if (body.includes(term)) score += 1;
    }
    return { source, score };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.source.sourceUpdatedAt ?? b.source.syncedAt) - (a.source.sourceUpdatedAt ?? a.source.syncedAt))
    .slice(0, limit)
    .map((item) => item.source);
}

export async function ensureSourcesLoaded(): Promise<void> {
  if (!useSources.getState().loaded) await useSources.getState().load();
}
