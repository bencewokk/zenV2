import { useEffect, useMemo, useRef, useState } from "react";
import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";
import { useHome } from "@/features/home/store";
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
        className={`zen-pressable rounded px-2 py-0.5 ${
          note.inbox ? "bg-[var(--accent-dim)] text-[var(--text)]" : "bg-[var(--bg-elev)] text-[var(--text-dim)]"
        }`}
        onClick={() => update({ inbox: !note.inbox })}
        title="Toggle inbox flag"
      >
        inbox
      </button>
      <NotePdfs note={note} />
    </div>
  );
}

/** Button + popover to attach PDFs that share a tag with this note. */
function NotePdfs({ note }: { note: Note }) {
  const pdfs = usePdfs((s) => s.pdfs);
  const addPdf = usePdfs((s) => s.add);
  const launchDeepWork = useHome((s) => s.launchDeepWork);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const noteTags = note.tags.map((t) => t.toLowerCase().trim()).filter(Boolean);
  const related = useMemo(
    () =>
      Object.values(pdfs).filter((p) =>
        p.tags.some((t) => noteTags.includes(t.toLowerCase().trim()))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdfs, note.tags.join(",")]
  );

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Tag the new PDF with the note's tags so it's linked by default.
    const id = await addPdf(file, note.tags);
    if (id) launchDeepWork({ type: "pdf", id });
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        className="zen-pressable rounded bg-[var(--bg-elev)] px-2 py-0.5 text-[var(--text-dim)] hover:text-[var(--text)]"
        onClick={() => setOpen((v) => !v)}
        title="Attach a PDF with a shared tag"
      >
        📄 PDFs{related.length ? ` · ${related.length}` : ""}
      </button>
      {open && (
        <div className="zen-anim-pop absolute right-0 z-50 mt-1 max-h-[60vh] min-w-[240px] overflow-auto rounded-[12px] border border-[var(--border)] bg-[rgba(18,19,24,0.96)] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur" style={{ transformOrigin: "top right" }}>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-dim)]">
            PDFs sharing a tag
          </div>
          {noteTags.length === 0 ? (
            <div className="px-3 py-2 text-[var(--text-dim)]">Add a tag to this note first.</div>
          ) : related.length === 0 ? (
            <div className="px-3 py-2 text-[var(--text-dim)]">No PDFs with these tags yet.</div>
          ) : (
            related.map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-[var(--bg-elev)]"
                onClick={() => { launchDeepWork({ type: "pdf", id: p.id }); setOpen(false); }}
              >
                <span className="shrink-0">📄</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[var(--text)]">{p.name}</span>
                  <span className="block truncate text-[10px] text-[var(--text-dim)]">{p.tags.join(", ")}</span>
                </span>
              </button>
            ))
          )}
          <div className="mt-1 border-t border-[var(--border)] pt-1">
            <button
              className="zen-pressable block w-full rounded-[10px] px-3 py-2 text-left text-[var(--accent)] hover:bg-[var(--bg-elev)]"
              onClick={() => fileRef.current?.click()}
            >
              ＋ Upload PDF{noteTags.length ? " (tagged like this note)" : ""}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onUpload} />
        </div>
      )}
    </div>
  );
}
