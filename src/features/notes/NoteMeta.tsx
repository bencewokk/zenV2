import { useNotes } from "@/features/notes/store";
import type { Note } from "@/shared/lib/types";

/** Inline metadata editor for the open note: space/subject/unit/tags/inbox. */
export function NoteMeta({ note }: { note: Note }) {
  const saveMeta = useNotes((s) => s.saveMeta);

  // metadata changes persist immediately (content untouched)
  const update = (fields: Partial<Note>) => {
    void saveMeta(note.id, fields);
  };

  const field = (key: "space" | "subject" | "unit") => (
    <input
      value={note[key] ?? ""}
      onChange={(e) => update({ [key]: e.target.value || null } as Partial<Note>)}
      placeholder={key}
      className="w-24 rounded bg-[var(--bg-elev)] px-2 py-0.5 text-xs outline-none placeholder:text-[var(--text-dim)]"
    />
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3 text-xs">
      {field("space")}
      {field("subject")}
      {field("unit")}
      <input
        value={note.tags.join(", ")}
        onChange={(e) =>
          update({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })
        }
        placeholder="tags, comma, separated"
        className="min-w-[160px] flex-1 rounded bg-[var(--bg-elev)] px-2 py-0.5 outline-none placeholder:text-[var(--text-dim)]"
      />
      <button
        className={`rounded px-2 py-0.5 ${
          note.inbox ? "bg-[var(--accent-dim)] text-[var(--text)]" : "bg-[var(--bg-elev)] text-[var(--text-dim)]"
        }`}
        onClick={() => update({ inbox: !note.inbox })}
        title="Toggle inbox flag"
      >
        inbox
      </button>
    </div>
  );
}
