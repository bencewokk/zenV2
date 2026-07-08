import { useEffect, useRef, useState, type ReactNode } from "react";
import { APP_LOOKS, applyAppearance, loadAppearance, saveAppearance, type AppLook } from "@/services/appearance";
import { useOnboarding } from "./store";
import { useSparkIntro } from "./sparkStore";
import MagicBento from "@/shared/ui/reactbits/MagicBento";
import LineSidebar from "@/shared/ui/reactbits/LineSidebar";
import CardNav from "@/shared/ui/reactbits/CardNav";
import "./SparkIntro.css";

/**
 * First-run "Spark Intro": a focused cinematic reveal. A spark ignites, washes
 * the empty screen in accent, the user picks an app look, then a schematic of
 * Zen assembles itself and "opens" every surface one at a time — each with a
 * one-line tutorial. Self-contained (not the live DOM) so it stays fully
 * controlled. On finish it hands off to the connection wizard (Onboarding.tsx).
 */

type SurfaceId = "home" | "notes" | "deepwork" | "calendar" | "mail" | "sources" | "ai" | "settings";

interface Surface { id: SurfaceId; chip: string; caption: ReactNode }

const SURFACES: Surface[] = [
  { id: "home", chip: "Zen", caption: <>This is <b>home</b> — every view returns here. One calm place to start.</> },
  { id: "notes", chip: "Notes", caption: <>Your <b>notes</b> live on the left. Local-first, yours, synced only if you ask.</> },
  { id: "deepwork", chip: "Deep Work", caption: <><b>Deep Work</b> pulls your material into one timed, focused session.</> },
  { id: "calendar", chip: "Calendar", caption: <>Your <b>Calendar</b> keeps deadlines and study blocks in view.</> },
  { id: "mail", chip: "Mail", caption: <><b>Mail</b> surfaces what needs a reply, triaged by AI labels.</> },
  { id: "sources", chip: "Sources", caption: <><b>Sources</b> connect Canvas, Drive, Zotero, GitHub and the web.</> },
  { id: "ai", chip: "AI", caption: <><b>AI</b> is here when you want it — quiet until you open it.</> },
  { id: "settings", chip: "Settings", caption: <>Tune everything in <b>Settings</b> — connections, plan, and appearance.</> },
];

// Header chips in display order (Search has no tour surface; the rest map 1:1).
const CHIPS: Array<{ id: SurfaceId | "search"; label: string }> = [
  { id: "search", label: "⌕" },
  { id: "notes", label: "Notes" },
  { id: "deepwork", label: "Deep Work" },
  { id: "calendar", label: "Calendar" },
  { id: "mail", label: "Mail" },
  { id: "sources", label: "Sources" },
  { id: "ai", label: "AI" },
  { id: "settings", label: "⚙" },
];

type Kind = "ignite" | "title" | "look" | "tour" | "ready";
interface Beat { kind: Kind; surface?: Surface; hold: number }

const BEATS: Beat[] = [
  { kind: "ignite", hold: 2000 },
  { kind: "title", hold: 2800 },
  { kind: "look", hold: 0 }, // interactive — waits for a pick
  ...SURFACES.map((surface) => ({ kind: "tour" as const, surface, hold: 2700 })),
  { kind: "ready", hold: 60000 },
];

const LOOK = BEATS.findIndex((b) => b.kind === "look");
const FIRST_TOUR = BEATS.findIndex((b) => b.kind === "tour");
const READY = BEATS.length - 1;

export function SparkIntro() {
  const open = useSparkIntro((s) => s.open);
  const finishIntro = useSparkIntro((s) => s.finish);
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [look, setLook] = useState<AppLook>(() => loadAppearance().appLook);
  const [lookPicked, setLookPicked] = useState(false);
  const reduceMotion = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    reduceMotion.current = document.documentElement.hasAttribute("data-reduce-motion");
    setLeaving(false);
    setLookPicked(false);
    setLook(loadAppearance().appLook);
    setBeat(reduceMotion.current ? LOOK : 0);
  }, [open]);

  // Auto-advance, except the interactive look beat and the final ready beat.
  useEffect(() => {
    if (!open || reduceMotion.current) return;
    const b = BEATS[beat];
    if (b.kind === "look" || b.kind === "ready") return;
    timer.current = setTimeout(() => setBeat((v) => Math.min(v + 1, READY)), b.hold);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [open, beat]);

  if (!open) return null;

  const b = BEATS[beat];
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); };
  const advance = () => { clearTimer(); setBeat((v) => Math.min(v + 1, READY)); };

  const chooseLook = (id: AppLook) => {
    const next = { ...loadAppearance(), appLook: id };
    saveAppearance(next);
    applyAppearance(next); // apply live so the whole intro retints instantly
    setLook(id);
    setLookPicked(true);
  };

  const handOff = () => {
    clearTimer();
    const go = () => { finishIntro(); useOnboarding.getState().start(); };
    if (reduceMotion.current) return go();
    setLeaving(true);
    setTimeout(go, 480);
  };

  const staged = b.kind === "tour" || b.kind === "ready";
  const activeChip: string | null = b.kind === "tour" ? b.surface!.id : b.kind === "ready" ? "home" : null;
  const tourIndex = beat - FIRST_TOUR;
  const clickToAdvance = b.kind === "tour" || (b.kind === "title");

  return (
    <div
      className={`spark-intro${staged ? " spark-intro--staged" : ""}${leaving ? " spark-intro--leaving" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Zen"
      onClick={clickToAdvance ? advance : undefined}
    >
      <div className="spark-intro__wash" style={{ ["--wash" as string]: 1 }} />
      {b.kind === "ignite" && <div className="spark-intro__spark" />}

      <button className="spark-intro__skip" onClick={(e) => { e.stopPropagation(); handOff(); }}>
        Skip intro
      </button>

      {/* Title */}
      {b.kind === "title" && (
        <div className="spark-intro__stage">
          <SplitTitle text="Welcome to Zen" />
          <p className="spark-intro__subtitle" style={{ ["--sub-d" as string]: "820ms" }}>
            A calm, focused space for study. Let's light it up.
          </p>
        </div>
      )}

      {/* Look chooser */}
      {b.kind === "look" && (
        <div className="spark-intro__stage" onClick={(e) => e.stopPropagation()}>
          <h2 className="spark-intro__steptitle">Choose your look</h2>
          <p className="spark-intro__subtitle spark-intro__subtitle--static">You can change this any time in Settings → Appearance.</p>
          <div className="spark-look-grid">
            {APP_LOOKS.map((option) => (
              <button
                key={option.id}
                className={`spark-look-card${look === option.id ? " spark-look-card--active" : ""}`}
                onClick={() => chooseLook(option.id)}
              >
                <span className="spark-look-swatch" style={{ background: option.swatch }} />
                <span className="spark-look-name">{option.label}</span>
                <span className="spark-look-hint">{option.hint}</span>
              </button>
            ))}
          </div>
          <button className="zen-btn zen-shine spark-look-continue" disabled={!lookPicked} onClick={advance}>
            {lookPicked ? "Continue" : "Pick a look to continue"}
          </button>
        </div>
      )}

      {/* Schematic app that "opens" each surface */}
      {staged && (
        <>
          <div className="spark-frame">
            <div className="spark-frame__header">
              <span className={`spark-frame__wordmark${activeChip === "home" ? " spark-chip--active" : ""}`}>Zen</span>
              <span className="spark-frame__spacer" />
              {CHIPS.map((chip) => (
                <span
                  key={chip.id}
                  className={`spark-chip spark-chip--in${activeChip === chip.id ? " spark-chip--active" : ""}`}
                >
                  {chip.label}
                </span>
              ))}
            </div>
            <div className="spark-frame__body">
              <SurfaceMock id={(b.surface?.id ?? "home") as SurfaceId} />
            </div>
          </div>
          <div className="spark-intro__caption">
            <span key={beat} className="spark-caption-swap">
              {b.kind === "ready"
                ? <>That's your space. Next, connect the pieces you want — nothing is on until you choose it.</>
                : b.surface!.caption}
            </span>
          </div>
        </>
      )}

      <div className="spark-intro__controls" onClick={(e) => e.stopPropagation()}>
        {b.kind === "tour" && (
          <div className="spark-intro__dots" aria-hidden>
            {SURFACES.map((_, i) => (
              <span key={i} className={`spark-intro__dot${tourIndex === i ? " spark-intro__dot--on" : ""}`} />
            ))}
          </div>
        )}
        {b.kind === "ready" && (
          <button className="zen-btn zen-shine" onClick={handOff}>Enter Zen</button>
        )}
      </div>
    </div>
  );
}

/** A lightweight mock of each surface, rendered inside the schematic frame.
 *  Home / Sources / Settings double as showcases for the React Bits pieces. */
function SurfaceMock({ id }: { id: SurfaceId }) {
  if (id === "home") {
    return (
      <div className="spark-mock spark-mock--pad spark-mock__home">
        <CardNav
          logoText="Zen"
          ctaLabel="New session"
          items={[
            { label: "Study", bgColor: "var(--bg)", textColor: "var(--text)", links: [{ label: "Deep Work" }, { label: "Quizzes" }] },
            { label: "Work", bgColor: "var(--bg)", textColor: "var(--text)", links: [{ label: "Notes" }, { label: "Sources" }] },
            { label: "Admin", bgColor: "var(--bg)", textColor: "var(--text)", links: [{ label: "Calendar" }, { label: "Mail" }] },
          ]}
        />
        <MagicBento
          className="spark-mock-bento"
          enableSpotlight={false}
          enableTilt
          particleCount={8}
          cards={[
            { label: "Focus", title: "Daily Focus", description: "Your next best study action" },
            { label: "Timer", title: "Deep Work", description: "Start a 25–90m block" },
            { label: "Brief", title: "Startup Brief", description: "AI-summarised for today" },
            { label: "Exam", title: "Exam Focus", description: "Readiness & weak spots" },
            { label: "Feed", title: "Action Feed", description: "Mail, notes, events" },
            { label: "Notes", title: "Quick Capture", description: "Park a thought fast" },
          ]}
        />
      </div>
    );
  }
  if (id === "notes") {
    return (
      <div className="spark-mock">
        <div className="spark-mock__notes">
          {["Biology · Cell cycle", "Calc II · Series", "History essay", "Inbox: reply to TA", "Lab writeup"].map((t, i) => (
            <div key={i} className={`spark-mock__note${i === 0 ? " spark-mock__note--active" : ""}`}>{t}</div>
          ))}
        </div>
        <div className="spark-mock__editor">
          <div className="spark-mock__h" />
          {[92, 100, 84, 96, 70].map((w, i) => <div key={i} className="spark-mock__line" style={{ width: `${w}%` }} />)}
        </div>
      </div>
    );
  }
  if (id === "deepwork") {
    return (
      <div className="spark-mock spark-mock--center">
        <div className="spark-mock__timer">25:00</div>
        <div className="spark-mock__bar"><span style={{ width: "62%" }} /></div>
        <div className="spark-mock__chips">
          {["Notes", "PDF", "Backbone", "Quiz"].map((t) => <span key={t}>{t}</span>)}
        </div>
      </div>
    );
  }
  if (id === "calendar") {
    return (
      <div className="spark-mock spark-mock--pad">
        <div className="spark-mock__cal">
          {Array.from({ length: 21 }).map((_, i) => (
            <div key={i} className={`spark-mock__cell${[3, 9, 10, 16].includes(i) ? " spark-mock__cell--event" : ""}`} />
          ))}
        </div>
      </div>
    );
  }
  if (id === "mail") {
    return (
      <div className="spark-mock spark-mock--pad">
        {["Prof. Lee · Assignment 3 feedback", "Study group · Meet Thursday?", "Library · Hold ready", "Canvas · New grade posted"].map((t, i) => (
          <div key={i} className="spark-mock__mailrow">
            <span className={`spark-mock__dot${i < 2 ? " spark-mock__dot--unread" : ""}`} />
            <span className="spark-mock__mailtext">{t}</span>
          </div>
        ))}
      </div>
    );
  }
  if (id === "sources") {
    return (
      <div className="spark-mock spark-mock--pad">
        <MagicBento
          className="spark-mock-bento"
          enableSpotlight={false}
          particleCount={6}
          cards={[
            { label: "LMS", title: "Canvas", description: "Courses & assignments" },
            { label: "Files", title: "Drive", description: "Read-only files" },
            { label: "Research", title: "Zotero", description: "Papers & citations" },
            { label: "Code", title: "GitHub", description: "Your repositories" },
          ]}
        />
      </div>
    );
  }
  if (id === "ai") {
    return (
      <div className="spark-mock spark-mock--pad spark-mock__ai">
        <div className="spark-mock__bubble spark-mock__bubble--me">Summarise chapter 4</div>
        <div className="spark-mock__bubble">Chapter 4 covers the cell cycle — here are the 3 key phases…</div>
        <div className="spark-mock__bubble spark-mock__bubble--me">Quiz me on it</div>
      </div>
    );
  }
  // settings
  return (
    <div className="spark-mock spark-mock--pad spark-mock__settings">
      <LineSidebar
        items={["Connections", "Plan & usage", "AI behavior", "Appearance", "Data"]}
        defaultActive={3}
        itemGap={12}
        fontSize={0.85}
      />
      <div className="spark-mock__settingspane">
        <div className="spark-mock__h" style={{ width: "40%" }} />
        {[80, 60, 90].map((w, i) => <div key={i} className="spark-mock__line" style={{ width: `${w}%` }} />)}
      </div>
    </div>
  );
}

/** Splits text into per-char spans with a staggered reveal (SplitText, native). */
function SplitTitle({ text }: { text: string }) {
  return (
    <h1 className="spark-intro__title" aria-label={text}>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="spark-intro__char" aria-hidden style={{ ["--d" as string]: `${i * 55}ms` }}>{ch}</span>
      ))}
    </h1>
  );
}
