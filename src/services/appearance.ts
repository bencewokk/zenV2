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

export interface AppearanceSettings {
  accent: string;
  accentDim: string;
  reduceMotion: boolean;
  /** A font id from UI_FONTS. */
  uiFont: string;
}

const KEY = "zen.appearance.v1";

/** A handful of accent presets; the picker also allows any custom hex. */
export const ACCENT_PRESETS = ["#6ea8fe", "#7dd3a8", "#f0a868", "#c792ea", "#f6685e", "#4cc9c0"];

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  accent: "#6ea8fe",
  accentDim: "#3b5b8a",
  reduceMotion: false,
  uiFont: "system",
};

export function loadAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...APPEARANCE_DEFAULTS, ...(JSON.parse(raw) as Partial<AppearanceSettings>) };
  } catch { /* ignore */ }
  return { ...APPEARANCE_DEFAULTS };
}

export function saveAppearance(s: AppearanceSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
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
}
