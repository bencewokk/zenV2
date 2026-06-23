import { createElement, useEffect, useRef } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { MathfieldElement } from "mathlive";
import "mathlive";
import "@/features/math/setup";

/**
 * Shared NodeView for math nodes — renders an editable MathLive field.
 * The LaTeX lives in the node's `latex` attribute (persisted with the doc).
 */
export function MathView({ node, updateAttributes, selected, extension, editor, getPos }: NodeViewProps) {
  const ref = useRef<MathfieldElement | null>(null);
  const inline = extension.name === "mathInline";

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
      }`}
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
    </NodeViewWrapper>
  );
}
