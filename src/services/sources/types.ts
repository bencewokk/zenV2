export type SourceProvider = "canvas" | "drive" | "zotero" | "github" | "web";
export type SourceKind =
  | "course" | "assignment" | "module" | "announcement" | "file"
  | "collection" | "paper" | "annotation" | "repository" | "issue" | "pull_request"
  | "article" | "selection";

export interface ConnectedSource {
  /** Stable provider-qualified id, e.g. canvas:assignment:42:91. */
  id: string;
  provider: SourceProvider;
  kind: SourceKind;
  externalId: string;
  title: string;
  text: string;
  url?: string;
  parentId?: string;
  container?: string;
  authors?: string[];
  citation?: string;
  imageDataUrl?: string;
  tags?: string[];
  metadata?: Record<string, string | number | boolean | null>;
  sourceUpdatedAt?: number;
  syncedAt: number;
}

export interface SourceRefreshResult {
  provider: SourceProvider;
  imported: number;
  skipped?: number;
  message?: string;
}
