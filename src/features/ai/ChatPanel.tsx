import { memo, useEffect, useRef, useState } from "react";
import { renderMarkdown } from "@/shared/lib/renderMarkdown";
import { linkifyCitations } from "@/features/ai/citations";
import { useAI, type ToolTone, type ChatTurn } from "@/features/ai/store";
import { useAiAccess, aiBlocked, aiBlockedMessage, availableModels, MODEL_LABEL, type AiModel } from "@/features/ai/access";
import { useNotes } from "@/features/notes/store";
import { useHome } from "@/features/home/store";
import { usePdfNav } from "@/features/pdfs/pdfNav";
import { docToText } from "@/shared/lib/docText";
import { ProfilePanel } from "@/features/memory/ProfilePanel";
import { ToolSettings } from "@/features/ai/ToolSettings";
import { useMemoryStatus } from "@/features/memory/useMemoryStatus";
import { usePresence } from "@/shared/ui/usePresence";
import { Dropdown } from "@/shared/ui/Dropdown";
import { useSources } from "@/services/sources/store";
import { useWorkspace } from "@/shared/stores/workspace";

/** Dot colour for a tool-activity tone (no emojis — a small status dot instead). */
const TONE_DOT: Record<ToolTone, string> = {
  read: "var(--text-dim)",
  run: "var(--accent)",
  done: "var(--ok)",
  error: "var(--danger)",
  info: "var(--accent)",
  blocked: "var(--text-dim)",
};
function toneColor(tone?: ToolTone): string {
  return tone ? TONE_DOT[tone] : "var(--text-dim)";
}

/** Compact token readout; authoritative spend lives in Settings → Plan & usage. */
function UsageBadge({ promptTokens, completionTokens }: { promptTokens?: number; completionTokens?: number }) {
  const total = (promptTokens ?? 0) + (completionTokens ?? 0);
  if (!total) return null;
  const tok = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
  return (
    <span
      className="shrink-0 tabular-nums"
      title={`${promptTokens ?? 0} prompt + ${completionTokens ?? 0} completion tokens. See Plan & usage for authoritative spend.`}
    >
      {tok} tok
    </span>
  );
}

/** Historical turns keep the same object identity while the live answer grows,
 * so memoization avoids re-running Markdown, KaTeX, and sanitization for the
 * entire conversation on every streamed chunk. */
const TurnBubble = memo(function TurnBubble({
  turn,
  retryable = false,
  onRetry,
}: {
  turn: ChatTurn;
  retryable?: boolean;
  onRetry?: () => void;
}) {
  if (turn.role === "tool") {
    return (
      <div className="zen-anim-rise flex flex-col gap-0.5 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${turn.tone === "run" ? "zen-glow" : ""}`}
            style={{ background: toneColor(turn.tone), "--zen-glow-color": "rgba(110, 168, 254, 0.45)" } as React.CSSProperties}
          />
          <span className="min-w-0 flex-1 truncate text-[var(--text-dim)]" title={`${turn.content}${turn.detail ? " · " + turn.detail : ""}`}>
            <span className="text-[var(--text)]">{turn.content}</span>
            {turn.detail && <span> · {turn.detail}</span>}
          </span>
        </div>
        {turn.result && (
          <div
            className={`truncate pl-3.5 ${turn.tone === "error" ? "text-[var(--danger)]" : "text-[var(--text-dim)]"}`}
            title={turn.result}
          >
            {turn.result}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`zen-anim-rise ${turn.role === "user" ? "text-right" : ""}`}>
      <div
        className={`inline-block max-w-full rounded-[var(--radius)] px-3 py-2 text-sm ${
          turn.role === "user" ? "bg-[var(--accent-dim)] text-left" : "bg-[var(--bg-elev)]"
        }`}
      >
        {turn.role === "assistant" ? (
          <div>
            {(turn.content || turn.status === "streaming") && (
              <div
                className="zen-md"
                dangerouslySetInnerHTML={{ __html: linkifyCitations(renderMarkdown(turn.content || "…")) }}
              />
            )}
            {(turn.status === "error" || turn.status === "stopped") && (
              <div className={`mt-1.5 flex items-center gap-2 text-xs ${turn.status === "error" ? "text-[var(--danger)]" : "text-[var(--text-dim)]"}`}>
                <span className="min-w-0 flex-1">
                  {turn.status === "error" ? (turn.error || "The reply failed.") : "Stopped."}
                </span>
                {retryable && onRetry && (
                  <button
                    type="button"
                    className="zen-pressable shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text)]"
                    onClick={onRetry}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <span className="whitespace-pre-wrap">{turn.content}</span>
        )}
      </div>
    </div>
  );
});

export function ChatPanel() {
  const open = useAI((s) => s.open);
  const turns = useAI((s) => s.turns);
  const streaming = useAI((s) => s.streaming);
  const send = useAI((s) => s.send);
  const retryLast = useAI((s) => s.retryLast);
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
  const aiAccess = useAiAccess((s) => s.access);
  const tier = useAiAccess((s) => s.tier);
  const modelPref = useAI((s) => s.modelPref);
  const setModelPref = useAI((s) => s.setModelPref);
  const blocked = aiBlocked(aiAccess);
  const models = availableModels(tier);
  const conversationBusy = streaming || proposals.some((p) => p.conversationId === activeId && p.status === "running");

  const [input, setInput] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // True once the in-flight assistant turn has visible text — at that point the
  // streaming bubble itself is the live indicator, so the "Thinking" dots below
  // it would be redundant noise rather than useful signal.
  const lastTurn = turns[turns.length - 1];
  const hasLiveContent = !!lastTurn && lastTurn.role === "assistant" && !!lastTurn.content;
  let lastUserIndex = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === "user") { lastUserIndex = i; break; }
  }
  const turnsAfterLastUser = lastUserIndex === -1 ? [] : turns.slice(lastUserIndex + 1);
  const retryableTurnId = turnsAfterLastUser.some((turn) => turn.role === "tool")
    ? null
    : [...turnsAfterLastUser].reverse().find((turn) =>
        turn.role === "assistant" && (turn.status === "error" || turn.status === "stopped"))?.id ?? null;

  useEffect(() => {
    stickToBottom.current = true;
  }, [activeId]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight });
    });
    return () => cancelAnimationFrame(frame);
  }, [turns, proposals, pendingQuestion]);

  // Clickable citations: open the cited note, or the cited PDF page on the canvas.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const cite = (e.target as HTMLElement).closest<HTMLElement>("[data-cite-note],[data-cite-pdf],[data-cite-source]");
      if (!cite) return;
      const noteId = cite.getAttribute("data-cite-note");
      const pdfId = cite.getAttribute("data-cite-pdf");
      const sourceId = cite.getAttribute("data-cite-source");
      if (noteId) {
        useNotes.getState().select(noteId);
      } else if (pdfId) {
        useHome.getState().launchDeepWork({ type: "pdf", id: pdfId });
        usePdfNav.getState().goTo(pdfId, Number(cite.getAttribute("data-cite-page")) || 1);
      } else if (sourceId) {
        useSources.getState().select(sourceId);
        useNotes.getState().select(null);
        useHome.getState().setManualDeepWork(false);
        useWorkspace.getState().set({ surface: "sources" });
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  const { mounted, state } = usePresence(open, 200);
  if (!mounted) return null;
  const animClass = state === "exit" ? "zen-exit-slide-right" : "zen-anim-slide-right";

  function submit() {
    if (streaming) return;
    const text = input.trim();
    if (!text) return;
    stickToBottom.current = true;
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

  if (showTools) {
    return (
      <aside data-tour="ai-tools" className={`${animClass} flex w-[360px] shrink-0 flex-col border-l border-[var(--border)]`}>
        <ToolSettings onClose={() => setShowTools(false)} />
      </aside>
    );
  }

  if (showActivity) {
    return (
      <aside data-tour="ai-activity" className={`${animClass} flex w-[360px] shrink-0 flex-col border-l border-[var(--border)]`}>
        <ActivityPanel turns={turns} onClose={() => setShowActivity(false)} />
      </aside>
    );
  }

  return (
    <aside aria-label="Zen AI chat" data-tour="ai-panel" className={`${animClass} flex w-[360px] shrink-0 flex-col border-l border-[var(--border)]`}>
      {/* Primary row: conversation + new + close */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-2">
        <Dropdown
          value={activeId}
          onChange={(id) => { if (!conversationBusy) switchConversation(id); }}
          title={conversationBusy ? "Stop or wait for the current action before switching conversations" : "Conversation"}
          className={`min-w-0 flex-1 text-sm font-medium ${conversationBusy ? "pointer-events-none opacity-60" : ""}`}
          options={conversations
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((c) => ({ value: c.id, label: c.title || "New chat" }))}
        />
        <button
          className="zen-pressable shrink-0 rounded px-1.5 text-base leading-none text-[var(--text-dim)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={newConversation}
          disabled={conversationBusy}
          title={conversationBusy ? "Stop or wait for the current action before starting a new conversation" : "New conversation"}
          aria-label="New conversation"
        >
          ＋
        </button>
        <button
          className="zen-pressable shrink-0 rounded px-1.5 text-sm leading-none text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={toggle}
          title="Close panel"
          aria-label="Close AI panel"
        >
          ✕
        </button>
      </div>

      {/* Secondary row: model + memory · profile / delete (all muted) */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text-dim)]">
        {models.length > 1 ? (
          <span className="inline-flex items-center gap-0.5 rounded-[6px] bg-[var(--bg-elev)] p-0.5" title="Pick your model — Pro is strongest; Flash is faster and cheaper against your monthly budget">
            {models.map((m: AiModel) => (
              <button
                key={m}
                className={`rounded-[4px] px-1.5 py-0.5 ${modelPref === m ? "bg-[var(--accent-dim)] text-[var(--text)]" : "hover:text-[var(--text)]"}`}
                onClick={() => setModelPref(m)}
                title={MODEL_LABEL[m]}
              >
                {m === "pro" ? "Pro" : "Flash"}
              </button>
            ))}
          </span>
        ) : (
          <span title={models[0] ? MODEL_LABEL[models[0]] : "Your Zen plan selects the AI model"}>
            {models[0] ? MODEL_LABEL[models[0]] : "DeepSeek"}
          </span>
        )}
        <UsageBadge
          promptTokens={conversations.find((c) => c.id === activeId)?.promptTokens}
          completionTokens={conversations.find((c) => c.id === activeId)?.completionTokens}
        />
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
          <button data-tour="ai-activity-button" className="zen-pressable hover:text-[var(--text)]" onClick={() => setShowActivity(true)} title="AI activity log">
            Activity
          </button>
          <button data-tour="ai-tools-button" className="zen-pressable hover:text-[var(--text)]" onClick={() => setShowTools(true)} title="Tool permissions">
            Tools
          </button>
          <button className="zen-pressable hover:text-[var(--text)]" onClick={() => setShowProfile(true)} title="Profile memory">
            Profile
          </button>
          <button
            className="zen-pressable hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => deleteConversation(activeId)}
            disabled={conversationBusy}
            title={conversationBusy ? "Stop or wait for the current action before deleting this conversation" : "Delete this conversation"}
          >
            Delete
          </button>
        </div>
      </div>

      {blocked && (
        <div className="border-b border-[var(--border)] bg-[rgba(246,104,94,0.06)] px-3 py-2.5 text-xs text-[var(--text-dim)]">
          <span className="text-[var(--text)]">{aiBlockedMessage(aiAccess)}</span>
          <button
            className="zen-pressable mt-1.5 block rounded border border-[var(--border)] px-2 py-1 text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={() => {
              useNotes.getState().select(null);
              useHome.getState().setManualDeepWork(false);
              useWorkspace.getState().set({ surface: "settings", adminMailId: null });
            }}
          >
            Open Settings
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        role="log"
        aria-label="Conversation"
        aria-busy={streaming}
        data-tour="ai-thread"
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3"
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {turns.length === 0 && (
          <div className="text-sm text-[var(--text-dim)]">
            Ask anything. The open note is sent as context. Tip: add notes or PDFs to Deep Work,
            then ask me to study your Deep Work material.
          </div>
        )}
        {turns.map((turn, i) => {
          const retryable = !!turn.id && turn.id === retryableTurnId;
          return (
            <TurnBubble
              key={turn.id ?? i}
              turn={turn}
              retryable={retryable}
              onRetry={retryable ? retryLast : undefined}
            />
          );
        })}
        {proposals
          // Resolved cards become inline tool turns. Interrupted running cards
          // remain visible as errors until the user acknowledges them.
          .filter((p) => p.conversationId === activeId && (p.status === "pending" || p.status === "running" || p.status === "error"))
          .map((p) => (
            <div
              key={p.id}
              data-tour="ai-proposal"
              className={`zen-anim-rise rounded-[var(--radius)] border bg-[var(--bg-elev)] p-3 text-sm ${
                p.danger ? "border-[var(--danger)]" : "border-[var(--border)]"
              }`}
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${p.status === "running" ? "zen-glow" : ""}`}
                  style={{ background: p.danger ? "var(--danger)" : "var(--accent)", "--zen-glow-color": "rgba(110, 168, 254, 0.45)" } as React.CSSProperties}
                />
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
              ) : p.status === "error" ? (
                <div className="space-y-2 text-xs text-[var(--danger)]">
                  <div>{p.result ?? "Completion is unknown. Check the target before retrying."}</div>
                  <button
                    className="zen-pressable rounded border border-[var(--border)] px-3 py-1 text-[var(--text-dim)] hover:text-[var(--text)]"
                    onClick={() => dismissProposal(p.id)}
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <div className="text-xs text-[var(--text-dim)]">
                  {p.status === "running" ? "Running…" : p.status === "done" ? (p.result ?? "Done") : (p.result ?? "Failed")}
                </div>
              )}
            </div>
          ))}

        {pendingQuestion && (
          <div className="zen-anim-rise rounded-[var(--radius)] border border-[var(--accent)] bg-[var(--bg-elev)] p-3 text-sm">
            <div className="zen-md mb-2 font-medium" dangerouslySetInnerHTML={{ __html: renderMarkdown(pendingQuestion.question) }} />
            <div className="flex flex-col gap-1.5">
              {pendingQuestion.options.map((opt, i) => (
                <button
                  key={i}
                  className="zen-pressable rounded border border-[var(--border)] px-3 py-1.5 text-left text-xs hover:bg-[var(--bg)] hover:text-[var(--text)]"
                  onClick={() => answerQuestion(opt)}
                >
                  <span className="zen-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(opt) }} />
                </button>
              ))}
            </div>
          </div>
        )}
        {streaming && !pendingQuestion && !hasLiveContent && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
            <span>Thinking</span>
            <span className="zen-typing">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-2">
        <textarea
          data-tour="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={blocked ? "AI is unavailable for this account" : "Message… (Enter to send, Shift+Enter for newline)"}
          aria-label="Message Zen"
          rows={3}
          disabled={blocked}
          className="w-full resize-none rounded bg-[var(--bg-elev)] px-2 py-1.5 text-sm outline-none placeholder:text-[var(--text-dim)] disabled:opacity-60"
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
              disabled={!input.trim() || blocked}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

/** A persistent log of every tool the AI ran/proposed in this conversation. */
function ActivityPanel({ turns, onClose }: { turns: ChatTurn[]; onClose: () => void }) {
  const acts = turns.filter((t) => t.role === "tool");
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">Activity</span>
        <span className="text-[11px] text-[var(--text-dim)]">{acts.length}</span>
        <button
          className="zen-pressable ml-auto rounded px-1.5 text-sm leading-none text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={onClose}
          title="Back to chat"
        >
          ✕
        </button>
      </div>
      <div className="zen-stagger flex-1 space-y-1.5 overflow-y-auto p-3 text-xs">
        {acts.length === 0 ? (
          <div className="text-[var(--text-dim)]">No tool activity yet in this conversation.</div>
        ) : (
          acts.map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: toneColor(t.tone) }} />
              <span className="min-w-0 flex-1 break-words">
                <span className="text-[var(--text)]">{t.content}</span>
                {t.detail && <span className="text-[var(--text-dim)]"> · {t.detail}</span>}
                {t.result && (
                  <span className={t.tone === "error" ? "block text-[var(--danger)]" : "block text-[var(--text-dim)]"}>{t.result}</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
