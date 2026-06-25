import { useEffect, useState } from "react";
import { renderMarkdown } from "@/shared/lib/renderMarkdown";
import { ChatPanel } from "@/features/ai/ChatPanel";
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
  const { sessionActive, sessionRemaining } = useFocusSession();

  // The chat is the lesson's only input — make sure it's open while teaching.
  useEffect(() => {
    if (active && !useAI.getState().open) useAI.getState().toggle();
  }, [active]);

  if (!active) return null;

  return (
    <div className="zen-anim-fade fixed inset-0 z-[60] flex bg-[var(--bg)]">
      {/* Lesson board */}
      <div className="zen-panel-scroll relative min-w-0 flex-1 overflow-y-auto px-6 py-5 sm:px-10">
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
              className={`zen-pressable rounded-[6px] border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)] ${sessionActive ? "" : "ml-auto"}`}
              onClick={() => useLesson.getState().end()}
              title="End lesson"
            >
              ◑ End lesson
            </button>
          </div>

          {blocks.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-dim)]">
              Your tutor is preparing the lesson… it will pull up explanations, diagrams, and questions here.
            </div>
          ) : (
            <div className="space-y-4">
              {blocks.map((b) => (
                <BlockView key={b.id} block={b} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat docked on the right (the single ChatPanel instance while a lesson runs). */}
      <ChatPanel />
    </div>
  );
}

function BlockView({ block }: { block: LessonBlock }) {
  switch (block.kind) {
    case "text":
      return <div className="zen-md text-sm text-[var(--text)]" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.markdown) }} />;
    case "svg":
      return (
        <figure className="rounded-[12px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-3">
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

  function submit(answer: string) {
    const a = answer.trim();
    if (!a || block.answered) return;
    useLesson.getState().answerQuestion(block.id, a);
    const tag = [block.concept && `concept: ${block.concept}`, block.sub && `sub-skill: ${block.sub}`].filter(Boolean).join(" · ");
    useAI.getState().send(`[Lesson answer]${tag ? ` (${tag})` : ""}\nQ: ${block.prompt}\nA: ${a}`);
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
