import { markBlobDirty } from "@/services/sync/cursor";

export interface ExternalConnectionSettings {
  driveFolderIds: string[];
  zoteroLibraryType: "user" | "group";
  zoteroLibraryId: string;
  zoteroApiKey: string;
  zoteroCollectionKeys: string[];
  githubToken: string;
  githubRepositories: string[];
  githubExcludePatterns: string[];
}

const KEY = "zen.externalConnections.v1";
export const EXTERNAL_CONNECTIONS_KEY = KEY;
export const EXTERNAL_CONNECTIONS_SECRET_FIELDS = ["zoteroApiKey", "githubToken"] as const;

const DEFAULTS: ExternalConnectionSettings = {
  driveFolderIds: [],
  zoteroLibraryType: "user",
  zoteroLibraryId: "",
  zoteroApiKey: "",
  zoteroCollectionKeys: [],
  githubToken: "",
  githubRepositories: [],
  githubExcludePatterns: ["node_modules/", "vendor/", "dist/", "build/", "target/", "coverage/", ".min.", "package-lock.json", "Cargo.lock"],
};

export function loadExternalConnectionSettings(): ExternalConnectionSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function saveExternalConnectionSettings(settings: ExternalConnectionSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
  markBlobDirty("externalConnections");
}

export function hydrateExternalConnectionSettings(): void {
  /* read on demand */
}

export function splitConnectionList(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];
}

export function driveFolderId(value: string): string {
  const match = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? value.trim();
}
