import type { CalEvent } from "@/services/google/calendar";

function formatWhen(event: CalEvent): string {
  const start = new Date(event.start);
  if (event.allDay) return start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const end = new Date(event.end);
  const day = start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const from = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const to = end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${from} – ${to}`;
}

/** Full calendar-event details for the Deep Work canvas. */
export function EventWindow({ event }: { event: CalEvent }) {
  return (
    <div className="space-y-3 p-4 text-left">
      <div className="text-sm text-[var(--text)]">{formatWhen(event)}</div>
      {event.location && (
        <div className="text-sm text-[var(--text-dim)]">📍 {event.location}</div>
      )}
      {event.description && (
        <div className="whitespace-pre-wrap text-sm leading-6 text-[rgba(232,233,237,0.86)]">{event.description}</div>
      )}
      {!event.description && !event.location && (
        <div className="text-sm text-[var(--text-dim)]">No description.</div>
      )}
      {event.htmlLink && (
        <a
          href={event.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-dim)] transition hover:text-[var(--text)]"
        >
          Open in Google Calendar
        </a>
      )}
    </div>
  );
}
