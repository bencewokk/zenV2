import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { marked } from "marked";
import type { JSONContent } from "@tiptap/react";
import {
  buildActionGroups,
  buildTriageItems,
  parseBriefItems,
  resolveTargetDetails,
  useHome,
  type HomeTarget,
} from "@/features/home/store";
import { DeepWorkV2 } from "@/features/home/deepwork/DeepWorkV2";
import { useFocusSession } from "@/features/home/deepwork/useFocusSession";
import { fmtClock, sessionList, useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useQuote } from "@/features/home/quote";
import { useNotes } from "@/features/notes/store";
import { docToText } from "@/shared/lib/docText";
import { notify } from "@/shared/ui/notify";
import type { CalEvent } from "@/services/google/calendar";

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
  const createNote = useNotes((s) => s.create);
  const renameNote = useNotes((s) => s.rename);
  const saveContent = useNotes((s) => s.saveContent);
  const saveMeta = useNotes((s) => s.saveMeta);
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
  const [quickCapture, setQuickCapture] = useState("");
  const [captureSaving, setCaptureSaving] = useState(false);
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

  const triage = useMemo(() => buildTriageItems(visibleNotes, visibleThreads, visibleEvents).slice(0, 10), [visibleNotes, visibleThreads, visibleEvents]);
  const matchedThreadLabels = useHome((s) => s.matchedThreadLabels);
  const groups = useMemo(() => buildActionGroups(visibleNotes, visibleEvents, visibleThreads, matchedThreadLabels), [visibleEvents, visibleNotes, visibleThreads, matchedThreadLabels]);
  const focus = useMemo(
    () => resolveTargetDetails(focusTarget, visibleNotes, visibleEvents, visibleThreads),
    [focusTarget, visibleEvents, visibleNotes, visibleThreads]
  );
  const deepWorkAnchorEvent = useMemo(() => (focus.kind === "event" ? focus.event : null), [focus]);
  const deepWorkTimer = useMemo(() => buildDeepWorkTimer(deepWorkAnchorEvent, now), [deepWorkAnchorEvent, now]);
  const deepWorkActions = useMemo(
    () =>
      triage
        .filter((item) => !focusTarget || item.target.type !== focusTarget.type || item.target.id !== focusTarget.id)
        .slice(0, 3),
    [focusTarget, triage]
  );
  const nextTarget = useMemo(
    () => pickNextTarget(focusTarget, visibleNotes, visibleEvents, visibleThreads),
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

  async function handleQuickCapture(tag: string | null = null) {
    const value = quickCapture.trim();
    if (!value || captureSaving) return;

    setCaptureSaving(true);
    try {
      const noteId = await createNote(null);
      await renameNote(noteId, deriveCaptureTitle(value));
      await saveContent(noteId, buildTextDoc(value));
      if (tag) {
        await saveMeta(noteId, { tags: [tag] });
      }
      select(null);
      setQuickCapture("");
      notify.success("Added to inbox");
    } catch {
      notify.error("Could not save quick capture");
    } finally {
      setCaptureSaving(false);
    }
  }

  function hideTarget(target: HomeTarget, until: number) {
    setHiddenTargets((current) => ({ ...current, [targetKey(target)]: until }));
  }

  async function handleDone() {
    if (!focusTarget || focus.kind === "empty") return;

    try {
      if (focus.kind === "note" && (focus.note.inbox || focus.note.tags.includes("blocked"))) {
        await saveMeta(focus.note.id, {
          inbox: false,
          tags: focus.note.tags.filter((tag) => tag !== "blocked"),
        });
      }
      hideTarget(focusTarget, endOfDay(now));
      setFocusTarget(nextTarget);
      notify.success("Marked done");
    } catch {
      notify.error("Could not mark this item done");
    }
  }

  function handleSnooze() {
    if (!focusTarget || focus.kind === "empty") return;
    hideTarget(focusTarget, Date.now() + 60 * 60 * 1000);
    setFocusTarget(nextTarget);
    notify.success("Snoozed for 1 hour");
  }

  async function handleBlocked() {
    if (!focusTarget || focus.kind === "empty") return;

    const title = buildBlockedTitle(focus);
    const body = buildBlockedBody(focus);

    setCaptureSaving(true);
    try {
      const noteId = await createNote(null);
      await renameNote(noteId, title);
      await saveContent(noteId, buildTextDoc(body));
      await saveMeta(noteId, { tags: ["blocked"], inbox: true });
      select(null);
      hideTarget(focusTarget, Date.now() + 30 * 60 * 1000);
      setFocusTarget(nextTarget);
      notify.success("Blocked item parked in inbox");
    } catch {
      notify.error("Could not park the blocked item");
    } finally {
      setCaptureSaving(false);
    }
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
    <section className={`relative h-full min-h-0 overflow-hidden px-4 py-3 sm:px-6 ${deepWork ? "" : "sm:py-4"}`}>
      <div className={deepWork ? "h-full min-h-0" : "mx-auto h-full min-h-0 w-full max-w-5xl"}>
        <div className="zen-home-center">
          <SurfaceCard
            className={`zen-focus-surface flex min-h-0 flex-col overflow-hidden p-5 sm:p-6 ${deepWork ? "h-full" : ""}`}
            style={deepWork ? { borderColor: "#60A5FA", boxShadow: "0 0 0 1px #60A5FA20" } : undefined}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
              <div className="space-y-2">
                <SectionLabel>Daily Focus</SectionLabel>
                <div>
                  <div className="text-2xl font-semibold tracking-tight text-[var(--text)]">{focusTime}</div>
                  <div className="zen-meta text-sm">{focusDate}</div>
                </div>
              </div>
              {!deepWork && <DailyQuote />}
            </div>

            <div className={`zen-panel-scroll mt-5 grid flex-1 gap-5 pr-1 ${deepWork ? "min-h-0 grid-cols-1" : "xl:grid-cols-[minmax(0,1.55fr)_minmax(14rem,0.45fr)]"}`}>
              <div className={`min-w-0 ${deepWork ? "flex min-h-0 flex-col justify-center" : "space-y-6"}`}>
                <section className="border-b border-[rgba(255,255,255,0.07)] pb-5">
                  <div className={`grid gap-4 ${deepWork ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(15rem,0.8fr)]" : "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]"}`}>
                    <div className="space-y-3">
                      <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">Focus Timer</div>

                      {session ? (
                        <div className="rounded-[16px] border border-[rgba(96,165,250,0.3)] bg-[rgba(96,165,250,0.06)] px-4 py-3">
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
                              className="h-full rounded-full bg-[#60A5FA] transition-[width] duration-1000"
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
                        <div className="flex flex-wrap items-center gap-2">
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

                    {deepWork ? (
                      <div className="rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
                        <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">Focus Block</div>
                        {deepWorkTimer ? (
                          <>
                            <div className="mt-2 text-lg font-semibold text-[var(--text)]">{deepWorkTimer.label}</div>
                            <div className="zen-secondary-copy mt-1 text-sm">{deepWorkTimer.detail}</div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
                              <div
                                className="h-full rounded-full transition-[width] duration-300"
                                style={{ width: `${deepWorkTimer.progress}%`, background: deepWorkTimer.color }}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="zen-secondary-copy mt-2 text-sm">
                            No active focus block is linked right now. Deep Work can still center a note, thread, or manual task.
                          </div>
                        )}
                      </div>
                    ) : (
                      <DeepWorkRecommendations />
                    )}
                  </div>
                </section>

                {!deepWork && <section className="border-b border-[rgba(255,255,255,0.07)] pb-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start">
                    <div className="min-w-0 flex-1 md:pr-4">
                      <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">
                        Startup Brief
                      </div>
                      {summaryLoading && !summary ? (
                        <div className="zen-primary-copy mt-2 max-w-[54ch] text-[15px] text-[var(--text)]">
                          Generating your brief...
                        </div>
                      ) : briefItems.length > 0 ? (
                        <ul className="mt-2 max-w-[54ch] space-y-1.5 text-[15px] text-[var(--text)]">
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
                                  <span dangerouslySetInnerHTML={{ __html: marked.parseInline(item.text) as string }} />
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
                      ) : summary ? (
                        <div className="zen-secondary-copy mt-2 max-w-[54ch] text-[15px]">
                          All cleared for today. Regenerate for a fresh brief.
                        </div>
                      ) : (
                        <div className="zen-primary-copy mt-2 max-w-[54ch] text-[15px] text-[var(--text)]">
                          Generate a focus brief to seed the canvas.
                        </div>
                      )}
                    </div>
                    <button
                      className="zen-pressable zen-shine shrink-0 self-start rounded-[12px] bg-[#60A5FA] px-4 py-2 text-sm font-semibold text-black shadow-[0_16px_50px_rgba(96,165,250,0.24)] hover:brightness-105 disabled:opacity-60"
                      onClick={() => void regenerateSummary()}
                      disabled={summaryLoading}
                    >
                      {summaryLoading ? "Generating..." : "Generate"}
                    </button>
                  </div>
                </section>}

                <section className={deepWork ? "min-h-0" : "pt-1"}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">
                        Active Workspace
                      </div>
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

                  {deepWork && focus.kind !== "empty" && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className="zen-pressable rounded-[12px] border border-[rgba(76,175,114,0.3)] bg-[rgba(76,175,114,0.08)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[rgba(76,175,114,0.14)]"
                        onClick={() => void handleDone()}
                      >
                        Done
                      </button>
                      <button
                        className="zen-pressable rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)]"
                        onClick={handleSnooze}
                      >
                        Snooze
                      </button>
                      <button
                        className="zen-pressable rounded-[12px] border border-[rgba(246,104,94,0.28)] bg-[rgba(246,104,94,0.08)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[rgba(246,104,94,0.14)] disabled:opacity-60"
                        onClick={() => void handleBlocked()}
                        disabled={captureSaving}
                      >
                        {captureSaving ? "Blocking..." : "Blocked"}
                      </button>
                    </div>
                  )}

                  <div className="mt-4">
                    <FocusWorkspace focus={focus} notes={visibleNotes} />
                  </div>

                  {deepWork && deepWorkActions.length > 0 && (
                    <div className="mt-6 border-t border-[rgba(255,255,255,0.07)] pt-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <SectionLabel>Next Actions</SectionLabel>
                        <span className="zen-meta text-xs">Compact queue</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {deepWorkActions.map((item) => (
                          <button
                            key={item.key}
                            className="rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-[rgba(255,255,255,0.04)]"
                            onClick={() => {
                              setFocusTarget(item.target);
                              openTarget(item.target);
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: item.accent }} />
                              <span className="min-w-0 flex-1">
                                <span className="zen-clamp-1 block text-sm font-medium text-[var(--text)]">{item.title}</span>
                                <span className="zen-meta zen-clamp-1 mt-1 block text-xs">{item.subtitle}</span>
                                <span className="zen-secondary-copy zen-clamp-2 mt-1 block text-xs">{item.preview}</span>
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {deepWork && (
                    <div className="mt-6 border-t border-[rgba(255,255,255,0.07)] pt-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <SectionLabel>Quick Capture</SectionLabel>
                        <span className="zen-meta text-xs">Inbox note</span>
                      </div>
                      <form
                        className="flex flex-col gap-3 sm:flex-row"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleQuickCapture();
                        }}
                      >
                        <textarea
                          className="min-h-[112px] min-w-0 flex-1 rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[rgba(232,233,237,0.34)] focus:border-[#60A5FA]"
                          value={quickCapture}
                          onChange={(event) => setQuickCapture(event.target.value)}
                          placeholder="Park a follow-up, loose thought, or later task without leaving focus. The first line becomes the note title and the full text is saved to the body."
                          rows={4}
                        />
                        <button
                          className="zen-pressable zen-shine shrink-0 rounded-[12px] bg-[#60A5FA] px-4 py-2.5 text-sm font-semibold text-black hover:brightness-105 disabled:opacity-60"
                          type="submit"
                          disabled={!quickCapture.trim() || captureSaving}
                        >
                          {captureSaving ? "Saving..." : "Capture"}
                        </button>
                      </form>
                    </div>
                  )}
                </section>
              </div>

              {!deepWork && <div className="space-y-6 px-1 pt-1">
                <LabelManager />
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <SectionLabel>Action Feed</SectionLabel>
                    <span className="zen-meta text-xs">Chronological</span>
                  </div>
                  <div className="zen-stagger space-y-4">
                    {groups.length === 0 ? (
                      <EmptyState
                        title="No action pressure yet"
                        body="Unread mail, recent notes, and upcoming events will converge here automatically."
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
              </div>}
            </div>
          </SurfaceCard>
        </div>

      </div>
    </section>
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
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel>AI Labels</SectionLabel>
        <span className="zen-meta text-xs">Topics for email</span>
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Add a topic the AI should tag…"
        className="w-full rounded-[10px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[#60A5FA]"
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
          {preview || "This note has no text yet. Use the center canvas to decide if it belongs in focus or back in triage."}
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
          : "Use the timeline or triage rail to seed the center workspace."
      }
    />
  );
}

function SurfaceCard({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-[22px] border border-[rgba(255,255,255,0.08)] bg-[rgba(35,36,40,0.78)] shadow-[0_12px_30px_rgba(0,0,0,0.18)] backdrop-blur-[6px] ${className}`}
      style={style}
    >
      {children}
    </div>
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

/** Dashboard card: resume a recent Deep Work session or start a new one. */
function DeepWorkRecommendations() {
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
    <div className="rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
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
          {recent.map((s) => (
            <button
              key={s.id}
              className="flex w-full items-center gap-2 rounded-[10px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.01)] px-3 py-2 text-left transition hover:translate-x-1 hover:border-[rgba(96,165,250,0.3)] hover:bg-[rgba(96,165,250,0.06)]"
              onClick={() => open(s.id)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--text)]">{s.name}</span>
                <span className="block truncate text-xs text-[var(--text-dim)]">
                  {s.items.length} source{s.items.length === 1 ? "" : "s"}
                  {s.backbone ? ` · ${s.backbone.overall}% ready` : ""}
                </span>
              </span>
              <span className="shrink-0 text-sm text-[var(--text-dim)]">→</span>
            </button>
          ))}
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

function pickNextTarget(
  current: HomeTarget | null,
  notes: Record<string, ReturnType<typeof useNotes.getState>["notes"][string]>,
  events: CalEvent[],
  threads: ReturnType<typeof useHome.getState>["threads"]
): HomeTarget | null {
  const noteTargets = Object.values(notes)
    .filter((note) => note.inbox)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((note) => ({ type: "note" as const, id: note.id }));
  const eventTargets = events.map((event) => ({ type: "event" as const, id: event.id }));
  const threadTargets = threads
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .map((thread) => ({ type: "mail" as const, id: thread.id }));

  const candidates = [...noteTargets, ...eventTargets, ...threadTargets];
  return candidates.find((candidate) => !current || targetKey(candidate) !== targetKey(current)) ?? null;
}

function deriveCaptureTitle(value: string): string {
  const firstLine = value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  return clipTitle(firstLine || value, 72);
}

function clipTitle(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized || "Untitled";
}

function buildTextDoc(value: string): JSONContent {
  const paragraphs = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }));

  return {
    type: "doc",
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }],
  };
}

function buildBlockedTitle(focus: ReturnType<typeof resolveTargetDetails>): string {
  if (focus.kind === "event") return `Blocked: ${focus.event.summary}`;
  if (focus.kind === "mail") return `Blocked: ${focus.thread.subject}`;
  if (focus.kind === "note") return `Blocked: ${focus.note.title || "Untitled"}`;
  return "Blocked item";
}

function buildBlockedBody(focus: ReturnType<typeof resolveTargetDetails>): string {
  const lines = [
    focus.kind === "event"
      ? `Blocked event: ${focus.event.summary}`
      : focus.kind === "mail"
        ? `Blocked thread: ${focus.thread.subject}`
        : focus.kind === "note"
          ? `Blocked note: ${focus.note.title || "Untitled"}`
          : null,
    focus.kind === "event"
      ? focus.event.description?.trim() || focus.event.location || formatEventWindow(focus.event.start, focus.event.end, focus.event.allDay)
      : focus.kind === "mail"
        ? focus.thread.snippet
        : focus.kind === "note"
          ? docToText(focus.note.content).trim() || "No body yet"
          : null,
    "Next step needed:",
    "",
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function endOfDay(now: Date): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

function buildDeepWorkTimer(event: CalEvent | null, now: Date): { label: string; detail: string; progress: number; color: string } | null {
  if (!event) return null;

  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || event.allDay) {
    return {
      label: event.allDay ? "All-day focus block" : "Focus block",
      detail: `${formatEventWindow(event.start, event.end, event.allDay)}${event.summary ? ` · ${event.summary}` : ""}`,
      progress: 100,
      color: "#60A5FA",
    };
  }

  const current = now.getTime();
  if (current <= start) {
    return {
      label: `Starts in ${formatRelativeDistance(start - current)}`,
      detail: `${formatTime(new Date(start))} to ${formatTime(new Date(end))} · ${event.summary}`,
      progress: 0,
      color: "#94A3B8",
    };
  }

  if (current >= end) {
    return {
      label: "Focus block ended",
      detail: `${formatTime(new Date(start))} to ${formatTime(new Date(end))} · ${event.summary}`,
      progress: 100,
      color: "#64748B",
    };
  }

  const progress = Math.max(0, Math.min(100, ((current - start) / (end - start)) * 100));
  return {
    label: `${formatRelativeDistance(end - current)} left`,
    detail: `${formatTime(new Date(start))} to ${formatTime(new Date(end))} · ${event.summary}`,
    progress,
    color: "#60A5FA",
  };
}

function formatRelativeDistance(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / (60 * 1000)));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}
