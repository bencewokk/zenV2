import { useWorkspace } from "@/shared/stores/workspace";
import { useHome } from "@/features/home/store";
import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";
import { useCommandPalette } from "@/features/search/CommandPalette";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useFocusStore } from "@/features/home/deepwork/useFocusSession";
import { useQuiz } from "@/features/home/deepwork/quizStore";
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
      body: "Notes are the core unit in Zen. Click New note to make your first one.",
      feedback: "Nice — that's your note, open in the editor. Everything you do next lives here.",
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
      id: "m-rename",
      title: "Name your note",
      body: "A clear title is how you'll find this later. Type a real name over “New note” up here.",
      feedback: "That title now shows in search, the sidebar, and any links to this note.",
      anchor: '[data-tour="note-title"]',
      interactive: true,
      advanceWhen: (advance) => {
        // Advance only on a genuine, user-chosen rename of the *currently
        // selected* note. Two hazards to avoid: (1) the create step fires on
        // note-count change but selection/rename settle a tick later and in an
        // unpredictable order, and (2) the new note is programmatically titled
        // "New note". So: ignore the default placeholders entirely, baseline the
        // title per selected note, and only advance when the current note's
        // title is a real title that differs from its baseline.
        const DEFAULTS = new Set(["", "New note", "Untitled"]);
        let baseId = useNotes.getState().selectedId;
        let baseTitle = baseId ? useNotes.getState().notes[baseId]?.title ?? "" : "";
        return useNotes.subscribe((s) => {
          const id = s.selectedId;
          if (id !== baseId) {
            baseId = id;
            baseTitle = id ? s.notes[id]?.title ?? "" : "";
            return;
          }
          const cur = (id ? s.notes[id]?.title ?? "" : "").trim();
          if (cur && cur !== baseTitle && !DEFAULTS.has(cur)) advance();
        });
      },
    },
    {
      id: "m-meta",
      title: "Organise it",
      body: "Optionally tag the note with a space, subject, unit, or comma-separated tags — these power search and filtering. MOC turns a note into a Map of Content that lists its child notes.",
      anchor: '[data-tour="note-meta"]',
      interactive: true,
    },
    {
      id: "m-write",
      title: "Write freely",
      body: "Type at least a few words in the editor.",
      feedback: "Already saved — no save button, ever. Zen writes as you type.",
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
      body: "You can pin a PDF beside a note. Click 📄 PDFs, then add or pick one (optional).",
      feedback: "Your PDF is docked next to the note — study both side by side.",
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
      body: "Everything you add is indexed instantly. Press Ctrl / ⌘ + K, then open any result.",
      feedback: "That's search — an instant jump to anything you've added.",
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
  deepwork: [
    {
      id: "dw-intro",
      title: "Start Deep Work",
      body: "Deep Work is one focused canvas per topic — notes, PDFs, events, and mail side by side. Let's build one.",
      beforeShow: goDashboard,
    },
    {
      id: "dw-open",
      title: "Open Deep Work",
      body: "Open the Deep Work canvas from here.",
      feedback: "This is the Deep Work canvas — a workspace all its own.",
      anchor: '[data-tour="deep-work"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) =>
        useHome.subscribe((s, prev) => {
          if (s.manualDeepWork && !prev.manualDeepWork) advance();
        }),
    },
    {
      id: "dw-session",
      title: "Start a session",
      body: "Each topic gets its own session. Click ＋ up here to start a fresh one.",
      feedback: "That's a clean session — a blank canvas for this topic.",
      anchor: '[data-tour="dw-new-session"]',
      interactive: true,
      advanceWhen: (advance) => {
        const base = Object.keys(useDeepWork.getState().sessions).length;
        return useDeepWork.subscribe((s) => {
          if (Object.keys(s.sessions).length > base) advance();
        });
      },
    },
    {
      id: "dw-name",
      title: "Name the session",
      body: "Double-click the session tab and type a topic name.",
      feedback: "Named — jump between sessions from these tabs any time.",
      anchor: '[data-tour="dw-session-tab"]',
      interactive: true,
      advanceWhen: (advance) => {
        // Advance on a real rename of the active session (baseline per session,
        // re-baseline if the active session changes).
        let baseId = useDeepWork.getState().activeId;
        let baseName = baseId ? useDeepWork.getState().sessions[baseId]?.name ?? "" : "";
        return useDeepWork.subscribe((s) => {
          const id = s.activeId;
          if (id !== baseId) {
            baseId = id;
            baseName = id ? s.sessions[id]?.name ?? "" : "";
            return;
          }
          const cur = id ? s.sessions[id]?.name ?? "" : "";
          if (cur.trim() && cur !== baseName) advance();
        });
      },
    },
    {
      id: "dw-add",
      title: "Add a source",
      body: "Pull in a note, PDF, event, or email. Click ＋ Add source, then pick one.",
      feedback: "It opens as a movable window right on the canvas.",
      anchor: '[data-tour="dw-add-source"]',
      anchorWhenOpen: '[data-tour="dw-source-library"]',
      interactive: true,
      advanceWhen: (advance) => {
        const base = useDeepWork.getState().items.length;
        return useDeepWork.subscribe((s) => {
          if (s.items.length > base) advance();
        });
      },
    },
    {
      id: "dw-arrange",
      title: "Arrange the canvas",
      body: "Drag a window by its header, or resize it from the bottom-right corner.",
      feedback: "Lay your sources out however helps you think.",
      anchor: '[data-tour="dw-window"]',
      interactive: true,
      advanceWhen: (advance) => {
        const snapshot = () => JSON.stringify(useDeepWork.getState().windows);
        const base = snapshot();
        return useDeepWork.subscribe(() => {
          if (snapshot() !== base) advance();
        });
      },
    },
    {
      id: "dw-done",
      title: "That's Deep Work",
      body: "One workspace per topic, all your sources in reach. Sessions live in the tabs up top.",
    },
  ],
  study: [
    {
      id: "sq-intro",
      title: "Study and quiz",
      body: "Zen's learning loop lives in Deep Work: focus, quiz yourself, and watch your mastery climb.",
      beforeShow: goDashboard,
    },
    {
      id: "sq-open",
      title: "Open Deep Work",
      body: "The study tools live on the Deep Work canvas. Open it from here.",
      feedback: "Good — studying always happens inside a Deep Work session.",
      anchor: '[data-tour="deep-work"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) =>
        useHome.subscribe((s, prev) => {
          if (s.manualDeepWork && !prev.manualDeepWork) advance();
        }),
    },
    {
      id: "sq-study",
      title: "Open the Study panel",
      body: "Click Study to open your cockpit — mastery, quizzes, and your revision plan.",
      feedback: "This panel tracks how ready you are and what to review next.",
      anchor: '[data-tour="dw-study"]',
      interactive: true,
      advanceWhen: (advance) => {
        const id = setInterval(() => {
          if (document.querySelector('[data-tour="study-panel"]')) advance();
        }, 200);
        return () => clearInterval(id);
      },
    },
    {
      id: "sq-focus",
      title: "Start a focus block",
      body: "Click the timer, type some minutes, and press Enter. Focus blocks work even with AI off.",
      feedback: "Timer's running — Zen logs your focus time against this session.",
      anchor: '[data-tour="dw-timer"]',
      interactive: true,
      advanceWhen: (advance) => {
        if (useFocusStore.getState().session) {
          advance();
          return () => {};
        }
        return useFocusStore.subscribe((s) => {
          if (s.session) advance();
        });
      },
    },
    {
      id: "sq-quiz",
      title: "Quiz yourself",
      body: "With AI on, Start quiz builds questions weighted to your weak spots, then grades them here.",
      feedback: "Every graded answer updates your mastery so Zen re-tests what you miss.",
      anchor: '[data-tour="study-quiz"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: (advance) => {
        const base = Object.keys(useQuiz.getState().quizzes).length;
        return useQuiz.subscribe((s) => {
          if (Object.keys(s.quizzes).length > base) advance();
        });
      },
    },
    {
      id: "sq-done",
      title: "That's the loop",
      body: "Focus, quiz, review — repeat, and your readiness climbs. Guided lessons live in the AI panel too.",
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
