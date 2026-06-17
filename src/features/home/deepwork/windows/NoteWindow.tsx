import { Editor } from "@/features/notes/Editor";

/** Editable note inside a Deep Work window. */
export function NoteWindow({ noteId }: { noteId: string }) {
  return (
    <div className="px-4 py-3 text-left">
      <Editor noteId={noteId} />
    </div>
  );
}
