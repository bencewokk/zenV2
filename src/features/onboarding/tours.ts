import { useWorkspace } from "@/shared/stores/workspace";
import { useHome } from "@/features/home/store";
import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";
import { useCommandPalette } from "@/features/search/CommandPalette";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useFocusStore } from "@/features/home/deepwork/useFocusSession";
import { useQuiz } from "@/features/home/deepwork/quizStore";
import { useAI } from "@/features/ai/store";
import { docToText } from "@/shared/lib/docText";
import { isSeededSample } from "./contentSignals";
import { markTutorialItemDone } from "@/features/home/dashboardPrefs";
import { useTour, type TourStep } from "./tourStore";

/** Put the app on the plain home dashboard so the tour's tile anchors exist. */
function goDashboard() {
  useNotes.getState().select(null);
  useHome.getState().setManualDeepWork(false);
  useWorkspace.getState().set({ surface: "home", adminMailId: null });
}

function completeTutorialGoals(...keys: string[]): void {
  for (const key of keys) markTutorialItemDone(key);
}

/** Checklist progress belongs to the walkthrough cursor, never inferred app
 * state. Decorate every phase step once so all forward paths (Next, an
 * auto-advance, or Skip step) persist the same deterministic result. */
export function isChecklistTourStep(step: TourStep): boolean {
  return !step.id.endsWith("-intro") && !step.id.endsWith("-done") && step.id !== "welcome" && step.id !== "done";
}

const CORE_LOOP_CHECKLIST_ALIASES: Record<string, string> = {
  "new-note": "m-note",
  "name-note": "m-rename",
  write: "m-write",
  search: "m-search",
  "core-open": "dw-open",
  "add-note": "dw-add",
};

function withWalkthroughCompletion(steps: TourStep[]): TourStep[] {
  return steps.map((step) => {
    const completes = step.completes ?? (isChecklistTourStep(step) ? [CORE_LOOP_CHECKLIST_ALIASES[step.id] ?? step.id] : undefined);
    if (!completes?.length) return step;
    return {
      ...step,
      completes,
      onPass: () => {
        step.onPass?.();
        completeTutorialGoals(...completes);
      },
    };
  });
}

/** Put a user-owned note on screen for the editor-centric tours: keep the open
 *  one only when it is not seeded demo content, else pick the most recently
 *  touched user note, else create a fresh one. The checklist deliberately
 *  excludes seeded notes, so the walkthrough must never ask the user to edit
 *  one and then advance without ticking the matching goal. */
function openNoteForTour() {
  useHome.getState().setManualDeepWork(false);
  useWorkspace.getState().set({ surface: "home", adminMailId: null, sidebarCollapsed: false });
  const st = useNotes.getState();
  if (st.selectedId && st.notes[st.selectedId] && !isSeededSample(st.notes[st.selectedId])) return;
  const pick = Object.values(st.notes)
    .filter((note) => !isSeededSample(note))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (pick) st.select(pick.id);
  else void st.create(null);
}

/** Auto-advance when a new note appears in the store. */
function advanceOnNoteCreated(advance: () => void): () => void {
  const base = Object.keys(useNotes.getState().notes).length;
  return useNotes.subscribe((s) => {
    if (Object.keys(s.notes).length > base) advance();
  });
}

/** Auto-advance on a genuine, user-chosen rename of the *currently selected*
 *  note. Two hazards to avoid: (1) creation fires on note-count change but
 *  selection/rename settle a tick later in an unpredictable order, and (2) new
 *  notes are programmatically titled "New note". So: ignore the default
 *  placeholders entirely, baseline the title per selected note, and only
 *  advance when the current note's title is a real title that differs from its
 *  baseline. */
function advanceOnRealRename(advance: () => void): () => void {
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
}

/** Auto-advance once the open note holds at least `min` words. */
function advanceOnWords(min: number): (advance: () => void) => () => void {
  return (advance) => {
    const words = (id: string | null) => {
      const note = id ? useNotes.getState().notes[id] : null;
      return note ? docToText(note.content).trim().split(/\s+/).filter(Boolean).length : 0;
    };
    return useNotes.subscribe((s) => {
      if (words(s.selectedId) >= min) advance();
    });
  };
}

/** Auto-advance when the user opens search AND actually jumps to a result.
 *  Requires opening a result, not just pressing Esc: track that search was
 *  opened and that a navigation happened (note selected or surface changed);
 *  advance once both are true and the palette has closed. Handled from all
 *  three subscriptions so either event order — select-then-close or
 *  close-then-select — still resolves. */
function advanceOnSearchJump(advance: () => void): () => void {
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
}

/** Auto-advance when a source lands on the Deep Work canvas. */
function advanceOnDwItemAdded(advance: () => void): () => void {
  const base = useDeepWork.getState().items.length;
  return useDeepWork.subscribe((s) => {
    if (s.items.length > base) advance();
  });
}

/** Auto-advance when the user sends another message to the assistant. */
function advanceOnAiUserTurn(advance: () => void): () => void {
  const count = () => useAI.getState().turns.filter((turn) => turn.role === "user").length;
  const base = count();
  return useAI.subscribe(() => {
    if (count() > base) advance();
  });
}

/** Open the assistant from the global header and follow the spotlight into it. */
function openAssistantStep(prefix: string): TourStep {
  return {
    id: `${prefix}-open`,
    title: "Open the AI panel",
    body: "Open Zen's assistant from the header. It keeps the open note or Deep Work session as context.",
    feedback: "The assistant is now beside your workspace, not in a separate app.",
    anchor: '[data-tour="ai-toggle"]',
    anchorWhenOpen: '[data-tour="ai-panel"]',
    interactive: true,
    beforeShow: goDashboard,
    advanceWhen: (advance) => {
      if (useAI.getState().open) {
        advance();
        return () => {};
      }
      return useAI.subscribe((s) => {
        if (s.open) advance();
      });
    },
  };
}

/** A single "get into Deep Work" step that self-skips if the user is already there. */
function openDeepWorkStep(prefix: string, body: string): TourStep {
  return {
    id: `${prefix}-open`,
    title: "Open Deep Work",
    body,
    anchor: '[data-tour="deep-work"]',
    interactive: true,
    beforeShow: () => {
      useNotes.getState().select(null);
      useWorkspace.getState().set({ surface: "home", adminMailId: null });
    },
    advanceWhen: (advance) => {
      if (useHome.getState().manualDeepWork) {
        advance();
        return () => {};
      }
      return useHome.subscribe((s, prev) => {
        if (s.manualDeepWork && !prev.manualDeepWork) advance();
      });
    },
  };
}


/**
 * The core study loop, done for real: in ~2 minutes the user creates and names
 * an actual note, writes in it, jumps to it with search, and puts it on a Deep
 * Work canvas. Every step is action-driven — the tour advances when the thing
 * happens, not when Next is clicked — so the user finishes with a real note
 * and a real study session, not a memory of highlighted tiles.
 */
export const CORE_LOOP_TOUR: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Zen",
    body: "Let's do the core loop for real — you'll capture a note, find it with search, and set it up for studying. About two minutes, and you keep everything you make. Esc skips anytime.",
    beforeShow: goDashboard,
  },
  {
    id: "new-note",
    title: "Capture a note",
    body: "Notes are the core unit in Zen. Click New note to create your first one.",
    feedback: "That's your note, open in the editor — it already exists, no save button ever.",
    anchor: '[data-tour="new-note"]',
    interactive: true,
    beforeShow: goDashboard,
    advanceWhen: advanceOnNoteCreated,
  },
  {
    id: "name-note",
    title: "Name it",
    body: "A clear title is how you'll find this later. Type a real name over “New note” up here — a course, a topic, anything.",
    feedback: "That title now shows up in search, the sidebar, and links.",
    anchor: '[data-tour="note-title"]',
    interactive: true,
    advanceWhen: advanceOnRealRename,
  },
  {
    id: "write",
    title: "Write a line",
    body: "Type a sentence in the editor — a thought, a definition, whatever's on your mind.",
    feedback: "Saved as you typed. Zen never asks you to save.",
    anchor: '[data-tour="editor"]',
    interactive: true,
    advanceWhen: advanceOnWords(5),
  },
  {
    id: "search",
    title: "Now find it",
    body: "Press Ctrl / ⌘ + K, type a word from your title, and open the result. Search reaches every note, source, and command from anywhere.",
    feedback: "That jump works from any screen — it's the fastest way around Zen.",
    anchor: '[data-tour="search-header"]',
    anchorWhenOpen: '[data-tour="command-palette"]',
    interactive: true,
    advanceWhen: advanceOnSearchJump,
  },
  openDeepWorkStep(
    "core",
    "Last stop: Deep Work, where studying happens. Open it from here."
  ),
  {
    id: "add-note",
    title: "Put your note on the canvas",
    body: "Click ＋ Add source and pick the note you just made.",
    feedback: "Your note is a movable window on a study canvas — add PDFs, events, or mail beside it, then quiz yourself on all of it.",
    anchor: '[data-tour="dw-add-source"]',
    anchorWhenOpen: '[data-tour="dw-source-library"]',
    interactive: true,
    advanceWhen: advanceOnDwItemAdded,
  },
  {
    id: "done",
    title: "That's the loop",
    body: "Capture → find → study, and you just did all three. The First Run Path on the dashboard has guided walkthroughs for everything deeper — replay this one anytime from Settings → Appearance.",
  },
];

/** Start the core-loop walkthrough. */
export function startCoreLoopTour() {
  useTour.getState().start(withWalkthroughCompletion(CORE_LOOP_TOUR));
}

/**
 * Per-PHASE walkthroughs for the First Run Path. Each is an action-driven tour
 * that makes the user actually do that phase's checklist items, auto-advancing
 * as each task completes. Keyed by the tutorial phase's `key`
 * (`<group>-<phaseNumber>`, e.g. "material-2").
 */
export const GROUP_TOURS: Record<string, TourStep[]> = {
  "assistant-1": [
    {
      id: "ai1-intro",
      title: "Ask with context",
      body: "Zen can reason over what is open, cite the material it used, and keep a real conversation going.",
      beforeShow: goDashboard,
    },
    openAssistantStep("ai1"),
    {
      id: "ai1-note",
      title: "Ask about the open note",
      body: "Open one of your notes, then ask a specific question about it. The note's text is included automatically.",
      anchor: '[data-tour="ai-input"]',
      interactive: true,
      beforeShow: openNoteForTour,
      advanceWhen: advanceOnAiUserTurn,
    },
    {
      id: "ai1-session",
      title: "Ask about the current Deep Work session",
      body: "Open Deep Work and ask Zen to compare or explain the material on the current canvas. It can read the gathered notes and PDFs as one context.",
      anchor: '[data-tour="ai-input"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: advanceOnAiUserTurn,
    },
    {
      id: "ai1-reference",
      title: "Inspect a source reference",
      body: "Assistant answers can include clickable note, PDF-page, and connected-source chips. Click one to inspect the evidence in place.",
      anchor: '[data-tour="ai-citation"]',
      interactive: true,
      optional: true,
      skipLabel: "No citation yet",
    },
    {
      id: "ai1-continue",
      title: "Continue the conversation",
      body: "Ask a follow-up. Zen keeps the conversation and tool activity together, so you can refine an explanation without restating the context.",
      anchor: '[data-tour="ai-input"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: advanceOnAiUserTurn,
    },
    {
      id: "ai1-done",
      title: "Context connected",
      body: "Notes, canvas material, and cited sources now form one continuous academic conversation.",
    },
  ],
  "material-1": [
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
      advanceWhen: advanceOnNoteCreated,
    },
    {
      id: "m-rename",
      title: "Name your note",
      body: "A clear title is how you'll find this later. Type a real name over “New note” up here.",
      feedback: "That title now shows in search, the sidebar, and any links to this note.",
      anchor: '[data-tour="note-title"]',
      interactive: true,
      advanceWhen: advanceOnRealRename,
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
      advanceWhen: advanceOnWords(5),
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
      advanceWhen: advanceOnSearchJump,
    },
    {
      id: "m-done",
      title: "Material collected",
      body: "Notes, PDFs, and search — that's how your material gets into Zen. Back to the checklist.",
    },
  ],
  "deepwork-1": [
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
      advanceWhen: advanceOnDwItemAdded,
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
  "study-1": [
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
  useTour.getState().start(withWalkthroughCompletion(steps));
  return true;
}
