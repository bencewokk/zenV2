import { useEffect, useState } from "react";
import { useHome } from "@/features/home/store";

/**
 * User-defined email topics the AI matches against. Lived on the home dashboard, which
 * put a settings-grade configuration surface in the middle of a decision surface.
 */
export function LabelManager() {
  const labels = useHome((s) => s.customLabels);
  const addCustomLabel = useHome((s) => s.addCustomLabel);
  const removeCustomLabel = useHome((s) => s.removeCustomLabel);
  const [draft, setDraft] = useState("");

  function submit() {
    addCustomLabel(draft);
    setDraft("");
  }

  return (
    <div data-tour="ai-labels">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Add a topic the AI should tag…"
        className="w-full rounded-[10px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
      />
      {labels.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {labels.map((label) => (
            <LabelRow key={label.name} name={label.name} hint={label.hint} onRemove={() => removeCustomLabel(label.name)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LabelRow({ name, hint, onRemove }: { name: string; hint: string; onRemove: () => void }) {
  const updateCustomLabel = useHome((s) => s.updateCustomLabel);
  const [draftHint, setDraftHint] = useState(hint);

  // Keep local draft in sync if the stored hint changes elsewhere.
  useEffect(() => setDraftHint(hint), [hint]);

  function commit() {
    if (draftHint.trim() !== hint.trim()) updateCustomLabel(name, draftHint.trim());
  }

  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-[var(--text)]">{name}</span>
        <button
          className="shrink-0 text-[var(--text-dim)] transition hover:text-[var(--danger)]"
          onClick={onRemove}
          title={`Remove ${name}`}
        >
          ✕
        </button>
      </div>
      <input
        value={draftHint}
        onChange={(e) => setDraftHint(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder="Match hint: senders, keywords, context…"
        className="mt-1.5 w-full rounded-[8px] border border-transparent bg-[rgba(255,255,255,0.02)] px-2 py-1 text-xs text-[var(--text-dim)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--border)] focus:text-[var(--text)]"
      />
    </div>
  );
}
