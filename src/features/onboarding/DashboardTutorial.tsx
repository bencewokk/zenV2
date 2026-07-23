import { useEffect, useState } from "react";
import { useNotes } from "@/features/notes/store";
import { useAI } from "@/features/ai/store";
import { useDeepWork, sessionList } from "@/features/home/deepwork/deepworkStore";
import { navigate, createAndOpenNote } from "@/shared/stores/navigate";
import { useCommandPalette } from "@/features/search/CommandPalette";
import { Masonry } from "@/shared/ui/Masonry";
import { notify } from "@/shared/ui/notify";
import {
  onTutorialStateChange,
  readTutorialState,
  writeTutorialState,
  type TutorialManualState,
} from "@/features/home/dashboardPrefs";
import { isSeededSample } from "@/features/onboarding/contentSignals";
import { startCoreLoopTour, startGroupTour, GROUP_TOURS, isChecklistTourStep } from "@/features/onboarding/tours";
import { Button } from "@/shared/ui/Button";

/**
 * First-run checklist on the dashboard: four groups, each a guided walkthrough.
 *
 * This used to carry a multi-phase system — `currentPhaseIndex`, `justUnlocked`,
 * `seenAtMount`, "New goals unlocked" cues, per-phase progress bars and phase-transition
 * toasts. Every group was configured with exactly one phase, so none of it could ever
 * run; roughly 150 lines were unreachable. A group is now simply a checklist of its
 * walkthrough's steps.
 *
 * It also lived inside `Home.tsx`, which is why that file was 1377 lines.
 */

interface TutorialItem {
  key: string;
  label: string;
  done: boolean;
  /** Shown on the checklist but does not block completion. */
  optional?: boolean;
}

interface TutorialGroup {
  /** Also the GROUP_TOURS key for this group's walkthrough. */
  key: string;
  title: string;
  body: string;
  action: string;
  run: () => void;
  items: TutorialItem[];
}

function isGroupDone(group: TutorialGroup): boolean {
  return group.items.every((item) => item.done || item.optional);
}

export function DashboardTutorial() {
  const notes = useNotes((s) => s.notes);
  const renameNote = useNotes((s) => s.rename);
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const [manual, setManual] = useState<TutorialManualState>(() => readTutorialState());

  useEffect(() => writeTutorialState(manual), [manual]);
  useEffect(() => onTutorialStateChange(setManual), []);

  // Celebrate a group finishing while the dashboard is open. The first run only records a
  // baseline, so returning to the dashboard never re-toasts a group completed earlier.
  const [, setCompleted] = useState<Record<string, boolean> | null>(null);

  const openDeepWork = () => {
    const open = sessionList({ sessions, order }).filter((s) => !s.archived);
    const active = open.find((s) => s.id === useDeepWork.getState().activeId) ?? open[0] ?? null;
    navigate({ view: "deepwork", sessionId: active?.id ?? null });
  };

  // Seeded sample notes ship on every install, so only a note the user made counts toward
  // "create a note" — matching contentSignals and the tour's own create signal.
  const ownNoteCount = Object.values(notes).filter((note) => !isSeededSample(note)).length;
  const manualDone = manual.done ?? {};

  const configured: Omit<TutorialGroup, "items">[] = [
    {
      key: "material",
      title: "Capture & find",
      body: "Create a note, then jump to anything with instant search.",
      action: ownNoteCount ? "Try search" : "Create note",
      run: () => {
        if (ownNoteCount) return useCommandPalette.getState().setOpen(true);
        void createAndOpenNote(null).then((id) => void renameNote(id, "First study note"));
      },
    },
    {
      key: "deepwork",
      title: "Deep Work",
      body: "Turn loose notes, PDFs, events, or mail into one study workspace.",
      action: "Open Deep Work",
      run: openDeepWork,
    },
    {
      key: "study",
      title: "Study & quiz",
      body: "Use the learning loop: backbone, focus, quiz, feedback.",
      action: "Go study",
      run: openDeepWork,
    },
    {
      key: "assistant",
      title: "The AI assistant",
      body: "Work with an assistant that can understand and operate your academic workspace.",
      action: "Open Assistant",
      run: () => useAI.getState().setOpen(true),
    },
  ];

  // The checklist is generated from the walkthrough itself: one tick per substantive step,
  // so there are no orphan goals for state detection to guess at.
  const groups: TutorialGroup[] = configured.map((group) => ({
    ...group,
    items: (GROUP_TOURS[`${group.key}-1`] ?? [])
      .filter(isChecklistTourStep)
      .map((step) => ({ key: step.id, label: step.title, done: !!manualDone[step.id], optional: step.optional })),
  }));

  useEffect(() => {
    const snapshot = Object.fromEntries(groups.map((g) => [g.key, isGroupDone(g)]));
    setCompleted((prev) => {
      if (prev) {
        for (const g of groups) {
          if (!prev[g.key] && snapshot[g.key]) notify.success(`${g.title} complete 🎉`);
        }
      }
      return snapshot;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(manualDone)]);

  if (manual.hidden) return null;

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const done = groups.reduce((n, g) => n + g.items.filter((i) => i.done || i.optional).length, 0);
  const next = groups.find((g) => !isGroupDone(g)) ?? groups[groups.length - 1];

  return (
    <section className="mb-4 rounded-[14px] border border-[rgba(var(--accent-rgb),0.28)] bg-[rgba(var(--accent-rgb),0.055)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-dim)]">First Run Path</div>
          <div className="mt-1 text-sm font-semibold text-[var(--text)]">Learn Zen by doing</div>
          <p className="zen-secondary-copy mt-1 text-xs">Click any goal and Zen walks you through actually doing it.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="zen-pressable zen-shine rounded-[10px] bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-black hover:brightness-105"
            onClick={startCoreLoopTour}
            title="Hands-on tour: make a real note, find it, study it (~2 min)"
          >
            Do the core loop
          </button>
          <button
            className="text-xs text-[var(--text-dim)] transition hover:text-[var(--text)]"
            onClick={() => setManual((cur) => ({ ...cur, hidden: true }))}
            title="Hide tutorial"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width]"
          style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
        />
      </div>
      <div className="zen-meta mt-1.5 text-xs">
        {done} of {total} done{done < total ? ` — next up: ${next.title}` : " — all done 🎉"}
      </div>

      <Masonry className="mt-4">
        {groups.map((group) => {
          const groupDone = isGroupDone(group);
          const doneCount = group.items.filter((i) => i.done).length;
          const hasTour = !!GROUP_TOURS[`${group.key}-1`];
          return (
            <details
              key={group.key}
              className="group rounded-[12px] border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] px-3 py-2"
              open={group.key === next.key && !groupDone}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2">
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border text-[11px] ${
                    groupDone ? "border-transparent bg-[var(--accent)] text-black" : "border-[var(--border)] text-[var(--text-dim)]"
                  }`}
                >
                  {groupDone ? "✓" : doneCount}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--text)]">{group.title}</span>
                  <span className="zen-secondary-copy block text-xs">{group.body}</span>
                </span>
                <span className="text-xs text-[var(--text-dim)] transition group-open:rotate-90">→</span>
              </summary>

              <div className="mt-3 space-y-2">
                {group.items.map((item) => {
                  // Progress is read-only: advancing the walkthrough is the only thing that ticks it.
                  const launches = !item.done && hasTour;
                  return (
                    <button
                      key={item.key}
                      className="group/tick flex w-full items-start gap-2 text-left text-xs"
                      disabled={!launches}
                      onClick={() => startGroupTour(`${group.key}-1`)}
                      title={launches ? "Show me how — guided walkthrough" : undefined}
                    >
                      <span
                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border text-[10px] ${
                          item.done ? "border-transparent bg-[var(--text-dim)] text-black" : "border-[var(--border)] text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className={`min-w-0 flex-1 ${item.done ? "text-[var(--text-dim)] line-through" : "text-[var(--text)]"}`}>
                        {item.label}
                      </span>
                      {launches && (
                        <span className="shrink-0 text-[var(--text-dim)] opacity-0 transition group-hover/tick:opacity-100">Show me →</span>
                      )}
                    </button>
                  );
                })}
                {hasTour ? (
                  <Button className="zen-shine mt-1 w-full justify-center" onClick={() => startGroupTour(`${group.key}-1`)}>
                    Start walkthrough
                  </Button>
                ) : (
                  <Button variant="ghost" className="mt-1 w-full justify-center" onClick={group.run}>
                    {group.action}
                  </Button>
                )}
              </div>
            </details>
          );
        })}
      </Masonry>

      <Button className="zen-shine mt-4 w-full justify-center"
        onClick={() => (GROUP_TOURS[`${next.key}-1`] ? startGroupTour(`${next.key}-1`) : next.run())}
      >
        {GROUP_TOURS[`${next.key}-1`] ? `Walk me through: ${next.title}` : `Next: ${next.action}`}
      </Button>
    </section>
  );
}
