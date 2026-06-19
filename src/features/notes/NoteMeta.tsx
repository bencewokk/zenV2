import { useEffect, useMemo, useRef, useState } from "react";
import { useNotes } from "@/features/notes/store";
import { usePdfs } from "@/features/pdfs/store";
import { useNoteSplit } from "@/features/pdfs/splitStore";
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

/** Button + popover to attach PDFs to a note (explicit attachments + tag suggestions). */
function NotePdfs({ note }: { note: Note }) {
  const pdfs = usePdfs((s) => s.pdfs);
  const addPdf = usePdfs((s) => s.add);
  const attachPdf = useNotes((s) => s.attachPdf);
  const detachPdf = useNotes((s) => s.detachPdf);
  const openSplit = useNoteSplit((s) => s.open);
  const launchDeepWork = useHome((s) => s.launchDeepWork);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dwMenu, setDwMenu] = useState<{ x: number; y: number; pdfId: string } | null>(null);
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

  // Dismiss the Deep Work context menu on any outside interaction.
  useEffect(() => {
    if (!dwMenu) return;
    const close = () => setDwMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [dwMenu]);

  // Drop the menu whenever the popover closes.
  useEffect(() => {
    if (!open) setDwMenu(null);
  }, [open]);

  const noteTags = note.tags.map((t) => t.toLowerCase().trim()).filter(Boolean);
  const attached = useMemo(
    () => note.pdfIds.map((id) => pdfs[id]).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdfs, note.pdfIds.join(",")]
  );
  // Tag-matching PDFs not already attached → offered as quick-attach suggestions.
  const suggestions = useMemo(
    () =>
      Object.values(pdfs).filter(
        (p) => !note.pdfIds.includes(p.id) && p.tags.some((t) => noteTags.includes(t.toLowerCase().trim()))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdfs, note.tags.join(","), note.pdfIds.join(",")]
  );

  async function ingest(file: File | undefined) {
    if (!file) return;
    // Tag with the note's tags and attach explicitly so it stays linked.
    const id = await addPdf(file, note.tags);
    if (id) { await attachPdf(note.id, id); openSplit(id); }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    await ingest(file);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    await ingest([...e.dataTransfer.files].find((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")));
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        className="zen-pressable rounded bg-[var(--bg-elev)] px-2 py-0.5 text-[var(--text-dim)] hover:text-[var(--text)]"
        onClick={() => setOpen((v) => !v)}
        title="Attach PDFs to this note"
      >
        📄 PDFs{attached.length ? ` · ${attached.length}` : ""}
      </button>
      {open && (
        <div
          className={`zen-anim-pop absolute right-0 z-50 mt-1 max-h-[60vh] min-w-[260px] overflow-auto rounded-[12px] border bg-[rgba(18,19,24,0.96)] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur ${dragging ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
          style={{ transformOrigin: "top right" }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {attached.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-dim)]">Attached</div>
              {attached.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center gap-2 rounded-[10px] px-3 py-2 hover:bg-[var(--bg-elev)]"
                  onContextMenu={(e) => { e.preventDefault(); setDwMenu({ x: e.clientX, y: e.clientY, pdfId: p.id }); }}
                >
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => { openSplit(p.id); setOpen(false); }}>
                    <span className="shrink-0">📄</span>
                    <span className="block min-w-0 flex-1 truncate text-[var(--text)]">{p.name}</span>
                  </button>
                  <button className="shrink-0 text-[var(--text-dim)] opacity-0 hover:text-[var(--accent)] group-hover:opacity-100" title="Add to Deep Work" onClick={() => { launchDeepWork({ type: "pdf", id: p.id }); setOpen(false); }}>⊕</button>
                  <button className="shrink-0 text-[var(--text-dim)] opacity-0 hover:text-red-400 group-hover:opacity-100" title="Detach" onClick={() => detachPdf(note.id, p.id)}>✕</button>
                </div>
              ))}
            </>
          )}

          {suggestions.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-dim)]">Suggested (shared tag)</div>
              {suggestions.map((p) => (
                <button
                  key={p.id}
                  className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-[var(--bg-elev)]"
                  onClick={() => { void attachPdf(note.id, p.id); openSplit(p.id); setOpen(false); }}
                  onContextMenu={(e) => { e.preventDefault(); setDwMenu({ x: e.clientX, y: e.clientY, pdfId: p.id }); }}
                  title="Attach & open beside this note (right-click → Add to Deep Work)"
                >
                  <span className="shrink-0 text-[var(--accent)]">＋</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--text)]">{p.name}</span>
                    <span className="block truncate text-[10px] text-[var(--text-dim)]">{p.tags.join(", ")}</span>
                  </span>
                </button>
              ))}
            </>
          )}

          {attached.length === 0 && suggestions.length === 0 && (
            <div className="px-3 py-2 text-[var(--text-dim)]">{dragging ? "Drop to upload…" : "No PDFs attached. Upload or drop one below."}</div>
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

      {dwMenu && (
        <div
          className="zen-anim-pop fixed z-[60] min-w-[180px] rounded-[12px] border border-[var(--border)] bg-[rgba(18,19,24,0.96)] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur"
          style={{ left: dwMenu.x, top: dwMenu.y, transformOrigin: "top left" }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full rounded-[10px] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--bg-elev)]"
            onClick={() => {
              launchDeepWork({ type: "pdf", id: dwMenu.pdfId });
              setDwMenu(null);
              setOpen(false);
            }}
          >
            Add to Deep Work
          </button>
        </div>
      )}
    </div>
  );
}
