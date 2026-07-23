import { useState } from "react";
import { MathField } from "@/features/math/MathField";
import { simplify, evaluate, type CasResult } from "@/features/math/cas";
import { Checkbox } from "@/shared/ui/Checkbox";

/**
 * Self-contained LaTeX scratch workspace: compose math in the same MathLive field
 * the notes editor uses (so entry/rendering is identical everywhere), optionally
 * run CAS simplify/evaluate, and insert the expression into the host's active
 * answer field via `onInsert`. No quiz/lesson coupling beyond that callback.
 */
export function MathWorkspace({
  onInsert,
  onClose,
}: {
  onInsert?: (latex: string) => void;
  onClose?: () => void;
}) {
  const [latex, setLatex] = useState("");
  const [casOn, setCasOn] = useState(false);
  const [result, setResult] = useState<CasResult | null>(null);

  // CAS results that are LaTeX get rendered in a read-only field; verdict strings
  // ("equivalent") are shown as plain text.
  const resultLatex =
    result?.ok && result.value !== "equivalent" && result.value !== "not equivalent"
      ? result.value
      : null;

  return (
    <div className="zen-math-ws">
      <div className="zen-math-ws-head">
        <span className="zen-math-ws-title">Math scratch</span>
        {onClose && (
          <button type="button" className="zen-math-ws-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      <MathField
        value={latex}
        onChange={(v) => {
          setLatex(v);
          setResult(null);
        }}
        ariaLabel="Math scratch input"
      />

      <Checkbox
        checked={casOn}
        onCheckedChange={setCasOn}
        label="CAS check"
        className="zen-math-ws-toggle"
      />

      {casOn && (
        <div className="zen-math-ws-cas">
          <div className="zen-math-ws-btns">
            <button type="button" onClick={() => setResult(simplify(latex))}>
              Simplify
            </button>
            <button type="button" onClick={() => setResult(evaluate(latex))}>
              Evaluate
            </button>
          </div>
          {result &&
            (result.ok ? (
              resultLatex ? (
                <div className="zen-math-ws-result">
                  <MathField value={resultLatex} readOnly ariaLabel="CAS result" />
                </div>
              ) : (
                <div className="zen-math-ws-result">{result.value}</div>
              )
            ) : (
              <div className="zen-math-ws-err">{result.error}</div>
            ))}
        </div>
      )}

      <div className="zen-math-ws-actions">
        {onInsert && (
          <button
            type="button"
            className="zen-math-ws-insert"
            disabled={!latex.trim()}
            onClick={() => onInsert(latex.trim())}
          >
            Insert into answer
          </button>
        )}
        <button
          type="button"
          className="zen-math-ws-copy"
          disabled={!latex.trim()}
          onClick={() => void navigator.clipboard?.writeText(latex.trim())}
        >
          Copy LaTeX
        </button>
      </div>
    </div>
  );
}
