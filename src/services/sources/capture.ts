import type { ConnectedSource } from "./types";

export interface WebCapturePayload {
  version: 1;
  title: string;
  url: string;
  text: string;
  selection?: string;
  author?: string;
  capturedAt?: string;
  imageDataUrl?: string;
}

export function captureToSource(payload: WebCapturePayload): ConnectedSource {
  if (payload.version !== 1 || !payload.title?.trim() || !payload.url?.trim()) throw new Error("Invalid Zen web capture file.");
  const selected = payload.selection?.trim();
  const stable = hash(`${payload.url}\n${selected ?? ""}`);
  return {
    id: `web:${stable}`,
    provider: "web",
    kind: selected ? "selection" : "article",
    externalId: stable,
    title: payload.title.trim(),
    text: (selected || payload.text || "").trim().slice(0, 200_000),
    url: payload.url,
    authors: payload.author ? [payload.author] : undefined,
    citation: `${payload.author ? `${payload.author}. ` : ""}${payload.title}. ${payload.url}`,
    imageDataUrl: payload.imageDataUrl,
    sourceUpdatedAt: payload.capturedAt ? new Date(payload.capturedAt).getTime() : Date.now(),
    syncedAt: Date.now(),
  };
}

function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
