import { useMemo, useState } from "react";
import { renderLatex } from "@/shared/lib/renderMarkdown";
import { simplify, evaluate, type CasResult } from "@/features/math/cas";

/**
 * Self-contained LaTeX scratch workspace: type LaTeX, see a live KaTeX preview,
 * optionally run CAS simplify/evaluate, and insert the expression into the host's
 * active answer field via `onInsert`. No quiz/lesson coupling beyond that callback.
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

  const previewHtml = useMemo(
    () => (latex.trim() ? renderLatex(latex, true) : ""),
    [latex]
  );

  const resultHtml = useMemo(() => {
    if (!result || !result.ok) return "";
    if (result.value === "equivalent" || result.value === "not equivalent") return "";
    return renderLatex(result.value, true);
  }, [result]);

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

      <textarea
        className="zen-math-ws-input"
        value={latex}
        spellCheck={false}
        placeholder="Type LaTeX… e.g. \frac{d}{dx}x^2"
        onChange={(e) => {
          setLatex(e.target.value);
          setResult(null);
        }}
      />

      <div className="zen-math-ws-preview">
        {previewHtml ? (
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : (
          <span className="zen-math-ws-dim">Preview appears here</span>
        )}
      </div>

      <label className="zen-math-ws-toggle">
        <input type="checkbox" checked={casOn} onChange={(e) => setCasOn(e.target.checked)} />
        CAS check
      </label>

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
              resultHtml ? (
                <div className="zen-math-ws-result" dangerouslySetInnerHTML={{ __html: resultHtml }} />
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
