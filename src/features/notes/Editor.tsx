import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import DragHandle from "@tiptap/extension-drag-handle-react";
import { useEffect, useRef, useState } from "react";
import { useNotes } from "@/features/notes/store";
import { SlashCommand } from "@/features/notes/extensions/slashCommand";
import { WikiLink } from "@/features/notes/extensions/wikiLink";
import { MathBlock, MathInline } from "@/features/math/math-nodes";
import { useMathCheck } from "@/features/math/checkStore";
import { TrailingNode } from "@/features/notes/extensions/trailingNode";
import { Geometry } from "@/features/geometry/geometry-node";
import { Svg } from "@/features/svg/svg-node";
import { MocBlock, MOC_ALLOW_REMOVE, countMocBlocks } from "@/features/notes/extensions/mocBlock";
import { TableToolbar } from "@/features/notes/TableToolbar";
import { AIBubbleMenu } from "@/features/ai/AIBubbleMenu";

export function Editor({ noteId }: { noteId: string }) {
  const note = useNotes((s) => s.notes[noteId]);
  const saveContent = useNotes((s) => s.saveContent);
  const markDirty = useNotes((s) => s.patch);
  const rename = useNotes((s) => s.rename);
  const saveMeta = useNotes((s) => s.saveMeta);
  const saveTimer = useRef<number | null>(null);
  const [inTable, setInTable] = useState(false);

  // Mirror this note's Math Checker flag into the global toggle store that math node
  // views read; re-sync whenever the open note (or its flag) changes.
  const mathCheck = note?.mathCheck ?? false;
  useEffect(() => {
    useMathCheck.getState().setEnabled(mathCheck);
    return () => useMathCheck.getState().setEnabled(false);
  }, [noteId, mathCheck]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Placeholder.configure({ placeholder: "Start writing — press / for commands…" }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        SlashCommand,
        WikiLink,
        MathBlock,
        MathInline,
        Geometry,
        Svg,
        MocBlock,
        TrailingNode,
      ],
      content: note?.content ?? "",
      editorProps: { attributes: { class: "zen-editor min-h-[60vh] pl-8 leading-relaxed" } },
      onUpdate: ({ editor }) => {
        markDirty(noteId, {});
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          void saveContent(noteId, editor.getJSON());
        }, 700);
      },
      onSelectionUpdate: ({ editor }) => setInTable(editor.isActive("table")),
    },
    [noteId]
  );

  // Flush pending save when switching notes / unmounting.
  useEffect(() => {
    return () => {
      if (saveTimer.current && editor) {
        window.clearTimeout(saveTimer.current);
        void saveContent(noteId, editor.getJSON());
      }
    };
  }, [noteId, editor, saveContent]);

  // Keep the MOC block in sync with the note's `moc` flag: insert it at the top
  // when enabled, remove it (bypassing the deletion guard) when disabled.
  const moc = note?.moc ?? false;
  useEffect(() => {
    if (!editor) return;
    const present = countMocBlocks(editor.state.doc) > 0;
    if (moc && !present) {
      editor.chain().insertContentAt(0, { type: "mocBlock" }).run();
    } else if (!moc && present) {
      let target: { pos: number; size: number } | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "mocBlock") {
          target = { pos, size: node.nodeSize };
          return false;
        }
        return true;
      });
      if (target) {
        const { pos, size } = target;
        editor.view.dispatch(editor.state.tr.delete(pos, pos + size).setMeta(MOC_ALLOW_REMOVE, true));
      }
    }
  }, [editor, moc]);

  if (import.meta.env.DEV && editor) (window as unknown as { __zenEditor?: unknown }).__zenEditor = editor;

  if (!editor) return null;

  return (
    <div>
      {/* Title — explicit, editable */}
      <input
        data-tour="note-title"
        value={note?.title === "Untitled" ? "" : note?.title ?? ""}
        onChange={(e) => void rename(noteId, e.target.value)}
        placeholder="Untitled"
        className="mb-2 w-full bg-transparent text-3xl font-bold outline-none placeholder:text-[var(--text-dim)]"
      />

      {/* Note-wide controls */}
      <div className="mb-2 flex items-center gap-2">
        <button
          data-tour="math-check"
          className={`zen-pressable rounded-[6px] border px-2 py-1 text-xs ${
            mathCheck
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]"
          }`}
          onClick={() => void saveMeta(noteId, { mathCheck: !mathCheck })}
          title="Live-check each line of a multi-line math block against the line above it"
        >
          ✓ Math check{mathCheck ? " · on" : ""}
        </button>
      </div>

      {/* Stable wrapper so toggling the toolbar never reshuffles siblings
          around the BubbleMenu (which relocates its own DOM into a popup). */}
      <div>{inTable && <TableToolbar editor={editor} />}</div>

      {/* Editor has pl-8 so the drag handle sits inside its hover area */}
      <div className="relative">
        <DragHandle editor={editor}>
          <div className="zen-drag-handle" title="Drag to move block">⠿</div>
        </DragHandle>
        <EditorContent editor={editor} />
      </div>

      {/* Rendered last: BubbleMenu detaches into a tippy popup. */}
      <AIBubbleMenu editor={editor} />
    </div>
  );
}
