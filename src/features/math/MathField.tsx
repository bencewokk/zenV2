import { createElement, useEffect, useRef } from "react";
import type { MathfieldElement } from "mathlive";
import "mathlive";
import "@/features/math/setup";

/**
 * Standalone MathLive field for use OUTSIDE the TipTap editor (e.g. quiz math
 * answers) — the same `math-field` web component the notes editor uses, so math
 * entry/rendering is identical everywhere. Editable by default; pass `readOnly`
 * for display.
 */
export function MathField({
  value,
  onChange,
  readOnly = false,
  ariaLabel,
}: {
  value: string;
  onChange?: (latex: string) => void;
  readOnly?: boolean;
  ariaLabel?: string;
}) {
  const ref = useRef<MathfieldElement | null>(null);

  useEffect(() => {
    const mf = ref.current;
    if (!mf) return;
    if (mf.value !== value) mf.value = value ?? "";
    mf.readOnly = readOnly;
    // Inline-only fields would suppress it, but a quiz answer is the primary input.
    mf.mathVirtualKeyboardPolicy = readOnly ? "manual" : "auto";
  }, [value, readOnly]);

  useEffect(() => {
    const mf = ref.current;
    if (!mf || readOnly) return;
    const onInput = () => onChange?.(mf.value);
    mf.addEventListener("input", onInput);
    return () => mf.removeEventListener("input", onInput);
  }, [onChange, readOnly]);

  return (
    <div className={`zen-math zen-math-block ${readOnly ? "is-readonly" : ""}`}>
      {createElement("math-field", {
        ref,
        "aria-label": ariaLabel,
        style: { display: "block", width: "100%" },
      })}
    </div>
  );
}
