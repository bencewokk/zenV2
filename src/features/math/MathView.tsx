import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { MathfieldElement } from "mathlive";
import "mathlive";
import "@/features/math/setup";
import { MathField } from "@/features/math/MathField";
import { useMathCheck } from "@/features/math/checkStore";
import { checkAnswer, checkDerivation, type DerivationStep, type Verdict } from "@/features/math/cas";
import { renderLatex } from "@/shared/lib/renderMarkdown";

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: "Correct",
  equivalent: "Equivalent ✓",
  wrong: "Not the expected answer",
  empty: "Type your answer…",
  unknown: "",
};

/**
 * Shared NodeView for math nodes — renders an editable MathLive field.
 * The LaTeX lives in the node's `latex` attribute (persisted with the doc).
 */
export function MathView({ node, updateAttributes, selected, extension, editor, getPos }: NodeViewProps) {
  const ref = useRef<MathfieldElement | null>(null);
  const inline = extension.name === "mathInline";

  // ── Math Checker ──
  const checkOn = useMathCheck((s) => s.enabled);
  const [editingTarget, setEditingTarget] = useState(false);
  const target: string = node.attrs.target ?? "";
  // Live verdict (only when the checker is on and this block has a target).
  const result = useMemo(
    () => (checkOn && target.trim() ? checkAnswer(node.attrs.latex ?? "", target) : null),
    [checkOn, target, node.attrs.latex]
  );
  const verdictClass =
    result && (result.verdict === "correct" || result.verdict === "equivalent")
      ? "zen-check-ok"
      : result && result.verdict === "wrong"
        ? "zen-check-bad"
        : "";
  const showPanel = checkOn && (selected || editingTarget);

  // Derivation rail — for a multi-line block equation, check each line follows from
  // the one above. Independent of `target` (that checks the final answer).
  const derivation = useMemo(
    () => (checkOn && !inline ? checkDerivation(node.attrs.latex ?? "") : null),
    [checkOn, inline, node.attrs.latex]
  );
  const showRail = !!derivation && derivation.lines.length >= 2;

  useEffect(() => {
    const mf = ref.current;
    if (!mf) return;
    if (mf.value !== node.attrs.latex) mf.value = node.attrs.latex ?? "";

    // Inline math: don't pop the virtual keyboard on focus — it's intrusive for a
    // small in-text field. Show it only on an explicit double-click (below). Block
    // equations keep the default auto behaviour.
    mf.mathVirtualKeyboardPolicy = inline ? "manual" : "auto";

    const onInput = () => updateAttributes({ latex: mf.value });

    // When the caret moves past an edge of the field, hand focus back to the
    // text editor on the correct side so you can keep typing / add a new line.
    const onMoveOut = (ev: Event) => {
      const dir = (ev as CustomEvent<{ direction: string }>).detail?.direction;
      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos == null) return;
      ev.preventDefault();
      if (dir === "forward" || dir === "downward") {
        const after = pos + node.nodeSize;
        // ensure there is somewhere to land after a trailing block math node
        if (after >= editor.state.doc.content.size) {
          editor.chain().insertContentAt(after, { type: "paragraph" }).focus(after + 1).run();
        } else {
          editor.commands.focus(after);
        }
      } else {
        editor.commands.focus(Math.max(0, pos));
      }
    };

    // In a block equation, Enter adds a new line within the SAME block by
    // adding a row (MathLive wraps the content in \displaylines). Capture
    // phase + stopImmediatePropagation so MathLive's own Enter doesn't also
    // fire (that produced an extra line). Inline math stays single-line.
    const onKeyDown = (ev: KeyboardEvent) => {
      if (inline || ev.key !== "Enter" || ev.shiftKey) return;
      const v = mf.value;
      const inEnv = v.includes("\\displaylines") || /\\begin\{/.test(v);
      // First Enter on a plain equation: MathLive's native Enter does nothing,
      // so wrap it into \displaylines ourselves. Once it's an environment,
      // let MathLive's native Enter add each subsequent row (avoids doubling).
      if (!inEnv) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        mf.executeCommand("addRowAfter");
      }
    };

    mf.addEventListener("input", onInput);
    mf.addEventListener("move-out", onMoveOut as EventListener);
    mf.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      mf.removeEventListener("input", onInput);
      mf.removeEventListener("move-out", onMoveOut as EventListener);
      mf.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [node.attrs.latex, node.nodeSize, updateAttributes, editor, getPos, inline]);

  return (
    <NodeViewWrapper
      as={inline ? "span" : "div"}
      className={`zen-math ${inline ? "zen-math-inline" : "zen-math-block"} ${
        selected ? "is-selected" : ""
      } ${verdictClass}`}
      // Focus the field on click instead of letting ProseMirror node-select it.
      onMouseDown={(e: React.MouseEvent) => {
        e.stopPropagation();
        ref.current?.focus();
      }}
      // Inline math suppresses the virtual keyboard on focus; a double-click is the
      // explicit gesture to summon it.
      onDoubleClick={
        inline
          ? (e: React.MouseEvent) => {
              e.stopPropagation();
              ref.current?.focus();
              window.mathVirtualKeyboard?.show();
            }
          : undefined
      }
    >
      {createElement("math-field", {
        ref,
        style: inline ? { display: "inline-block" } : {},
      })}

      {/* Derivation rail — line-by-line "does this step follow?" for multi-line working. */}
      {showRail && <DerivationRail lines={derivation!.lines} steps={derivation!.steps} />}

      {/* Checker badge — compact verdict shown whenever the checker is on and the block
          has a target (and the editor panel isn't open). */}
      {checkOn && result && !showPanel && result.verdict !== "unknown" && (
        <span className="zen-check-badge" contentEditable={false}>
          {VERDICT_LABEL[result.verdict]}
        </span>
      )}

      {/* Author panel — set/clear the expected answer and read the verdict + note. */}
      {showPanel && (
        <div className="zen-check-panel" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          <div className="zen-check-panel-row">
            <span className="zen-check-panel-label">Expected answer</span>
            {target && (
              <button
                type="button"
                className="zen-check-clear"
                onClick={() => {
                  updateAttributes({ target: "" });
                  setEditingTarget(false);
                }}
              >
                clear
              </button>
            )}
          </div>
          <MathField
            value={target}
            onChange={(latex) => updateAttributes({ target: latex })}
            ariaLabel="Expected answer"
          />
          {result && result.verdict !== "unknown" && (
            <div className={`zen-check-verdict ${verdictClass}`}>
              {VERDICT_LABEL[result.verdict]}
              {result.note && <span className="zen-check-note"> — {result.note}</span>}
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** Maps a step verdict to its rail-segment colour class. */
function segClass(step: DerivationStep | undefined): string {
  if (!step) return "";
  if (step.verdict === "correct" || step.verdict === "equivalent") return "zen-deriv-ok";
  if (step.verdict === "wrong") return "zen-deriv-bad";
  return "zen-deriv-neutral";
}

/**
 * Renders the working as a stack of KaTeX-rendered lines with a vertical rail to the
 * left: each connector between two lines is green when the lower line follows from the
 * one above, red when the step breaks (with a short reason). A read-only mirror of the
 * editable field above, shown only while the Math Checker is on.
 */
function DerivationRail({ lines, steps }: { lines: string[]; steps: DerivationStep[] }) {
  return (
    <div className="zen-deriv" contentEditable={false}>
      {lines.map((ln, i) => {
        const incoming = i > 0 ? steps[i] : undefined; // step INTO this line
        const outgoing = i < lines.length - 1 ? steps[i + 1] : undefined; // step OUT of this line
        return (
          <div key={i} className="zen-deriv-row">
            <div className="zen-deriv-rail">
              <span className={`zen-deriv-dot ${segClass(incoming) || segClass(outgoing)}`} />
              {i < lines.length - 1 && <span className={`zen-deriv-seg ${segClass(outgoing)}`} />}
            </div>
            <div className="zen-deriv-body">
              <div className="zen-deriv-line" dangerouslySetInnerHTML={{ __html: renderLatex(ln, true) }} />
              {incoming?.verdict === "wrong" && (
                <div className="zen-deriv-flag">{incoming.note ?? "This line doesn't follow from the one above."}</div>
              )}
              {incoming?.verdict === "unknown" && incoming.note && (
                <div className="zen-deriv-flag-muted" title="The checker couldn't symbolically confirm or refute this step.">
                  {incoming.note}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
