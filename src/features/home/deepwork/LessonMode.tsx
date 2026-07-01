import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "@/shared/lib/renderMarkdown";
import { ChatPanel } from "@/features/ai/ChatPanel";
import { MathWorkspace } from "@/features/math/MathWorkspace";
import { useAI } from "@/features/ai/store";
import { usePdfs } from "@/features/pdfs/store";
import { useLesson, type LessonBlock } from "@/features/home/deepwork/lessonStore";
import { useFocusSession } from "@/features/home/deepwork/useFocusSession";
import { fmtClock } from "@/features/home/deepwork/deepworkStore";

/**
 * STUDY MODE — a fullscreen, AI-authored lesson. The tutor composes a board of
 * blocks (text, SVG diagrams, highlighted PDF snippets, inline questions) on the
 * left via the `study_present` tool; the chat is docked on the right. Mostly
 * read-only — only `question` blocks take input, which is fed back to the chat for
 * grading (crediting the relevant concept sub-skill). Mounted at App root, like QuizView.
 */
export function LessonMode() {
  const active = useLesson((s) => s.active);
  const title = useLesson((s) => s.title);
  const blocks = useLesson((s) => s.blocks);
  const cursor = useLesson((s) => s.cursor);
  const revealAll = useLesson((s) => s.revealAll);
  const boardComplete = useLesson((s) => s.boardComplete);
  const streaming = useAI((s) => s.streaming);
  const { sessionActive, sessionRemaining } = useFocusSession();
  const [showWS, setShowWS] = useState(false);

  // The chat is the lesson's only input — make sure it's open while teaching.
  useEffect(() => {
    if (active && !useAI.getState().open) useAI.getState().toggle();
  }, [active]);

  // Keep the newest revealed step in view as the lesson advances.
  const currentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!revealAll) currentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [cursor, revealAll]);

  // Keyboard navigation: ←/→/Space step through; number keys answer the current
  // choice question. Skipped while typing in the chat or an answer field.
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (isEditingTarget()) return;
      const { blocks: bs, cursor: cur, revealAll: all } = useLesson.getState();
      if (all || !bs.length) return;
      const block = bs[cur - 1];
      if (block?.kind === "question" && block.qkind === "choice" && !block.answered && block.options?.length) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= block.options.length) {
          e.preventDefault();
          submitLessonAnswer(block, block.options[n - 1]);
          return;
        }
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        useLesson.getState().back();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        if (block?.kind === "question" && !block.answered) return; // gated on the check
        e.preventDefault();
        if (!useLesson.getState().next() && !useAI.getState().streaming) finishOrContinueLesson();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!active) return null;

  const visible = revealAll ? blocks : blocks.slice(0, cursor);
  const current = blocks[cursor - 1];
  // Don't let the user skip past an unanswered check question.
  const blockedByQuestion = !revealAll && current?.kind === "question" && !current.answered;
  const atEnd = cursor >= blocks.length;

  function handleNext() {
    if (useLesson.getState().next()) return; // revealed the next authored step
    if (!streaming) finishOrContinueLesson();
  }

  function finishOrContinueLesson() {
    const lesson = useLesson.getState();
    if (lesson.boardComplete) {
      lesson.end();
      return;
    }
    void useAI.getState().send(
      "[Lesson] The current slide batch is finished. Decide whether an important uncovered objective remains. " +
      "If yes, append only the necessary next slides with study_present and mark whether that batch completes the lesson. " +
      "If no, call deepwork_end_lesson now. Do not repeat covered material."
    );
  }

  function askAbout(kind: "more" | "simpler" | "example" | "stuck") {
    if (streaming || !current) return;
    const gist = blockGist(current).replace(/\s+/g, " ").slice(0, 300);
    const lead = {
      more: "Go deeper on this part of the lesson",
      simpler: "Explain this part of the lesson more simply",
      example: "Give me a concrete worked example for this part of the lesson",
      stuck: "I'm stuck on this part of the lesson — help me understand it",
    }[kind];
    useAI.getState().send(`${lead}:\n"${gist}"`);
  }

  return (
    <div className="zen-anim-fade fixed inset-0 z-[60] flex bg-[var(--bg)]">
      {/* Lesson board — a column so the step controls pin to the visible bottom,
          not the bottom of the (scrolling) content. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="zen-panel-scroll flex-1 overflow-y-auto px-6 py-5 sm:px-10">
        <div className="mx-auto w-full max-w-[760px]">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">Lesson</span>
            {title && <span className="min-w-0 truncate text-sm font-medium text-[var(--text)]">{title}</span>}
            {sessionActive && (
              <span className="ml-auto tabular-nums text-xs text-[var(--accent)]" title="Lesson focus timer">
                ◷ {fmtClock(sessionRemaining)}
              </span>
            )}
            <button
              className={`zen-pressable rounded-[6px] border border-[var(--border)] px-2 py-1 text-xs hover:text-[var(--text)] ${showWS ? "text-[var(--accent)]" : "text-[var(--text-dim)]"} ${sessionActive ? "" : "ml-auto"}`}
              onClick={() => setShowWS((v) => !v)}
              title="Math scratch workspace"
            >
              ∑ Math
            </button>
            <button
              className="zen-pressable rounded-[6px] border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
              onClick={() => useLesson.getState().end()}
              title="Finish class and close the board"
            >
              ◑ Finish class
            </button>
          </div>

          {blocks.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-dim)]">
              Your tutor is preparing the lesson… it will pull up explanations, diagrams, and questions here.
            </div>
          ) : (
            <div className="space-y-4 pb-28">
              {visible.map((b, i) => (
                <div
                  key={b.id}
                  ref={!revealAll && i === visible.length - 1 ? currentRef : undefined}
                  className={!revealAll && i < visible.length - 1 ? "opacity-45 transition-opacity" : ""}
                >
                  <BlockView block={b} />
                </div>
              ))}
            </div>
          )}
        </div>
        </div>

        {/* Paced step controls — one block at a time; ask about the current step or move on. */}
        {blocks.length > 0 && !revealAll && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-6 pb-4 sm:px-10">
            <div className="zen-anim-rise pointer-events-auto flex w-full max-w-[760px] flex-col gap-2 rounded-[14px] border border-[var(--border)] bg-[rgba(18,19,24,0.94)] p-2.5 backdrop-blur">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-dim)]">Ask</span>
                {([["more", "Explain more"], ["simpler", "Simpler"], ["example", "Example"], ["stuck", "I'm stuck"]] as const).map(
                  ([k, label]) => (
                    <button
                      key={k}
                      className="zen-pressable rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-40"
                      onClick={() => askAbout(k)}
                      disabled={streaming}
                    >
                      {label}
                    </button>
                  )
                )}
                <button
                  className="zen-pressable ml-auto rounded-full px-2 py-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
                  onClick={() => useLesson.getState().setRevealAll(true)}
                  title="Show the whole lesson at once"
                >
                  Show all
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="zen-pressable rounded-[8px] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30"
                  onClick={() => useLesson.getState().back()}
                  disabled={cursor <= 1}
                >
                  ← Back
                </button>
                <span className="text-xs tabular-nums text-[var(--text-dim)]" title="Shortcuts: ← / → or Space to step · 1–9 to answer a choice question">
                  {Math.min(cursor, blocks.length)} / {blocks.length}
                </span>
                <button
                  className="zen-pressable ml-auto rounded-[8px] border border-[var(--accent)] bg-[var(--accent-dim)] px-4 py-1.5 text-sm text-[var(--text)] disabled:opacity-40"
                  onClick={handleNext}
                  disabled={blockedByQuestion || (atEnd && streaming)}
                  title={blockedByQuestion ? "Answer the question to continue" : atEnd ? (boardComplete ? "Finish class and close the board" : "Let the tutor decide what remains") : "Next step"}
                >
                  {atEnd ? (streaming ? "…" : boardComplete ? "Finish class" : "Continue →") : "Next →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {blocks.length > 0 && revealAll && (
          <button
            className="zen-pressable absolute bottom-4 right-6 rounded-full border border-[var(--border)] bg-[rgba(18,19,24,0.9)] px-3 py-1.5 text-xs text-[var(--text-dim)] backdrop-blur hover:text-[var(--text)] sm:right-10"
            onClick={() => useLesson.getState().setRevealAll(false)}
          >
            Step through
          </button>
        )}
      </div>

      {/* Math scratch workspace, docked between the board and the chat. */}
      {showWS && (
        <MathWorkspace
          onInsert={(latex) => useLesson.getState().requestInsert(latex)}
          onClose={() => setShowWS(false)}
        />
      )}

      {/* Chat docked on the right (the single ChatPanel instance while a lesson runs). */}
      <ChatPanel />
    </div>
  );
}

/** Submit an answer to an inline lesson question: mark it answered + send to the tutor
 *  for grading. Shared by the question block's UI and the keyboard handler. */
function submitLessonAnswer(block: Extract<LessonBlock, { kind: "question" }>, answer: string) {
  const a = answer.trim();
  if (!a || block.answered) return;
  useLesson.getState().answerQuestion(block.id, a);
  const tag = [block.concept && `concept: ${block.concept}`, block.sub && `sub-skill: ${block.sub}`].filter(Boolean).join(" · ");
  void useAI.getState().send(`[Lesson answer]${tag ? ` (${tag})` : ""}\nQ: ${block.prompt}\nA: ${a}`);
}

/** True when a typing surface (chat box, answer field) holds focus — so navigation
 *  shortcuts don't hijack the user's keystrokes. */
function isEditingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON" || el.isContentEditable;
}

/** A short text gist of a block, used to give the tutor context for a quick-ask. */
function blockGist(b: LessonBlock): string {
  switch (b.kind) {
    case "text": return b.markdown;
    case "svg": return b.caption ?? "this diagram";
    case "snippet": return b.note ? `${b.text} (${b.note})` : b.text;
    case "pdf": return b.caption ?? "this PDF page";
    case "question": return b.prompt;
    default: return "this part";
  }
}

function BlockView({ block }: { block: LessonBlock }) {
  switch (block.kind) {
    case "text":
      return <div className="zen-md text-sm text-[var(--text)]" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.markdown) }} />;
    case "svg":
      // Render diagrams on a light "whiteboard" so the model's default black
      // strokes/text are visible (the dark board hid them). See .zen-lesson-diagram.
      return (
        <figure className="zen-lesson-diagram rounded-[12px] border border-[var(--border)] p-2">
          {/* Reuse renderMarkdown's ```svg sanitizer by fencing the raw SVG. */}
          <div className="zen-md flex justify-center" dangerouslySetInnerHTML={{ __html: renderMarkdown("```svg\n" + block.svg + "\n```") }} />
          {block.caption && <figcaption className="mt-2 text-center text-xs text-[var(--text-dim)]">{block.caption}</figcaption>}
        </figure>
      );
    case "snippet":
      return (
        <div className="rounded-[12px] border-l-2 border-[var(--accent)] bg-[rgba(96,165,250,0.06)] px-3 py-2">
          {block.source && <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[var(--text-dim)]">{block.source}</div>}
          <div className="zen-md text-sm text-[var(--text)]" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }} />
          {block.note && <div className="mt-1.5 text-xs italic text-[var(--text-dim)]">{block.note}</div>}
        </div>
      );
    case "pdf":
      return <PdfBlock pdfId={block.pdfId} page={block.page} caption={block.caption} />;
    case "question":
      return <QuestionBlock block={block} />;
    default:
      return null;
  }
}

/** A referenced PDF page — header + the page's extracted text (loaded lazily). */
function PdfBlock({ pdfId, page, caption }: { pdfId: string; page: number; caption?: string }) {
  const name = usePdfs((s) => s.pdfs[pdfId]?.name) ?? "PDF";
  const [text, setText] = useState("");
  useEffect(() => {
    let alive = true;
    void usePdfs
      .getState()
      .pagesFor(pdfId)
      .then((pages) => {
        if (alive && pages) setText(pages[page - 1] ?? "");
      });
    return () => {
      alive = false;
    };
  }, [pdfId, page]);
  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-3">
      <div className="mb-1 text-xs font-medium text-[var(--text-dim)]">📄 {name} · p{page}</div>
      {caption && <div className="mb-1.5 text-sm text-[var(--text)]">{caption}</div>}
      {text && <div className="max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-dim)]">{text.slice(0, 1500)}</div>}
    </div>
  );
}

/** An inline question — the only interactive block. On submit it's marked answered
 *  and the answer is sent to the chat so the tutor grades it (crediting the sub-skill). */
function QuestionBlock({ block }: { block: Extract<LessonBlock, { kind: "question" }> }) {
  const [value, setValue] = useState("");
  const streaming = useAI((s) => s.streaming);
  const insertReq = useLesson((s) => s.insertReq);
  const appliedNonce = useRef(0);

  // Apply a math-workspace insert aimed at this question's answer field (once per nonce).
  useEffect(() => {
    if (!insertReq || insertReq.id !== block.id || insertReq.nonce === appliedNonce.current) return;
    appliedNonce.current = insertReq.nonce;
    setValue((v) => (v.trim() ? `${v} $${insertReq.text}$` : `$${insertReq.text}$`));
  }, [insertReq, block.id]);

  function submit(answer: string) {
    submitLessonAnswer(block, answer);
  }

  return (
    <div className="rounded-[12px] border border-[var(--accent)] bg-[rgba(96,165,250,0.08)] px-3 py-2.5">
      <div className="mb-2 zen-md text-sm font-medium text-[var(--text)]" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.prompt) }} />
      {block.answered ? (
        <div className="text-xs text-[var(--text-dim)]">Your answer: <span className="text-[var(--text)]">{block.answer}</span></div>
      ) : block.qkind === "choice" && block.options?.length ? (
        <div className="flex flex-col gap-1.5">
          {block.options.map((opt, i) => (
            <button
              key={i}
              className="zen-pressable rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-left text-sm text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
              onClick={() => submit(opt)}
              disabled={streaming}
            >
              <span className="zen-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(opt) }} />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <textarea
            value={value}
            onFocus={() => useLesson.getState().setFocusedQ(block.id)}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(value);
              }
            }}
            rows={2}
            placeholder="Your answer…"
            className="min-h-[2.25rem] flex-1 resize-none rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button
            className="zen-pressable rounded-[8px] border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-50"
            onClick={() => submit(value)}
            disabled={streaming || !value.trim()}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
