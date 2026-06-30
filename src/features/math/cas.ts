import { ComputeEngine, type BoxedExpression } from "@cortex-js/compute-engine";

/**
 * Thin CAS wrapper over a single lazily-constructed ComputeEngine. Every entry
 * point parses LaTeX, runs symbolic work, and returns LaTeX again — guarded so
 * malformed input never throws into the UI.
 */

export type CasResult = { ok: true; value: string } | { ok: false; error: string };

let _ce: ComputeEngine | null = null;
function engine(): ComputeEngine {
  if (!_ce) _ce = new ComputeEngine();
  return _ce;
}

function parse(latex: string): BoxedExpression {
  return engine().parse(latex);
}

/** Simplify a LaTeX expression, returning LaTeX. */
export function simplify(latex: string): CasResult {
  try {
    const out = parse(latex).simplify().latex;
    return out ? { ok: true, value: out } : { ok: false, error: "Could not simplify" };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Evaluate a LaTeX expression (numeric where possible), returning LaTeX. */
export function evaluate(latex: string): CasResult {
  try {
    const out = parse(latex).evaluate().latex;
    return out ? { ok: true, value: out } : { ok: false, error: "Could not evaluate" };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Decide whether two LaTeX expressions are mathematically equivalent. Tries the
 * symbolic check first; falls back to numeric sampling over a handful of points
 * for the free variables when the symbolic check is inconclusive.
 */
export function isEquivalent(a: string, b: string): CasResult {
  try {
    const ea = parse(a);
    const eb = parse(b);
    const sym = ea.isEqual(eb);
    if (sym === true) return { ok: true, value: "equivalent" };
    // `isEqual` returns false/undefined when it can't settle symbolically; sample.
    const diff = engine().box(["Subtract", ea, eb]);
    const vars = [...new Set(diff.unknowns ?? [])];
    const samples = [-3.1, -1.7, -0.5, 0.5, 1.3, 2.9, 4.2];
    for (let i = 0; i < 6; i++) {
      const scope: Record<string, number> = {};
      vars.forEach((v, k) => (scope[v] = samples[(i + k) % samples.length]));
      const val = diff.subs(scope).N().re;
      if (typeof val !== "number" || !isFinite(val)) continue;
      if (Math.abs(val) > 1e-6) return { ok: true, value: "not equivalent" };
    }
    return { ok: true, value: vars.length ? "equivalent" : "not equivalent" };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Invalid expression";
}
