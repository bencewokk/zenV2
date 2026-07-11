import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { sessionQuizzes, useQuiz } from "@/features/home/deepwork/quizStore";
import {
  reconcilePlan as reconcilePlanPure, nextSession, planHealth,
  fmtPlanDay, fmtStartMin, verdictColor, verdictLabel, mostUrgentExam, KIND_META,
} from "@/features/home/deepwork/studyPlan";
import { useQuote } from "@/features/home/quote";
import { useAiAccess, aiBlocked, aiBlockedMessage } from "@/features/ai/access";
import { useWorkspace } from "@/shared/stores/workspace";
import { WhatsNew } from "@/features/home/ReleaseNotes";
import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";
import { useCommandPalette } from "@/features/search/CommandPalette";
import { isSignedIn, onAuthChange } from "@/services/google/auth";
import { loadProfile } from "@/services/memory";
import { useSources } from "@/services/sources/store";
import { loadSyncSettings } from "@/services/sync/settings";
import { isSparkFirstRun, useSparkIntro } from "@/features/onboarding/sparkStore";
import { docToText } from "@/shared/lib/docText";
import { renderMarkdownInline } from "@/shared/lib/renderMarkdown";
import { markTutorialItemDone, onTutorialStateChange, readTutorialState, writeTutorialState, type TutorialManualState } from "@/features/home/dashboardPrefs";
import { useLesson } from "@/features/home/deepwork/lessonStore";
import { DEFAULT_GOAL_HOURS, useStudyLog } from "@/features/home/deepwork/studyLog";
import { isFilterActive } from "@/features/filtering/filter";
import { docHasDerivation, docHasNode, isSeededSample } from "@/features/onboarding/contentSignals";
import { loadAppearance } from "@/services/appearance";
import { useToolPolicy } from "@/services/ai/toolPolicy";
import { notify } from "@/shared/ui/notify";
import { Masonry } from "@/shared/ui/Masonry";
import { AssistantConnect } from "@/features/home/AssistantConnect";
import { loadAssistantCaptures, onAssistantCapturesChange } from "@/services/assistantCaptures";
import { loadAssistantTasks, onAssistantTasksChange } from "@/services/assistantTasks";
import { startCoreLoopTour, startGroupTour, GROUP_TOURS } from "@/features/onboarding/tours";

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
              {/* Clock + daily quote */}
              <div className="bento-tile">
                <SectionLabel>Daily Focus</SectionLabel>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text)]">{focusTime}</div>
                <div className="zen-meta text-sm">{focusDate}</div>
                <div className="mt-4 border-t border-[var(--border)] pt-3">
                  <DailyQuote />
                </div>
              </div>

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

// Name of the seeded demo Deep Work session (see onboarding/seedSession.ts). Its
// presence is not a user action, so it's excluded from the "create a session" tick.
const SAMPLE_SESSION_NAME = "Quadratics — sample";

// These signals fire inside Deep Work / Calendar / Mail, while the dashboard
// tutorial is unmounted — record the ticks straight to storage; the tutorial
// re-reads on mount, so they appear when the user comes back to the dashboard.
useLesson.subscribe((s, prev) => {
  if (s.active && !prev.active) {
    markTutorialItemDone("lesson-start");
    // Starting a lesson is also "Try a lesson/class" (study-1) — that item read a
    // different key, so doing the lesson never ticked it.
    markTutorialItemDone("lesson");
  }
  if (!s.active && prev.active) markTutorialItemDone("class-finish");
});
useDeepWork.subscribe((s, prev) => {
  if (s.zenMode && !prev.zenMode) markTutorialItemDone("zen-mode");
});
useWorkspace.subscribe((s, prev) => {
  if (s.surface === "admin" && prev.surface !== "admin") markTutorialItemDone("open-admin");
  if (s.surface === "settings" && prev.surface !== "settings") markTutorialItemDone("settings");
});

function DashboardTutorial() {
  const notes = useNotes((s) => s.notes);
  const createNote = useNotes((s) => s.create);
  const renameNote = useNotes((s) => s.rename);
  const selectNote = useNotes((s) => s.select);
  const pdfCount = usePdfs((s) => Object.keys(s.pdfs).length);
  const sourcesCount = useSources((s) => Object.keys(s.sources).length);
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const switchSession = useDeepWork((s) => s.switchSession);
  const quizzes = useQuiz((s) => s.quizzes);
  const quizOrder = useQuiz((s) => s.order);
  const setManualDeepWork = useHome((s) => s.setManualDeepWork);
  const setWorkspace = useWorkspace((s) => s.set);
  const startSpark = useSparkIntro((s) => s.start);
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [manual, setManual] = useState<TutorialManualState>(() => readTutorialState());
  const [syncEnabled, setSyncEnabled] = useState(() => loadSyncSettings().enabled);
  const [profileSaved, setProfileSaved] = useState(() => hasProfile());
  const goalHours = useStudyLog((s) => s.goalHours);
  const filterActive = useNotes((s) => isFilterActive(s.filter));
  const searchOpened = useCommandPalette((s) => s.open);
  const customLabelCount = useHome((s) => s.customLabels.length);
  const toolOverrideCount = useToolPolicy((s) => Object.keys(s.overrides).length);
  const hasProviderSource = useSources((s) => Object.values(s.sources).some((source) => source.provider !== "web"));
  const hasWebCapture = useSources((s) => Object.values(s.sources).some((source) => source.provider === "web"));
  // Phone link: any assistant data having synced proves a phone signed in.
  const [phoneLinked, setPhoneLinked] = useState(
    () => loadAssistantTasks().length > 0 || loadAssistantCaptures().length > 0
  );
  useEffect(() => {
    const refresh = () => setPhoneLinked(loadAssistantTasks().length > 0 || loadAssistantCaptures().length > 0);
    const unsubTasks = onAssistantTasksChange(refresh);
    const unsubCaptures = onAssistantCapturesChange(refresh);
    return () => {
      unsubTasks();
      unsubCaptures();
    };
  }, []);
  // Plain localStorage settings — re-read per render; the dashboard remounts when
  // the user navigates back from Settings, so changes show up then.
  const appearance = loadAppearance();

  // Content-derived goals (metadata, wiki-links, MOCs, math, tables) — scanned
  // from the in-memory notes; seeded sample notes don't count as the user's own
  // organising/authoring work.
  const contentSignals = useMemo(() => {
    const own = Object.values(notes).filter((n) => !isSeededSample(n));
    return {
      hasMeta: own.some((n) => n.tags.length > 0 || n.space || n.subject || n.unit),
      hasWikiLink: own.some((n) => docHasNode(n.content, ["wikiLink"])),
      hasMoc: own.some((n) => n.moc),
      hasMath: own.some((n) => docHasNode(n.content, ["mathBlock", "mathInline"])),
      hasCheckedMath: own.some((n) => !!n.mathCheck && docHasDerivation(n.content)),
      hasBlock: own.some((n) => docHasNode(n.content, ["table", "geometry"])),
    };
  }, [notes]);

  useEffect(() => onAuthChange(setSignedIn), []);
  useEffect(() => {
    const refresh = () => {
      setSyncEnabled(loadSyncSettings().enabled);
      setProfileSaved(hasProfile());
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => writeTutorialState(manual), [manual]);
  useEffect(() => onTutorialStateChange(setManual), []);

  const setManualDone = useCallback((key: string) => {
    setManual((current) => (current.done?.[key] ? current : { ...current, done: { ...current.done, [key]: true } }));
  }, []);

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

  // Sidebar filtering is transient store state — persist the achievement the
  // moment it's observed so the tick survives restarts.
  useEffect(() => {
    if (filterActive) setManualDone("filter");
  }, [filterActive, setManualDone]);

  // Opening the command palette (Ctrl/⌘+K) satisfies "Try search" — otherwise the
  // item only ticked from the tile's own button, so actually searching left it
  // unchecked and blocked the phase from completing.
  useEffect(() => {
    if (searchOpened) setManualDone("search");
  }, [searchOpened, setManualDone]);

  if (manual.hidden) return null;

  const allSessions = sessionList({ sessions, order }).filter((session) => !session.archived);
  // The seeded demo session (see onboarding/seedSession.ts) exists on every fresh
  // install, so its mere presence must NOT tick "create a session" — only a
  // session the user made (or renamed) counts. Default new sessions are "Session N".
  const isSampleSession = (name: string) => name.trim() === SAMPLE_SESSION_NAME;
  const isUserNamed = (name: string) => {
    const n = name.trim();
    return !!n && !isSampleSession(n) && !/^Session \d+$/.test(n);
  };
  const hasSession = allSessions.some((session) => !isSampleSession(session.name));
  const activeSession = allSessions.find((session) => session.id === useDeepWork.getState().activeId) ?? allSessions[0] ?? null;
  // The sample session ships with 2 sources, so — like hasSession — it must not
  // auto-tick "add a source" / "gather a second source"; only the user's own
  // sessions count.
  const hasDeepWorkItem = allSessions.some((session) => !isSampleSession(session.name) && session.items.length > 0);
  // "Name the session or set intent" — renaming sets `name` (not `intent`), so a
  // real, user-chosen name must satisfy this too, not just the intent field.
  const hasIntent = allSessions.some((session) => !!session.intent.trim() || isUserNamed(session.name));
  const hasBackbone = allSessions.some((session) => !!session.backbone?.concepts.length);
  const hasFocus = allSessions.some((session) => session.focusSessions > 0 || session.focusMs > 0);
  const hasGradedQuiz = allSessions.some((session) =>
    sessionQuizzes({ quizzes, order: quizOrder }, session.id).some((quiz) => quiz.status === "graded")
  );
  const hasAnyQuiz = quizOrder.length > 0;
  const hasReviewedWeak = allSessions.some((session) =>
    (session.backbone?.concepts ?? []).some((concept) => (concept.reviewCount ?? 0) > 0)
  );
  const hasPlan = allSessions.some((session) => !!session.plan);
  const hasPlannedBlockDone = allSessions.some((session) =>
    !!session.plan?.sessions.some((planned) => planned.status === "done")
  );
  const hasSecondSource = allSessions.some((session) => !isSampleSession(session.name) && session.items.length >= 2);
  const hasSecondSession = allSessions.length >= 2;
  const hasRealItem = allSessions.some((session) =>
    session.items.some((item) => item.type === "event" || item.type === "mail")
  );
  // Seeded sample notes ship on every install — only a note the user made counts
  // toward "create a note" (matches contentSignals / the tour's create signal).
  const ownNoteCount = Object.values(notes).filter((note) => !isSeededSample(note)).length;
  const setupDone = !isSparkFirstRun();
  const manualDone = manual.done ?? {};
  const markManual = (key: string) => {
    setManual((current) => ({ ...current, done: { ...current.done, [key]: !current.done?.[key] } }));
  };
  const openDeepWork = () => {
    if (activeSession) switchSession(activeSession.id);
    selectNote(null);
    setWorkspace({ surface: "home", adminMailId: null });
    setManualDeepWork(true);
  };
  const openSettings = () => {
    setManualDone("settings");
    selectNote(null);
    setManualDeepWork(false);
    setWorkspace({ surface: "settings", adminMailId: null });
  };
  const openSources = () => {
    selectNote(null);
    setManualDeepWork(false);
    setWorkspace({ surface: "sources", adminMailId: null });
  };

  const groups: TutorialGroup[] = [
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
          items: [
            { key: "spark", label: "Finish Spark setup", done: setupDone },
            { key: "identity", label: signedIn ? "Google connected" : "Google or local-only chosen", done: setupDone || signedIn },
            { key: "sync", label: syncEnabled ? "Sync enabled" : "Sync or local-only chosen", done: setupDone || syncEnabled },
            { key: "profile", label: "Private profile saved or skipped", done: setupDone || profileSaved },
          ],
        },
        {
          key: "setup-2",
          label: "Make it yours",
          items: [
            { key: "look", label: "Pick an app look", done: appearance.appLook !== "zen" || !!manualDone.look, manual: true },
            { key: "font", label: "Choose a UI font", done: appearance.uiFont !== "system" || !!manualDone.font, manual: true },
            { key: "ai-label", label: "Add an AI email label", done: customLabelCount > 0 },
          ],
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
          setManualDone("search");
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
          items: [
            { key: "note", label: "Create a note", done: ownNoteCount > 0 },
            { key: "pdf", label: "Open the sample PDF or add one", done: pdfCount > 0, optional: true },
            { key: "search", label: "Try Ctrl/Cmd+K search", done: !!manualDone.search, manual: true },
          ],
        },
        {
          key: "material-2",
          label: "Organise & link",
          items: [
            { key: "meta", label: "Tag a note (space, subject, unit, or tags)", done: contentSignals.hasMeta },
            { key: "filter", label: "Filter the sidebar", done: !!manualDone.filter, manual: true },
            { key: "wikilink", label: "Link notes with [[ ]]", done: contentSignals.hasWikiLink },
            { key: "moc", label: "Turn a note into a Map of Content", done: contentSignals.hasMoc },
          ],
        },
        {
          key: "material-3",
          label: "Author & solve",
          items: [
            { key: "math", label: "Insert a math block with /", done: contentSignals.hasMath },
            { key: "math-check", label: "Check a derivation with Math check", done: contentSignals.hasCheckedMath },
            { key: "block", label: "Insert a table or geometry block", done: contentSignals.hasBlock },
          ],
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
          items: [
            { key: "session", label: "Create or open a session", done: hasSession },
            { key: "session-item", label: "Add a note, PDF, event, or email", done: hasDeepWorkItem },
            { key: "session-intent", label: "Name the session or set intent", done: hasIntent },
            { key: "arrange", label: "Move or resize one source window", done: !!manualDone.arrange, manual: true },
          ],
        },
        {
          key: "deepwork-2",
          label: "Work the canvas",
          items: [
            { key: "second-source", label: "Gather a second source", done: hasSecondSource },
            { key: "add-related", label: "Right-click something → Add to Deep Work", done: !!manualDone["add-related"], manual: true },
            { key: "zen-mode", label: "Try zen mode", done: !!manualDone["zen-mode"], manual: true },
            { key: "second-session", label: "Open a second session", done: hasSecondSession },
          ],
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
          items: [
            { key: "study-open", label: "Open the Study panel", done: !!manualDone["study-open"], manual: true },
            { key: "focus", label: "Start one focus session", done: hasFocus },
            { key: "quiz", label: "Take a quiz", done: hasAnyQuiz },
          ],
        },
        {
          key: "study-2",
          label: "Evidence & mastery",
          items: [
            { key: "backbone", label: "Generate a study backbone", done: hasBackbone },
            { key: "review-weak", label: "Review your weakest concept", done: hasReviewedWeak },
            { key: "quiz-graded", label: "Grade a quiz into mastery", done: hasGradedQuiz },
            { key: "requiz", label: "Re-quiz a mistake", done: !!manualDone.requiz, manual: true },
          ],
        },
        {
          key: "study-3",
          label: "Plan to the deadline",
          items: [
            { key: "plan", label: "Set a study plan + exam date", done: hasPlan },
            { key: "hero", label: "Read the Exam-Focus hero", done: !!manualDone.hero, manual: true },
            { key: "planned-block", label: "Finish a planned session", done: hasPlannedBlockDone },
            { key: "daily-goal", label: "Set your daily goal", done: goalHours !== DEFAULT_GOAL_HOURS || !!manualDone["daily-goal"], manual: true },
          ],
        },
        {
          key: "study-4",
          label: "Lessons & tutoring",
          items: [
            { key: "lesson-start", label: "Start a guided lesson", done: !!manualDone["lesson-start"], manual: true },
            { key: "class-finish", label: "Finish a class", done: !!manualDone["class-finish"], manual: true },
            { key: "deadline-modes", label: "Learn the deadline modes", done: !!manualDone["deadline-modes"], manual: true },
          ],
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
          items: [
            { key: "google", label: "Connect Google or stay local", done: setupDone || signedIn },
            { key: "sources", label: "Refresh or import a connected source", done: sourcesCount > 0 },
            // Auto-ticks once any phone task/capture syncs; but a phone that paired
            // and captured nothing yet is invisible to the desktop (blob sync has no
            // presence signal), so allow a manual tick too — you know you linked it.
            { key: "phone-link", label: "Link your phone via the QR tile", done: phoneLinked || !!manualDone["phone-link"], manual: true },
            { key: "add-real", label: "Add a source/event/email to Deep Work", done: !!manualDone["add-real"], manual: true },
          ],
        },
        {
          key: "connect-2",
          label: "Wire it up",
          items: [
            { key: "provider", label: "Connect Canvas, Drive, Zotero, or GitHub", done: hasProviderSource },
            { key: "web-capture", label: "Capture a web page", done: hasWebCapture },
            { key: "open-admin", label: "Open Calendar or Mail", done: !!manualDone["open-admin"], manual: true },
            { key: "real-to-dw", label: "Add an event or email to Deep Work", done: hasRealItem },
          ],
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
          items: [
            { key: "settings", label: "Open Settings", done: !!manualDone.settings, manual: true },
            { key: "tools", label: "Review AI tool permissions", done: !!manualDone.tools, manual: true },
            { key: "backup", label: "Export backup or copy diagnostics", done: !!manualDone.backup, manual: true },
          ],
        },
        {
          key: "trust-2",
          label: "Own your data",
          items: [
            { key: "tool-toggle", label: "Adjust an AI tool permission", done: toolOverrideCount > 0 },
            { key: "export-backup", label: "Export a backup", done: !!manualDone["export-backup"], manual: true },
            { key: "diagnostics", label: "Copy diagnostics", done: !!manualDone.diagnostics, manual: true },
            { key: "plan-usage", label: "Review Plan & usage", done: !!manualDone["plan-usage"], manual: true },
          ],
        },
      ],
    },
  ];

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
          const groupDone = group.phases.every((p) => p.items.every((item) => item.done));
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
                    // Every unfinished goal is a live entry point: manual ticks
                    // toggle, everything else jumps into the phase's guided
                    // walkthrough so "click what you want to learn" always works.
                    const launchesTour = !item.manual && !item.done && !!GROUP_TOURS[phase.key];
                    const clickable = item.manual || launchesTour;
                    return (
                      <button
                        key={item.key}
                        className="group/tick flex w-full items-start gap-2 text-left text-xs"
                        disabled={!clickable}
                        onClick={() => (item.manual ? markManual(item.key) : startGroupTour(phase.key))}
                        title={item.manual ? "Toggle this tick manually" : launchesTour ? "Show me how — guided walkthrough" : undefined}
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

function hasProfile(): boolean {
  const profile = loadProfile();
  return !!(profile.name.trim() || profile.about.trim() || profile.stack.trim() || profile.preferences.trim());
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

/** AI-generated daily quote, shown in the empty space beside the clock. */
function DailyQuote() {
  const quote = useQuote((s) => s.current);
  const loading = useQuote((s) => s.loading);
  const refresh = useQuote((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!quote) {
    return loading ? (
      <div className="max-w-md flex-1 text-right text-sm text-[var(--text-dim)]">Finding a quote…</div>
    ) : null;
  }

  return (
    <div className="group max-w-md flex-1 text-right">
      <blockquote className="zen-primary-copy text-[15px] italic leading-snug text-[var(--text)]">
        “{quote.text}”
      </blockquote>
      <div className="zen-meta mt-1 text-xs">
        — {quote.author}
        <button
          className="ml-2 inline-block align-middle text-[var(--text-dim)] opacity-0 transition hover:text-[var(--text)] group-hover:opacity-100 disabled:opacity-40"
          onClick={() => void refresh(true)}
          disabled={loading}
          title="New quote"
          aria-label="New quote"
        >
          <span className={loading ? "zen-spin" : ""}>↻</span>
        </button>
      </div>
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
