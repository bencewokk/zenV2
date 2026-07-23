import { useRoute, type Route, type RouteView } from "@/shared/stores/route";
import { navigate, createAndOpenNote } from "@/shared/stores/navigate";
import { useWorkspace } from "@/shared/stores/workspace";
import { useStatus } from "@/shared/stores/status";
import { useAI } from "@/features/ai/store";
import { useHome } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { useFocusSession } from "@/features/home/deepwork/useFocusSession";
import { FocusTimerButton } from "@/features/home/deepwork/FocusTimerButton";
import { SessionTabs } from "@/features/home/deepwork/SessionTabs";
import { useCommandPalette } from "@/features/search/CommandPalette";
import { WindowControls, IS_TAURI } from "@/shared/ui/WindowChrome";
import { Tooltip } from "@/shared/ui/Tooltip";

/**
 * The app header — one row, one navigation system.
 *
 * Replaces the previous stack of three overlapping systems (a GSAP mega-panel behind a
 * hamburger, five always-visible buttons, and an always-mounted session tab row). The panel's
 * seven links grouped destinations under "Study"/"Notes"/"Admin" — categories that filed the
 * home dashboard under *Notes* and Settings under *Admin* — and capped itself at three cards,
 * silently dropping any fourth. Both are gone: five flat destinations, active state read
 * straight off the route.
 *
 *   Zen │ Home  Deep Work  Calendar  Mail  Sources │ ‹tabs› │ ⏱ │Study│AI│ + ⌕ ⚙ │ — □ ✕
 *
 * Layout controls (the notes-panel toggle) live on the right with the other utilities rather
 * than in the nav, because they change the current view rather than navigating away from it.
 */

const BTN =
  "zen-pressable inline-flex h-7 items-center rounded-[6px] border text-xs";
const IDLE =
  "border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-dim)] hover:text-[var(--text)]";
const ACTIVE = "border-[var(--accent)] bg-[var(--bg)] text-[var(--accent)]";

interface NavItem {
  view: RouteView;
  label: string;
  glyph: string;
  route: Route;
  tour?: string;
}

const NAV: NavItem[] = [
  {
    view: "dashboard",
    label: "Home",
    glyph: "⌂",
    route: { view: "dashboard" },
  },
  {
    view: "deepwork",
    label: "Deep Work",
    glyph: "◈",
    route: { view: "deepwork" },
    tour: "deep-work",
  },
  {
    view: "calendar",
    label: "Calendar",
    glyph: "◷",
    route: { view: "calendar" },
  },
  { view: "mail", label: "Mail", glyph: "✉", route: { view: "mail" } },
  { view: "sources", label: "Sources", glyph: "⛁", route: { view: "sources" } },
];

/**
 * Which nav item a route lights up. A note is a sub-state of Home — sidebar plus editor —
 * not its own destination, so it keeps Home highlighted and Home returns to the dashboard.
 */
function sectionOf(view: RouteView): RouteView {
  return view === "note" ? "dashboard" : view;
}

export interface AppHeaderProps {
  /** Window width, threaded from App so this doesn't add a second resize listener. */
  winWidth: number;
  sidebarVisible: boolean;
  sidebarApplicable: boolean;
}

export function AppHeader({
  winWidth,
  sidebarVisible,
  sidebarApplicable,
}: AppHeaderProps) {
  const route = useRoute((s) => s.route);
  const section = sectionOf(route.view);
  const isDeepWork = route.view === "deepwork";

  const aiStatus = useStatus((s) => s.ai);
  const setWs = useWorkspace((s) => s.set);
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed);
  const deepWorkItemCount = useDeepWork((s) => s.items.length);
  const studyOpen = useWorkspace((s) => s.rightPanel === "study");
  const aiOpen = useAI((s) => s.open);
  const { sessionActive } = useFocusSession();

  function toggleStudy() {
    if (studyOpen) return setWs({ rightPanel: null });
    useAI.getState().setOpen(false); // one panel in the rail
    setWs({ rightPanel: "study" });
  }

  // Below this width the nav shows glyphs only — five labels plus the tab row and six
  // utility controls stop fitting well before the window gets genuinely narrow.
  const labels = winWidth >= 1100;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        className="shrink-0 px-1 text-sm font-semibold tracking-tight text-[var(--text)]"
        onClick={() => {
          navigate({ view: "dashboard" });
          void useHome.getState().refresh();
        }}
      >
        Zen
      </button>

      <nav className="zen-scrollbar-none flex shrink-0 items-center gap-1 overflow-x-auto">
        {NAV.map((item) => {
          const active = section === item.view;
          return (
            <Tooltip key={item.view} label={item.label}>
              <button
                data-tour={item.tour}
                className={`${BTN} ${active ? ACTIVE : IDLE} ${labels ? "gap-1.5 px-2.5" : "w-8 justify-center"}`}
                onClick={() => navigate(item.route)}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
              >
                <span aria-hidden>{item.glyph}</span>
                {labels && <span>{item.label}</span>}
                {item.view === "deepwork" && deepWorkItemCount > 0 && (
                  <span className="text-[10px] opacity-70">
                    {deepWorkItemCount}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
      </nav>

      {/* Session tabs belong to Deep Work, so they mount only there — mounting them on every
              route is what used to crowd the header's window-drag area. */}
      {isDeepWork && (
        <div className="min-w-0 flex-1">
          <SessionTabs onOpen={() => navigate({ view: "deepwork" })} />
        </div>
      )}
      {!isDeepWork && <div className="min-w-0 flex-1" />}

      <div className="flex shrink-0 items-center gap-1">
        {/* The focus timer is global and survives reloads, so a running one stays visible on
            every route; the idle "start" affordance only shows where study happens. */}
        {(sessionActive || isDeepWork) && <FocusTimerButton />}

        <div className="inline-flex items-center gap-1 rounded-[8px] bg-[rgba(255,255,255,0.04)] p-0.5">
          {isDeepWork && (
            <Tooltip label="Study panel — backbone, mastery & plan">
              <button
                data-tour="dw-study"
                className={`${BTN} px-2.5 ${studyOpen ? ACTIVE : IDLE}`}
                onClick={toggleStudy}
              >
                Study
              </button>
            </Tooltip>
          )}
          <Tooltip label="AI assistant (Ctrl+J)">
            <button
              data-tour="ai-toggle"
              className={`${BTN} px-2.5 ${
                aiStatus === "busy"
                  ? "zen-glow border-[var(--accent)] bg-[var(--bg)] text-[var(--accent)]"
                  : aiOpen
                    ? ACTIVE
                    : IDLE
              }`}
              onClick={() => useAI.getState().setOpen(!aiOpen)}
            >
              AI
            </button>
          </Tooltip>
        </div>

        <Tooltip label="New note (Ctrl+N)">
          <button
            data-tour="new-note"
            className={`${BTN} ${IDLE} w-8 justify-center`}
            onClick={() => void createAndOpenNote(null)}
            aria-label="New note"
          >
            ＋
          </button>
        </Tooltip>
        <Tooltip label="Search everything (Ctrl+K)">
          <button
            data-tour="search-header"
            className={`${BTN} ${IDLE} w-8 justify-center`}
            onClick={() => useCommandPalette.getState().setOpen(true)}
            aria-label="Search"
          >
            ⌕
          </button>
        </Tooltip>
        {sidebarApplicable && (
          <Tooltip
            label={`${sidebarVisible ? "Hide" : "Show"} notes panel (Ctrl+\)`}
          >
            <button
              className={`${BTN} ${sidebarVisible ? ACTIVE : IDLE} w-8 justify-center`}
              onClick={() => setWs({ sidebarCollapsed: !sidebarCollapsed })}
              aria-label={
                sidebarVisible ? "Hide notes panel" : "Show notes panel"
              }
            >
              ☰
            </button>
          </Tooltip>
        )}
        <Tooltip label="Settings">
          <button
            className={`${BTN} ${route.view === "settings" ? ACTIVE : IDLE} w-8 justify-center`}
            onClick={() => navigate({ view: "settings" })}
            aria-label="Settings"
          >
            ⚙
          </button>
        </Tooltip>
        {IS_TAURI && <WindowControls className="shrink-0" />}
      </div>
    </div>
  );
}
