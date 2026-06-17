import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "@/shared/lib/types";
import type { CalEvent } from "@/services/google/calendar";
import type { MailThread } from "@/services/google/gmail";
import { notify } from "@/shared/ui/notify";
import { useHome, type HomeTarget } from "@/features/home/store";
import {
  fmtDuration,
  readinessColor,
  targetKey,
  useDeepWork,
  type AiReadiness,
  type WindowGeom,
} from "@/features/home/deepwork/deepworkStore";
import { assessReadiness } from "@/features/home/deepwork/aiReadiness";
import { WindowFrame } from "@/features/home/deepwork/windows/WindowFrame";
import { NoteWindow } from "@/features/home/deepwork/windows/NoteWindow";
import { EmailWindow } from "@/features/home/deepwork/windows/EmailWindow";
import { EventWindow } from "@/features/home/deepwork/windows/EventWindow";

/** A candidate the user can pull onto the canvas, related to the source item. */
interface RelatedCandidate {
  target: HomeTarget;
  type: "note" | "event" | "mail";
  title: string;
  subtitle: string;
}

const TYPE_GLYPH: Record<RelatedCandidate["type"], string> = { note: "✎", event: "◷", mail: "✉" };

/**
 * Keywords that characterise a source item, used to find related material via
 * substring matching — the same text-matching convention the home dashboard uses.
 * Notes contribute their tags; events their summary; emails their subject + sender.
 */
function keywordsFor(
  target: HomeTarget,
  notes: Record<string, Note>,
  events: CalEvent[],
  threads: MailThread[],
  matchedLabels: Record<string, string>
): string[] {
  if (target.type === "note") {
    return notes[target.id]?.tags.map((t) => t.toLowerCase().trim()).filter(Boolean) ?? [];
  }
  if (target.type === "event") {
    const e = events.find((ev) => ev.id === target.id);
    return e?.summary ? [e.summary.toLowerCase().trim()] : [];
  }
  const t = threads.find((th) => th.id === target.id);
  if (!t) return [];
  // An email's keywords include the event label the AI matched it to, so a
  // right-click finds the note/event it belongs to even when the subject differs.
  const label = matchedLabels[target.id];
  return [t.subject, t.from, label].filter(Boolean).map((s) => s!.toLowerCase().trim());
}

/**
 * All notes/events/emails related to `source` by the keyword convention above,
 * excluding the source item itself.
 */
function relatedCandidates(
  source: HomeTarget,
  notes: Record<string, Note>,
  events: CalEvent[],
  threads: MailThread[],
  matchedLabels: Record<string, string>
): RelatedCandidate[] {
  const keywords = keywordsFor(source, notes, events, threads, matchedLabels);
  if (keywords.length === 0) return [];
  const isSource = (t: HomeTarget) => t.type === source.type && t.id === source.id;
  // A keyword and a field match if either contains the other (tags are short labels;
  // summaries/subjects are longer phrases that may embed a tag, or vice versa).
  const hits = (fields: string[]) =>
    fields.some((f) => {
      const h = f.toLowerCase();
      return keywords.some((k) => h.includes(k) || k.includes(h));
    });

  const noteHits: RelatedCandidate[] = Object.values(notes)
    .filter((n) => !isSource({ type: "note", id: n.id }) && hits(n.tags.concat(n.title)))
    .map((n) => ({
      target: { type: "note", id: n.id },
      type: "note",
      title: n.title || "Untitled",
      subtitle: n.tags.join(", "),
    }));

  const evHits: RelatedCandidate[] = events
    .filter((e) => !isSource({ type: "event", id: e.id }) && hits([e.summary]))
    .map((e) => ({
      target: { type: "event", id: e.id },
      type: "event",
      title: e.summary || "Event",
      subtitle: e.location || "Calendar event",
    }));

  const mailHits: RelatedCandidate[] = threads
    .filter(
      (t) =>
        !isSource({ type: "mail", id: t.id }) &&
        hits([t.subject, t.from, matchedLabels[t.id] ?? ""].filter(Boolean))
    )
    .map((t) => ({
      target: { type: "mail", id: t.id },
      type: "mail",
      title: t.subject || "Email",
      subtitle: t.from,
    }));

  return [...noteHits, ...evHits, ...mailHits];
}

const SECTION_LABEL = "text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--text-dim)]";

export interface DeepWorkV2Props {
  notes: Record<string, Note>;
  events: CalEvent[];
  threads: MailThread[];
  sessionActive: boolean;
  sessionRemaining: number;
  sessionProgress: number;
  onStartSession: (min: number) => void;
  onEndSession: () => void;
}

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DeepWorkV2({
  notes, events, threads,
  sessionActive, sessionRemaining, sessionProgress, onStartSession, onEndSession,
}: DeepWorkV2Props) {
  const items = useDeepWork((s) => s.items);
  const windows = useDeepWork((s) => s.windows);
  const setWindow = useDeepWork((s) => s.setWindow);
  const addItem = useDeepWork((s) => s.addItem);
  const removeItem = useDeepWork((s) => s.removeItem);
  const intent = useDeepWork((s) => s.intent);
  const setIntent = useDeepWork((s) => s.setIntent);
  const ai = useDeepWork((s) => s.ai);
  const setAi = useDeepWork((s) => s.setAi);
  const focusMs = useDeepWork((s) => s.focusMs);
  const sessions = useDeepWork((s) => s.sessions);
  const logFocus = useDeepWork((s) => s.logFocus);
  const headerCollapsed = useDeepWork((s) => s.headerCollapsed);
  const setHeaderCollapsed = useDeepWork((s) => s.setHeaderCollapsed);
  const zenMode = useDeepWork((s) => s.zenMode);
  const setZenMode = useDeepWork((s) => s.setZenMode);
  const matchedLabels = useHome((s) => s.matchedThreadLabels);

  const [relatedMenu, setRelatedMenu] = useState<{ x: number; y: number; source: HomeTarget } | null>(null);
  useEffect(() => {
    if (!relatedMenu) return;
    const close = () => setRelatedMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [relatedMenu]);

  function openRelatedMenu(e: React.MouseEvent, source: HomeTarget) {
    e.preventDefault();
    setRelatedMenu({ x: e.clientX, y: e.clientY, source });
  }

  // Credit focused time when a session ends.
  const focusStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (sessionActive) {
      if (focusStartRef.current === null) focusStartRef.current = Date.now();
    } else if (focusStartRef.current !== null) {
      const ms = Date.now() - focusStartRef.current;
      focusStartRef.current = null;
      logFocus(ms);
    }
  }, [sessionActive, logFocus]);

  // Resolve the curated set against current data for AI assessment.
  const materials = useMemo(() => {
    const mNotes: Note[] = [];
    const mEvents: CalEvent[] = [];
    const mEmails: MailThread[] = [];
    for (const item of items) {
      if (item.type === "note" && notes[item.id]) mNotes.push(notes[item.id]);
      else if (item.type === "event") {
        const ev = events.find((e) => e.id === item.id);
        if (ev) mEvents.push(ev);
      } else if (item.type === "mail") {
        const th = threads.find((t) => t.id === item.id);
        if (th) mEmails.push(th);
      }
    }
    return { notes: mNotes, events: mEvents, emails: mEmails };
  }, [items, notes, events, threads]);

  const [assessing, setAssessing] = useState(false);
  async function runAssessment(intentArg?: string) {
    const goal = (intentArg ?? intent).trim();
    if (!goal || assessing) return;
    setAssessing(true);
    try {
      const result = await assessReadiness(goal, { ...materials, focusMs, sessions });
      setAi(result);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Could not assess readiness");
    } finally {
      setAssessing(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {!zenMode && (
        <div className="shrink-0 space-y-3">
          <button
            className="zen-pressable flex items-center gap-2 text-left text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={() => setHeaderCollapsed(!headerCollapsed)}
            title={headerCollapsed ? "Expand header" : "Collapse header"}
          >
            <span className="text-xs">{headerCollapsed ? "▸" : "▾"}</span>
            <span className={SECTION_LABEL}>Session</span>
          </button>
          {!headerCollapsed && (
            <>
              <div className="flex flex-wrap items-start gap-3">
                <IntentBar
                  intent={intent}
                  assessing={assessing}
                  onCommit={setIntent}
                  onAssess={(value) => void runAssessment(value)}
                />
                <SessionTimer
                  sessionActive={sessionActive}
                  sessionRemaining={sessionRemaining}
                  sessionProgress={sessionProgress}
                  onStartSession={onStartSession}
                  onEndSession={onEndSession}
                />
              </div>
              <AiReadinessPanel
                ai={ai}
                intent={intent}
                assessing={assessing}
                focusMs={focusMs}
                sessions={sessions}
                onAssess={() => void runAssessment()}
              />
            </>
          )}
        </div>
      )}

      <div className="zen-panel-scroll relative min-h-0 flex-1 overflow-auto rounded-[16px] border border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.12)]">
        {zenMode && (
          <button
            className="zen-anim-fade zen-pressable absolute right-3 top-3 z-10 rounded-full border border-[rgba(255,255,255,0.1)] bg-[rgba(18,19,24,0.7)] px-2 py-1 text-sm leading-none text-[var(--text-dim)] backdrop-blur hover:text-[var(--text)]"
            onClick={() => setZenMode(false)}
            title="Exit zen mode"
            aria-label="Exit zen mode"
          >
            ◑
          </button>
        )}
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-[var(--text-dim)]">
            Nothing here yet. Right-click a note, email, or event → <span className="mx-1 text-[var(--text)]">Add to Deep Work</span> to bring it onto this canvas.
          </div>
        ) : (
          items.map((item) => {
            const key = targetKey(item);
            const geom: WindowGeom = windows[key] ?? { x: 32, y: 32, w: 380, h: 340 };
            const commit = (g: WindowGeom) => setWindow(key, g);
            const onRemove = () => removeItem(item);

            if (item.type === "note") {
              const note = notes[item.id];
              return (
                <WindowFrame
                  key={key}
                  geom={geom}
                  onCommit={commit}
                  onRemove={onRemove}
                  glyph="✎"
                  accent="#60A5FA"
                  title={note?.title || "Untitled"}
                  onHeaderContextMenu={(e) => openRelatedMenu(e, item)}
                >
                  {note ? <NoteWindow noteId={item.id} /> : <Missing label="This note is no longer available." />}
                </WindowFrame>
              );
            }
            if (item.type === "event") {
              const event = events.find((e) => e.id === item.id);
              return (
                <WindowFrame
                  key={key}
                  geom={geom}
                  onCommit={commit}
                  onRemove={onRemove}
                  glyph="◷"
                  accent="#6ea8fe"
                  title={event?.summary || "Event"}
                  onHeaderContextMenu={(e) => openRelatedMenu(e, item)}
                >
                  {event ? <EventWindow event={event} /> : <Missing label="Event not loaded (sign in to Google to view)." />}
                </WindowFrame>
              );
            }
            const thread = threads.find((t) => t.id === item.id);
            return (
              <WindowFrame
                key={key}
                geom={geom}
                onCommit={commit}
                onRemove={onRemove}
                glyph="✉"
                accent="#b073e0"
                title={thread?.subject || "Email"}
                onHeaderContextMenu={(e) => openRelatedMenu(e, item)}
              >
                <EmailWindow threadId={item.id} from={thread?.from ?? "the sender"} />
              </WindowFrame>
            );
          })
        )}
      </div>

      {relatedMenu && (
        <RelatedTagMenu
          x={relatedMenu.x}
          y={relatedMenu.y}
          related={relatedCandidates(relatedMenu.source, notes, events, threads, matchedLabels).filter(
            (c) => !items.some((it) => it.type === c.target.type && it.id === c.target.id)
          )}
          onAdd={(c) => {
            addItem(c.target);
            setRelatedMenu(null);
          }}
        />
      )}
    </div>
  );
}

function RelatedTagMenu({
  x, y, related, onAdd,
}: {
  x: number;
  y: number;
  related: RelatedCandidate[];
  onAdd: (candidate: RelatedCandidate) => void;
}) {
  return (
    <div
      className="zen-anim-pop fixed z-50 max-h-[60vh] min-w-[240px] overflow-auto rounded-[12px] border border-[var(--border)] bg-[rgba(18,19,24,0.96)] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur"
      style={{ left: x, top: y, transformOrigin: "top left" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-dim)]">
        Related by tag
      </div>
      {related.length === 0 ? (
        <div className="px-3 py-2 text-sm text-[var(--text-dim)]">Nothing related to add.</div>
      ) : (
        related.map((c) => (
          <button
            key={`${c.target.type}:${c.target.id}`}
            className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-[var(--bg-elev)]"
            onClick={() => onAdd(c)}
          >
            <span className="shrink-0 text-sm text-[var(--text-dim)]">{TYPE_GLYPH[c.type]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-[var(--text)]">{c.title}</span>
              {c.subtitle && <span className="block truncate text-xs text-[var(--text-dim)]">{c.subtitle}</span>}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function Missing({ label }: { label: string }) {
  return <div className="p-4 text-sm text-[var(--text-dim)]">{label}</div>;
}

// ── intent + AI readiness ────────────────────────────────────────────────────

function IntentBar({
  intent, assessing, onCommit, onAssess,
}: {
  intent: string;
  assessing: boolean;
  onCommit: (value: string) => void;
  onAssess: (value: string) => void;
}) {
  const [value, setValue] = useState(intent);
  useEffect(() => setValue(intent), [intent]);
  return (
    <form
      className="min-w-0 flex-1 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onCommit(value);
        onAssess(value);
      }}
    >
      <div className={SECTION_LABEL}>What do you want to do?</div>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[rgba(232,233,237,0.34)] focus:border-[#60A5FA]"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => onCommit(value)}
          placeholder="e.g. Be ready for the Python exam — finish the practice sets"
        />
        <button
          type="submit"
          disabled={!value.trim() || assessing}
          className="zen-pressable shrink-0 rounded-[12px] bg-[#60A5FA] px-4 py-2 text-sm font-semibold text-black hover:brightness-105 disabled:opacity-60"
        >
          {assessing ? "Assessing…" : "Assess"}
        </button>
      </div>
    </form>
  );
}

function AiReadinessPanel({
  ai, intent, assessing, focusMs, sessions, onAssess,
}: {
  ai: AiReadiness | null;
  intent: string;
  assessing: boolean;
  focusMs: number;
  sessions: number;
  onAssess: () => void;
}) {
  const color = ai ? readinessColor(ai.percent) : "#60A5FA";
  const hasIntent = !!intent.trim();
  return (
    <div className="space-y-3 rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <span className={SECTION_LABEL}>AI Readiness</span>
        <div className="flex items-center gap-3">
          {ai && <span className="text-2xl font-bold tabular-nums" style={{ color }}>{ai.percent}%</span>}
          <button
            onClick={onAssess}
            disabled={assessing || !hasIntent}
            className="zen-pressable rounded-[10px] border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {assessing ? "…" : ai ? "Reassess" : "Assess"}
          </button>
        </div>
      </div>

      {ai ? (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${ai.percent}%`, background: color }} />
          </div>
          {ai.summary && <div className="text-sm text-[rgba(232,233,237,0.86)]">{ai.summary}</div>}
          {ai.next.length > 0 && (
            <ul className="space-y-1">
              {ai.next.map((step, i) => (
                <li key={i} className="flex gap-2 text-sm text-[var(--text-dim)]">
                  <span style={{ color }}>→</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="text-sm text-[var(--text-dim)]">
          {hasIntent ? "Assess to see how ready you are for this goal." : "Add items and tell the AI what you want to do, then assess."}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-dim)]">
        <span className="text-[var(--text)]">{fmtDuration(focusMs)}</span>
        <span>focused</span>
        <span>·</span>
        <span><span className="text-[var(--text)]">{sessions}</span> sessions</span>
      </div>
    </div>
  );
}

// ── focus timer ──────────────────────────────────────────────────────────────

function SessionTimer({
  sessionActive, sessionRemaining, sessionProgress, onStartSession, onEndSession,
}: {
  sessionActive: boolean;
  sessionRemaining: number;
  sessionProgress: number;
  onStartSession: (min: number) => void;
  onEndSession: () => void;
}) {
  if (sessionActive) {
    return (
      <div className="min-w-[220px] rounded-[16px] bg-[rgba(96,165,250,0.06)] px-4 py-3 text-left">
        <div className="flex items-center justify-between gap-3">
          <span className="text-3xl font-semibold tabular-nums text-[var(--text)]">{fmtClock(sessionRemaining)}</span>
          <button
            className="rounded-[12px] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={onEndSession}
          >
            End session
          </button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
          <div className="h-full rounded-full bg-[#60A5FA] transition-[width] duration-1000" style={{ width: `${sessionProgress}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 pt-6">
      {[25, 50, 90].map((d) => (
        <button
          key={d}
          onClick={() => onStartSession(d)}
          className="zen-pressable rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)]"
        >
          {d}m
        </button>
      ))}
    </div>
  );
}
