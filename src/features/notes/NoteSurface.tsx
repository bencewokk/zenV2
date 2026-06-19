import { useRef } from "react";
import { Editor } from "./Editor";
import { NoteMeta } from "./NoteMeta";
import { PdfViewer } from "@/features/pdfs/PdfViewer";
import { usePdfs } from "@/features/pdfs/store";
import { useNoteSplit } from "@/features/pdfs/splitStore";
import type { Note } from "@/shared/lib/types";

/**
 * The note editing surface. When a PDF is opened against the note (via the
 * note's 📄 PDFs menu) it splits side-by-side with a draggable divider, instead
 * of yanking the user out to Deep Work.
 */
export function NoteSurface({ note }: { note: Note }) {
  const splitId = useNoteSplit((s) => s.pdfId);
  const fraction = useNoteSplit((s) => s.fraction);
  const setFraction = useNoteSplit((s) => s.setFraction);
  const close = useNoteSplit((s) => s.close);
  const pdf = usePdfs((s) => (splitId ? s.pdfs[splitId] : undefined));
  const containerRef = useRef<HTMLDivElement>(null);

  const editorColumn = (
    <div className="mx-auto w-full max-w-3xl px-8 py-6">
      <NoteMeta note={note} />
      <Editor noteId={note.id} />
    </div>
  );

  if (!splitId || !pdf) {
    return <div className="h-full overflow-y-auto">{editorColumn}</div>;
  }

  const onDividerDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setFraction((ev.clientX - rect.left) / rect.width);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div ref={containerRef} className="flex h-full min-h-0">
      <div className="min-w-0 overflow-y-auto" style={{ width: `${fraction * 100}%` }}>
        {editorColumn}
      </div>
      <div
        className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent-dim)]"
        onMouseDown={onDividerDown}
      />
      <div className="flex min-w-0 flex-col border-l border-[var(--border)]" style={{ width: `${(1 - fraction) * 100}%` }}>
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2.5 py-1.5 text-xs">
          <span className="shrink-0">📄</span>
          <span className="min-w-0 flex-1 truncate font-medium">{pdf.name}</span>
          <button
            className="zen-pressable shrink-0 rounded px-1.5 leading-none text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={close}
            title="Close PDF"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <PdfViewer pdfId={splitId} />
        </div>
      </div>
    </div>
  );
}
