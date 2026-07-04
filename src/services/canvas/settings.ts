import { markBlobDirty } from "@/services/sync/cursor";

export interface CanvasSettings {
  /** Institution root, e.g. https://school.instructure.com (no /api/v1 suffix). */
  baseUrl: string;
  /** Personal token for initial read-only access. Replaced by OAuth later. */
  accessToken: string;
}

const KEY = "zen.canvas.settings.v1";
export const CANVAS_SETTINGS_KEY = KEY;
export const CANVAS_SETTINGS_SECRET_FIELDS = ["accessToken"] as const;

const DEFAULTS: CanvasSettings = { baseUrl: "", accessToken: "" };

export function loadCanvasSettings(): CanvasSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore malformed local settings */
  }
  return { ...DEFAULTS };
}

export function saveCanvasSettings(settings: CanvasSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
  markBlobDirty("canvasSettings");
}

export function clearCanvasSettings(): void {
  localStorage.removeItem(KEY);
  markBlobDirty("canvasSettings");
}

export function hydrateCanvasSettings(): void {
  /* Settings are read on demand. */
}

