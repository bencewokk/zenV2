import type { Editor } from "@tiptap/react";

/** Appears while the cursor is inside a table. Add/remove rows & columns. */
export function TableToolbar({ editor }: { editor: Editor }) {
  const btn = (label: string, fn: () => void, title: string) => (
    <button
      className="rounded bg-[var(--bg-elev)] px-2 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
      title={title}
      onClick={fn}
    >
      {label}
    </button>
  );

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {btn("+ Row", () => editor.chain().focus().addRowAfter().run(), "Add row below")}
      {btn("+ Col", () => editor.chain().focus().addColumnAfter().run(), "Add column right")}
      {btn("− Row", () => editor.chain().focus().deleteRow().run(), "Delete current row")}
      {btn("− Col", () => editor.chain().focus().deleteColumn().run(), "Delete current column")}
      {btn("Header", () => editor.chain().focus().toggleHeaderRow().run(), "Toggle header row")}
      <span className="w-2" />
      {btn("Delete table", () => editor.chain().focus().deleteTable().run(), "Delete whole table")}
    </div>
  );
}
