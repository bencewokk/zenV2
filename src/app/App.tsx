import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Toaster } from "sonner";
import { Sidebar } from "@/features/notes/Sidebar";
import { NoteSurface } from "@/features/notes/NoteSurface";
import { FilterBar } from "@/features/filtering/FilterBar";
import { StatusBar } from "@/shared/ui/StatusBar";
import { AuroraOverlay } from "@/shared/ui/AuroraOverlay";
import { ChatPanel } from "@/features/ai/ChatPanel";
import { Home } from "@/features/home/Home";
import { useHome } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { FocusTimerButton } from "@/features/home/deepwork/FocusTimerButton";
import { CalendarPanel } from "@/features/google/CalendarPanel";
import { MailPanel } from "@/features/google/MailPanel";
import { useNotes } from "@/features/notes/store";
import { useAI } from "@/features/ai/store";
import { useWorkspace } from "@/shared/stores/workspace";
import { usePdfs } from "@/features/pdfs/store";

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
  const surface = useWorkspace((s) => s.surface);
  const adminFocus = useWorkspace((s) => s.adminFocus);
  const adminMailId = useWorkspace((s) => s.adminMailId);
  const setSurface = (surface: "home" | "admin") => setWs({ surface });
  const setAdminFocus = (adminFocus: "calendar" | "mail") => setWs({ adminFocus });
  const setAdminMailId = (adminMailId: string | null) => setWs({ adminMailId });
  const shellRef = useRef<HTMLDivElement>(null);

  // Selecting a note returns to the editor and resets any shell-only state.
  useEffect(() => {
    if (selectedId) setSurface("home");
  }, [selectedId]);

  // Initial load + restore the last surface (once). Until that has run we must
  // not write lastOpenId, or the mount-time null selection would wipe it.
  const restored = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void load();
    void usePdfs.getState().load();
  }, [load]);
  useEffect(() => {
    if (loaded && !restored.current) {
      restored.current = true;
      // Restore the last surface across refresh. Deep Work and the admin
      // panels (Calendar/Mail) own the view, so don't re-open a note over them.
      // A null lastOpenId on the home surface means the dashboard was showing.
      const deepWork = useHome.getState().manualDeepWork;
      const onAdmin = useWorkspace.getState().surface === "admin";
      if (!deepWork && !onAdmin) {
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
  const showHome = !note && surface === "home";
  const deepWork = showHome && manualDeepWork;
  const zen = deepWork && zenMode;
  const sidebarApplicable = !showAdmin && !deepWork;
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

      <AuroraOverlay />

      {!zen && <header className="relative z-30 flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <button
          className="zen-pressable inline-flex h-7 items-center font-semibold tracking-tight text-[var(--text)] hover:text-[var(--accent)]"
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
        <div className="flex items-center gap-2">
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
          {deepWork && <FocusTimerButton />}
          {deepWork && (
            <button
              className={`${HEADER_BTN} ${HEADER_BTN_IDLE}`}
              onClick={() => setZenMode(true)}
              title="Zen mode — show only sources"
              aria-label="Enter zen mode"
            >
              ◐
            </button>
          )}
          <button
            className={`${HEADER_BTN} ${HEADER_BTN_IDLE}`}
            onClick={() => useAI.getState().toggle()}
            title="Toggle AI panel"
          >
            AI
          </button>
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

        <main className={`min-w-0 flex-1 ${note || showAdmin || deepWork ? "overflow-hidden" : "overflow-y-auto"}`}>
          {/* Keyed by surface so switching views re-mounts and crossfades in. */}
          <div
            key={note ? "note" : showAdmin ? "admin" : deepWork ? (zen ? "zen" : "deep") : "home"}
            className="zen-anim-fade h-full min-h-0"
          >
            {note ? (
              <NoteSurface note={note} />
            ) : showAdmin ? (
              <AdminPanel focus={adminFocus} mailId={adminMailId} />
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

        <ChatPanel />
      </div>

      {!zen && (
        <div className="relative z-10">
          <StatusBar />
        </div>
      )}
      <Toaster theme="dark" position="bottom-right" richColors />
    </div>
  );
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
            <CalendarPanel embedded />
          </AdminSurface>
        </div>

        <div
          className="mx-1 w-1 cursor-col-resize self-stretch rounded-full bg-transparent hover:bg-[var(--accent-dim)] active:bg-[var(--accent-dim)]"
          onMouseDown={onDividerMouseDown}
        />

        <div style={{ width: `${(1 - calendarFraction) * 100}%` }} className="min-w-0 min-h-0">
          <AdminSurface title="Inbox" active={focus === "mail"}>
            <MailPanel embedded initialOpenId={mailId} />
          </AdminSurface>
        </div>
      </div>

      {/* Narrow layout: stacked tabs */}
      <div className="min-h-0 flex-1 lg:hidden">
        {focus === "calendar" ? (
          <AdminSurface title="Agenda" active>
            <CalendarPanel embedded />
          </AdminSurface>
        ) : (
          <AdminSurface title="Inbox" active>
            <MailPanel embedded initialOpenId={mailId} />
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
