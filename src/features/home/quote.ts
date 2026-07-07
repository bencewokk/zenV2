import { create } from "zustand";
import { useAI } from "@/features/ai/store";
import { useAiAccess } from "@/features/ai/access";

/**
 * Daily dashboard quote. The AI generates one quote per day, choosing the category that
 * best keeps the running distribution on these target ratios. Per-category counts are
 * tracked so the mix converges to the targets over time.
 */

export type QuoteCategory = "humor" | "philosophy" | "science" | "literature";

export const QUOTE_CATEGORIES: { key: QuoteCategory; label: string; ratio: number; prompt: string }[] = [
  { key: "humor", label: "Humor & Wit", ratio: 0.45, prompt: "humor and wit" },
  { key: "philosophy", label: "Philosophy", ratio: 0.20, prompt: "philosophy" },
  { key: "science", label: "Science & Technology", ratio: 0.20, prompt: "science or technology" },
  { key: "literature", label: "Literature & Poetry", ratio: 0.15, prompt: "literature or poetry" },
];

type Counts = Record<QuoteCategory, number>;

const ZERO_COUNTS: Counts = { humor: 0, philosophy: 0, science: 0, literature: 0 };

/** The category whose share is furthest below its target — keeps the mix on the ratios. */
export function pickCategory(counts: Counts): QuoteCategory {
  const total = QUOTE_CATEGORIES.reduce((sum, c) => sum + (counts[c.key] || 0), 0);
  let best = QUOTE_CATEGORIES[0];
  let bestDeficit = -Infinity;
  for (const c of QUOTE_CATEGORIES) {
    // Target count after adding one more quote; the largest deficit wins.
    const deficit = c.ratio * (total + 1) - (counts[c.key] || 0);
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = c;
    }
  }
  return best.key;
}

const FALLBACKS: Record<QuoteCategory, { quote: string; author: string }[]> = {
  humor: [
    { quote: "I can resist everything except temptation.", author: "Oscar Wilde" },
    { quote: "The trouble with having an open mind is that people keep coming along and putting things in it.", author: "Terry Pratchett" },
    { quote: "I am so clever that sometimes I don't understand a single word of what I am saying.", author: "Oscar Wilde" },
  ],
  philosophy: [
    { quote: "The unexamined life is not worth living.", author: "Socrates" },
    { quote: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
  ],
  science: [
    { quote: "The good thing about science is that it's true whether or not you believe in it.", author: "Neil deGrasse Tyson" },
    { quote: "Somewhere, something incredible is waiting to be known.", author: "Carl Sagan" },
  ],
  literature: [
    { quote: "Not all those who wander are lost.", author: "J.R.R. Tolkien" },
    { quote: "It is our choices that show what we truly are, far more than our abilities.", author: "J.K. Rowling" },
  ],
};

export interface Quote {
  text: string;
  author: string;
  category: QuoteCategory;
}

interface PersistedQuote {
  current: Quote | null;
  dayKey: string | null;
  counts: Counts;
}

const KEY = "zen.home.quote.v1";

function localDayKey(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function read(): PersistedQuote {
  const empty: PersistedQuote = { current: null, dayKey: null, counts: { ...ZERO_COUNTS } };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PersistedQuote>;
      return { current: p.current ?? null, dayKey: p.dayKey ?? null, counts: { ...ZERO_COUNTS, ...(p.counts ?? {}) } };
    }
  } catch {
    /* ignore */
  }
  return empty;
}

/** Pull a clean {quote, author} out of the model's reply, tolerating fences/prose. */
function parseQuote(raw: string): { quote: string; author: string } | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]) as { quote?: unknown; author?: unknown };
    const quote = typeof obj.quote === "string" ? obj.quote.trim() : "";
    const author = typeof obj.author === "string" ? obj.author.trim() : "";
    if (!quote) return null;
    return { quote, author: author || "Unknown" };
  } catch {
    return null;
  }
}

interface QuoteState extends PersistedQuote {
  loading: boolean;
  refresh: (force?: boolean) => Promise<void>;
}

export const useQuote = create<QuoteState>((set, get) => {
  const initial = read();

  function persist(next: PersistedQuote) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  return {
    ...initial,
    loading: false,

    async refresh(force = false) {
      const state = get();
      if (state.loading) return;
      const dayKey = localDayKey();
      if (!force && state.current && state.dayKey === dayKey) return;

      const category = pickCategory(state.counts);
      const meta = QUOTE_CATEGORIES.find((c) => c.key === category)!;

      set({ loading: true });
      // The quote is decorative — only spend an AI call when access is confirmed.
      // Anything else (signed out, free tier, still checking) falls back silently
      // instead of surfacing an error toast on every app open.
      const out =
        useAiAccess.getState().access === "ready"
          ? await useAI.getState().complete(
              `Give me one short, real, attributable quote about ${meta.prompt}. ` +
                `Return ONLY JSON: {"quote": "...", "author": "..."}. Keep it under 30 words. No markdown.`,
              meta.label
            )
          : null;
      const parsed = parseQuote(out ?? "");
      const fallbacks = FALLBACKS[category];
      const pick = parsed ?? fallbacks[(state.counts[category] || 0) % fallbacks.length];

      const counts: Counts = { ...state.counts, [category]: (state.counts[category] || 0) + 1 };
      const current: Quote = { text: pick.quote, author: pick.author, category };
      const next: PersistedQuote = { current, dayKey, counts };
      set({ ...next, loading: false });
      persist(next);
    },
  };
});
