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
    return { ok: true, value: equivBoxed(parse(a), parse(b)) ? "equivalent" : "not equivalent" };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ── Answer checking (Math Checker) ───────────────────────────────────────────

export type Verdict = "correct" | "equivalent" | "wrong" | "empty" | "unknown";
export interface CheckResult {
  verdict: Verdict;
  /** A short explanation for a wrong answer when we can classify it (best-effort). */
  note?: string;
}

/**
 * Check a student's LaTeX expression against a known target. `correct` = same form,
 * `equivalent` = mathematically equal but written differently, `wrong` = not equal
 * (with a light classification when we can detect a sign flip or constant factor),
 * `empty` = nothing typed yet, `unknown` = no target or unparseable input.
 */
export function checkAnswer(student: string, target: string): CheckResult {
  const s = (student ?? "").trim();
  const t = (target ?? "").trim();
  if (!t) return { verdict: "unknown" };
  if (!s) return { verdict: "empty" };
  try {
    const ce = engine();
    const se = ce.parse(s);
    const te = ce.parse(t);
    if (se.isSame(te)) return { verdict: "correct" };
    if (equivBoxed(se, te)) return { verdict: "equivalent" };
    // Light classification — only claims we can actually verify.
    if (equivBoxed(se, ce.box(["Negate", te])))
      return { verdict: "wrong", note: "Sign error — this is the negation of the expected answer." };
    const k = constantRatio(se, te);
    if (k != null)
      return { verdict: "wrong", note: `Off by a constant factor (×${fmtNum(k)}).` };
    return { verdict: "wrong" };
  } catch {
    return { verdict: "unknown" };
  }
}

// ── Derivation checking (line-by-line working) ───────────────────────────────

export interface DerivationStep {
  /** Verdict for the transition FROM the previous line TO this line. */
  verdict: Verdict;
  note?: string;
}

/**
 * Split a multi-line block equation into its individual lines. MathLive stores
 * multi-row math as `\displaylines{a \\ b}` or an aligned/array environment; we
 * strip the wrapper and split on top-level `\\` (ignoring `\\` nested in braces).
 */
export function splitLines(latex: string): string[] {
  let s = (latex ?? "").trim();
  // Unwrap \displaylines{...}
  const dl = s.match(/^\\displaylines\s*\{([\s\S]*)\}$/);
  if (dl) s = dl[1];
  // Unwrap \begin{env}...\end{env} (aligned / array / cases / matrix variants)
  const env = s.match(/^\\begin\{[a-z*]+\}(?:\{[^}]*\})?([\s\S]*?)\\end\{[a-z*]+\}$/i);
  if (env) s = env[1];

  const lines: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    if (depth === 0 && c === "\\" && s[i + 1] === "\\") {
      lines.push(buf);
      buf = "";
      i++; // consume the second backslash
      continue;
    }
    buf += c;
  }
  lines.push(buf);
  // Drop alignment markers (&) and blank lines.
  return lines.map((l) => l.replace(/&/g, " ").trim()).filter(Boolean);
}

/**
 * Check a derivation: for each consecutive pair of lines, decide whether the lower
 * line follows from (is equivalent to) the one above. Returns one step per line; the
 * first line has no incoming step (verdict "unknown"). A wrong step carries the same
 * sign/factor classification as a single answer check.
 */
export function checkDerivation(latex: string): { lines: string[]; steps: DerivationStep[] } {
  const lines = splitLines(latex);
  const steps: DerivationStep[] = lines.map(() => ({ verdict: "unknown" as Verdict }));
  for (let i = 1; i < lines.length; i++) {
    const r = checkAnswer(lines[i], lines[i - 1]);
    steps[i] = { verdict: r.verdict, note: r.note };
  }
  return { lines, steps };
}

// ── Numeric helpers ──────────────────────────────────────────────────────────

const SAMPLES = [-3.1, -1.7, -0.5, 0.7, 1.3, 2.9, 4.2];

function freeVars(...exprs: BoxedExpression[]): string[] {
  const set = new Set<string>();
  for (const e of exprs) for (const v of e.unknowns ?? []) set.add(v);
  return [...set];
}

function scopeAt(vars: string[], i: number): Record<string, number> {
  const scope: Record<string, number> = {};
  vars.forEach((v, k) => (scope[v] = SAMPLES[(i + k) % SAMPLES.length]));
  return scope;
}

/** Numeric value of an expression at a sample point, or NaN if it doesn't resolve. */
function numAt(expr: BoxedExpression, scope: Record<string, number>): number {
  const v = expr.subs(scope).N().re;
  return typeof v === "number" ? v : NaN;
}

/** Symbolic-first, numeric-fallback equality over the union of free variables. */
function equivBoxed(a: BoxedExpression, b: BoxedExpression): boolean {
  if (a.isEqual(b) === true) return true;
  const vars = freeVars(a, b);
  let compared = 0;
  for (let i = 0; i < 7; i++) {
    const scope = scopeAt(vars, i);
    const da = numAt(a, scope);
    const db = numAt(b, scope);
    if (!isFinite(da) || !isFinite(db)) continue; // skip domain holes
    compared++;
    if (Math.abs(da - db) > 1e-6 * (1 + Math.abs(db))) return false;
    if (!vars.length) break; // constants: one comparison settles it
  }
  return compared > 0; // equal at every point we could evaluate
}

/** If a/b is the same nonzero constant (≠1) at every sample point, return it; else null. */
function constantRatio(a: BoxedExpression, b: BoxedExpression): number | null {
  const vars = freeVars(a, b);
  const ratios: number[] = [];
  for (let i = 0; i < 7; i++) {
    const scope = scopeAt(vars, i);
    const da = numAt(a, scope);
    const db = numAt(b, scope);
    if (!isFinite(da) || !isFinite(db) || Math.abs(db) < 1e-9) continue;
    ratios.push(da / db);
    if (!vars.length) break;
  }
  if (ratios.length < 2) return null;
  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  if (!isFinite(mean) || Math.abs(mean - 1) < 1e-6 || Math.abs(mean) < 1e-9) return null;
  const consistent = ratios.every((r) => Math.abs(r - mean) < 1e-6 * (1 + Math.abs(mean)));
  return consistent ? mean : null;
}

/** Render a numeric factor compactly: integers and simple values stay clean. */
function fmtNum(n: number): string {
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 1e-9) return String(rounded);
  return Number(n.toFixed(4)).toString();
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Invalid expression";
}
