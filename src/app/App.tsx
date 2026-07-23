import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Toaster } from "sonner";
import { Sidebar } from "@/features/notes/Sidebar";
import { NoteSurface } from "@/features/notes/NoteSurface";
import { FilterBar } from "@/features/filtering/FilterBar";
import { StatusBar } from "@/shared/ui/StatusBar";
import { AmbientOverlay } from "@/shared/ui/AmbientOverlay";
import { WindowResizeHandles, IS_TAURI } from "@/shared/ui/WindowChrome";
import { AppHeader } from "@/app/AppHeader";
import { useAppShortcuts } from "@/app/useAppShortcuts";
import { Home } from "@/features/home/Home";
import { useHome } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { StudyPanel } from "@/features/home/deepwork/StudyPanel";
import { useLesson } from "@/features/home/deepwork/lessonStore";
import { useQuiz } from "@/features/home/deepwork/quizStore";
import { AddToSessionPicker } from "@/features/home/deepwork/AddToSessionPicker";
import { CommandPalette } from "@/features/search/CommandPalette";
import { ReleaseNotesModal } from "@/features/home/ReleaseNotes";
import { SparkIntro } from "@/features/onboarding/SparkIntro";
import { GuidedTour } from "@/features/onboarding/GuidedTour";
import { useSparkIntro } from "@/features/onboarding/sparkStore";
import { seedSampleSession } from "@/features/onboarding/seedSession";
import { checkForUpdates } from "@/services/update";
import { startSync } from "@/services/sync/engine";
import { startAssistantNotifications } from "@/services/assistantNotify";
import { applyAppearance } from "@/services/appearance";
import { useNotes } from "@/features/notes/store";
import { useAI } from "@/features/ai/store";
import { startAiAccessWatch } from "@/features/ai/access";
import { useWorkspace } from "@/shared/stores/workspace";
import { navigate } from "@/shared/stores/navigate";
import { currentRoute, useRoute } from "@/shared/stores/route";
import { usePdfs } from "@/features/pdfs/store";
import { ensureSourcesLoaded } from "@/services/sources/store";
import { startSourceRefresh } from "@/services/sources/refresh";
import { isSignedIn, onAuthChange } from "@/services/google/auth";
import { clearLocalConnectionSecrets, reconcileConnectionVault } from "@/services/connections/vault";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { notify } from "@/shared/ui/notify";

const ChatPanel = lazy(() => import("@/features/ai/ChatPanel").then((module) => ({ default: module.ChatPanel })));
const CalendarPanel = lazy(() => import("@/features/google/CalendarPanel").then((module) => ({ default: module.CalendarPanel })));
const MailPanel = lazy(() => import("@/features/google/MailPanel").then((module) => ({ default: module.MailPanel })));
const SettingsView = lazy(() => import("@/features/settings/SettingsView").then((module) => ({ default: module.SettingsView })));
const SourcesPanel = lazy(() => import("@/features/sources/SourcesPanel").then((module) => ({ default: module.SourcesPanel })));
const QuizView = lazy(() => import("@/features/home/deepwork/QuizView").then((module) => ({ default: module.QuizView })));
const LessonMode = lazy(() => import("@/features/home/deepwork/LessonMode").then((module) => ({ default: module.LessonMode })));

/**
 * Crash containment for the fullscreen study surfaces. The quiz's activeId is
 * persisted, so a render crash in QuizView would otherwise loop forever: crash →
 * root error screen → reload → the same quiz re-opens → crash. Rendered as an
 * ErrorBoundary fallback, this closes the surface (clearing that persisted
 * state), tells the user, and lets the rest of the app live on.
 */
function CloseCrashedSurface({ label, close }: { label: string; close: () => void }) {
  useEffect(() => {
    notify.error(`The ${label} hit an error and was closed. You can start a new one.`);
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Phase 1 shell — a thin composer of feature modules (the anti-ui.py).
 * Sidebar (tree) + FilterBar | Editor + NoteMeta, StatusBar across the bottom.
 */
export function App() {
  const load = useNotes((s) => s.load);
  const loaded = useNotes((s) => s.loaded);
  const notes = useNotes((s) => s.notes);
  const route = useRoute((s) => s.route);
  const sidebarWidth = useWorkspace((s) => s.sidebarWidth);
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed);
  const [winWidth, setWinWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const setWs = useWorkspace((s) => s.set);
  const zenMode = useDeepWork((s) => s.zenMode);
  const threads = useHome((s) => s.threads);
  const aiOpen = useAI((s) => s.open);
  const showStudy = useWorkspace((s) => s.rightPanel === "study");
  const shellRef = useRef<HTMLDivElement>(null);
  const lessonActive = useLesson((s) => s.active);
  const quizActive = useQuiz((s) => s.activeId !== null);

  useAppShortcuts();

  // Initial load + restore the persisted route (once).
  const restored = useRef(false);
  useEffect(() => {
    applyAppearance();
    void usePdfs.getState().load();
    void ensureSourcesLoaded();
    useSparkIntro.getState().startIfFirstRun();
    // Seed notes first, then build the ready-made sample Deep Work session from them.
    void load().then(() => seedSampleSession());
    // Check for a newer release shortly after launch (desktop only; no-op in browser).
    const t = window.setTimeout(() => void checkForUpdates(), 4000);
    // Background cloud sync (no-op until enabled + signed in via Settings).
    startSync();
    // Watch synced phone data → desktop notifications for new routine runs / tasks.
    startAssistantNotifications();
    const stopVaultAuth = onAuthChange((signedIn) => {
      if (signedIn) void reconcileConnectionVault().catch(() => {});
      else clearLocalConnectionSecrets();
    });
    if (isSignedIn()) void reconcileConnectionVault().catch(() => {});
    const stopSourceRefresh = startSourceRefresh();
    const stopAiAccess = startAiAccessWatch();
    return () => { window.clearTimeout(t); stopSourceRefresh(); stopVaultAuth(); stopAiAccess(); };
  }, [load]);
  // Replay the persisted route through navigate() once notes are loaded, so every
  // legacy field it still drives is set from one place. A note route whose note is
  // gone (deleted on another device) falls back to the dashboard rather than a blank pane.
  useEffect(() => {
    if (!loaded || restored.current) return;
    restored.current = true;
    const route = currentRoute();
    navigate(route.view === "note" && !notes[route.id] ? { view: "dashboard" } : route);
  }, [loaded, notes]);

  useEffect(() => {
    if (loaded) void useHome.getState().bootstrap();
  }, [loaded]);

  // Wiki-link click navigation.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest("a[data-wiki-link]");
      if (!el) return;
      e.preventDefault();
      const id = el.getAttribute("data-note-id");
      if (id && useNotes.getState().notes[id]) navigate({ view: "note", id });
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // One route decides the whole shell. Previously a selected note silently overrode the
  // surface, so these five booleans could disagree about what was on screen.
  const note = route.view === "note" ? notes[route.id] ?? null : null;
  const showAdmin = route.view === "calendar" || route.view === "mail";
  const adminFocus = route.view === "mail" ? "mail" : "calendar";
  const adminMailId = route.view === "mail" ? route.threadId ?? null : null;
  const showSettings = route.view === "settings";
  const showSources = route.view === "sources";
  const showHome = route.view === "dashboard";
  const deepWork = route.view === "deepwork";
  const zen = deepWork && zenMode;
  // The notes sidebar belongs to the notes workspace: the dashboard and an open note.
  const sidebarApplicable = showHome || route.view === "note";
  // Responsive guard: the notes sidebar is a fixed width, so on a narrow window it
  // would crush the main column (the dashboard text wraps a letter per line). Keep
  // main at least MIN_MAIN wide — shrink the sidebar to fit, and drop it entirely
  // once there isn't even room for a usable one.
  const MIN_MAIN = 420;
  const MIN_SIDEBAR = 200;
  const roomForSidebar = winWidth - MIN_MAIN >= MIN_SIDEBAR;
  const effectiveSidebarWidth = Math.min(sidebarWidth, Math.max(MIN_SIDEBAR, winWidth - MIN_MAIN));
  const sidebarVisible = sidebarApplicable && !sidebarCollapsed && roomForSidebar;
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
      {!zen && !lessonActive && (
        <header data-tauri-drag-region className="relative z-30 flex items-center gap-2 px-2.5 pb-1.5 pt-1.5">
          <AppHeader
            winWidth={winWidth}
            sidebarVisible={sidebarVisible}
            sidebarApplicable={sidebarApplicable}
          />
        </header>
      )}

      <div className="relative z-10 flex min-h-0 flex-1">
        <aside
          className="overflow-hidden border-r border-[var(--border)] transition-[width,opacity,transform] duration-300"
          style={{
            width: sidebarVisible ? effectiveSidebarWidth : 0,
            opacity: sidebarVisible ? 1 : 0,
            transform: sidebarVisible ? "translateX(0)" : "translateX(-32px)",
          }}
        >
          <div className="flex h-full flex-col" style={{ width: effectiveSidebarWidth }}>
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
                onOpenAdmin={(focus, targetId) =>
                  navigate(focus === "mail" ? { view: "mail", threadId: targetId ?? null } : { view: "calendar" })
                }
              />
            )}
          </div>
        </main>

        {deepWork && showStudy && <StudyPanel onClose={() => setWs({ rightPanel: null })} />}

        {/* During a lesson the ChatPanel is rendered inside LessonMode instead (one instance). */}
        {!lessonActive && aiOpen && (
          <ErrorBoundary fallback={<CloseCrashedSurface label="AI panel" close={() => useAI.setState({ open: false })} />}>
            <Suspense fallback={null}><ChatPanel /></Suspense>
          </ErrorBoundary>
        )}
      </div>

      {!zen && !lessonActive && (
        <div className="relative z-10">
          <StatusBar />
        </div>
      )}
      <AddToSessionPicker />
      {quizActive && (
        <ErrorBoundary fallback={<CloseCrashedSurface label="quiz" close={() => useQuiz.getState().closeView()} />}>
          <Suspense fallback={null}><QuizView /></Suspense>
        </ErrorBoundary>
      )}
      {lessonActive && (
        <ErrorBoundary fallback={<CloseCrashedSurface label="lesson" close={() => useLesson.setState({ active: false })} />}>
          <Suspense fallback={null}><LessonMode /></Suspense>
        </ErrorBoundary>
      )}
      <SparkIntro />
      <GuidedTour />
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
  // Persisted, so dragging the divider survives leaving and coming back.
  const calendarFraction = useWorkspace((s) => s.calendarFraction);
  const setWs = useWorkspace((s) => s.set);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const fraction = Math.max(0.15, Math.min(0.85, (ev.clientX - rect.left) / rect.width));
      setWs({ calendarFraction: fraction });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const calendar = (
    <AdminSurface title="Agenda" active={focus === "calendar"}>
      <Suspense fallback={<LoadingSurface />}><CalendarPanel embedded /></Suspense>
    </AdminSurface>
  );
  const mail = (
    <AdminSurface title="Inbox" active={focus === "mail"}>
      <Suspense fallback={<LoadingSurface />}><MailPanel embedded initialOpenId={mailId} /></Suspense>
    </AdminSurface>
  );

  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-4 sm:px-6">
      {/* Wide: the focused panel leads, the other stays alongside as context. Both used to
          render equally, which made choosing Calendar vs Mail only re-tint a border. */}
      <div ref={containerRef} className="hidden min-h-0 flex-1 lg:flex lg:gap-0">
        <div
          style={{ width: `${(focus === "calendar" ? calendarFraction : 1 - calendarFraction) * 100}%` }}
          className="min-w-0 min-h-0"
        >
          {focus === "calendar" ? calendar : mail}
        </div>

        <div
          className="mx-1 w-1 cursor-col-resize self-stretch rounded-full bg-transparent hover:bg-[var(--accent-dim)] active:bg-[var(--accent-dim)]"
          onMouseDown={onDividerMouseDown}
        />

        <div
          style={{ width: `${(focus === "calendar" ? 1 - calendarFraction : calendarFraction) * 100}%` }}
          className="min-w-0 min-h-0"
        >
          {focus === "calendar" ? mail : calendar}
        </div>
      </div>

      {/* Narrow: only the focused panel. */}
      <div className="min-h-0 flex-1 lg:hidden">{focus === "calendar" ? calendar : mail}</div>
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
