import { useState } from "react";
import {
  loadProfile, saveProfile, type Profile,
  loadMemories, saveMemory, deleteMemory, type MemoryEntry,
} from "@/services/memory";
import { notify } from "@/shared/ui/notify";

/** Editor for Layer-1 persistent profile memory (injected into every AI prompt). */
export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<Profile>(() => loadProfile());
  const [memories, setMemories] = useState<MemoryEntry[]>(() => loadMemories());
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");

  function addMemory() {
    if (!newTitle.trim() || !newContent.trim()) return;
    saveMemory(newTitle.trim(), newContent.trim());
    setMemories(loadMemories());
    setNewTitle("");
    setNewContent("");
  }
  function removeMemory(id: string) {
    deleteMemory(id);
    setMemories(loadMemories());
  }

  const field = (key: keyof Profile, label: string, placeholder: string, rows = 2) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">
        {label}
      </span>
      <textarea
        value={p[key]}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => setP({ ...p, [key]: e.target.value })}
        className="w-full resize-none rounded bg-[var(--bg-elev)] px-2 py-1.5 text-sm outline-none placeholder:text-[var(--text-dim)]"
      />
    </label>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-sm font-semibold">Memory</span>
        <button className="ml-auto text-xs text-[var(--text-dim)] hover:text-[var(--text)]" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs text-[var(--text-dim)]">
          Profile + saved memories are sent with every AI message. The AI can edit these itself.
        </p>
        {field("name", "Name", "How the AI should address you")}
        {field("about", "About", "Role, expertise, what you're working on", 3)}
        {field("stack", "Stack / domains", "Languages, tools, subjects you care about")}
        {field("preferences", "Preferences", "e.g. concise answers, format math cleanly, tone", 3)}

        <div className="border-t border-[var(--border)] pt-3">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">
            Saved memories ({memories.length})
          </span>
          <div className="space-y-1">
            {memories.map((m) => (
              <div key={m.id} className="group flex items-start gap-2 rounded bg-[var(--bg-elev)] px-2 py-1.5 text-xs">
                <span className="flex-1">
                  <span className="font-semibold">{m.title}</span>
                  <span className="text-[var(--text-dim)]"> · {m.category}</span>
                  <br />
                  <span className="text-[var(--text-dim)]">{m.content}</span>
                </span>
                <button
                  className="text-[var(--text-dim)] opacity-0 hover:text-[var(--danger)] group-hover:opacity-100"
                  onClick={() => removeMemory(m.id)}
                  title="Forget"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="memory title"
              className="w-full rounded bg-[var(--bg-elev)] px-2 py-1 text-xs outline-none placeholder:text-[var(--text-dim)]"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="what to remember…"
              rows={2}
              className="w-full resize-none rounded bg-[var(--bg-elev)] px-2 py-1 text-xs outline-none placeholder:text-[var(--text-dim)]"
            />
            <button
              className="w-full rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
              onClick={addMemory}
            >
              + Add memory
            </button>
          </div>
        </div>
      </div>
      <div className="border-t border-[var(--border)] p-2">
        <button
          className="w-full rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-black"
          onClick={() => {
            saveProfile(p);
            notify.success("Profile saved");
            onClose();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
