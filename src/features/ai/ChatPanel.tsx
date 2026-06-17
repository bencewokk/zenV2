import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import { useAI } from "@/features/ai/store";
import { useNotes } from "@/features/notes/store";
import { docToText } from "@/shared/lib/docText";
import { ProfilePanel } from "@/features/memory/ProfilePanel";
import { useMemoryStatus } from "@/features/memory/useMemoryStatus";
import { usePresence } from "@/shared/ui/usePresence";

export function ChatPanel() {
  const open = useAI((s) => s.open);
  const turns = useAI((s) => s.turns);
  const streaming = useAI((s) => s.streaming);
  const models = useAI((s) => s.models);
  const model = useAI((s) => s.model);
  const setModel = useAI((s) => s.setModel);
  const refreshModels = useAI((s) => s.refreshModels);
  const send = useAI((s) => s.send);
  const stop = useAI((s) => s.stop);
  const clear = useAI((s) => s.clear);
  const toggle = useAI((s) => s.toggle);
  const pendingConfirm = useAI((s) => s.pendingConfirm);
  const answerConfirm = useAI((s) => s.answerConfirm);
  const memStatus = useMemoryStatus();

  const [input, setInput] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && models.length === 0) void refreshModels();
  }, [open, models.length, refreshModels]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, pendingConfirm]);

  const { mounted, state } = usePresence(open, 200);
  if (!mounted) return null;
  const animClass = state === "exit" ? "zen-exit-slide-right" : "zen-anim-slide-right";

  function submit() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const sel = useNotes.getState();
    const note = sel.selectedId ? sel.notes[sel.selectedId] : null;
    void send(text, note ? `# ${note.title}\n${docToText(note.content)}` : undefined);
  }

  if (showProfile) {
    return (
      <aside className={`${animClass} flex w-[360px] shrink-0 flex-col border-l border-[var(--border)]`}>
        <ProfilePanel onClose={() => setShowProfile(false)} />
      </aside>
    );
  }

  return (
    <aside className={`${animClass} flex w-[360px] shrink-0 flex-col border-l border-[var(--border)]`}>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-sm font-semibold">AI</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded bg-[var(--bg-elev)] px-1.5 py-1 text-xs outline-none"
          title="Model"
        >
          {(models.length ? models : [model]).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        {memStatus !== "idle" && (
          <span
            className="ml-auto flex items-center gap-1 text-[10px] text-[var(--text-dim)]"
            title={`Embedding model: ${memStatus}`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  memStatus === "ready" ? "var(--ok)" : memStatus === "error" ? "var(--danger)" : "var(--accent)",
              }}
            />
            {memStatus === "loading" ? "memory…" : "memory"}
          </span>
        )}
        <button
          className={`text-xs text-[var(--text-dim)] hover:text-[var(--text)] ${memStatus === "idle" ? "ml-auto" : ""}`}
          onClick={() => setShowProfile(true)}
          title="Profile memory"
        >
          ⚙
        </button>
        <button
          className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={clear}
          title="Clear conversation"
        >
          Clear
        </button>
        <button
          className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={toggle}
          title="Close panel"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="text-sm text-[var(--text-dim)]">
            Ask anything. The open note is sent as context.
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "tool" ? (
            <div key={i} className="zen-anim-rise flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
              <span>🔧</span>
              <span className="truncate font-mono">{t.content}</span>
            </div>
          ) : (
            <div key={i} className={`zen-anim-rise ${t.role === "user" ? "text-right" : ""}`}>
              <div
                className={`inline-block max-w-full rounded-[var(--radius)] px-3 py-2 text-sm ${
                  t.role === "user" ? "bg-[var(--accent-dim)] text-left" : "bg-[var(--bg-elev)]"
                }`}
              >
                {t.role === "assistant" ? (
                  <div
                    className="zen-md"
                    dangerouslySetInnerHTML={{ __html: marked.parse(t.content || "…") as string }}
                  />
                ) : (
                  <span className="whitespace-pre-wrap">{t.content}</span>
                )}
              </div>
            </div>
          )
        )}
        {pendingConfirm && (
          <div className="rounded-[var(--radius)] border border-[var(--danger)] bg-[var(--bg-elev)] p-3 text-sm">
            <div className="mb-2">
              Allow <span className="font-semibold">{pendingConfirm.name}</span>?
            </div>
            <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg)] p-2 text-xs">
              {pendingConfirm.args || "{}"}
            </pre>
            <div className="flex gap-2">
              <button
                className="rounded bg-[var(--ok)] px-3 py-1 text-xs text-black"
                onClick={() => answerConfirm(true)}
              >
                Approve
              </button>
              <button
                className="rounded bg-[var(--danger)] px-3 py-1 text-xs text-white"
                onClick={() => answerConfirm(false)}
              >
                Deny
              </button>
            </div>
          </div>
        )}
        {streaming && !pendingConfirm && <div className="text-xs text-[var(--text-dim)]">Working…</div>}
      </div>

      <div className="border-t border-[var(--border)] p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          rows={3}
          className="w-full resize-none rounded bg-[var(--bg-elev)] px-2 py-1.5 text-sm outline-none placeholder:text-[var(--text-dim)]"
        />
        <div className="mt-1 flex justify-end">
          {streaming ? (
            <button
              className="rounded bg-[var(--danger)] px-3 py-1 text-xs text-white"
              onClick={stop}
            >
              Stop
            </button>
          ) : (
            <button
              className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-black disabled:opacity-50"
              onClick={submit}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
