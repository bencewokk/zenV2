import { useCallback, useEffect, useMemo, useState } from "react";
import { GoogleGate } from "@/features/google/GoogleGate";
import { listEvents, createEvent, deleteEvent, type CalEvent } from "@/services/google/calendar";
import { useHome } from "@/features/home/store";
import { useDeepWork } from "@/features/home/deepwork/deepworkStore";
import { notify } from "@/shared/ui/notify";
import { SkeletonRows } from "@/shared/ui/Skeleton";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function CalendarPanel({ embedded = false }: { embedded?: boolean }) {
  return (
    <GoogleGate title="Calendar">
      <CalendarInner embedded={embedded} />
    </GoogleGate>
  );
}

function CalendarInner({ embedded }: { embedded: boolean }) {
  const requestAdd = useDeepWork((s) => s.requestAdd);
  const knownLabelOptions = useHome((s) => s.knownLabelOptions);
  const scanned = useMemo(
    () => new Set(knownLabelOptions.map((o) => o.toLowerCase().trim())),
    [knownLabelOptions]
  );
  const [days, setDays] = useState(7);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [quick, setQuick] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const min = startOfDay(new Date());
      const max = new Date(min);
      max.setDate(max.getDate() + days);
      setEvents(await listEvents(min.toISOString(), max.toISOString()));
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  // group events by date label
  const groups: Record<string, CalEvent[]> = {};
  for (const e of events) {
    const key = new Date(e.start).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    (groups[key] ??= []).push(e);
  }

  async function addQuick() {
    const text = quick.trim();
    if (!text) return;
    // default: 1h event starting next hour today
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    try {
      await createEvent({ summary: text, startISO: start.toISOString(), endISO: end.toISOString() });
      setQuick("");
      notify.success("Event created");
      void load();
    } catch (e) {
      notify.error((e as Error).message);
    }
  }

  return (
    <div className={embedded ? "flex h-full flex-col px-4 py-4" : "mx-auto w-full max-w-2xl px-8 py-6"}>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="ml-auto rounded bg-[var(--bg-elev)] px-2 py-1 text-sm outline-none"
        >
          <option value={1}>Today</option>
          <option value={7}>Next 7 days</option>
          <option value={30}>Next 30 days</option>
        </select>
      </div>

      <div className="mb-5 flex gap-2">
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addQuick()}
          placeholder="Quick add event (starts next hour)…"
          className="flex-1 rounded bg-[var(--bg-elev)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-dim)]"
        />
        <button className="zen-pressable rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-black" onClick={addQuick}>
          Add
        </button>
      </div>

      <div className={embedded ? "min-h-0 flex-1 overflow-y-auto pr-1" : ""}>
        {loading ? (
          <SkeletonRows count={6} />
        ) : events.length === 0 ? (
          <div className="text-[var(--text-dim)]">No upcoming events.</div>
        ) : (
          <div className="zen-stagger">
          {Object.entries(groups).map(([day, evs]) => (
            <div key={day} className="mb-5">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">{day}</div>
              {evs.map((e) => (
                <div
                  key={e.id}
                  className="group flex items-center gap-3 rounded px-2 py-1.5 [transition:background-color_var(--motion-fast)_var(--ease-out)] hover:bg-[var(--bg-elev)]"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, id: e.id });
                  }}
                >
                  <span className="w-16 shrink-0 text-sm tabular-nums text-[var(--text-dim)]">
                    {e.allDay ? "all-day" : new Date(e.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="flex flex-1 items-center gap-1.5 truncate text-sm">
                    <span className="truncate">{e.summary}</span>
                    <span
                      className={`shrink-0 text-[10px] ${scanned.has(e.summary.toLowerCase().trim()) ? "text-[var(--accent)]" : "text-transparent"}`}
                      title={scanned.has(e.summary.toLowerCase().trim()) ? "AI has scanned emails for matches to this event" : undefined}
                    >
                      ✦
                    </span>
                  </span>
                  {e.location && <span className="truncate text-xs text-[var(--text-dim)]">{e.location}</span>}
                  <button
                    className="hidden text-xs text-[var(--text-dim)] hover:text-[var(--danger)] group-hover:block"
                    onClick={async () => {
                      await deleteEvent(e.id);
                      void load();
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}
          </div>
        )}
      </div>

      {menu && (
        <div
          className="zen-anim-pop fixed z-50 min-w-[180px] rounded-[12px] border border-[var(--border)] bg-[rgba(18,19,24,0.96)] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur"
          style={{ left: menu.x, top: menu.y, transformOrigin: "top left" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="block w-full rounded-[10px] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--bg-elev)]"
            onClick={() => {
              requestAdd({ type: "event", id: menu.id });
              setMenu(null);
            }}
          >
            Add to Deep Work
          </button>
        </div>
      )}
    </div>
  );
}
