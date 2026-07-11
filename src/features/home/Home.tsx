import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildActionGroups,
  parseBriefItems,
  resolveTargetDetails,
  useHome,
  type HomeTarget,
} from "@/features/home/store";
import { DeepWorkV2 } from "@/features/home/deepwork/DeepWorkV2";
import { useFocusSession } from "@/features/home/deepwork/useFocusSession";
import { fmtClock, nextToReview, sessionList, useDeepWork } from "@/features/home/deepwork/deepworkStore";
import {
  reconcilePlan as reconcilePlanPure, nextSession, planHealth,
  fmtPlanDay, fmtStartMin, verdictColor, verdictLabel, mostUrgentExam, KIND_META,
} from "@/features/home/deepwork/studyPlan";
import { useStudyLog, dayKey, HOUR_MS, computeStreak } from "@/features/home/deepwork/studyLog";
import { useAiAccess, aiBlocked, aiBlockedMessage } from "@/features/ai/access";
import { useWorkspace } from "@/shared/stores/workspace";
import { WhatsNew } from "@/features/home/ReleaseNotes";
import { useNotes } from "@/features/notes/store";
import { useCommandPalette } from "@/features/search/CommandPalette";
import { useSources } from "@/services/sources/store";
import { useSparkIntro } from "@/features/onboarding/sparkStore";
import { docToText } from "@/shared/lib/docText";
import { renderMarkdownInline } from "@/shared/lib/renderMarkdown";
import { onTutorialStateChange, readTutorialState, writeTutorialState, type TutorialManualState } from "@/features/home/dashboardPrefs";
import { isSeededSample } from "@/features/onboarding/contentSignals";
import { notify } from "@/shared/ui/notify";
import { Masonry } from "@/shared/ui/Masonry";
import { AssistantConnect } from "@/features/home/AssistantConnect";
import { startCoreLoopTour, startGroupTour, GROUP_TOURS, isChecklistTourStep } from "@/features/onboarding/tours";

type AdminFocus = "calendar" | "mail";

const HIDDEN_TARGETS_KEY = "zen.home.hidden-targets.v1";

type HiddenTargets = Record<string, number>;

interface HomeProps {
  deepWork?: boolean;
  onOpenAdmin?: (focus: AdminFocus, targetId?: string) => void;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function Home({ deepWork = false, onOpenAdmin }: HomeProps) {
  const now = useClock();
  const notes = useNotes((s) => s.notes);
  const select = useNotes((s) => s.select);
  const summary = useHome((s) => s.summary);
  const summaryLoading = useHome((s) => s.summaryLoading);
  const events = useHome((s) => s.events);
  const threads = useHome((s) => s.threads);
  const focusTarget = useHome((s) => s.focusTarget);
  const setFocusTarget = useHome((s) => s.setFocusTarget);
  const regenerateSummary = useHome((s) => s.regenerateSummary);
  const doneBriefItems = useHome((s) => s.doneBriefItems);
  const markBriefItemDone = useHome((s) => s.markBriefItemDone);
  const bootstrap = useHome((s) => s.bootstrap);
  // Items ticked in this view stay visible (lined out) until reload; persisted done items vanish.
  const [briefStruck, setBriefStruck] = useState<Set<string>>(() => new Set());
  const [hiddenTargets, setHiddenTargets] = useState<HiddenTargets>(() => readHiddenTargets());
  const aiAccess = useAiAccess((s) => s.access);
  const aiOff = aiBlocked(aiAccess);
  const { session, sessionRemaining, sessionProgress, startSession, endSession } = useFocusSession();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    writeHiddenTargets(hiddenTargets);
  }, [hiddenTargets]);

  useEffect(() => {
    setHiddenTargets((current) => pruneHiddenTargets(current, now.getTime()));
  }, [now]);

  const visibleNotes = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(notes).filter(([id]) => !isTargetHidden(hiddenTargets, { type: "note", id }, now.getTime()))
      ),
    [hiddenTargets, notes, now]
  );
  const visibleEvents = useMemo(
    () => events.filter((event) => !isTargetHidden(hiddenTargets, { type: "event", id: event.id }, now.getTime())),
    [events, hiddenTargets, now]
  );
  const visibleThreads = useMemo(
    () => threads.filter((thread) => !isTargetHidden(hiddenTargets, { type: "mail", id: thread.id }, now.getTime())),
    [hiddenTargets, now, threads]
  );

  const matchedThreadLabels = useHome((s) => s.matchedThreadLabels);
  const groups = useMemo(() => buildActionGroups(visibleNotes, visibleEvents, visibleThreads, matchedThreadLabels), [visibleEvents, visibleNotes, visibleThreads, matchedThreadLabels]);
  const focus = useMemo(
    () => resolveTargetDetails(focusTarget, visibleNotes, visibleEvents, visibleThreads),
    [focusTarget, visibleEvents, visibleNotes, visibleThreads]
  );

  // Parse the brief into checklist items, hiding ones already ticked off on a prior view.
  const briefItems = useMemo(
    () =>
      parseBriefItems(summary)
        // Reassuring "nothing to act on" lines aren't tasks — show them as the cleared
        // state, not as a tickable checklist item.
        .filter((item) => !(!item.source && /^nothing\s+(needs|to\s+worry)/i.test(item.text)))
        .filter((item) => !doneBriefItems.includes(item.key) || briefStruck.has(item.key)),
    [summary, doneBriefItems, briefStruck]
  );

  function tickBriefItem(key: string, text: string) {
    setBriefStruck((current) => new Set(current).add(key));
    markBriefItemDone(key, text);
  }

  const openAdmin = onOpenAdmin ?? (() => undefined);
  const focusTime = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const focusDate = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  function openTarget(target: HomeTarget | null) {
    if (!target) return;
    if (target.type === "note") {
      select(target.id);
      return;
    }
    openAdmin(target.type === "event" ? "calendar" : "mail", target.id);
  }

  if (deepWork) {
    return (
      <section className="relative h-full min-h-0 overflow-hidden">
        <DeepWorkV2
          notes={visibleNotes}
          events={visibleEvents}
          threads={visibleThreads}
          sessionActive={!!session}
        />
      </section>
    );
  }

  return (
    <section className="relative h-full min-h-0 overflow-hidden px-2 py-2 sm:px-3 sm:py-3">
      <div className="h-full min-h-0 w-full">
        <div className="zen-home-center">
          <div className="zen-panel-scroll h-full min-h-0 overflow-y-auto pr-1">
            {/* Self-hides when dismissed / toggled off in Settings. */}
            <DashboardTutorial />

            <Masonry>
              {/* Clock + weekly study chart */}
              <DailyFocusTile focusTime={focusTime} focusDate={focusDate} />

              {/* Most urgent exam — self-styled, renders nothing when no plan */}
              <ExamFocusHero now={now.getTime()} className="bento-item" />

              {/* Focus timer */}
              <div className="bento-tile">
                <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">Focus Timer</div>
                {session ? (
                  <div className="mt-3 rounded-[14px] border border-[rgba(var(--accent-rgb),0.3)] bg-[rgba(var(--accent-rgb),0.06)] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-3xl font-semibold tabular-nums text-[var(--text)]">
                        {fmtClock(sessionRemaining)}
                      </span>
                      <button
                        className="rounded-[12px] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-dim)] transition hover:text-[var(--text)]"
                        onClick={endSession}
                      >
                        End session
                      </button>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-1000"
                        style={{ width: `${sessionProgress}%` }}
                      />
                    </div>
                    <div className="zen-secondary-copy mt-2 text-xs">
                      {sessionRemaining <= 0
                        ? "Time's up — wrap up or start a fresh block."
                        : "Stay on your current focus."}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {[25, 50, 90].map((d) => (
                      <button
                        key={d}
                        className="zen-pressable rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)]"
                        onClick={() => startSession(d)}
                      >
                        {d}m
                      </button>
                    ))}
                    <span className="zen-secondary-copy text-xs">Start a timed focus block.</span>
                  </div>
                )}
              </div>

              {/* Deep Work — self-styled card, always renders */}
              <DeepWorkRecommendations now={now.getTime()} className="bento-item" />

              {/* Startup brief */}
              <div className="bento-tile">
                <div className="flex items-start justify-between gap-3">
                  <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">Startup Brief</div>
                  {aiOff ? (
                    <button
                      className="zen-pressable shrink-0 rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                      onClick={() => {
                        select(null);
                        useWorkspace.getState().set({ surface: "settings", adminMailId: null });
                      }}
                    >
                      Open Settings
                    </button>
                  ) : (
                    <button
                      className="zen-pressable zen-shine shrink-0 rounded-[10px] bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-black hover:brightness-105 disabled:opacity-60"
                      onClick={() => void regenerateSummary()}
                      disabled={summaryLoading}
                    >
                      {summaryLoading ? "Generating..." : "Generate"}
                    </button>
                  )}
                </div>
                {summaryLoading && !summary ? (
                  <div className="zen-primary-copy mt-3 text-[15px] text-[var(--text)]">Generating your brief...</div>
                ) : briefItems.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 text-[15px] text-[var(--text)]">
                    {briefItems.map((item) => {
                      const done = doneBriefItems.includes(item.key);
                      return (
                        <li key={item.key} className="flex items-start gap-2.5">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={done}
                            disabled={done}
                            onClick={() => tickBriefItem(item.key, item.text)}
                            aria-label={`Mark done: ${item.text}`}
                            className={`mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border transition ${
                              done
                                ? "border-transparent bg-[var(--text-dim)] text-black"
                                : "cursor-pointer border-[var(--border)] hover:border-[var(--text-dim)]"
                            }`}
                          >
                            {done && (
                              <svg viewBox="0 0 12 12" className="zen-anim-burst h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                                <path d="M2.5 6.4l2.4 2.4 4.6-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                          <span className={`zen-primary-copy min-w-0 flex-1 ${done ? "text-[var(--text-dim)] line-through" : ""}`}>
                            <span dangerouslySetInnerHTML={{ __html: renderMarkdownInline(item.text) }} />
                            {item.source && (
                              <button
                                type="button"
                                onClick={() => openTarget(item.source)}
                                className="ml-1.5 align-middle text-[13px] text-[var(--text-dim)] transition hover:text-[var(--text)]"
                                aria-label="Open source"
                                title="Open source"
                              >
                                ↗
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : aiOff ? (
                  <div className="zen-secondary-copy mt-3 text-[15px]">{aiBlockedMessage(aiAccess)}</div>
                ) : summary ? (
                  <div className="zen-secondary-copy mt-3 text-[15px]">All cleared for today. Regenerate for a fresh brief.</div>
                ) : (
                  <div className="zen-primary-copy mt-3 text-[15px] text-[var(--text)]">Generate a focus brief to seed the canvas.</div>
                )}
              </div>

              {/* Active workspace */}
              <div className="bento-tile">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">Active Workspace</div>
                    <div className="mt-1 text-lg font-semibold text-[var(--text)]">
                      {focus.kind === "empty"
                        ? "No active item selected"
                        : focus.kind === "event"
                          ? focus.event.summary
                          : focus.kind === "mail"
                            ? focus.thread.subject
                            : focus.note.title || "Untitled"}
                    </div>
                  </div>
                  <button
                    className="zen-pressable rounded-[12px] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-60"
                    onClick={() => openTarget(focusTarget)}
                    disabled={focus.kind === "empty"}
                  >
                    {focus.kind === "event"
                      ? "Open Calendar"
                      : focus.kind === "mail"
                        ? "Open Mail"
                        : focus.kind === "note"
                          ? "Open Note"
                          : "Open"}
                  </button>
                </div>
                <div className="mt-4">
                  <FocusWorkspace focus={focus} notes={visibleNotes} />
                </div>
              </div>

              {/* Jump back in — quick navigation */}
              <div className="bento-tile">
                <div className="mb-3">
                  <SectionLabel>Jump Back In</SectionLabel>
                </div>
                <QuickAccessBento onOpenAdmin={openAdmin} />
              </div>

              {/* Phone assistant — QR handoff to the assistant PWA */}
              <div className="bento-tile" data-tour="phone-qr">
                <div className="mb-3">
                  <SectionLabel>Zen on your phone</SectionLabel>
                </div>
                <AssistantConnect />
              </div>

              {/* What's new — self-styled button */}
              <div className="bento-item">
                <WhatsNew />
              </div>

              {/* AI labels */}
              <div className="bento-tile">
                <LabelManager />
              </div>

              {/* Action feed */}
              <div className="bento-tile">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <SectionLabel>Action Feed</SectionLabel>
                  <span className="zen-meta text-xs">Chronological</span>
                </div>
                <div className="zen-stagger space-y-4">
                  {groups.length === 0 ? (
                    <EmptyState
                      title="Nothing needs attention yet"
                      body="Unread mail, recent notes, and upcoming events will show up here automatically."
                    />
                  ) : (
                    groups.map((group) => (
                      <div
                        key={group.key}
                        className="zen-flat-feed-group pl-4"
                        style={{ borderLeft: `3px solid ${group.accent}` }}
                      >
                        <button
                          className="w-full text-left transition-transform duration-150 ease-out enabled:hover:translate-x-1 disabled:opacity-100"
                          disabled={!group.target}
                          onClick={() => {
                            if (!group.target) return;
                            setFocusTarget(group.target);
                            openTarget(group.target);
                          }}
                        >
                          <div className="zen-clamp-1 text-sm font-medium text-[var(--text)]">{group.title}</div>
                          <div className="zen-meta zen-clamp-1 mt-1 text-xs">{group.subtitle}</div>
                        </button>

                        {group.children.length > 0 && (
                          <div className="mt-2 space-y-1.5 pl-2">
                            {group.children.map((child) => (
                              <button
                                key={child.key}
                                className="flex w-full items-start gap-3 rounded-[12px] px-2 py-1.5 text-left transition hover:translate-x-1 hover:bg-[rgba(255,255,255,0.03)]"
                                onClick={() => {
                                  setFocusTarget(child.target);
                                  openTarget(child.target);
                                }}
                              >
                                <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: child.accent }} />
                                <span className="min-w-0 flex-1">
                                  <span className="zen-clamp-1 block text-sm text-[var(--text)]">{child.title}</span>
                                  <span className="zen-meta zen-clamp-1 mt-0.5 block text-xs">{child.subtitle}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Masonry>
          </div>
        </div>
      </div>
    </section>
  );
}

type TutorialItem = {
  key: string;
  label: string;
  done: boolean;
  manual?: boolean;
  /** Shown on the checklist but does NOT block phase / group completion. */
  optional?: boolean;
};

type TutorialPhase = {
  /** `<group>-<number>` — also the GROUP_TOURS key for this phase's walkthrough. */
  key: string;
  label: string;
  items: TutorialItem[];
};

type TutorialGroup = {
  key: string;
  title: string;
  body: string;
  action: string;
  run: () => void;
  /** Ordered phases; a deeper phase stays hidden until the prior one is complete. */
  phases: TutorialPhase[];
};

/** The phase the group currently shows: the first with an unfinished item
 *  (falling back to the last once everything is done). */
function currentPhaseIndex(group: TutorialGroup): number {
  const idx = group.phases.findIndex((phase) => phase.items.some((item) => !item.done && !item.optional));
  return idx === -1 ? group.phases.length - 1 : idx;
}

function DashboardTutorial() {
  const notes = useNotes((s) => s.notes);
  const createNote = useNotes((s) => s.create);
  const renameNote = useNotes((s) => s.rename);
  const selectNote = useNotes((s) => s.select);
  const sourcesCount = useSources((s) => Object.keys(s.sources).length);
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const switchSession = useDeepWork((s) => s.switchSession);
  const setManualDeepWork = useHome((s) => s.setManualDeepWork);
  const setWorkspace = useWorkspace((s) => s.set);
  const startSpark = useSparkIntro((s) => s.start);
  const [manual, setManual] = useState<TutorialManualState>(() => readTutorialState());
  useEffect(() => writeTutorialState(manual), [manual]);
  useEffect(() => onTutorialStateChange(setManual), []);

  // "New goals unlocked" shows only the FIRST time a deeper phase is seen. The
  // snapshot is frozen for this mount so the cue doesn't vanish mid-visit; the
  // effect below persists the keys, hiding the cue from the next visit on.
  const [seenAtMount] = useState<Record<string, boolean>>(() => readTutorialState().seen ?? {});
  const groupsRef = useRef<TutorialGroup[]>([]);
  const prevProgress = useRef<Record<string, { idx: number; done: boolean }> | null>(null);
  useEffect(() => {
    const snapshot = Object.fromEntries(
      groupsRef.current.map((group) => [
        group.key,
        {
          idx: currentPhaseIndex(group),
          done: group.phases.every((phase) => phase.items.every((item) => item.done || item.optional)),
        },
      ])
    );
    // Celebrate transitions that happen while the dashboard is open (the first
    // run only records a baseline, so returning to the dashboard never toasts).
    const prev = prevProgress.current;
    prevProgress.current = snapshot;
    if (prev) {
      for (const group of groupsRef.current) {
        const before = prev[group.key];
        const now = snapshot[group.key];
        if (!before || !now) continue;
        if (!before.done && now.done) notify.success(`${group.title} complete 🎉`);
        else if (now.idx > before.idx) notify.success(`${group.phases[before.idx].label} complete — new goals unlocked`);
      }
    }
    // Persist which deeper phases have shown their cue.
    const unseen = groupsRef.current
      .filter((group) => currentPhaseIndex(group) > 0)
      .map((group) => group.phases[currentPhaseIndex(group)].key)
      .filter((key) => !manual.seen?.[key]);
    if (unseen.length) {
      setManual((current) => ({
        ...current,
        seen: { ...current.seen, ...Object.fromEntries(unseen.map((key) => [key, true])) },
      }));
    }
  });

  if (manual.hidden) return null;

  const allSessions = sessionList({ sessions, order }).filter((session) => !session.archived);
  const activeSession = allSessions.find((session) => session.id === useDeepWork.getState().activeId) ?? allSessions[0] ?? null;
  // Seeded sample notes ship on every install — only a note the user made counts
  // toward "create a note" (matches contentSignals / the tour's create signal).
  const ownNoteCount = Object.values(notes).filter((note) => !isSeededSample(note)).length;
  const manualDone = manual.done ?? {};
  const openDeepWork = () => {
    if (activeSession) switchSession(activeSession.id);
    selectNote(null);
    setWorkspace({ surface: "home", adminMailId: null });
    setManualDeepWork(true);
  };
  const openSettings = () => {
    selectNote(null);
    setManualDeepWork(false);
    setWorkspace({ surface: "settings", adminMailId: null });
  };
  const openSources = () => {
    selectNote(null);
    setManualDeepWork(false);
    setWorkspace({ surface: "sources", adminMailId: null });
  };

  const configuredGroups: TutorialGroup[] = [
    {
      key: "setup",
      title: "Set Up Zen",
      body: "Finish the foundation so Zen knows what it may connect.",
      action: "Replay setup",
      run: startSpark,
      phases: [
        {
          key: "setup-1",
          label: "Foundation",
          items: [],
        },
        {
          key: "setup-2",
          label: "Make it yours",
          items: [],
        },
      ],
    },
    {
      key: "material",
      title: "Collect Material",
      body: "Open or create the material Zen will help you study.",
      action: ownNoteCount ? "Try search" : "Create note",
      run: () => {
        if (ownNoteCount) {
          useCommandPalette.getState().setOpen(true);
          return;
        }
        void createNote(null).then((id) => {
          void renameNote(id, "First study note");
          selectNote(id);
        });
      },
      phases: [
        {
          key: "material-1",
          label: "Capture",
          items: [],
        },
        {
          key: "material-2",
          label: "Organise & link",
          items: [],
        },
        {
          key: "material-3",
          label: "Author & solve",
          items: [],
        },
      ],
    },
    {
      key: "deepwork",
      title: "Start Deep Work",
      body: "Turn loose notes, PDFs, events, or mail into one study workspace.",
      action: "Open Deep Work",
      run: openDeepWork,
      phases: [
        {
          key: "deepwork-1",
          label: "Build a workspace",
          items: [],
        },
        {
          key: "deepwork-2",
          label: "Work the canvas",
          items: [],
        },
      ],
    },
    {
      key: "study",
      title: "Study And Quiz",
      body: "Use the learning loop: backbone, focus, quiz, feedback.",
      action: "Go study",
      run: openDeepWork,
      phases: [
        {
          key: "study-1",
          label: "The loop",
          items: [],
        },
        {
          key: "study-2",
          label: "Evidence & mastery",
          items: [],
        },
        {
          key: "study-3",
          label: "Plan to the deadline",
          items: [],
        },
        {
          key: "study-4",
          label: "Lessons & tutoring",
          items: [],
        },
      ],
    },
    {
      key: "connect",
      title: "Connect Real Life",
      body: "Bring in outside academic context when you want it.",
      action: sourcesCount ? "Open Sources" : "Connect sources",
      run: sourcesCount ? openSources : openSettings,
      phases: [
        {
          key: "connect-1",
          label: "Bring it in",
          items: [],
        },
        {
          key: "connect-2",
          label: "Wire it up",
          items: [],
        },
      ],
    },
    {
      key: "trust",
      title: "Trust And Control",
      body: "Know where data, AI tools, backups, and diagnostics live.",
      action: "Open Settings",
      run: openSettings,
      phases: [
        {
          key: "trust-1",
          label: "Where things live",
          items: [],
        },
        {
          key: "trust-2",
          label: "Own your data",
          items: [],
        },
      ],
    },
  ];

  // The checklist is generated from the walkthrough itself: one visible tick
  // for every substantive step, and no orphan goals for state detection to
  // guess at. Intro and completion cards intentionally have no tick.
  const groups: TutorialGroup[] = configuredGroups.map((group) => ({
    ...group,
    phases: group.phases.map((phase) => ({
      ...phase,
      items: (GROUP_TOURS[phase.key] ?? [])
        .filter(isChecklistTourStep)
        .map((step) => ({ key: step.id, label: step.title, done: !!manualDone[step.id] })),
    })),
  }));

  // Let the transition-watching effect see this render's group state.
  groupsRef.current = groups;

  // Progress counts only the phases unlocked so far — deeper phases join the
  // total (and the bar dips) when they unlock, which is the "new goals" moment.
  const { total, done } = groups.reduce(
    (acc, group) => {
      for (const phase of group.phases.slice(0, currentPhaseIndex(group) + 1)) {
        acc.total += phase.items.length;
        // Optional items never block completion, so count them as satisfied for
        // the bar — otherwise a skipped optional keeps it below 100% forever.
        acc.done += phase.items.filter((item) => item.done || item.optional).length;
      }
      return acc;
    },
    { total: 0, done: 0 }
  );
  const nextGroup =
    groups.find((group) => group.phases.some((phase) => phase.items.some((item) => !item.done && !item.optional))) ??
    groups[groups.length - 1];

  return (
    <section className="mb-4 rounded-[14px] border border-[rgba(var(--accent-rgb),0.28)] bg-[rgba(var(--accent-rgb),0.055)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>First Run Path</SectionLabel>
          <div className="mt-1 text-sm font-semibold text-[var(--text)]">Learn Zen by doing</div>
          <p className="zen-secondary-copy mt-1 text-xs">Click any goal below and Zen walks you through actually doing it.</p>
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
            onClick={() => setManual((current) => ({ ...current, hidden: true }))}
            title="Hide tutorial"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
        <div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </div>
      <div className="zen-meta mt-1.5 text-xs">{done} of {total} done{done < total ? ` — next up: ${nextGroup.title}` : " — all done 🎉"}</div>

      <Masonry className="mt-4">
        {groups.map((group) => {
          // Only the CURRENT phase is shown in full: earlier phases collapse to a
          // "complete" line, later phases stay hidden until this one is done.
          const phaseIdx = currentPhaseIndex(group);
          const phase = group.phases[phaseIdx];
          const phaseDoneCount = phase.items.filter((item) => item.done).length;
          const groupDone = group.phases.every((p) => p.items.every((item) => item.done || item.optional));
          const justUnlocked = phaseIdx > 0 && !groupDone && !seenAtMount[phase.key];
          return (
            <details key={group.key} className="group rounded-[12px] border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] px-3 py-2" open={group.key === nextGroup.key && !groupDone}>
              <summary className="flex cursor-pointer list-none items-center gap-2">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border text-[11px] ${groupDone ? "border-transparent bg-[var(--accent)] text-black" : "border-[var(--border)] text-[var(--text-dim)]"}`}>
                  {groupDone ? "✓" : phaseDoneCount}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--text)]">{group.title}</span>
                  <span className="zen-secondary-copy block text-xs">{group.body}</span>
                </span>
                <span className="text-xs text-[var(--text-dim)] transition group-open:rotate-90">→</span>
              </summary>
              <div className="mt-3 space-y-2">
                {group.phases.slice(0, phaseIdx).map((donePhase) => (
                  <div key={donePhase.key} className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] bg-[var(--accent)] text-[10px] text-black">✓</span>
                    <span>{donePhase.label} complete</span>
                  </div>
                ))}
                {/* Keyed by phase so a newly-unlocked phase remounts and pops in. */}
                <div key={phase.key} className={`space-y-2 ${justUnlocked ? "zen-anim-pop" : ""}`}>
                  {group.phases.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-dim)]">
                      <span>
                        Phase {phaseIdx + 1} of {group.phases.length} — {phase.label}
                      </span>
                      {justUnlocked && (
                        <span className="rounded-full bg-[var(--accent-dim)] px-1.5 py-0.5 normal-case tracking-normal text-[var(--accent)]">
                          New goals unlocked
                        </span>
                      )}
                    </div>
                  )}
                  {phase.items.map((item) => {
                    // The checklist is read-only progress. Every unfinished item
                    // enters its phase walkthrough; advancing through that
                    // walkthrough is the only thing that can tick it.
                    const launchesTour = !item.done && !!GROUP_TOURS[phase.key];
                    return (
                      <button
                        key={item.key}
                        className="group/tick flex w-full items-start gap-2 text-left text-xs"
                        disabled={!launchesTour}
                        onClick={() => startGroupTour(phase.key)}
                        title={launchesTour ? "Show me how — guided walkthrough" : undefined}
                      >
                        <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border text-[10px] ${item.done ? "border-transparent bg-[var(--text-dim)] text-black" : "border-[var(--border)] text-transparent"}`}>
                          ✓
                        </span>
                        <span className={`min-w-0 flex-1 ${item.done ? "text-[var(--text-dim)] line-through" : "text-[var(--text)]"}`}>{item.label}</span>
                        {launchesTour && (
                          <span className="shrink-0 text-[var(--text-dim)] opacity-0 transition group-hover/tick:opacity-100">Show me →</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {GROUP_TOURS[phase.key] ? (
                  <button
                    className="zen-btn zen-shine mt-1 w-full justify-center"
                    onClick={() => startGroupTour(phase.key)}
                  >
                    Start walkthrough
                  </button>
                ) : (
                  <button className="zen-btn-ghost mt-1 w-full justify-center" onClick={group.run}>{group.action}</button>
                )}
              </div>
            </details>
          );
        })}
      </Masonry>

      {/* Primary CTA leads into DOING the next unfinished phase — its guided
          walkthrough when one exists, the group's plain action otherwise. */}
      {(() => {
        const nextPhase = nextGroup.phases[currentPhaseIndex(nextGroup)];
        const hasTour = !!GROUP_TOURS[nextPhase.key];
        return (
          <button
            className="zen-btn zen-shine mt-4 w-full justify-center"
            onClick={() => (hasTour ? startGroupTour(nextPhase.key) : nextGroup.run())}
          >
            {hasTour ? `Walk me through: ${nextGroup.title} — ${nextPhase.label}` : `Next: ${nextGroup.action}`}
          </button>
        );
      })()}
    </section>
  );
}

/**
 * Compact calm launcher for the app's main workspaces — the dashboard's
 * "jump back in" tile. A quiet 2-column grid of nav buttons that matches the
 * zen mindset rather than the old flashy MagicBento treatment.
 */
function QuickAccessBento({ onOpenAdmin }: { onOpenAdmin: (focus: AdminFocus, targetId?: string) => void }) {
  const createNote = useNotes((s) => s.create);
  const renameNote = useNotes((s) => s.rename);
  const selectNote = useNotes((s) => s.select);
  const switchSession = useDeepWork((s) => s.switchSession);
  const setManualDeepWork = useHome((s) => s.setManualDeepWork);
  const setWorkspace = useWorkspace((s) => s.set);

  function openDeepWork() {
    const { sessions, order, activeId } = useDeepWork.getState();
    const active = sessionList({ sessions, order }).find((session) => !session.archived && session.id === activeId)
      ?? sessionList({ sessions, order }).find((session) => !session.archived);
    if (active) switchSession(active.id);
    selectNote(null);
    setWorkspace({ surface: "home", adminMailId: null });
    setManualDeepWork(true);
  }

  const items: Array<{ label: string; title: string; tour?: string; onClick: () => void }> = [
    { label: "Focus", title: "Deep Work", tour: "deep-work", onClick: openDeepWork },
    {
      label: "Capture",
      title: "New note",
      tour: "new-note",
      onClick: () => {
        setManualDeepWork(false);
        setWorkspace({ surface: "home", adminMailId: null });
        void createNote(null).then((id) => {
          void renameNote(id, "New note");
          selectNote(id);
        });
      },
    },
    { label: "Find", title: "Search", tour: "search", onClick: () => useCommandPalette.getState().setOpen(true) },
    {
      label: "Connect",
      title: "Sources",
      tour: "sources",
      onClick: () => {
        selectNote(null);
        setManualDeepWork(false);
        setWorkspace({ surface: "sources", adminMailId: null });
      },
    },
    { label: "Plan", title: "Calendar", tour: "calendar", onClick: () => onOpenAdmin("calendar") },
    {
      label: "Tune",
      title: "Settings",
      tour: "settings",
      onClick: () => {
        selectNote(null);
        setManualDeepWork(false);
        setWorkspace({ surface: "settings", adminMailId: null });
      },
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <button
          key={item.title}
          data-tour={item.tour}
          onClick={item.onClick}
          className="zen-pressable rounded-[12px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5 text-left transition hover:border-[var(--text-dim)]"
        >
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-dim)]">{item.label}</div>
          <div className="mt-0.5 text-sm font-medium text-[var(--text)]">{item.title}</div>
        </button>
      ))}
    </div>
  );
}

function LabelManager() {
  const labels = useHome((s) => s.customLabels);
  const addCustomLabel = useHome((s) => s.addCustomLabel);
  const removeCustomLabel = useHome((s) => s.removeCustomLabel);
  const [draft, setDraft] = useState("");

  function submit() {
    addCustomLabel(draft);
    setDraft("");
  }

  return (
    <div data-tour="ai-labels">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel>AI Labels</SectionLabel>
        <span className="zen-meta text-xs">Topics for email</span>
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Add a topic the AI should tag…"
        className="w-full rounded-[10px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
      />
      {labels.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {labels.map((label) => (
            <LabelRow key={label.name} name={label.name} hint={label.hint} onRemove={() => removeCustomLabel(label.name)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LabelRow({ name, hint, onRemove }: { name: string; hint: string; onRemove: () => void }) {
  const updateCustomLabel = useHome((s) => s.updateCustomLabel);
  const [draftHint, setDraftHint] = useState(hint);

  // Keep local draft in sync if the stored hint changes elsewhere.
  useEffect(() => setDraftHint(hint), [hint]);

  function commit() {
    if (draftHint.trim() !== hint.trim()) updateCustomLabel(name, draftHint.trim());
  }

  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-[var(--text)]">{name}</span>
        <button
          className="shrink-0 text-[var(--text-dim)] transition hover:text-[var(--danger)]"
          onClick={onRemove}
          title={`Remove ${name}`}
        >
          ✕
        </button>
      </div>
      <input
        value={draftHint}
        onChange={(e) => setDraftHint(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder="Match hint: senders, keywords, context…"
        className="mt-1.5 w-full rounded-[8px] border border-transparent bg-[rgba(255,255,255,0.02)] px-2 py-1 text-xs text-[var(--text-dim)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--border)] focus:text-[var(--text)]"
      />
    </div>
  );
}

function FocusWorkspace({
  focus,
  notes,
}: {
  focus: ReturnType<typeof resolveTargetDetails>;
  notes: ReturnType<typeof useNotes.getState>["notes"];
}) {
  if (focus.kind === "event") {
    const event = focus.event;
    return (
      <div className="space-y-3">
        <div className="zen-meta text-sm">{formatEventWindow(event.start, event.end, event.allDay)}</div>
        {event.location && <div className="text-sm text-[var(--text)]">{event.location}</div>}
        <p className="zen-primary-copy whitespace-pre-wrap text-sm text-[var(--text)]">
          {event.description?.trim() || "No event description. Use this block as the parent container for the work that should happen around this meeting or study window."}
        </p>
      </div>
    );
  }

  if (focus.kind === "mail") {
    return (
      <div className="space-y-3">
        <div className="zen-meta text-sm">{focus.thread.from}</div>
        <p className="zen-primary-copy text-sm text-[var(--text)]">{focus.thread.snippet}</p>
        <div className="zen-meta text-xs uppercase tracking-[0.22em]">
          {focus.thread.unread ? "Unread thread" : "Read thread"} - {formatThreadDate(focus.thread.date)}
        </div>
      </div>
    );
  }

  if (focus.kind === "note") {
    const preview = docToText(focus.note.content).trim();
    return (
      <div className="space-y-4">
        <div className="zen-meta flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em]">
          {focus.note.space && <span>{focus.note.space}</span>}
          {focus.note.subject && <span>{focus.note.subject}</span>}
          {focus.note.unit && <span>{focus.note.unit}</span>}
          {focus.note.inbox && <span>Inbox</span>}
        </div>
        <div
          className="zen-primary-copy rounded-[14px] border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 text-sm text-[var(--text)]"
          style={{ borderLeft: `3px solid ${focus.accent}` }}
        >
          {preview || "This note has no text yet. Open it to start writing."}
        </div>
        {focus.note.tags.length > 0 && (
          <div className="zen-meta flex flex-wrap gap-2 text-xs">
            {focus.note.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-[var(--border)] px-2 py-0.5">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const inboxCount = Object.values(notes).filter((note) => note.inbox).length;
  return (
    <EmptyState
      title="Select a task, thread, or note"
      body={
        inboxCount > 0
          ? `You still have ${inboxCount} inbox item${inboxCount === 1 ? "" : "s"} to triage.`
          : "Pick an item from the Action Feed, or open a note from the sidebar."
      }
    />
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-dim)]">{children}</div>;
}

/**
 * Clock + date + streak + weekly study chart, combined so the streak/summary row
 * sits between the date and the divider — the quick "how am I doing?" answer
 * before the detailed chart.
 */
function DailyFocusTile({ focusTime, focusDate }: { focusTime: string; focusDate: string }) {
  const days = useStudyLog((s) => s.days);
  const goalHours = useStudyLog((s) => s.goalHours);
  const goalMs = goalHours * HOUR_MS;
  const streak = computeStreak(days, goalMs);

  // Weekly totals from the same 7-day window the chart renders.
  const weekTotal = useMemo(() => {
    const now = new Date();
    let total = 0;
    let daysMet = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const ms = days[dayKey(d)] ?? 0;
      total += ms;
      if (ms >= goalMs) daysMet++;
    }
    return { total, daysMet };
  }, [days, goalMs]);

  return (
    <div className="bento-tile">
      <SectionLabel>Daily Focus</SectionLabel>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text)]">{focusTime}</div>
      <div className="zen-meta text-sm">{focusDate}</div>

      {/* Streak + weekly summary — the one-line answer before the chart */}
      {weekTotal.total > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {streak > 0 && (
            <span className="font-medium tabular-nums text-[var(--text)]" title={`${streak}-day study streak`}>
              {streak}d streak
            </span>
          )}
          <span className="tabular-nums text-[var(--text-dim)]">
            {(weekTotal.total / HOUR_MS).toFixed(1)}h this week
          </span>
          <span className="tabular-nums text-[var(--text-dim)]">
            · {weekTotal.daysMet}/7 days on track
          </span>
          {weekTotal.daysMet === 7 && <span className="text-[#4ade80]">All week</span>}
        </div>
      ) : (
        <div className="mt-2 text-xs text-[var(--text-dim)] italic">
          No study data yet — start a focus session.
        </div>
      )}

      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <WeeklyStudyChart />
      </div>
    </div>
  );
}

/** Last-7-days study-hours bar chart, replacing the daily quote. */
function WeeklyStudyChart() {
  const days = useStudyLog((s) => s.days);
  const goalHours = useStudyLog((s) => s.goalHours);

  const data = useMemo(() => {
    const now = new Date();
    const result: { label: string; hours: number; dateKey: string }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      const ms = days[key] ?? 0;
      result.push({
        label: d.toLocaleDateString([], { weekday: "short" }),
        hours: ms / HOUR_MS,
        dateKey: key,
      });
    }
    return result;
  }, [days]);

  const maxH = Math.max(goalHours, ...data.map((d) => d.hours), 0.5);
  const anyData = data.some((d) => d.hours > 0);

  /* ── chart geometry (px) ── */
  const padLeft = 0;
  const padBottom = 18;
  const padTop = 4;
  const chartH = 64;
  const svgH = chartH + padTop + padBottom;
  const barW = 12;
  const gap = (): number => {
    const avail = 100 - data.length * barW;
    return Math.max(avail / (data.length + 1), 4);
  };

  if (!anyData) {
    return (
      <div className="mt-3 text-xs text-[var(--text-dim)] italic">
        No study data yet — start a focus session.
      </div>
    );
  }

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 100 ${svgH}`}
        className="w-full"
        style={{ maxHeight: svgH }}
        role="img"
        aria-label="Last 7 days study hours"
      >
        {/* goal reference line */}
        <line
          x1={0}
          y1={padTop + chartH - (goalHours / maxH) * chartH}
          x2={100}
          y2={padTop + chartH - (goalHours / maxH) * chartH}
          stroke="var(--border)"
          strokeDasharray="2 2"
          strokeWidth={0.5}
        />

        {data.map((d, i) => {
          const x = gap() + i * (barW + gap());
          const barH = (d.hours / maxH) * chartH;
          const y = padTop + chartH - barH;
          const met = d.hours >= goalHours;
          const fill = met ? "#4ade80" : "var(--accent)";
          const todayKey = dayKey();
          const isToday = d.dateKey === todayKey;

          return (
            <g key={d.dateKey}>
              {/* bar */}
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, isToday ? 1.5 : 0)}
                rx={3}
                fill={fill}
                opacity={isToday ? 1 : 0.72}
              >
                <title>
                  {d.label}: {d.hours.toFixed(1)}h
                  {met ? " ✓" : ""}
                </title>
              </rect>
              {/* day label */}
              <text
                x={x + barW / 2}
                y={svgH - 2}
                textAnchor="middle"
                className="select-none"
                fill={isToday ? "var(--text)" : "var(--text-dim)"}
                fontSize={isToday ? 8 : 7}
                fontWeight={isToday ? 600 : 400}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * The dashboard's decisive "next academic action": the most urgent exam across
 * all Deep Work sessions, with days left, evidence-based readiness, the verdict,
 * the weakest concept, and a one-click jump into that session. Hidden entirely
 * when no session has an AI-built plan with an exam date.
 */
function ExamFocusHero({ now, className = "" }: { now: number; className?: string }) {
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const switchSession = useDeepWork((s) => s.switchSession);
  const setManualDeepWork = useHome((s) => s.setManualDeepWork);
  const select = useNotes((s) => s.select);

  const focus = useMemo(
    () => mostUrgentExam(sessionList({ sessions, order }).filter((s) => !s.archived), now),
    [sessions, order, now]
  );
  if (!focus) return null;

  const weak = nextToReview(sessions[focus.sessionId]?.backbone ?? null, now);
  const h = focus.health;
  const color = verdictColor(h);
  const dayLabel = h.daysLeft === 0 ? "Exam today" : h.daysLeft === 1 ? "Exam tomorrow" : `Exam in ${h.daysLeft} days`;

  function studyNow() {
    select(null);
    switchSession(focus!.sessionId);
    setManualDeepWork(true);
  }

  return (
    <section
      data-tour="exam-hero"
      className={`rounded-[16px] border p-4 ${className}`}
      style={{ borderColor: `${color}55`, background: `${color}0f` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">Exam focus</div>
          <div className="mt-1 truncate text-lg font-semibold text-[var(--text)]">
            {focus.plan.goal || focus.sessionName}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
          style={{ color, border: `1px solid ${color}` }}
        >
          {dayLabel}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-dim)]">
        <span className="font-medium tabular-nums" style={{ color }}>{h.effectiveReadiness}% ready</span>
        <span>· {verdictLabel(h)}</span>
        {weak && (
          <span className="min-w-0">· weakest: <span className="text-[var(--text)]">{weak.title}</span></span>
        )}
      </div>
      <div className="mt-3">
        <button
          className="zen-pressable zen-shine rounded-[12px] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black shadow-[0_16px_50px_rgba(var(--accent-rgb),0.24)] hover:brightness-105"
          onClick={studyNow}
        >
          Study now
        </button>
      </div>
    </section>
  );
}

/** Dashboard card: resume a recent Deep Work session or start a new one. */
function DeepWorkRecommendations({ now, className = "" }: { now: number; className?: string }) {
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const switchSession = useDeepWork((s) => s.switchSession);
  const createSession = useDeepWork((s) => s.createSession);
  const setManualDeepWork = useHome((s) => s.setManualDeepWork);

  const recent = sessionList({ sessions, order })
    .filter((s) => !s.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);

  function open(id?: string) {
    if (id) switchSession(id);
    else createSession();
    setManualDeepWork(true);
  }

  return (
    <div className={`rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">Deep Work</div>
        <button className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]" onClick={() => open()}>
          + New
        </button>
      </div>
      {recent.length === 0 ? (
        <div className="mt-2 text-sm text-[var(--text)]">
          Start a session, then add notes, PDFs, events, or emails to it.
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {recent.map((s) => {
            const plan = s.plan ? reconcilePlanPure(s.plan, now).plan : null;
            const next = nextSession(plan, now);
            const h = plan ? planHealth(plan, s.backbone, now) : null;
            return (
              <button
                key={s.id}
                className="flex w-full items-center gap-2 rounded-[10px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.01)] px-3 py-2 text-left transition hover:translate-x-1 hover:border-[rgba(var(--accent-rgb),0.3)] hover:bg-[rgba(var(--accent-rgb),0.06)]"
                onClick={() => open(s.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--text)]">{s.name}</span>
                  <span className="block truncate text-xs text-[var(--text-dim)]">
                    {s.items.length} source{s.items.length === 1 ? "" : "s"}
                    {s.backbone ? ` · ${s.backbone.overall}% ready` : ""}
                  </span>
                  {next && (
                    <span
                      className="mt-0.5 block truncate text-[11px]"
                      style={{ color: h ? verdictColor(h) : "var(--text-dim)" }}
                    >
                      Next: {fmtPlanDay(next.date, now)} {fmtStartMin(next.startMin)} · {KIND_META[next.kind].label}
                      {h?.drift ? " · adjust" : ""}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm text-[var(--text-dim)]">→</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-[var(--border)] px-4 py-5 text-sm">
      <div className="font-medium text-[var(--text)]">{title}</div>
      <div className="zen-secondary-copy mt-2">{body}</div>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatEventWindow(startISO: string, endISO: string, allDay: boolean): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (allDay) {
    return start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }
  return `${start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} - ${formatTime(start)} to ${formatTime(end)}`;
}

function formatThreadDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Unknown date";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}


function readHiddenTargets(): HiddenTargets {
  try {
    const raw = localStorage.getItem(HIDDEN_TARGETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HiddenTargets;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writeHiddenTargets(hiddenTargets: HiddenTargets) {
  try {
    const next = pruneHiddenTargets(hiddenTargets, Date.now());
    if (Object.keys(next).length === 0) localStorage.removeItem(HIDDEN_TARGETS_KEY);
    else localStorage.setItem(HIDDEN_TARGETS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function pruneHiddenTargets(hiddenTargets: HiddenTargets, now: number): HiddenTargets {
  const next: HiddenTargets = {};
  for (const [key, until] of Object.entries(hiddenTargets)) {
    if (typeof until === "number" && until > now) next[key] = until;
  }
  return next;
}

function targetKey(target: HomeTarget): string {
  return `${target.type}:${target.id}`;
}

function isTargetHidden(hiddenTargets: HiddenTargets, target: HomeTarget, now: number): boolean {
  const until = hiddenTargets[targetKey(target)];
  return typeof until === "number" && until > now;
}
