import { create } from "zustand";

/**
 * Which PDF (if any) is open alongside the note editor as a split pane, plus the
 * split ratio. In-memory only — the split is a transient working layout, not
 * persisted state.
 */
interface NoteSplitState {
  pdfId: string | null;
  fraction: number; // editor column width as a fraction of the surface (0–1)
  open: (id: string) => void;
  close: () => void;
  setFraction: (f: number) => void;
}

export const useNoteSplit = create<NoteSplitState>((set) => ({
  pdfId: null,
  fraction: 0.5,
  open: (id) => set({ pdfId: id }),
  close: () => set({ pdfId: null }),
  setFraction: (f) => set({ fraction: Math.max(0.25, Math.min(0.75, f)) }),
}));
