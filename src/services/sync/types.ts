/**
 * Sync types. The engine is collection-agnostic: every synced record is identified
 * by `id` and ordered by `updatedAt` for last-write-wins. `deleted` records are
 * tombstones that propagate removals across devices.
 */
export interface SyncDoc {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

/** A document as exchanged with the backend: identity/timestamp + opaque payload. */
export interface WireDoc<T = unknown> {
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data?: T;
}

/**
 * Bridges one local store to the sync engine. Implementations live in
 * `adapters/` and own all knowledge of how their data is stored locally.
 */
export interface SyncAdapter {
  /** Collection name; must match the backend allowlist. */
  collection: string;
  /** Local docs changed since the last successful push. */
  listDirty(): Promise<WireDoc[]>;
  /** Merge docs pulled from the server into the local store (last-write-wins). */
  apply(remote: WireDoc[]): Promise<void>;
  /** Clear the dirty flag for ids the server accepted. */
  markPushed(ids: string[]): void;
}
