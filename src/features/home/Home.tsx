import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildActionGroups,
  parseBriefItems,
  useHome,
  type HomeTarget,
} from "@/features/home/store";
import { DeepWorkV2 } from "@/features/home/deepwork/DeepWorkV2";
import { useFocusSession } from "@/features/home/deepwork/useFocusSession";
import { nextToReview, sessionList, useDeepWork } from "@/features/home/deepwork/deepworkStore";
import {
  reconcilePlan as reconcilePlanPure, nextSession, planHealth,
  fmtPlanDay, fmtStartMin, verdictColor, verdictLabel, KIND_META,
} from "@/features/home/deepwork/studyPlan";
import { pickExamHero } from "@/features/home/deepwork/courseRollup";
import { useCourses, courseList } from "@/features/home/deepwork/courseStore";
import { useStudyLog, dayKey, HOUR_MS } from "@/features/home/deepwork/studyLog";
import { StudyGoal } from "@/features/home/deepwork/StudyGoal";
import { useAiAccess, aiBlocked, aiBlockedMessage } from "@/features/ai/access";
import { navigate } from "@/shared/stores/navigate";
import { useNotes } from "@/features/notes/store";
import { renderMarkdownInline } from "@/shared/lib/renderMarkdown";
import { Masonry } from "@/shared/ui/Masonry";
import { DashboardTutorial } from "@/features/onboarding/DashboardTutorial";

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
  const summary = useHome((s) => s.summary);
  const summaryLoading = useHome((s) => s.summaryLoading);
  const events = useHome((s) => s.events);
  const threads = useHome((s) => s.threads);
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
  const { session } = useFocusSession();

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
      navigate({ view: "note", id: target.id });
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

            {/* Ordered by decision, not by category: the one urgent thing, then what to
                do about it, then the backlog, then the reference numbers. */}
            <Masonry>
              {/* Most urgent exam — self-styled, renders nothing when nothing qualifies */}
              <ExamFocusHero now={now.getTime()} className="bento-item" />

              {/* Deep Work — the hero's fallback, always renders */}
              <DeepWorkRecommendations now={now.getTime()} className="bento-item" />

              {/* Startup brief */}
              <div className="bento-tile">
                <div className="flex items-start justify-between gap-3">
                  <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">Startup Brief</div>
                  {aiOff ? (
                    <button
                      className="zen-pressable shrink-0 rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                      onClick={() => navigate({ view: "settings" })}
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
              {/* Clock, streak and the weekly study chart */}
              <DailyFocusTile focusTime={focusTime} focusDate={focusDate} />
            </Masonry>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-dim)]">{children}</div>;
}

/**
 * Clock, date, goal summary and the weekly chart. The goal summary is shared with the
 * study panel and status bar via <StudyGoal>, so all three read one implementation.
 */
function DailyFocusTile({ focusTime, focusDate }: { focusTime: string; focusDate: string }) {
  return (
    <div className="bento-tile">
      <SectionLabel>Daily Focus</SectionLabel>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text)]">{focusTime}</div>
      <div className="zen-meta text-sm">{focusDate}</div>

      <StudyGoal variant="summary" />

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
 * courses and ungrouped Deep Work sessions, with days left, evidence-based
 * readiness, the verdict, the weakest concept, and a one-click jump into the
 * right session. A course hero aggregates its members (readiness rollup, exam
 * countdown from the course's or nearest member's date); a session belonging to
 * a course is represented by the course, never on its own. Hidden entirely when
 * nothing has an exam date with study evidence behind it.
 */
function ExamFocusHero({ now, className = "" }: { now: number; className?: string }) {
  const sessions = useDeepWork((s) => s.sessions);
  const order = useDeepWork((s) => s.order);
  const courses = useCourses((s) => s.courses);
  const courseOrder = useCourses((s) => s.order);

  const hero = useMemo(
    () => pickExamHero(courseList({ courses, order: courseOrder }), sessions, order, now),
    [courses, courseOrder, sessions, order, now]
  );
  if (!hero) return null;

  // The two hero shapes unify: a course hero borrows verdict/urgency from its
  // most urgent member (when one qualifies) and rolls readiness up over members.
  const urgent = hero.kind === "course" ? hero.rollup.urgent : hero.urgent;
  const h = urgent?.health ?? null;
  const title =
    hero.kind === "course"
      ? `${hero.course.emoji ? `${hero.course.emoji} ` : ""}${hero.course.name}`
      : hero.urgent.plan.goal || hero.urgent.sessionName;
  const daysLeft = hero.kind === "course" ? hero.rollup.daysLeft ?? 0 : hero.urgent.health.daysLeft;
  const targetId = hero.kind === "course" ? hero.rollup.studyTargetId : hero.urgent.sessionId;
  const readiness = hero.kind === "course" ? hero.rollup.readiness : hero.urgent.health.effectiveReadiness;
  const coverage =
    hero.kind === "course" && hero.rollup.assessedCount < hero.rollup.memberCount
      ? ` · ${hero.rollup.assessedCount}/${hero.rollup.memberCount} assessed`
      : "";
  const weak = targetId ? nextToReview(sessions[targetId]?.backbone ?? null, now) : null;
  const color = h ? verdictColor(h) : "var(--accent)";
  const dayLabel = daysLeft === 0 ? "Exam today" : daysLeft === 1 ? "Exam tomorrow" : `Exam in ${daysLeft} days`;

  function studyNow() {
    if (!targetId) return;
    navigate({ view: "deepwork", sessionId: targetId });
  }

  return (
    <section
      data-tour="exam-hero"
      className={`rounded-[16px] border p-4 ${className}`}
      style={{ borderColor: `${color}55`, background: `${color}0f` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="zen-meta text-[11px] uppercase tracking-[0.24em]">
            {hero.kind === "course" ? "Course exam focus" : "Exam focus"}
          </div>
          <div className="mt-1 truncate text-lg font-semibold text-[var(--text)]">
            {title}
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
        {readiness != null && (
          <span className="font-medium tabular-nums" style={{ color }}>{readiness}% ready{coverage}</span>
        )}
        {h && <span>· {verdictLabel(h)}</span>}
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
  const createSession = useDeepWork((s) => s.createSession);

  const recent = sessionList({ sessions, order })
    .filter((s) => !s.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);

  function open(id?: string) {
    navigate({ view: "deepwork", sessionId: id ?? createSession() });
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
