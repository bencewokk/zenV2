import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { MathfieldElement } from "mathlive";
import "mathlive";
import "@/features/math/setup";
import { useMathCheck } from "@/features/math/checkStore";
import { checkDerivation, type DerivationStep } from "@/features/math/cas";
import { sympyCheckDerivation } from "@/features/math/sympy";

type DerivationIssue =
  | { kind: "bad"; line: number; note: string }
  | { kind: "unknown"; line: number; note: string }
  | { kind: "ok" };

function firstDerivationIssue(derivation: { lines: string[]; steps: DerivationStep[] } | null): DerivationIssue | null {
  if (!derivation || derivation.lines.length < 2) return null;
  for (let i = 1; i < derivation.lines.length; i++) {
    if (derivation.steps[i]?.verdict === "wrong")
      return { kind: "bad", line: i + 1, note: derivation.steps[i].note ?? "doesn't follow from the line above." };
  }
  for (let i = 1; i < derivation.lines.length; i++) {
    const step = derivation.steps[i];
    if (step?.verdict === "unknown" && step.note) return { kind: "unknown", line: i + 1, note: step.note };
  }
  return { kind: "ok" };
}

/**
 * Shared NodeView for math nodes. The Math Checker now checks derivation steps
 * only; answer keys/expected targets are intentionally not exposed in notes.
 */
export function MathView({ node, updateAttributes, selected, extension, editor, getPos }: NodeViewProps) {
  const ref = useRef<MathfieldElement | null>(null);
  const inline = extension.name === "mathInline";
  const checkOn = useMathCheck((s) => s.enabled);
  const latex: string = node.attrs.latex ?? "";
  const [sympyDerivation, setSympyDerivation] = useState<{
    key: string;
    loading: boolean;
    value: { lines: string[]; steps: DerivationStep[] } | null;
    error?: string;
  } | null>(null);

  const derivation = useMemo(
    () => (checkOn && !inline ? checkDerivation(latex) : null),
    [checkOn, inline, latex]
  );
  const derivIssue = useMemo(() => firstDerivationIssue(derivation), [derivation]);
  const derivationKey = latex;

  useEffect(() => {
    if (!checkOn || inline || !latex.trim() || !derivation || derivation.lines.length < 2 || derivIssue?.kind === "ok") {
      setSympyDerivation(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      setSympyDerivation({ key: derivationKey, loading: true, value: null });
      void sympyCheckDerivation(latex)
        .then((next) => {
          if (alive) setSympyDerivation({ key: derivationKey, loading: false, value: next });
        })
        .catch((error: Error) => {
          if (alive) setSympyDerivation({ key: derivationKey, loading: false, value: null, error: error.message });
        });
    }, 550);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [checkOn, derivation, derivationKey, derivIssue?.kind, inline, latex]);

  const activeSympyDerivation = sympyDerivation?.key === derivationKey ? sympyDerivation : null;
  const effectiveDerivIssue = activeSympyDerivation?.value ? firstDerivationIssue(activeSympyDerivation.value) : derivIssue;
  const sympyLoading = !!activeSympyDerivation?.loading;
  const sympyError = activeSympyDerivation?.error;
  const verdictClass = effectiveDerivIssue?.kind === "bad" ? "zen-check-bad" : "";
  const showPanel = checkOn && selected && !inline;
  const showBar = !inline && checkOn && (
    effectiveDerivIssue?.kind === "bad" ||
    (showPanel && (effectiveDerivIssue?.kind === "ok" || sympyLoading || sympyError))
  );

  useEffect(() => {
    const mf = ref.current;
    if (!mf) return;
    if (mf.value !== latex) mf.value = latex;

    mf.mathVirtualKeyboardPolicy = inline ? "manual" : "auto";

    const onInput = () => updateAttributes({ latex: mf.value });

    const onMoveOut = (ev: Event) => {
      const dir = (ev as CustomEvent<{ direction: string }>).detail?.direction;
      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos == null) return;
      ev.preventDefault();
      if (dir === "forward" || dir === "downward") {
        const after = pos + node.nodeSize;
        if (after >= editor.state.doc.content.size) {
          editor.chain().insertContentAt(after, { type: "paragraph" }).focus(after + 1).run();
        } else {
          editor.commands.focus(after);
        }
      } else {
        editor.commands.focus(Math.max(0, pos));
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (inline || ev.key !== "Enter" || ev.shiftKey) return;
      const v = mf.value;
      const inEnv = v.includes("\\displaylines") || /\\begin\{/.test(v);
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
  }, [latex, node.nodeSize, updateAttributes, editor, getPos, inline]);

  return (
    <NodeViewWrapper
      as={inline ? "span" : "div"}
      className={`zen-math ${inline ? "zen-math-inline" : "zen-math-block"} ${selected ? "is-selected" : ""} ${verdictClass}`}
      onMouseDown={(e: React.MouseEvent) => {
        e.stopPropagation();
        ref.current?.focus();
      }}
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

      {showBar && (
        <div className="zen-check-bar" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          {effectiveDerivIssue?.kind === "bad" && (
            <div className="zen-check-step is-bad">
              <span className="zen-check-step-tag">Line {effectiveDerivIssue.line}</span> {effectiveDerivIssue.note}
            </div>
          )}
          {effectiveDerivIssue?.kind === "ok" && showPanel && (
            <div className="zen-check-step is-ok">Each step follows</div>
          )}
          {showPanel && sympyLoading && <div className="zen-check-step">SymPy checking...</div>}
          {showPanel && sympyError && <div className="zen-check-step">SymPy unavailable: {sympyError}</div>}
        </div>
      )}
    </NodeViewWrapper>
  );
}

