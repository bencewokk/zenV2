import { useWorkspace } from "@/shared/stores/workspace";
import { useHome } from "@/features/home/store";
import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";
import { useCommandPalette } from "@/features/search/CommandPalette";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useFocusStore } from "@/features/home/deepwork/useFocusSession";
import { useQuiz } from "@/features/home/deepwork/quizStore";
import { useLesson } from "@/features/home/deepwork/lessonStore";
import { useStudyLog } from "@/features/home/deepwork/studyLog";
import { isFilterActive } from "@/features/filtering/filter";
import { useSources } from "@/services/sources/store";
import { useToolPolicy } from "@/services/ai/toolPolicy";
import { useAI } from "@/features/ai/store";
import { loadAppearance } from "@/services/appearance";
import { docToText } from "@/shared/lib/docText";
import { docCountNodes, isSeededSample } from "./contentSignals";
import { markTutorialItemDone } from "@/features/home/dashboardPrefs";
import { useTour, type TourStep } from "./tourStore";

/** Put the app on the plain home dashboard so the tour's tile anchors exist. */
function goDashboard() {
  useNotes.getState().select(null);
  useHome.getState().setManualDeepWork(false);
  useWorkspace.getState().set({ surface: "home", adminMailId: null });
}

const SAMPLE_SESSION_NAME = "Quadratics — sample";

function isSampleSession(name: string): boolean {
  return name.trim() === SAMPLE_SESSION_NAME;
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

/** Auto-advance when the OPEN note gains a node of one of these types (baselined
 *  per selected note, so pre-existing nodes — e.g. in the sample notes — don't
 *  count; content lands in the store after the editor's debounced save). */
function advanceOnNodeAdded(types: string[]): (advance: () => void) => () => void {
  return (advance) => {
    const count = (id: string | null) => {
      const note = id ? useNotes.getState().notes[id] : null;
      return note ? docCountNodes(note.content, types) : 0;
    };
    let baseId = useNotes.getState().selectedId;
    let base = count(baseId);
    return useNotes.subscribe((s) => {
      if (s.selectedId !== baseId) {
        baseId = s.selectedId;
        base = count(baseId);
        return;
      }
      if (count(s.selectedId) > base) advance();
    });
  };
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

/** Shared entry for the study-phase tours: get into Deep Work with the Study
 *  panel open (each step self-skips if the user is already there). */
function studyEntrySteps(prefix: string): TourStep[] {
  return [
    openDeepWorkStep(prefix, "The study tools live on the Deep Work canvas. Open it from here."),
    {
      id: `${prefix}-study`,
      title: "Open the Study panel",
      body: "Click Study to open your cockpit — mastery, quizzes, and your revision plan.",
      anchor: '[data-tour="dw-study"]',
      interactive: true,
      advanceWhen: (advance) => {
        const id = setInterval(() => {
          if (document.querySelector('[data-tour="study-panel"]')) advance();
        }, 200);
        return () => clearInterval(id);
      },
    },
  ];
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
  "assistant-2": [
    {
      id: "ai2-intro",
      title: "Let Zen do work",
      body: "The assistant can operate Zen's tools, while writes remain visible and governed by your permissions.",
      beforeShow: () => {
        goDashboard();
        if (!useAI.getState().open) useAI.getState().toggle();
      },
    },
    {
      id: "ai2-create",
      title: "Create a note with AI",
      body: "Ask Zen to create a concise note on a topic. A tool activity line records the result and the new note remains yours to edit.",
      anchor: '[data-tour="ai-input"]',
      interactive: true,
      advanceWhen: advanceOnAiUserTurn,
    },
    {
      id: "ai2-improve",
      title: "Improve an existing note",
      body: "With a note open, ask Zen to restructure, expand, or correct it. Be explicit about what should stay unchanged.",
      anchor: '[data-tour="ai-input"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: advanceOnAiUserTurn,
    },
    {
      id: "ai2-find",
      title: "Find material",
      body: "Ask Zen to find a concept across your notes, PDFs, and connected sources, and to cite the strongest matches.",
      anchor: '[data-tour="ai-input"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: advanceOnAiUserTurn,
    },
    {
      id: "ai2-deepwork",
      title: "Add material to Deep Work",
      body: "Ask Zen to add a relevant note or PDF to the active Deep Work session. The canvas updates when the controlled action runs.",
      anchor: '[data-tour="ai-input"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: advanceOnAiUserTurn,
    },
    {
      id: "ai2-study",
      title: "Generate a quiz, backbone, plan, or lesson",
      body: "Ask for the study artifact you need next. Zen grounds it in the current session and places it in the Study workflow.",
      anchor: '[data-tour="ai-input"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: advanceOnAiUserTurn,
    },
    {
      id: "ai2-done",
      title: "Workspace operated",
      body: "The assistant is now a way to act on your academic workspace, not only talk about it.",
    },
  ],
  "assistant-3": [
    {
      id: "ai3-intro",
      title: "Control and verify",
      body: "Every assistant action has a permission, a visible execution path, and a result you can inspect.",
      beforeShow: () => {
        goDashboard();
        if (!useAI.getState().open) useAI.getState().toggle();
      },
    },
    {
      id: "ai3-tools",
      title: "Review available tools",
      body: "Open Tools to see every configurable action grouped by what it changes.",
      anchor: '[data-tour="ai-tools-button"]',
      anchorWhenOpen: '[data-tour="ai-tools"]',
      interactive: true,
      advanceWhen: (advance) => {
        const id = setInterval(() => {
          if (document.querySelector('[data-tour="ai-tools"]')) advance();
        }, 200);
        return () => clearInterval(id);
      },
    },
    {
      id: "ai3-permission",
      title: "Change a tool permission",
      body: "Set one action to Ask, Auto, or Off. Ask creates a confirmation card; Auto runs it immediately; Off prevents its use.",
      anchor: '[data-tour="ai-tools"]',
      interactive: true,
      advanceWhen: (advance) => {
        const base = JSON.stringify(useToolPolicy.getState().overrides);
        return useToolPolicy.subscribe((s) => {
          if (JSON.stringify(s.overrides) !== base) advance();
        });
      },
    },
    {
      id: "ai3-run",
      title: "Run a controlled action",
      body: "Return to chat, ask Zen for an action whose permission is Ask, inspect its arguments, then choose Run or Dismiss.",
    },
    {
      id: "ai3-result",
      title: "Inspect the result or receipt",
      body: "Open Activity to see what the assistant read, proposed, ran, and returned. Shared automation receipts also live in Settings → Data.",
      anchor: '[data-tour="ai-activity-button"]',
      anchorWhenOpen: '[data-tour="ai-activity"]',
      interactive: true,
    },
    {
      id: "ai3-correct",
      title: "Undo or correct the action",
      body: "If the result is wrong, say what to correct or use Zen's normal editing controls. Tool activity makes the changed target explicit so you can verify it.",
    },
    {
      id: "ai3-done",
      title: "Assistant under control",
      body: "Permissions decide what may happen; proposals show what will happen; activity shows what did happen.",
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
  "material-2": [
    {
      id: "m2-intro",
      title: "Organise & link",
      body: "Give your notes structure: metadata, filters, wiki-links, and Maps of Content. Follow the highlights.",
      beforeShow: openNoteForTour,
    },
    {
      id: "m2-meta",
      title: "Tag your note",
      body: "Fill in a space, subject, or unit — or type comma-separated tags — up here. They power search and the sidebar filters.",
      feedback: "Tagged — this note now shows up under those facets everywhere.",
      anchor: '[data-tour="note-meta"]',
      interactive: true,
      advanceWhen: (advance) => {
        // Advance on a real metadata edit of the OPEN note: baseline the selected
        // note's meta, re-baseline when the selection changes, and fire only when
        // the meta both changed and is non-empty (the seeded samples already ship
        // with metadata, so "changed" is what proves the user did it).
        const metaOf = (id: string | null) => {
          const n = id ? useNotes.getState().notes[id] : null;
          return n ? JSON.stringify([n.tags, n.space, n.subject, n.unit]) : "";
        };
        let baseId = useNotes.getState().selectedId;
        let base = metaOf(baseId);
        return useNotes.subscribe((s) => {
          const id = s.selectedId;
          if (id !== baseId) {
            baseId = id;
            base = metaOf(id);
            return;
          }
          const n = id ? s.notes[id] : null;
          if (!n) return;
          const cur = JSON.stringify([n.tags, n.space, n.subject, n.unit]);
          if (cur !== base && (n.tags.length > 0 || n.space || n.subject || n.unit)) advance();
        });
      },
    },
    {
      id: "m2-filter",
      title: "Filter the sidebar",
      body: "Use the filter bar — pick a space, subject, or unit, add a tag, or toggle Inbox — to narrow the note tree.",
      feedback: "Filtered — Clear resets it whenever you're done.",
      anchor: '[data-tour="filter-bar"]',
      interactive: true,
      beforeShow: () => useWorkspace.getState().set({ sidebarCollapsed: false }),
      advanceWhen: (advance) =>
        useNotes.subscribe((s) => {
          if (isFilterActive(s.filter)) advance();
        }),
    },
    {
      id: "m2-wikilink",
      title: "Link notes together",
      body: "In the editor, type [[ and pick another note (try “Sample: Functions”). Wiki-links weave your notes into a graph.",
      feedback: "Linked — click it any time to jump to that note.",
      anchor: '[data-tour="editor"]',
      interactive: true,
      advanceWhen: advanceOnNodeAdded(["wikiLink"]),
    },
    {
      id: "m2-moc",
      title: "Make a Map of Content",
      body: "Click MOC to turn this note into a Map of Content — a living index that lists its child notes.",
      feedback: "That's a MOC — nest notes under it in the sidebar and they appear here.",
      anchor: '[data-tour="note-moc"]',
      interactive: true,
      advanceWhen: (advance) => {
        const mocs = () => Object.values(useNotes.getState().notes).filter((n) => n.moc).length;
        const base = mocs();
        return useNotes.subscribe(() => {
          if (mocs() > base) advance();
        });
      },
    },
    {
      id: "m2-done",
      title: "Organised",
      body: "Metadata, filters, links, and MOCs — structure that compounds as your notes grow.",
    },
  ],
  "material-3": [
    {
      id: "m3-intro",
      title: "Author & solve",
      body: "Zen's editor is math-first: checkable math, tables, and geometry — all one “/” away.",
      beforeShow: openNoteForTour,
    },
    {
      id: "m3-math",
      title: "Insert a math block",
      body: "In the editor type /math and pick Math block, then write an equation — try x^2 - 5x + 6 = 0.",
      feedback: "A live math field — type naturally, get typeset math.",
      anchor: '[data-tour="editor"]',
      interactive: true,
      advanceWhen: advanceOnNodeAdded(["mathBlock", "mathInline"]),
    },
    {
      id: "m3-check",
      title: "Check your working",
      body: "Turn on Math check. In a multi-line math block, every line is verified against the one above — wrong steps get flagged with a verdict.",
      feedback: "Checker on — write a derivation line by line and Zen grades each step.",
      anchor: '[data-tour="math-check"]',
      interactive: true,
      advanceWhen: (advance) => {
        const on = (id: string | null) => !!(id && useNotes.getState().notes[id]?.mathCheck);
        if (on(useNotes.getState().selectedId)) {
          advance();
          return () => {};
        }
        return useNotes.subscribe((s) => {
          if (on(s.selectedId)) advance();
        });
      },
    },
    {
      id: "m3-block",
      title: "Add a table or geometry",
      body: "Type / again and insert a Table — or a Geometry block for interactive constructions.",
      feedback: "Structured blocks live right beside your prose and math.",
      anchor: '[data-tour="editor"]',
      interactive: true,
      advanceWhen: advanceOnNodeAdded(["table", "geometry"]),
    },
    {
      id: "m3-done",
      title: "Author & solve",
      body: "Math you can trust, plus tables and constructions — your notes can hold real working now.",
    },
  ],
  "material-4": [
    {
      id: "pdf-intro",
      title: "PDF research",
      body: "Move from importing a paper to searchable, cited, side-by-side research without leaving Zen.",
      beforeShow: openNoteForTour,
    },
    {
      id: "pdf-import",
      title: "Import a PDF",
      body: "Open PDFs on the note, then import a file or choose one already in your library.",
      feedback: "The PDF is stored locally, indexed page by page, and attached to your note.",
      anchor: '[data-tour="attach-pdf"]',
      anchorWhenOpen: '[data-tour="pdf-popover"]',
      interactive: true,
      optional: true,
      skipLabel: "Use an existing PDF",
      advanceWhen: (advance) => {
        const base = Object.keys(usePdfs.getState().pdfs).length;
        return usePdfs.subscribe((s) => {
          if (Object.keys(s.pdfs).length > base) advance();
        });
      },
    },
    {
      id: "pdf-search",
      title: "Search inside it",
      body: "Use Find page to locate a term across the extracted text. Matches show a page and surrounding passage.",
      anchor: '[data-tour="pdf-search"]',
      interactive: true,
    },
    {
      id: "pdf-outline",
      title: "Open the outline",
      body: "Use Contents to navigate the document's table of contents. PDFs without an embedded outline simply omit this section.",
      anchor: '[data-tour="pdf-outline"]',
      interactive: true,
      optional: true,
      skipLabel: "No outline in this PDF",
    },
    {
      id: "pdf-highlight",
      title: "Highlight or bookmark a passage",
      body: "Bookmark the current page. Zen saves a short passage; the assistant can create richer concept-tagged highlights.",
      feedback: "Saved — the passage now stays in the PDF's research panel.",
      anchor: '[data-tour="pdf-bookmark"]',
      interactive: true,
      advanceWhen: (advance) => {
        const count = () => Object.values(usePdfs.getState().annotations).reduce((sum, list) => sum + list.length, 0);
        const base = count();
        return usePdfs.subscribe(() => {
          if (count() > base) advance();
        });
      },
    },
    {
      id: "pdf-cite",
      title: "Cite a passage into a note",
      body: "Open the assistant and ask it to cite this passage into the open note. PDF page references remain clickable in the conversation.",
      anchor: '[data-tour="ai-toggle"]',
      interactive: true,
    },
    {
      id: "pdf-side-by-side",
      title: "Open note and PDF side by side",
      body: "Add the PDF to Deep Work, then place its window beside the note you are writing.",
      anchor: '[data-tour="pdf-deep-work"]',
      interactive: true,
      optional: true,
      skipLabel: "Do this later",
      advanceWhen: advanceOnDwItemAdded,
    },
    {
      id: "pdf-done",
      title: "PDF ready for research",
      body: "Search, outline, saved passages, citations, and side-by-side work turn a PDF into usable study material.",
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
  "deepwork-2": [
    {
      id: "dw2-intro",
      title: "Work the canvas",
      body: "Deep Work gets stronger with more on it: extra sources, zen mode, and parallel sessions.",
      beforeShow: goDashboard,
    },
    openDeepWorkStep("dw2", "Back to the canvas — open Deep Work from here."),
    {
      id: "dw2-second",
      title: "Gather a second source",
      body: "Click ＋ Add source and pull in one more note, PDF, event, or email — studying is comparing.",
      feedback: "Two windows side by side — that's the point of the canvas.",
      anchor: '[data-tour="dw-add-source"]',
      anchorWhenOpen: '[data-tour="dw-source-library"]',
      interactive: true,
      advanceWhen: (advance) => {
        const count = () => {
          const s = useDeepWork.getState();
          const active = s.activeId ? s.sessions[s.activeId] : null;
          return active && !isSampleSession(active.name) ? active.items.length : 0;
        };
        if (count() >= 2) {
          advance();
          return () => {};
        }
        return useDeepWork.subscribe(() => {
          if (count() >= 2) advance();
        });
      },
    },
    {
      id: "dw2-related",
      title: "Add related material from anywhere",
      body: "Outside the canvas, right-click a note in the sidebar, a PDF, an event, or an email → “Add to Deep Work”. It lands in whichever session you pick.",
    },
    {
      id: "dw2-zen",
      title: "Try Zen mode",
      body: "The ◑ button hides everything but the canvas. Click it — and click it again to bring the chrome back.",
      feedback: "That's zen mode. Toggle ◑ again whenever you want the chrome back.",
      anchor: '[data-tour="dw-zen"]',
      interactive: true,
      advanceWhen: (advance) => {
        if (useDeepWork.getState().zenMode) {
          advance();
          return () => {};
        }
        return useDeepWork.subscribe((s, prev) => {
          if (s.zenMode && !prev.zenMode) advance();
        });
      },
    },
    {
      id: "dw2-session",
      title: "Open a second session",
      body: "One topic per session. Click ＋ up here to open a parallel one — the tabs switch instantly.",
      feedback: "Two sessions — each keeps its own sources, backbone, and progress.",
      anchor: '[data-tour="dw-new-session"]',
      interactive: true,
      advanceWhen: (advance) => {
        const count = () => Object.values(useDeepWork.getState().sessions)
          .filter((s) => !s.archived && !isSampleSession(s.name)).length;
        if (count() >= 2) {
          advance();
          return () => {};
        }
        return useDeepWork.subscribe(() => {
          if (count() >= 2) advance();
        });
      },
    },
    {
      id: "dw2-done",
      title: "Canvas mastered",
      body: "More sources, zen focus, parallel sessions — the canvas scales with your workload.",
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
  "study-2": [
    {
      id: "ev-intro",
      title: "Evidence & mastery",
      body: "Turn studying into evidence: a concept backbone, targeted reviews, graded quizzes, and re-tests of what you missed. Most of this needs AI on.",
      beforeShow: goDashboard,
    },
    ...studyEntrySteps("ev"),
    {
      id: "ev-backbone",
      title: "Generate a backbone",
      body: "Ask the AI (panel on the right) to “study my Deep Work material” — it builds a concept backbone with mastery bars here.",
      anchor: '[data-tour="study-panel"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: (advance) => {
        const has = () => !!useDeepWork.getState().backbone?.concepts.length;
        if (has()) {
          advance();
          return () => {};
        }
        return useDeepWork.subscribe(() => {
          if (has()) advance();
        });
      },
    },
    {
      id: "ev-review",
      title: "Review the weakest concept",
      body: "“Review next” always points at your weakest concept. Click it to drill exactly that.",
      feedback: "Drilling — answer and grade the quiz to push that concept's mastery up.",
      anchor: '[data-tour="study-review-next"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: (advance) => {
        const base = useQuiz.getState().order.length;
        return useQuiz.subscribe((s) => {
          if (s.order.length > base) advance();
        });
      },
    },
    {
      id: "ev-grade",
      title: "Grade a quiz",
      body: "Take a quiz and submit it — grading updates per-concept mastery and your readiness score.",
      anchor: '[data-tour="study-quiz"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: (advance) => {
        const graded = () => Object.values(useQuiz.getState().quizzes).filter((q) => q.status === "graded").length;
        const base = graded();
        return useQuiz.subscribe(() => {
          if (graded() > base) advance();
        });
      },
    },
    {
      id: "ev-requiz",
      title: "Re-quiz your mistakes",
      body: "Once a graded quiz has misses, “↺ Re-quiz my mistakes” re-tests exactly those — the fastest way to close gaps.",
      anchor: '[data-tour="study-requiz"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: (advance) => {
        const base = useQuiz.getState().order.length;
        return useQuiz.subscribe((s) => {
          if (s.order.length > base) advance();
        });
      },
    },
    {
      id: "ev-done",
      title: "Mastery, evidenced",
      body: "Backbone → review → grade → re-quiz. Your readiness % is now earned, not guessed.",
    },
  ],
  "study-3": [
    {
      id: "mm-intro",
      title: "Mistakes & mastery",
      body: "Turn incorrect answers into a focused queue, then compare progress at both concept and sub-skill level.",
      beforeShow: goDashboard,
    },
    {
      id: "mm-bank",
      title: "Open the mistake bank",
      body: "Open Deep Work → Study. Your quiz history and Re-quiz my mistakes collect the evidence from graded answers for this session.",
      anchor: '[data-tour="deep-work"]',
      interactive: true,
    },
    {
      id: "mm-answer",
      title: "Review an incorrect answer",
      body: "Open a graded quiz from the history and inspect the verdict, feedback, and cited page for an answer you missed.",
      anchor: '[data-tour="study-mistake-bank"]',
      interactive: true,
    },
    {
      id: "mm-retest",
      title: "Re-test missed concepts",
      body: "Choose Re-quiz my mistakes. Zen generates fresh questions for the exact concepts you previously missed.",
      anchor: '[data-tour="study-requiz"]',
      interactive: true,
      optional: true,
      skipLabel: "No mistakes yet",
      advanceWhen: (advance) => {
        const base = useQuiz.getState().order.length;
        return useQuiz.subscribe((s) => {
          if (s.order.length > base) advance();
        });
      },
    },
    {
      id: "mm-compare",
      title: "Compare concept and sub-skill mastery",
      body: "Use the mastery bars to see whether a broad concept is hiding a weaker sub-skill. Click any concept to drill it directly.",
      anchor: '[data-tour="study-mastery"]',
      interactive: true,
    },
    {
      id: "mm-overdue",
      title: "Review an overdue concept",
      body: "Review next prioritises overdue concepts before merely low-scoring ones, so stale knowledge returns to the front of the queue.",
      anchor: '[data-tour="study-review-next"]',
      interactive: true,
    },
    {
      id: "mm-done",
      title: "Mistakes converted into evidence",
      body: "Missed answers now drive re-tests, sub-skill diagnosis, and spaced review instead of disappearing after a score.",
    },
  ],
  "study-4": [
    {
      id: "pl-intro",
      title: "Plan to the deadline",
      body: "Give Zen your exam date and it plans the runway: adaptive study sessions, an exam hero on the dashboard, and a daily goal.",
      beforeShow: goDashboard,
    },
    {
      id: "pl-hero",
      title: "View the Exam-Focus hero",
      body: "Once a session has a plan with an exam date, this dashboard hero tracks the countdown, your readiness, and your weakest concept — with one-click Study now.",
      anchor: '[data-tour="exam-hero"]',
      beforeShow: goDashboard,
    },
    ...studyEntrySteps("pl"),
    {
      id: "pl-plan",
      title: "Plan your week",
      body: "Click “📅 Plan my week” (it appears once you have a backbone) and give the AI your exam date — it books adaptive study sessions.",
      anchor: '[data-tour="study-plan"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: (advance) => {
        if (useDeepWork.getState().plan?.examDate) {
          advance();
          return () => {};
        }
        return useDeepWork.subscribe((s) => {
          if (s.plan?.examDate) advance();
        });
      },
    },
    {
      id: "pl-next25",
      title: "Finish a planned session",
      body: "Start a planned session, work through it, then click its ✓ control. The checklist completes only when that planned block is actually marked done.",
      feedback: "Planned block complete — your plan and readiness now reflect the work.",
      anchor: '[data-tour="study-plan"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip for now",
      advanceWhen: (advance) => {
        const done = () => Object.values(useDeepWork.getState().sessions)
          .some((session) => session.plan?.sessions.some((planned) => planned.status === "done"));
        if (done()) {
          advance();
          return () => {};
        }
        return useDeepWork.subscribe(() => {
          if (done()) advance();
        });
      },
    },
    {
      id: "pl-goal",
      title: "Set a daily goal",
      body: "Click the hours next to “Today” and set your own daily self-study goal — streaks count the days you hit it.",
      feedback: "Goal set — the bar and 🔥 streak track it from now on.",
      anchor: '[data-tour="daily-goal"]',
      interactive: true,
      advanceWhen: (advance) => {
        const base = useStudyLog.getState().goalHours;
        return useStudyLog.subscribe((s) => {
          if (s.goalHours !== base) advance();
        });
      },
    },
    {
      id: "pl-done",
      title: "Deadline covered",
      body: "Plan, hero, focus, goal — Zen now paces you to the exam and offers a re-plan whenever you drift.",
    },
  ],
  "study-5": [
    {
      id: "as-intro",
      title: "Adaptive study strategy",
      body: "Read the forecast as a decision tool: what is weak, how much time is missing, and what to do next.",
      beforeShow: goDashboard,
    },
    {
      id: "as-verdict",
      title: "Read your readiness verdict",
      body: "Open Deep Work → Study and read Goal forecast. The verdict combines deadline pressure, reliable mastery, evidence, and capacity.",
      anchor: '[data-tour="study-forecast"]',
    },
    {
      id: "as-weakest",
      title: "Identify the weakest concept",
      body: "Review next points to the weakest due concept, with its mastery beside it. This is the highest-value content target.",
      anchor: '[data-tour="study-review-next"]',
      interactive: true,
    },
    {
      id: "as-deficit",
      title: "Check the time deficit",
      body: "Goal forecast shows any extra time needed to reach the readiness target before the deadline.",
      anchor: '[data-tour="study-forecast"]',
    },
    {
      id: "as-booked",
      title: "Compare booked time with required time",
      body: "Compare booked against estimated time. A healthy plan covers the required work without exceeding your available capacity.",
      anchor: '[data-tour="study-forecast"]',
    },
    {
      id: "as-replan",
      title: "Re-plan after missed sessions",
      body: "When the plan drifts, use re-plan. Zen reschedules missed time and shifts effort toward weak concepts instead of pretending the old plan still fits.",
      anchor: '[data-tour="study-replan"]',
      interactive: true,
      optional: true,
      skipLabel: "Plan is on track",
    },
    {
      id: "as-next25",
      title: "Choose the next best 25-minute action",
      body: "Choose the next scheduled block, or start a 25-minute Study session focused on Review next. The best action joins urgency with the weakest evidence.",
      anchor: '[data-tour="study-next-actions"]',
      interactive: true,
    },
    {
      id: "as-done",
      title: "Strategy made actionable",
      body: "You can now turn readiness, weakness, and calendar capacity into one concrete next block.",
    },
  ],
  "study-6": [
    {
      id: "ls-intro",
      title: "Lessons & tutoring",
      body: "The deepest loop: the AI teaches you in a guided class, checks understanding as you go, and adapts to your deadline.",
      beforeShow: goDashboard,
    },
    ...studyEntrySteps("ls"),
    {
      id: "ls-start",
      title: "Start a class",
      body: "▶ Study session starts a 25-minute class: a focus timer plus an AI-taught lesson board built from your material.",
      anchor: '[data-tour="study-session"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs AI",
      advanceWhen: (advance) => {
        if (useLesson.getState().active) {
          advance();
          return () => {};
        }
        return useLesson.subscribe((s) => {
          if (s.active) advance();
        });
      },
    },
    {
      id: "ls-work",
      title: "Work through the lesson",
      body: "Step through the board with Next and answer the inline questions. The tutor adapts the explanation as you work.",
    },
    {
      id: "ls-finish",
      title: "Finish the class",
      body: "Press End class when you're done — the focus time is credited and the lesson board stays saved with the session.",
    },
    {
      id: "ls-modes",
      title: "Understand deadline modes",
      body: "Your plan's verdict shifts as the exam nears: Ahead → On track → At risk → Overcommitted. Zen tightens the plan accordingly — from deep learning toward survival — and nudges a re-plan when you drift.",
    },
  ],
  "setup-1": [
    {
      id: "su-intro",
      title: "Set up Zen",
      body: "Zen runs fully offline. Connecting Google, turning on sync, and saving a profile are all optional — here's where they live.",
      beforeShow: goDashboard,
    },
    {
      id: "su-settings",
      title: "Open Settings",
      body: "Open Settings to manage your account and sync.",
      feedback: "You're in Connections — the home for Google, Canvas, and sync.",
      anchor: '[data-tour="settings"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) =>
        useWorkspace.subscribe((s, prev) => {
          if (s.surface === "settings" && prev.surface !== "settings") advance();
        }),
    },
    {
      id: "su-rail",
      title: "Connections & sync",
      body: "Connections (open now) is where you link Google for Calendar & Mail and switch on Sync to back up across devices. All optional — skip it to stay fully local.",
      anchor: '[data-tour="settings-rail"]',
      interactive: true,
    },
    {
      id: "su-done",
      title: "Foundation set",
      body: "That's the setup. For the full guided flow, use “Replay Spark setup” inside Connections any time.",
    },
  ],
  "setup-2": [
    {
      id: "su2-intro",
      title: "Make it yours",
      body: "Zen adapts to you: pick a look, choose a font, and teach the AI your email topics.",
      beforeShow: goDashboard,
    },
    {
      id: "su2-settings",
      title: "Open Settings",
      body: "The look and font live in Settings.",
      anchor: '[data-tour="settings"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) => {
        if (useWorkspace.getState().surface === "settings") {
          advance();
          return () => {};
        }
        return useWorkspace.subscribe((s, prev) => {
          if (s.surface === "settings" && prev.surface !== "settings") advance();
        });
      },
    },
    {
      id: "su2-appearance",
      title: "Pick a look & font",
      body: "Open Appearance in the rail and try an app look and a UI font — changes apply live.",
      feedback: "That's your Zen now. Come back here any time.",
      anchor: '[data-tour="settings-rail"]',
      interactive: true,
      optional: true,
      skipLabel: "Keep the defaults",
      advanceWhen: (advance) => {
        // Appearance is plain localStorage (no store to subscribe to). Require
        // each still-default choice to change; advancing after only the look or
        // only the font left the other checklist item stranded.
        const base = loadAppearance();
        const needLook = base.appLook === "zen";
        const needFont = base.uiFont === "system";
        const id = setInterval(() => {
          const current = loadAppearance();
          const lookDone = !needLook || current.appLook !== base.appLook;
          const fontDone = !needFont || current.uiFont !== base.uiFont;
          if (lookDone && fontDone) advance();
        }, 300);
        return () => clearInterval(id);
      },
    },
    {
      id: "su2-label",
      title: "Add an AI email label",
      body: "Type a topic the AI should tag your email with (e.g. “Thesis” or “Internships”) and press Enter.",
      feedback: "Saved — matching mail gets grouped under that label automatically.",
      anchor: '[data-tour="ai-labels"]',
      interactive: true,
      optional: true,
      skipLabel: "Skip — no mail connection",
      beforeShow: goDashboard,
      advanceWhen: (advance) => {
        const count = () => useHome.getState().customLabels.length;
        if (count() > 0) {
          advance();
          return () => {};
        }
        return useHome.subscribe(() => {
          if (count() > 0) advance();
        });
      },
    },
    {
      id: "su2-done",
      title: "It's yours",
      body: "Look, font, and labels set. Everything else personal (profile, memory) lives in the AI panel.",
    },
  ],
  "connect-1": [
    {
      id: "cr-intro",
      title: "Connect real life",
      body: "Pull outside academic context into Zen — course material, files, papers, code, and the web.",
      beforeShow: goDashboard,
    },
    {
      id: "cr-sources",
      title: "Open Sources",
      body: "Open your source hub from here.",
      feedback: "This is Sources — Canvas, Drive, Zotero, GitHub, and web captures.",
      anchor: '[data-tour="sources"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) =>
        useWorkspace.subscribe((s, prev) => {
          if (s.surface === "sources" && prev.surface !== "sources") advance();
        }),
    },
    {
      id: "cr-use",
      title: "Refresh and study",
      body: "Pick a category to connect it, then refresh to pull the latest. To study anything, right-click a source, note, event, or email → Add to Deep Work.",
    },
    {
      id: "cr-phone",
      title: "Link your phone",
      body: "Scan this QR with your phone camera — it installs the Zen Assistant. Sign in there with the same Google account, and tasks or thoughts you capture on the go sync straight into this tile.",
      anchor: '[data-tour="phone-qr"]',
      beforeShow: goDashboard,
    },
    {
      id: "cr-done",
      title: "Real life connected",
      body: "Your outside material now flows into search and Deep Work alongside your notes.",
    },
  ],
  "connect-2": [
    {
      id: "cr2-intro",
      title: "Wire it up",
      body: "Bring your real academic life in: course platforms, files, papers, code, the web, and your calendar and mail.",
      beforeShow: goDashboard,
    },
    {
      id: "cr2-sources",
      title: "Open Sources",
      body: "Your source hub lives here.",
      anchor: '[data-tour="sources"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) => {
        if (useWorkspace.getState().surface === "sources") {
          advance();
          return () => {};
        }
        return useWorkspace.subscribe((s, prev) => {
          if (s.surface === "sources" && prev.surface !== "sources") advance();
        });
      },
    },
    {
      id: "cr2-provider",
      title: "Connect a provider",
      body: "Pick Canvas, Google Drive, Zotero, or GitHub and connect it — Zen pulls your material in and keeps it fresh.",
      interactive: true,
      optional: true,
      skipLabel: "Later",
      advanceWhen: (advance) => {
        const has = () => Object.values(useSources.getState().sources).some((s) => s.provider !== "web");
        if (has()) {
          advance();
          return () => {};
        }
        return useSources.subscribe(() => {
          if (has()) advance();
        });
      },
    },
    {
      id: "cr2-web",
      title: "Capture the web",
      body: "The Web category saves articles and pages as study sources — paste a URL and Zen keeps a readable copy.",
      interactive: true,
      optional: true,
      skipLabel: "Later",
      advanceWhen: (advance) => {
        const has = () => Object.values(useSources.getState().sources).some((s) => s.provider === "web");
        if (has()) {
          advance();
          return () => {};
        }
        return useSources.subscribe(() => {
          if (has()) advance();
        });
      },
    },
    {
      id: "cr2-admin",
      title: "Open Calendar or Mail",
      body: "Your schedule and inbox live one click away — open Calendar from here.",
      anchor: '[data-tour="calendar"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) =>
        useWorkspace.subscribe((s, prev) => {
          if (s.surface === "admin" && prev.surface !== "admin") advance();
        }),
    },
    {
      id: "cr2-real",
      title: "Add an event or email to Deep Work",
      body: "Right-click an event or email → “Add to Deep Work” and it becomes a source window like any note.",
      interactive: true,
      optional: true,
      skipLabel: "Skip — needs Google",
      advanceWhen: (advance) => {
        const has = () =>
          Object.values(useDeepWork.getState().sessions).some((session) =>
            session.items.some((item) => item.type === "event" || item.type === "mail")
          );
        if (has()) {
          advance();
          return () => {};
        }
        return useDeepWork.subscribe(() => {
          if (has()) advance();
        });
      },
    },
    {
      id: "cr2-done",
      title: "Wired up",
      body: "Courses, files, papers, code, web, calendar, mail — all of it flows into search and Deep Work.",
    },
  ],
  "trust-1": [
    {
      id: "tc-intro",
      title: "Trust and control",
      body: "Zen keeps your data on your device by default. Here's where to see exactly what it does with it.",
      beforeShow: goDashboard,
    },
    {
      id: "tc-settings",
      title: "Open Settings",
      body: "Open Settings to reach every control.",
      feedback: "Settings holds all of it — grouped in the rail on the left.",
      anchor: '[data-tour="settings"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) =>
        useWorkspace.subscribe((s, prev) => {
          if (s.surface === "settings" && prev.surface !== "settings") advance();
        }),
    },
    {
      id: "tc-rail",
      title: "Review your controls",
      body: "AI behavior lists every tool the AI may use — allow or block each. Data exports a full backup or copies diagnostics. Plan & usage shows your AI limits.",
      anchor: '[data-tour="settings-rail"]',
      interactive: true,
    },
    {
      id: "tc-done",
      title: "You're in control",
      body: "Nothing leaves your device unless you connect it. Review or export any time from here.",
    },
  ],
  "trust-2": [
    {
      id: "tc2-intro",
      title: "Own your data",
      body: "Take the controls for a spin: per-tool AI permissions, backups, diagnostics, and your plan limits.",
      beforeShow: goDashboard,
    },
    {
      id: "tc2-tools",
      title: "Adjust an AI tool permission",
      body: "Open the AI panel, then Tools — set any action to Ask (confirm first) or Off. Reads always stay local-safe.",
      anchor: '[data-tour="ai-toggle"]',
      interactive: true,
      optional: true,
      skipLabel: "Later",
      advanceWhen: (advance) => {
        const count = () => Object.keys(useToolPolicy.getState().overrides).length;
        const base = count();
        if (base > 0) {
          advance();
          return () => {};
        }
        return useToolPolicy.subscribe(() => {
          if (count() > base) advance();
        });
      },
    },
    {
      id: "tc2-settings",
      title: "Open Settings",
      body: "Backups, diagnostics, and your plan live in Settings.",
      anchor: '[data-tour="settings"]',
      interactive: true,
      beforeShow: goDashboard,
      advanceWhen: (advance) => {
        if (useWorkspace.getState().surface === "settings") {
          advance();
          return () => {};
        }
        return useWorkspace.subscribe((s, prev) => {
          if (s.surface === "settings" && prev.surface !== "settings") advance();
        });
      },
    },
    {
      id: "tc2-backups",
      title: "Review backups",
      body: "Open Data to export a full local backup or a settings-only copy.",
      anchor: '[data-tour="settings-rail"]',
      interactive: true,
    },
    {
      id: "tc2-diagnostics",
      title: "Inspect diagnostics",
      body: "Data also exposes copyable diagnostics for troubleshooting without hiding what is included.",
      anchor: '[data-tour="settings-rail"]',
      interactive: true,
    },
    {
      id: "tc2-plan",
      title: "Check plan and usage limits",
      body: "Open Plan & usage to see the AI models and limits available to your account.",
      anchor: '[data-tour="settings-rail"]',
      interactive: true,
    },
    {
      id: "tc2-done",
      title: "Yours, provably",
      body: "Permissions, backups, diagnostics, limits — every lever is on your side of the table.",
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
