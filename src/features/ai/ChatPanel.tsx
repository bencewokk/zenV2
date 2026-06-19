import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import { useAI } from "@/features/ai/store";
import { useNotes } from "@/features/notes/store";
import { useDeepWork, readinessColor, type StudyBackbone } from "@/features/home/deepwork/deepworkStore";
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
  const toggle = useAI((s) => s.toggle);
  const proposals = useAI((s) => s.proposals);
  const runProposal = useAI((s) => s.runProposal);
  const dismissProposal = useAI((s) => s.dismissProposal);
  const pendingQuestion = useAI((s) => s.pendingQuestion);
  const answerQuestion = useAI((s) => s.answerQuestion);
  const conversations = useAI((s) => s.conversations);
  const activeId = useAI((s) => s.activeId);
  const newConversation = useAI((s) => s.newConversation);
  const switchConversation = useAI((s) => s.switchConversation);
  const deleteConversation = useAI((s) => s.deleteConversation);
  const memStatus = useMemoryStatus();
  const backbone = useDeepWork((s) => s.backbone);

  const [input, setInput] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && models.length === 0) void refreshModels();
  }, [open, models.length, refreshModels]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, proposals, pendingQuestion]);

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
      {/* Primary row: conversation + new + close */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-2">
        <select
          value={activeId}
          onChange={(e) => switchConversation(e.target.value)}
          className="min-w-0 flex-1 truncate rounded bg-transparent py-1 text-sm font-medium outline-none hover:bg-[var(--bg-elev)]"
          title="Conversation"
        >
          {conversations
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((c) => (
              <option key={c.id} value={c.id}>{c.title || "New chat"}</option>
            ))}
        </select>
        <button
          className="zen-pressable shrink-0 rounded px-1.5 text-base leading-none text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={newConversation}
          title="New conversation"
        >
          ＋
        </button>
        <button
          className="zen-pressable shrink-0 rounded px-1.5 text-sm leading-none text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={toggle}
          title="Close panel"
        >
          ✕
        </button>
      </div>

      {/* Secondary row: model + memory · profile / delete (all muted) */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text-dim)]">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="min-w-0 max-w-[40%] truncate rounded bg-transparent py-0.5 text-[11px] outline-none hover:text-[var(--text)]"
          title="Model"
        >
          {(models.length ? models : [model]).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        {memStatus !== "idle" && (
          <span className="flex items-center gap-1" title={`Embedding model: ${memStatus}`}>
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  memStatus === "ready" ? "var(--ok)" : memStatus === "error" ? "var(--danger)" : "var(--accent)",
              }}
            />
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <button className="zen-pressable hover:text-[var(--text)]" onClick={() => setShowProfile(true)} title="Profile memory">
            Profile
          </button>
          <button className="zen-pressable hover:text-[var(--danger)]" onClick={() => deleteConversation(activeId)} title="Delete this conversation">
            Delete
          </button>
        </div>
      </div>

      {backbone && <StudyCard backbone={backbone} />}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="text-sm text-[var(--text-dim)]">
            Ask anything. The open note is sent as context. Tip: add notes or PDFs to Deep Work,
            then ask me to study your Deep Work material.
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
        {proposals
          // Resolved cards (done/error) become inline tool turns, so only the
          // still-actionable ones live here at the bottom of the chat.
          .filter((p) => p.status === "pending" || p.status === "running")
          .map((p) => (
            <div
              key={p.id}
              className={`zen-anim-rise rounded-[var(--radius)] border bg-[var(--bg-elev)] p-3 text-sm ${
                p.danger ? "border-[var(--danger)]" : "border-[var(--border)]"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span>{p.danger ? "⚠️" : "🔧"}</span>
                <span className="font-semibold">{p.title}</span>
              </div>
              {p.detail && <div className="mb-2 truncate text-[var(--text-dim)]">{p.detail}</div>}
              <details className="mb-2">
                <summary className="cursor-pointer text-xs text-[var(--text-dim)]">Details</summary>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg)] p-2 text-xs">
                  {JSON.stringify(p.args, null, 2)}
                </pre>
              </details>
              {p.status === "pending" ? (
                <div className="flex gap-2">
                  <button
                    className="zen-pressable rounded bg-[var(--accent)] px-3 py-1 text-xs text-black"
                    onClick={() => void runProposal(p.id)}
                  >
                    Run
                  </button>
                  <button
                    className="zen-pressable rounded border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                    onClick={() => dismissProposal(p.id)}
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <div className={`text-xs ${p.status === "error" ? "text-[var(--danger)]" : "text-[var(--text-dim)]"}`}>
                  {p.status === "running" ? "Running…" : p.status === "done" ? `✓ ${p.result ?? "Done"}` : `✕ ${p.result ?? "Failed"}`}
                </div>
              )}
            </div>
          ))}

        {pendingQuestion && (
          <div className="zen-anim-rise rounded-[var(--radius)] border border-[var(--accent)] bg-[var(--bg-elev)] p-3 text-sm">
            <div className="mb-2 font-medium">{pendingQuestion.question}</div>
            <div className="flex flex-col gap-1.5">
              {pendingQuestion.options.map((opt, i) => (
                <button
                  key={i}
                  className="zen-pressable rounded border border-[var(--border)] px-3 py-1.5 text-left text-xs hover:bg-[var(--bg)] hover:text-[var(--text)]"
                  onClick={() => answerQuestion(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}
        {streaming && !pendingQuestion && <div className="text-xs text-[var(--text-dim)]">Working…</div>}
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

/** Read-only Study overview: the AI-built backbone with per-concept + overall mastery. */
function StudyCard({ backbone }: { backbone: StudyBackbone }) {
  const [open, setOpen] = useState(true);
  const color = readinessColor(backbone.overall);
  return (
    <div className="border-b border-[var(--border)] px-3 py-2 text-sm">
      <button
        className="zen-pressable flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Collapse" : "Expand"}
      >
        <span className="text-xs text-[var(--text-dim)]">{open ? "▾" : "▸"}</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">Study</span>
        <span className="ml-auto text-base font-bold tabular-nums" style={{ color }}>{backbone.overall}%</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {backbone.intent && <div className="truncate text-xs text-[var(--text-dim)]" title={backbone.intent}>{backbone.intent}</div>}
          <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${backbone.overall}%`, background: color }} />
          </div>
          <ul className="space-y-1.5">
            {backbone.concepts.map((c) => {
              const cColor = readinessColor(c.mastery);
              return (
                <li key={c.id} title={c.summary}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-[var(--text)]">{c.title}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-dim)]">{c.mastery}%</span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                    <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${c.mastery}%`, background: cColor }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
