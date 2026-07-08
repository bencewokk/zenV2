import { markBlobDirty } from "@/services/sync/cursor";

/**
 * Appearance preferences — app look, motion, and UI font. Applied by setting
 * CSS custom properties / attributes on the document root, so they flow through
 * the theme tokens in styles/tokens.css. The accent color is owned by the look
 * (per data-look token overrides in tokens.css), not chosen separately.
 */

export interface FontOption {
  id: string;
  label: string;
  /** One-line vibe shown under the label in Settings. */
  hint: string;
  /** The CSS font-family stack pushed into --font-ui. */
  stack: string;
}

/** Curated UI fonts. All non-system faces are bundled via @fontsource imports
 *  in main.tsx (variable weights where available), so they work offline. */
export const UI_FONTS: FontOption[] = [
  { id: "system", label: "System default", hint: "Whatever your OS uses — zero surprises.", stack: "ui-sans-serif, system-ui, -apple-system, sans-serif" },
  { id: "inter", label: "Inter", hint: "Clean default — modern, safe.", stack: "'Inter Variable', 'Segoe UI', Roboto, ui-sans-serif, system-ui, sans-serif" },
  { id: "geist", label: "Geist", hint: "Sharper, more technical, premium.", stack: "'Geist Variable', 'Segoe UI', ui-sans-serif, system-ui, sans-serif" },
  { id: "plex", label: "IBM Plex Sans", hint: "Serious, academic, slightly nerdy.", stack: "'IBM Plex Sans Variable', 'Segoe UI', ui-sans-serif, system-ui, sans-serif" },
  { id: "literata", label: "Literata", hint: "Book-like — great for long notes.", stack: "'Literata Variable', Georgia, Cambria, serif" },
  { id: "newsreader", label: "Newsreader", hint: "Elegant, essay / humanities feel.", stack: "'Newsreader Variable', Georgia, 'Times New Roman', serif" },
  { id: "atkinson", label: "Atkinson Hyperlegible", hint: "Very readable, accessibility-friendly.", stack: "'Atkinson Hyperlegible', 'Segoe UI', ui-sans-serif, system-ui, sans-serif" },
  { id: "jetbrains", label: "JetBrains Mono", hint: "Code / math / terminal vibe.", stack: "'JetBrains Mono Variable', ui-monospace, 'Cascadia Mono', Consolas, monospace" },
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
  reduceMotion: boolean;
  /** A font id from UI_FONTS. */
  uiFont: string;
  /** A look id from APP_LOOKS. */
  appLook: AppLook;
}

const KEY = "zen.appearance.v1";
export const APPEARANCE_KEY = KEY;

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
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

/** Push the preferences into CSS variables / root attributes. Idempotent. */
export function applyAppearance(s: AppearanceSettings = loadAppearance()): void {
  const root = document.documentElement;
  // Accent used to be a user setting pushed as an inline style; clear any
  // leftover so the per-look token overrides in tokens.css always win.
  root.style.removeProperty("--accent");
  root.style.removeProperty("--accent-dim");
  const font = UI_FONTS.find((f) => f.id === s.uiFont) ?? UI_FONTS[0];
  root.style.setProperty("--font-ui", font.stack);
  root.toggleAttribute("data-reduce-motion", s.reduceMotion);
  const look = APP_LOOKS.some((l) => l.id === s.appLook) ? s.appLook : "zen";
  if (look === "zen") root.removeAttribute("data-look");
  else root.setAttribute("data-look", look);
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: s }));
}
