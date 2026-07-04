import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { loadExternalConnectionSettings } from "@/services/connections/settings";
import { useSources } from "./store";
import type { ConnectedSource, SourceRefreshResult } from "./types";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const httpFetch: typeof fetch = IS_TAURI ? (tauriFetch as typeof fetch) : fetch;

interface ZoteroCreator { firstName?: string; lastName?: string; name?: string }
interface ZoteroItemData {
  key: string; version: number; itemType: string; title?: string; abstractNote?: string; url?: string;
  DOI?: string; date?: string; publicationTitle?: string; creators?: ZoteroCreator[]; tags?: Array<{ tag: string }>;
  collections?: string[];
  parentItem?: string; annotationText?: string; annotationComment?: string; note?: string;
  extra?: string;
}
interface ZoteroItem { key: string; version: number; data: ZoteroItemData; bib?: string }
interface ZoteroCollection { key: string; data: { key: string; name: string; parentCollection?: string } }

function root(): { url: string; key: string } {
  const settings = loadExternalConnectionSettings();
  if (!settings.zoteroLibraryId.trim() || !settings.zoteroApiKey.trim()) throw new Error("Zotero is not configured in Settings → Connections.");
  return { url: `https://api.zotero.org/${settings.zoteroLibraryType}s/${encodeURIComponent(settings.zoteroLibraryId.trim())}`, key: settings.zoteroApiKey.trim() };
}

async function get<T>(path: string): Promise<T> {
  const cfg = root();
  const response = await httpFetch(`${cfg.url}${path}`, { headers: { "Zotero-API-Key": cfg.key, "Zotero-API-Version": "3" } });
  if (!response.ok) throw new Error(`Zotero ${response.status}: ${(await response.text().catch(() => "")).slice(0, 180)}`);
  return response.json() as Promise<T>;
}

async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < 2000; start += 100) {
    const join = path.includes("?") ? "&" : "?";
    const page = await get<T[]>(`${path}${join}limit=100&start=${start}`);
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

function creatorName(creator: ZoteroCreator): string {
  return creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" ");
}

function plain(value?: string): string {
  if (!value) return "";
  return (new DOMParser().parseFromString(value, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
}

export async function testZoteroConnection(): Promise<number> {
  return (await get<ZoteroItem[]>("/items/top?limit=1")).length;
}

export async function refreshZoteroSources(): Promise<SourceRefreshResult> {
  const settings = loadExternalConnectionSettings();
  const now = Date.now();
  const collections = await all<ZoteroCollection>("/collections?sort=title");
  const selected = settings.zoteroCollectionKeys;
  const wanted = selected.length ? collections.filter((collection) => selected.includes(collection.key)) : collections;
  const records: ConnectedSource[] = wanted.map((collection) => ({
    id: `zotero:collection:${collection.key}`, provider: "zotero", kind: "collection", externalId: collection.key,
    title: collection.data.name, text: "Zotero collection", parentId: collection.data.parentCollection ? `zotero:collection:${collection.data.parentCollection}` : undefined,
    syncedAt: now,
  }));
  const collectionNames = new Map(collections.map((collection) => [collection.key, collection.data.name]));
  const itemMap = new Map<string, ZoteroItem>();
  if (selected.length) {
    for (const key of selected) for (const item of await all<ZoteroItem>(`/collections/${encodeURIComponent(key)}/items?include=data,bib`)) itemMap.set(item.key, item);
  } else {
    for (const item of await all<ZoteroItem>("/items?include=data,bib")) itemMap.set(item.key, item);
  }
  for (const item of itemMap.values()) {
    const d = item.data;
    const isAnnotation = d.itemType === "annotation" || d.itemType === "note";
    const authors = (d.creators ?? []).map(creatorName).filter(Boolean);
    const title = d.title || (isAnnotation ? plain(d.annotationText || d.note).slice(0, 90) : "Untitled Zotero item") || "Untitled Zotero item";
    const citationKey = d.extra?.match(/(?:^|\n)Citation Key:\s*(.+)/i)?.[1]?.trim() ?? "";
    records.push({
      id: `zotero:item:${d.key}`, provider: "zotero", kind: isAnnotation ? "annotation" : "paper", externalId: d.key,
      parentId: d.parentItem ? `zotero:item:${d.parentItem}` : d.collections?.[0] ? `zotero:collection:${d.collections[0]}` : undefined,
      container: d.collections?.[0] ? collectionNames.get(d.collections[0]) : undefined, title,
      text: [d.abstractNote, d.annotationText, d.annotationComment, plain(d.note)].filter(Boolean).join("\n\n"),
      url: d.url || (d.DOI ? `https://doi.org/${d.DOI}` : undefined), authors,
      citation: plain(item.bib) || `${authors.join(", ")}${d.date ? ` (${d.date})` : ""}. ${title}.${d.publicationTitle ? ` ${d.publicationTitle}.` : ""}`,
      tags: (d.tags ?? []).map((tag) => tag.tag), metadata: { itemType: d.itemType, doi: d.DOI ?? "", citationKey, version: d.version },
      syncedAt: now,
    });
  }
  await useSources.getState().replaceProvider("zotero", records);
  return { provider: "zotero", imported: records.length };
}
