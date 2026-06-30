import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { MathfieldElement } from "mathlive";
import "mathlive";
import "@/features/math/setup";
import { MathField } from "@/features/math/MathField";
import { useMathCheck } from "@/features/math/checkStore";
import { checkAnswer, checkDerivation, type Verdict } from "@/features/math/cas";
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
  const showVerdict = !!result && result.verdict !== "unknown";
  const setTarget = (latex: string) => updateAttributes({ target: latex });
  const clearTarget = () => {
    updateAttributes({ target: "" });
    setEditingTarget(false);
  };

  // Derivation rail — for a multi-line block equation, check each line follows from
  // the one above. Independent of `target` (that checks the final answer).
  const derivation = useMemo(
    () => (checkOn && !inline ? checkDerivation(node.attrs.latex ?? "") : null),
    [checkOn, inline, node.attrs.latex]
  );
  // Compact status instead of a full mirror: surface only the first step that
  // breaks (or can't be confirmed); otherwise just "each step follows".
  const derivIssue = useMemo(() => {
    if (!derivation || derivation.lines.length < 2) return null;
    for (let i = 1; i < derivation.lines.length; i++) {
      if (derivation.steps[i]?.verdict === "wrong")
        return { kind: "bad" as const, line: i + 1, note: derivation.steps[i].note ?? "doesn’t follow from the line above." };
    }
    for (let i = 1; i < derivation.lines.length; i++) {
      const s = derivation.steps[i];
      if (s?.verdict === "unknown" && s.note)
        return { kind: "unknown" as const, line: i + 1, note: s.note };
    }
    return { kind: "ok" as const };
  }, [derivation]);

  // The expected-answer row shows while editing or once there's a verdict; the
  // whole bar appears for that, or to flag a broken step.
  const showExpected = showPanel || showVerdict;
  // Only a genuinely broken step forces the bar open — "couldn't verify" stays
  // silent so a correct-but-unprovable line doesn't look like a problem.
  const showBar = !inline && checkOn && (showExpected || derivIssue?.kind === "bad");

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

      {/* Inline math: a small verdict pill, expanding to a popover when selected. */}
      {inline && checkOn && result && !showPanel && result.verdict !== "unknown" && (
        <span className="zen-check-badge" contentEditable={false}>
          {VERDICT_LABEL[result.verdict]}
        </span>
      )}
      {inline && showPanel && (
        <div className="zen-check-panel" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          <div className="zen-check-panel-row">
            <span className="zen-check-panel-label">Expected answer</span>
            {target && (
              <button type="button" className="zen-check-clear" onClick={clearTarget}>clear</button>
            )}
          </div>
          <MathField value={target} onChange={setTarget} ariaLabel="Expected answer" />
          {showVerdict && (
            <div className={`zen-check-verdict ${verdictClass}`}>
              {VERDICT_LABEL[result!.verdict]}
              {result!.note && <span className="zen-check-note"> — {result!.note}</span>}
            </div>
          )}
        </div>
      )}

      {/* Block math: one compact bar — step status + expected answer + verdict. */}
      {showBar && (
        <div className="zen-check-bar" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          {derivIssue?.kind === "bad" && (
            <div className="zen-check-step is-bad">
              <span className="zen-check-step-tag">Line {derivIssue.line}</span> {derivIssue.note}
            </div>
          )}
          {derivIssue?.kind === "ok" && showPanel && (
            <div className="zen-check-step is-ok">Each step follows</div>
          )}
          {showExpected && (
            <div className="zen-check-expected">
              <span className="zen-check-panel-label">Expected</span>
              {showPanel ? (
                <MathField value={target} onChange={setTarget} ariaLabel="Expected answer" />
              ) : target ? (
                <span className="zen-check-target" dangerouslySetInnerHTML={{ __html: renderLatex(target, false) }} />
              ) : null}
              {showPanel && target && (
                <button type="button" className="zen-check-clear" onClick={clearTarget}>clear</button>
              )}
              {showVerdict && (
                <span className={`zen-check-verdict ${verdictClass}`}>
                  {VERDICT_LABEL[result!.verdict]}
                  {result!.note && <span className="zen-check-note"> — {result!.note}</span>}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}
