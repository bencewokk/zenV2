import { markBlobDirty } from "@/services/sync/cursor";

/**
 * Appearance preferences — accent color, motion, and UI font. Applied by setting
 * CSS custom properties on the document root, so they flow through the existing
 * theme tokens in styles/tokens.css (--accent, --accent-dim, --font-ui).
 */

export interface FontOption {
  id: string;
  label: string;
  /** The CSS font-family stack pushed into --font-ui. */
  stack: string;
}

/** Curated, web-safe / system font stacks (no font files loaded). */
export const UI_FONTS: FontOption[] = [
  { id: "system", label: "System default", stack: "ui-sans-serif, system-ui, -apple-system, sans-serif" },
  { id: "inter", label: "Inter / Humanist", stack: "Inter, 'Segoe UI', Roboto, ui-sans-serif, system-ui, sans-serif" },
  { id: "grotesk", label: "Grotesk", stack: "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif" },
  { id: "serif", label: "Serif", stack: "Georgia, Cambria, 'Times New Roman', serif" },
  { id: "slab", label: "Slab serif", stack: "'Rockwell', 'Roboto Slab', Georgia, serif" },
  { id: "mono", label: "Monospace", stack: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace" },
];

export type AppLook = "zen" | "veil" | "orb";

export interface AppLookOption {
  id: AppLook;
  label: string;
  hint: string;
  /** Small CSS gradient used as the preview swatch in Settings. */
  swatch: string;
}

/**
 * Whole-app looks. Each retints the shell/surfaces via `data-look` on <html>
 * (see tokens.css) and swaps the ambient AI-activity background
 * (AmbientOverlay): Zen keeps the original aurora, Veil uses DarkVeil, Orb a
 * plasma orb.
 */
export const APP_LOOKS: AppLookOption[] = [
  {
    id: "zen",
    label: "Zen",
    hint: "The original look — graphite surfaces with an aurora while the AI works.",
    swatch: "linear-gradient(135deg, #17181b 0%, #1d2b45 55%, #7cff67 130%)",
  },
  {
    id: "veil",
    label: "Veil",
    hint: "Near-black violet with an ink-wash veil while the AI works.",
    swatch: "linear-gradient(135deg, #0b0a10 0%, #241a38 60%, #a78bfa 140%)",
  },
  {
    id: "orb",
    label: "Orb",
    hint: "Deep-space blue with a plasma orb while the AI works.",
    swatch: "linear-gradient(135deg, #0a0f1a 0%, #14304a 60%, #4cc9f0 140%)",
  },
];

export interface AppearanceSettings {
  accent: string;
  accentDim: string;
  reduceMotion: boolean;
  /** A font id from UI_FONTS. */
  uiFont: string;
  /** A look id from APP_LOOKS. */
  appLook: AppLook;
}

const KEY = "zen.appearance.v1";
export const APPEARANCE_KEY = KEY;

/** A handful of accent presets; the picker also allows any custom hex. */
export const ACCENT_PRESETS = ["#6ea8fe", "#7dd3a8", "#f0a868", "#c792ea", "#f6685e", "#4cc9c0"];

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  accent: "#6ea8fe",
  accentDim: "#3b5b8a",
  reduceMotion: false,
  uiFont: "system",
  appLook: "zen",
};

/** Fired on window whenever applyAppearance runs, so live UI (e.g. the
 *  ambient AI overlay) can react without a store. */
export const APPEARANCE_EVENT = "zen:appearance-applied";

export function getAppLook(): AppLook {
  const look = loadAppearance().appLook;
  return APP_LOOKS.some((l) => l.id === look) ? look : "zen";
}

export function loadAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...APPEARANCE_DEFAULTS, ...(JSON.parse(raw) as Partial<AppearanceSettings>) };
  } catch { /* ignore */ }
  return { ...APPEARANCE_DEFAULTS };
}

export function saveAppearance(s: AppearanceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    markBlobDirty("appearance");
  } catch { /* ignore */ }
}

/** Re-read persisted appearance and re-apply it live (used by sync apply). */
export function hydrateAppearance(): void {
  applyAppearance(loadAppearance());
}

/** Darken a hex color toward black by `amount` (0-1) for the derived --accent-dim. */
export function deriveAccentDim(hex: string, amount = 0.45): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return APPEARANCE_DEFAULTS.accentDim;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Push the preferences into CSS variables / root attributes. Idempotent. */
export function applyAppearance(s: AppearanceSettings = loadAppearance()): void {
  const root = document.documentElement;
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--accent-dim", s.accentDim || deriveAccentDim(s.accent));
  const font = UI_FONTS.find((f) => f.id === s.uiFont) ?? UI_FONTS[0];
  root.style.setProperty("--font-ui", font.stack);
  root.toggleAttribute("data-reduce-motion", s.reduceMotion);
  const look = APP_LOOKS.some((l) => l.id === s.appLook) ? s.appLook : "zen";
  if (look === "zen") root.removeAttribute("data-look");
  else root.setAttribute("data-look", look);
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: s }));
}
