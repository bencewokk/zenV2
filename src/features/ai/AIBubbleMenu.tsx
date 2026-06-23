import { BubbleMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { useAI } from "@/features/ai/store";

const ACTIONS: { label: string; instruction: string }[] = [
  { label: "Improve", instruction: "Improve the clarity and flow of this text, keeping its meaning." },
  { label: "Fix grammar", instruction: "Fix any spelling and grammar mistakes in this text." },
  { label: "Shorten", instruction: "Make this text more concise." },
  { label: "Lengthen", instruction: "Expand this text with more detail." },
];

/** Selection bubble menu — runs an inline AI action and replaces the selection. */
export function AIBubbleMenu({ editor }: { editor: Editor }) {
  const complete = useAI((s) => s.complete);
  const [busy, setBusy] = useState(false);

  async function run(instruction: string) {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) return;
    setBusy(true);
    const result = await complete(instruction, text);
    setBusy(false);
    editor.chain().focus().insertContentAt({ from, to }, result).run();
  }

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ from, to }) => to > from}
      tippyOptions={{ placement: "top", animation: "scale", duration: [150, 100] }}
    >
      <div className="flex items-center gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elev)] p-1 shadow-lg">
        {busy ? (
          <span className="zen-typing px-2 py-1 text-xs text-[var(--text-dim)]">
            <span />
            <span />
            <span />
          </span>
        ) : (
          ACTIONS.map((a) => (
            <button
              key={a.label}
              className="zen-pressable rounded px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--accent-dim)] hover:text-[var(--text)]"
              onClick={() => void run(a.instruction)}
            >
              {a.label}
            </button>
          ))
        )}
      </div>
    </BubbleMenu>
  );
}
