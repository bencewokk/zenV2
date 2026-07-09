import { useWorkspace } from "@/shared/stores/workspace";
import { useHome } from "@/features/home/store";
import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";
import { useCommandPalette } from "@/features/search/CommandPalette";
import { docToText } from "@/shared/lib/docText";
import { useTour, type TourStep } from "./tourStore";

/** Put the app on the plain home dashboard so the tour's tile anchors exist. */
function goDashboard() {
  useNotes.getState().select(null);
  useHome.getState().setManualDeepWork(false);
  useWorkspace.getState().set({ surface: "home", adminMailId: null });
}

/**
 * The core study loop: capture → find → study → bring in material. Every anchor
 * lives on the home dashboard's bento grid (plus lands the user there first),
 * so the whole tour runs on one screen without cross-surface navigation.
 */
export const CORE_LOOP_TOUR: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Zen",
    body: "Take a quick lap of the core loop — capture, find, and study. You can skip anytime with Esc.",
    beforeShow: goDashboard,
  },
  {
    id: "new-note",
    title: "Capture a note",
    body: "Start here to create a note. Anything you write saves automatically — no save button.",
    anchor: '[data-tour="new-note"]',
    beforeShow: goDashboard,
  },
  {
    id: "search",
    title: "Find anything",
    body: "Search jumps to any note, source, or command. From anywhere in the app, just press Ctrl / ⌘ + K.",
    anchor: '[data-tour="search"]',
  },
  {
    id: "deep-work",
    title: "Study in Deep Work",
    body: "Deep Work pulls notes, PDFs, calendar events, and mail into one focused study workspace with a backbone and quizzes.",
    anchor: '[data-tour="deep-work"]',
  },
  {
    id: "sources",
    title: "Bring in your material",
    body: "Connect Canvas, Google Drive, Zotero, GitHub, or the web so Zen studies with your real course material.",
    anchor: '[data-tour="sources"]',
  },
  {
    id: "done",
    title: "That's the loop",
    body: "Capture → find → study. You can replay this walkthrough anytime from Settings → Appearance.",
  },
];

/** Start the core-loop walkthrough. */
export function startCoreLoopTour() {
  useTour.getState().start(CORE_LOOP_TOUR);
}

/**
 * Per-group walkthroughs for the First Run Path. Each is an action-driven tour
 * that makes the user actually do the group's checklist items, auto-advancing
 * as each task completes. Keyed by the tutorial group's `key`.
 */
export const GROUP_TOURS: Record<string, TourStep[]> = {
  material: [
    {
      id: "m-intro",
      title: "Collect material",
      body: "Let's get real material into Zen: a note, a PDF, and a quick search. Follow the highlights.",
      beforeShow: goDashboard,
    },
    {
      id: "m-note",
      title: "Create a note",
      body: "Click New note. It creates a note and drops you straight into the editor.",
      anchor: '[data-tour="new-note"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) => {
        const base = Object.keys(useNotes.getState().notes).length;
        return useNotes.subscribe((s) => {
          if (Object.keys(s.notes).length > base) advance();
        });
      },
    },
    {
      id: "m-write",
      title: "Write freely",
      body: "This is the editor. Type at least a few words — Zen autosaves as you go, so there's no save button.",
      anchor: '[data-tour="editor"]',
      interactive: true,
      advanceWhen: (advance) => {
        const words = (id: string | null) => {
          const note = id ? useNotes.getState().notes[id] : null;
          return note ? docToText(note.content).trim().split(/\s+/).filter(Boolean).length : 0;
        };
        return useNotes.subscribe((s) => {
          if (words(s.selectedId) >= 5) advance();
        });
      },
    },
    {
      id: "m-pdf",
      title: "Attach a PDF",
      body: "Click 📄 PDFs to add or pick a PDF. It opens beside your note so you can study both together.",
      anchor: '[data-tour="attach-pdf"]',
      anchorWhenOpen: '[data-tour="pdf-popover"]',
      interactive: true,
      optional: true,
      skipLabel: "Not right now",
      advanceWhen: (advance) => {
        const base = Object.keys(usePdfs.getState().pdfs).length;
        return usePdfs.subscribe((s) => {
          if (Object.keys(s.pdfs).length > base) advance();
        });
      },
    },
    {
      id: "m-search",
      title: "Find it later",
      body: "Everything you add is searchable. Press Ctrl / ⌘ + K, then open any result.",
      anchor: '[data-tour="search-header"]',
      anchorWhenOpen: '[data-tour="command-palette"]',
      interactive: true,
      advanceWhen: (advance) => {
        // Require the user to actually open a result, not just press Esc. Track
        // that search was opened and that a navigation happened (note selected
        // or surface changed); advance once both are true and the palette has
        // closed. Handled from all three subscriptions so either event order —
        // select-then-close or close-then-select — still resolves.
        let opened = false;
        let navigated = false;
        const maybeAdvance = () => {
          if (opened && navigated && !useCommandPalette.getState().open) advance();
        };
        const unsubPalette = useCommandPalette.subscribe((s) => {
          if (s.open) opened = true;
          maybeAdvance();
        });
        const unsubNotes = useNotes.subscribe((s, prev) => {
          if (opened && s.selectedId !== prev.selectedId) navigated = true;
          maybeAdvance();
        });
        const unsubWorkspace = useWorkspace.subscribe((s, prev) => {
          if (opened && s.surface !== prev.surface) navigated = true;
          maybeAdvance();
        });
        return () => {
          unsubPalette();
          unsubNotes();
          unsubWorkspace();
        };
      },
    },
    {
      id: "m-done",
      title: "Material collected",
      body: "Notes, PDFs, and search — that's how your material gets into Zen. Back to the checklist.",
    },
  ],
};

/** Start a First Run Path group's walkthrough, if one exists. */
export function startGroupTour(groupKey: string): boolean {
  const steps = GROUP_TOURS[groupKey];
  if (!steps) return false;
  useTour.getState().start(steps);
  return true;
}
