import { useMemo } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useNotes } from "@/features/notes/store";
import { docToText } from "@/shared/lib/docText";

/** In-editor block listing the open note's direct child notes; click to open. */
export function MocBlockView({ selected }: NodeViewProps) {
  const noteId = useNotes((s) => s.selectedId);
  const notes = useNotes((s) => s.notes);
  const select = useNotes((s) => s.select);

  const children = useMemo(
    () =>
      Object.values(notes)
        .filter((n) => n.parentId === noteId)
        .sort((a, b) => a.order - b.order),
    [notes, noteId]
  );

  return (
    <NodeViewWrapper
      className={`my-3 rounded-[14px] border bg-[var(--bg-elev)] px-4 py-3 transition-colors ${
        selected ? "border-[var(--accent)]" : "border-[var(--border)]"
      }`}
      contentEditable={false}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">
          Map of Content
        </span>
        <span className="text-[11px] text-[var(--text-dim)]">
          · {children.length} {children.length === 1 ? "note" : "notes"}
        </span>
      </div>
      {children.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--text-dim)]">
          No child notes yet. Nest notes under this one in the sidebar and they'll appear here.
        </div>
      ) : (
        <div className="space-y-2">
          {children.map((child) => {
            const preview = docToText(child.content).trim().replace(/\s+/g, " ");
            return (
              <button
                key={child.id}
                className="zen-pressable block w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-left transition hover:border-[var(--accent-dim)]"
                onClick={() => select(child.id)}
              >
                <div className="truncate text-sm font-medium text-[var(--text)]">{child.title || "Untitled"}</div>
                {preview && <div className="zen-clamp-2 mt-1 text-xs text-[var(--text-dim)]">{preview}</div>}
              </button>
            );
          })}
        </div>
      )}
    </NodeViewWrapper>
  );
}
