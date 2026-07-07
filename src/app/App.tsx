import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Toaster } from "sonner";
import { Sidebar } from "@/features/notes/Sidebar";
import { NoteSurface } from "@/features/notes/NoteSurface";
import { FilterBar } from "@/features/filtering/FilterBar";
import { StatusBar } from "@/shared/ui/StatusBar";
import { AmbientOverlay } from "@/shared/ui/AmbientOverlay";
import { WindowControls, WindowResizeHandles, IS_TAURI } from "@/shared/ui/WindowChrome";
import { Home } from "@/features/home/Home";
import { useHome } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { FocusTimerButton } from "@/features/home/deepwork/FocusTimerButton";
import { StudyPanel } from "@/features/home/deepwork/StudyPanel";
import { useLesson } from "@/features/home/deepwork/lessonStore";
import { useQuiz } from "@/features/home/deepwork/quizStore";
import { SessionTabs } from "@/features/home/deepwork/SessionTabs";
import { AddToSessionPicker } from "@/features/home/deepwork/AddToSessionPicker";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { CommandPalette, useCommandPalette } from "@/features/search/CommandPalette";
import { ReleaseNotesModal } from "@/features/home/ReleaseNotes";
import { useOnboarding } from "@/features/onboarding/store";
import { seedSampleSession } from "@/features/onboarding/seedSession";
import { checkForUpdates } from "@/services/update";
import { startSync } from "@/services/sync/engine";
import { applyAppearance } from "@/services/appearance";
import { useNotes } from "@/features/notes/store";
import { useAI } from "@/features/ai/store";
import { startAiAccessWatch } from "@/features/ai/access";
import { useWorkspace } from "@/shared/stores/workspace";
import { usePdfs } from "@/features/pdfs/store";
import { useStatus } from "@/shared/stores/status";
import { ensureSourcesLoaded } from "@/services/sources/store";
import { startSourceRefresh } from "@/services/sources/refresh";
import { isSignedIn, onAuthChange } from "@/services/google/auth";
import { clearLocalConnectionSecrets, reconcileConnectionVault } from "@/services/connections/vault";

const ChatPanel = lazy(() => import("@/features/ai/ChatPanel").then((module) => ({ default: module.ChatPanel })));
const CalendarPanel = lazy(() => import("@/features/google/CalendarPanel").then((module) => ({ default: module.CalendarPanel })));
const MailPanel = lazy(() => import("@/features/google/MailPanel").then((module) => ({ default: module.MailPanel })));
const SettingsView = lazy(() => import("@/features/settings/SettingsView").then((module) => ({ default: module.SettingsView })));
const SourcesPanel = lazy(() => import("@/features/sources/SourcesPanel").then((module) => ({ default: module.SourcesPanel })));
const QuizView = lazy(() => import("@/features/home/deepwork/QuizView").then((module) => ({ default: module.QuizView })));
const LessonMode = lazy(() => import("@/features/home/deepwork/LessonMode").then((module) => ({ default: module.LessonMode })));

/**
 * Phase 1 shell — a thin composer of feature modules (the anti-ui.py).
 * Sidebar (tree) + FilterBar | Editor + NoteMeta, StatusBar across the bottom.
 */
/** Shared base for every header button so they share one height (h-7). */
const HEADER_BTN = "zen-pressable inline-flex h-7 items-center rounded-[6px] border px-2.5 text-xs";
const HEADER_BTN_ACTIVE = "border-[var(--accent)] bg-[var(--bg)] text-[var(--accent)]";
const HEADER_BTN_IDLE = "border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-dim)] hover:text-[var(--text)]";

export function App() {
  const load = useNotes((s) => s.load);
  const loaded = useNotes((s) => s.loaded);
  const notes = useNotes((s) => s.notes);
  const selectedId = useNotes((s) => s.selectedId);
  const select = useNotes((s) => s.select);
  const sidebarWidth = useWorkspace((s) => s.sidebarWidth);
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed);
  const setWs = useWorkspace((s) => s.set);
  const manualDeepWork = useHome((s) => s.manualDeepWork);
  const setManualDeepWork = useHome((s) => s.setManualDeepWork);
  const deepWorkLaunchNonce = useHome((s) => s.deepWorkLaunchNonce);
  const deepWorkItemCount = useDeepWork((s) => s.items.length);
  const zenMode = useDeepWork((s) => s.zenMode);
  const setZenMode = useDeepWork((s) => s.setZenMode);
  const threads = useHome((s) => s.threads);
  const aiStatus = useStatus((s) => s.ai);
  const aiOpen = useAI((s) => s.open);
  const surface = useWorkspace((s) => s.surface);
  const adminFocus = useWorkspace((s) => s.adminFocus);
  const adminMailId = useWorkspace((s) => s.adminMailId);
  const setSurface = (surface: "home" | "admin" | "sources" | "settings") => setWs({ surface });
  const setAdminFocus = (adminFocus: "calendar" | "mail") => setWs({ adminFocus });
  const setAdminMailId = (adminMailId: string | null) => setWs({ adminMailId });
  const shellRef = useRef<HTMLDivElement>(null);
  const [showStudy, setShowStudy] = useState(false);
  const lessonActive = useLesson((s) => s.active);
  const quizActive = useQuiz((s) => s.activeId !== null);

  // Selecting a note returns to the editor and resets any shell-only state.
  useEffect(() => {
    if (selectedId) setSurface("home");
  }, [selectedId]);

  // Initial load + restore the last surface (once). Until that has run we must
  // not write lastOpenId, or the mount-time null selection would wipe it.
  const restored = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    applyAppearance();
    void usePdfs.getState().load();
    void ensureSourcesLoaded();
    useOnboarding.getState().startIfFirstRun();
    // Seed notes first, then build the ready-made sample Deep Work session from them.
    void load().then(() => seedSampleSession());
    // Check for a newer release shortly after launch (desktop only; no-op in browser).
    const t = window.setTimeout(() => void checkForUpdates(), 4000);
    // Background cloud sync (no-op until enabled + signed in via Settings).
    startSync();
    const stopVaultAuth = onAuthChange((signedIn) => {
      if (signedIn) void reconcileConnectionVault().catch(() => {});
      else clearLocalConnectionSecrets();
    });
    if (isSignedIn()) void reconcileConnectionVault().catch(() => {});
    const stopSourceRefresh = startSourceRefresh();
    const stopAiAccess = startAiAccessWatch();
    return () => { window.clearTimeout(t); stopSourceRefresh(); stopVaultAuth(); stopAiAccess(); };
  }, [load]);
  useEffect(() => {
    if (loaded && !restored.current) {
      restored.current = true;
      // Restore the last surface across refresh. Deep Work and the admin
      // panels (Calendar/Mail) own the view, so don't re-open a note over them.
      // A null lastOpenId on the home surface means the dashboard was showing.
      const deepWork = useHome.getState().manualDeepWork;
      // Admin (Calendar/Mail) and Settings own the view — don't re-open a note over them.
      const ownsView = useWorkspace.getState().surface !== "home";
      if (!deepWork && !ownsView) {
        const last = useWorkspace.getState().lastOpenId;
        if (last && notes[last]) select(last);
      }
      setHydrated(true);
    }
  }, [loaded, notes, select]);
  useEffect(() => {
    if (loaded) void useHome.getState().bootstrap();
  }, [loaded]);
  // Track the open note exactly (including deselection) so the home dashboard
  // and editor both persist across refresh.
  useEffect(() => {
    if (hydrated) setWs({ lastOpenId: selectedId });
  }, [hydrated, selectedId, setWs]);

  useEffect(() => {
    if (deepWorkLaunchNonce === 0) return;
    select(null);
    setSurface("home");
    setAdminMailId(null);
  }, [deepWorkLaunchNonce, select]);

  // Wiki-link click navigation.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest("a[data-wiki-link]");
      if (!el) return;
      e.preventDefault();
      const id = el.getAttribute("data-note-id");
      if (id && useNotes.getState().notes[id]) select(id);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [select]);

  const note = selectedId ? notes[selectedId] : null;
  const showAdmin = !note && surface === "admin";
  const showSettings = !note && surface === "settings";
  const showSources = !note && surface === "sources";
  const showHome = !note && surface === "home";
  const deepWork = showHome && manualDeepWork;
  const zen = deepWork && zenMode;
  const sidebarApplicable = !showAdmin && !showSources && !showSettings && !deepWork;
  const sidebarVisible = sidebarApplicable && !sidebarCollapsed;
  const noteList = Object.values(notes);
  const inboxCount = noteList.filter((item) => item.inbox).length;
  const weeklyActivity = noteList.filter((item) => Date.now() - item.updatedAt < 7 * 24 * 60 * 60 * 1000).length;
  const unreadCount = threads.filter((thread) => thread.unread).length;
  const shellStyle = useMemo(
    () => ({
      "--zen-contour-scale": String(Math.min(1.25, 0.72 + weeklyActivity / 18)),
      "--zen-contour-lift": String(Math.min(1, 0.18 + unreadCount / 12)),
      "--zen-triage-pressure": String(Math.min(1, (inboxCount + unreadCount) / 16)),
      "--zen-eclipse-opacity": deepWork ? "0.52" : showAdmin ? "0.28" : "0.36",
      "--zen-split-point": showAdmin
        ? "0%"
        : `${Math.max(18, Math.min(34, Math.round((sidebarWidth / 1440) * 100)))}%`,
    }) as CSSProperties,
    [deepWork, inboxCount, showAdmin, sidebarWidth, unreadCount, weeklyActivity]
  );

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;

    const updatePointer = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      node.style.setProperty("--zen-mouse-x", `${Math.max(0, Math.min(100, x))}%`);
      node.style.setProperty("--zen-mouse-y", `${Math.max(0, Math.min(100, y))}%`);
    };

    window.addEventListener("pointermove", updatePointer);
    return () => window.removeEventListener("pointermove", updatePointer);
  }, []);

  return (
    <div
      ref={shellRef}
      style={shellStyle}
      className={`zen-shell flex h-full flex-col ${showHome ? "is-home" : ""} ${showAdmin ? "is-admin" : ""} ${deepWork ? "is-deep-work" : ""}`}
    >

      <AmbientOverlay />

      <WindowResizeHandles />

      {/* Zen mode (and study/lesson mode) hide the whole header, including the
          window controls — the canvas exit-zen / End-lesson button is the way back. */}
      {!zen && !lessonActive && IS_TAURI && (
        // A guaranteed-empty strip to grab and move the window. The header row below
        // is also a drag region, but once Deep Work session tabs fill it there's
        // little open space left to click — this strip is never occluded by buttons.
        <div data-tauri-drag-region className="relative z-30 h-2.5 shrink-0" />
      )}
      {!zen && !lessonActive && <header data-tauri-drag-region className="relative z-30 flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <button
          className="zen-pressable zen-shine inline-flex h-7 items-center rounded-[6px] px-1.5 font-semibold tracking-tight text-[var(--text)] hover:text-[var(--accent)]"
          onClick={() => {
            select(null);
            setSurface("home");
            setManualDeepWork(false);
            void useHome.getState().refresh();
          }}
          title="Home dashboard"
        >
          Zen
        </button>
        <div data-tauri-drag-region className="mx-3 min-w-0 flex-1">
          <SessionTabs
            onOpen={() => {
              select(null);
              setSurface("home");
              setAdminMailId(null);
              setManualDeepWork(true);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`${HEADER_BTN} ${HEADER_BTN_IDLE}`}
            onClick={() => useCommandPalette.getState().setOpen(true)}
            title="Search everything (Ctrl+K)"
            aria-label="Search"
          >
            ⌕
          </button>
          {sidebarApplicable && (
            <button
              className={`${HEADER_BTN} ${sidebarVisible ? HEADER_BTN_ACTIVE : HEADER_BTN_IDLE}`}
              onClick={() => setWs({ sidebarCollapsed: !sidebarCollapsed })}
              title={sidebarVisible ? "Hide notes" : "Show notes"}
            >
              Notes
            </button>
          )}
          <button
            className={`${HEADER_BTN} ${showHome && deepWork ? HEADER_BTN_ACTIVE : HEADER_BTN_IDLE}`}
            onClick={() => {
              if (deepWork) {
                setManualDeepWork(false);
              } else {
                select(null);
                setSurface("home");
                setAdminMailId(null);
                setManualDeepWork(true);
              }
            }}
            title="Toggle Deep Work"
          >
            Deep Work{deepWorkItemCount > 0 ? ` · ${deepWorkItemCount}` : ""}
          </button>
          {([
            ["calendar", "Calendar"],
            ["mail", "Mail"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              className={`${HEADER_BTN} ${showAdmin && adminFocus === v ? HEADER_BTN_ACTIVE : HEADER_BTN_IDLE}`}
              onClick={() => {
                select(null);
                setSurface("admin");
                setAdminFocus(v);
                if (v !== "mail") setAdminMailId(null);
                void useHome.getState().refresh();
              }}
            >
              {label}
            </button>
          ))}
          <button
            className={`${HEADER_BTN} ${showSources ? HEADER_BTN_ACTIVE : HEADER_BTN_IDLE}`}
            onClick={() => { select(null); setManualDeepWork(false); setAdminMailId(null); setSurface("sources"); }}
            title="Connected sources"
          >
            Sources
          </button>
          {deepWork && (
            // Deep-Work-only controls, lightly grouped so they read as one cluster
            // that appears when you enter Deep Work.
            <div className="zen-anim-fade inline-flex items-center gap-1 rounded-[8px] bg-[rgba(255,255,255,0.04)] p-0.5">
              <FocusTimerButton />
              <button
                className={`${HEADER_BTN} ${showStudy ? HEADER_BTN_ACTIVE : HEADER_BTN_IDLE}`}
                onClick={() => setShowStudy((v) => !v)}
                title="Study panel — backbone, mastery & daily goal"
              >
                Study
              </button>
              <button
                className={`${HEADER_BTN} ${HEADER_BTN_IDLE}`}
                onClick={() => setZenMode(true)}
                title="Zen mode — show only sources"
                aria-label="Enter zen mode"
              >
                ◐
              </button>
            </div>
          )}
          <button
            className={`${HEADER_BTN} ${aiStatus === "busy" ? "zen-glow border-[var(--accent)] bg-[var(--bg)] text-[var(--accent)]" : HEADER_BTN_IDLE}`}
            onClick={() => useAI.getState().toggle()}
            title="Toggle AI panel"
          >
            AI
          </button>
          <button
            className={`${HEADER_BTN} ${showSettings ? HEADER_BTN_ACTIVE : HEADER_BTN_IDLE}`}
            onClick={() => {
              select(null);
              setManualDeepWork(false);
              setAdminMailId(null);
              setSurface("settings");
            }}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
          {IS_TAURI && <WindowControls className="-mr-2 ml-1" />}
        </div>
      </header>}

      <div className="relative z-10 flex min-h-0 flex-1">
        <aside
          className="overflow-hidden border-r border-[var(--border)] transition-[width,opacity,transform] duration-300"
          style={{
            width: sidebarVisible ? sidebarWidth : 0,
            opacity: sidebarVisible ? 1 : 0,
            transform: sidebarVisible ? "translateX(0)" : "translateX(-32px)",
          }}
        >
          <div className="flex h-full flex-col" style={{ width: sidebarWidth }}>
            <FilterBar />
            <Sidebar />
          </div>
        </aside>

        <div
          className={`cursor-col-resize bg-transparent transition-[width,opacity] duration-300 hover:bg-[var(--accent-dim)] ${sidebarVisible ? "w-1 opacity-100" : "w-0 opacity-0"}`}
          onMouseDown={(e) => {
            if (!sidebarVisible) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = sidebarWidth;
            const onMove = (ev: MouseEvent) =>
              setWs({ sidebarWidth: Math.max(200, Math.min(500, startW + ev.clientX - startX)) });
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        />

        <main className={`min-w-0 flex-1 ${note || showAdmin || showSources || showSettings || deepWork ? "overflow-hidden" : "overflow-y-auto"}`}>
          {/* Keyed by surface so switching views re-mounts and crossfades in. */}
          <div
            key={note ? "note" : showAdmin ? "admin" : showSources ? "sources" : showSettings ? "settings" : deepWork ? (zen ? "zen" : "deep") : "home"}
            className="zen-anim-rise-scale h-full min-h-0"
          >
            {note ? (
              <NoteSurface note={note} />
            ) : showAdmin ? (
              <AdminPanel focus={adminFocus} mailId={adminMailId} />
            ) : showSources ? (
              <Suspense fallback={<LoadingSurface />}><SourcesPanel /></Suspense>
            ) : showSettings ? (
              <Suspense fallback={<LoadingSurface />}><SettingsView /></Suspense>
            ) : (
              <Home
                deepWork={deepWork}
                onOpenAdmin={(focus, targetId) => {
                  setAdminFocus(focus);
                  setAdminMailId(focus === "mail" ? targetId ?? null : null);
                  setSurface("admin");
                }}
              />
            )}
          </div>
        </main>

        {deepWork && showStudy && <StudyPanel onClose={() => setShowStudy(false)} />}

        {/* During a lesson the ChatPanel is rendered inside LessonMode instead (one instance). */}
        {!lessonActive && aiOpen && <Suspense fallback={null}><ChatPanel /></Suspense>}
      </div>

      {!zen && !lessonActive && (
        <div className="relative z-10">
          <StatusBar />
        </div>
      )}
      <AddToSessionPicker />
      {quizActive && <Suspense fallback={null}><QuizView /></Suspense>}
      {lessonActive && <Suspense fallback={null}><LessonMode /></Suspense>}
      <Onboarding />
      <CommandPalette />
      <ReleaseNotesModal />
      <Toaster theme="dark" position="bottom-right" richColors />
    </div>
  );
}

function LoadingSurface() {
  return <div className="grid h-full place-items-center text-sm text-[var(--text-dim)]">Loading…</div>;
}

function AdminPanel({
  focus,
  mailId,
}: {
  focus: "calendar" | "mail";
  mailId: string | null;
}) {
  const [calendarFraction, setCalendarFraction] = useState(1 / 3);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const fraction = Math.max(0.15, Math.min(0.85, (ev.clientX - rect.left) / rect.width));
      setCalendarFraction(fraction);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-4 sm:px-6">
      {/* Wide layout: resizable side-by-side */}
      <div ref={containerRef} className="hidden min-h-0 flex-1 lg:flex lg:gap-0">
        <div style={{ width: `${calendarFraction * 100}%` }} className="min-w-0 min-h-0">
          <AdminSurface title="Agenda" active={focus === "calendar"}>
            <Suspense fallback={<LoadingSurface />}><CalendarPanel embedded /></Suspense>
          </AdminSurface>
        </div>

        <div
          className="mx-1 w-1 cursor-col-resize self-stretch rounded-full bg-transparent hover:bg-[var(--accent-dim)] active:bg-[var(--accent-dim)]"
          onMouseDown={onDividerMouseDown}
        />

        <div style={{ width: `${(1 - calendarFraction) * 100}%` }} className="min-w-0 min-h-0">
          <AdminSurface title="Inbox" active={focus === "mail"}>
            <Suspense fallback={<LoadingSurface />}><MailPanel embedded initialOpenId={mailId} /></Suspense>
          </AdminSurface>
        </div>
      </div>

      {/* Narrow layout: stacked tabs */}
      <div className="min-h-0 flex-1 lg:hidden">
        {focus === "calendar" ? (
          <AdminSurface title="Agenda" active>
            <Suspense fallback={<LoadingSurface />}><CalendarPanel embedded /></Suspense>
          </AdminSurface>
        ) : (
          <AdminSurface title="Inbox" active>
            <Suspense fallback={<LoadingSurface />}><MailPanel embedded initialOpenId={mailId} /></Suspense>
          </AdminSurface>
        )}
      </div>
    </div>
  );
}

function AdminSurface({
  title,
  active,
  children,
}: {
  title: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border bg-[var(--bg-elev)] ${
        active ? "border-[var(--accent)]" : "border-[var(--border)]"
      }`}
    >
      <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">
        {title}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}
