import { create } from "zustand";

/**
 * Cross-component PDF navigation: lets the AI tutor (and Study/Quiz panels) drive
 * the open PDF viewer to a specific page. The viewer subscribes and jumps when a
 * request targeting its pdf id arrives. `nonce` makes repeat requests to the same
 * page still fire.
 */
interface PdfNavState {
  pdfId: string | null;
  page: number;
  nonce: number;
  goTo: (pdfId: string, page: number) => void;
}

export const usePdfNav = create<PdfNavState>((set) => ({
  pdfId: null,
  page: 1,
  nonce: 0,
  goTo: (pdfId, page) =>
    set((s) => ({ pdfId, page: Math.max(1, Math.round(page) || 1), nonce: s.nonce + 1 })),
}));
