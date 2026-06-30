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

    // Equations: compare SOLUTION SETS, not surface form. Two equations are equivalent
    // when (lhs−rhs) of one is a nonzero constant multiple of the other's — i.e. you
    // scaled both sides (incl. ×−1) or moved terms across. So `5x=12` ≡ `15x=36`.
    const sd = eqDiff(se);
    const td = eqDiff(te);
    if (sd && td) {
      // Definitive when both lines are single-variable: compare REAL solution sets by
      // numeric root-finding on the compiled difference. Handles transcendental/sqrt/
      // rational steps, and catches both lost roots (x²=9→x=3) and extraneous roots
      // (squaring). Only act on it when both sides actually produced roots — so a missed
      // root never turns into a false error.
      const ra = equationRoots(se);
      const rb = equationRoots(te);
      if (ra && rb && ra.length && rb.length)
        return sameSet(ra, rb)
          ? { verdict: "equivalent" }
          : { verdict: "wrong", note: "Different solutions from the line above." };
      // Sound fallback: scaling/rearranging both sides (incl. ×−1) preserves solutions.
      if (equivBoxed(sd, td) || constantRatio(sd, td) != null) return { verdict: "equivalent" };
      // Can't confirm or refute — stay neutral rather than flag a false error.
      return { verdict: "unknown", note: "Couldn't auto-verify this step." };
    }
    if (sd || td) return { verdict: "wrong", note: "One line is an equation and the other isn't." };

    // Plain expressions.
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

/** If `expr` is an equation (a = b), return its difference (a − b); else null. */
function eqDiff(expr: BoxedExpression): BoxedExpression | null {
  if (expr.operator !== "Equal" || expr.nops < 2) return null;
  return engine().box(["Subtract", expr.op1, expr.op2]);
}

/**
 * Real solution set of a single-variable equation, found numerically: compile its
 * difference to a fast JS function and scan for sign-changes (+ tangent/local-min roots)
 * over a bounded range. Returns null for multi-variable or uncompilable equations.
 * Robust where the symbolic solver isn't (sqrt/log/exp/rational), and finds the same
 * set regardless of surface form — so comparing two sets detects lost/extra solutions.
 */
function equationRoots(expr: BoxedExpression): number[] | null {
  const vars = [...new Set(expr.unknowns ?? [])];
  if (vars.length !== 1) return null;
  const f = compileDiff(eqDiff(expr) ?? expr, vars[0]);
  return f ? numericRoots(f) : null;
}

const ROOT_LO = -60;
const ROOT_HI = 60;
const ROOT_STEP = 0.05;

/** A compiled `(x:number)=>number` for an expression, cached by its canonical LaTeX. */
const compileCache = new Map<string, ((x: number) => number) | null>();
function compileDiff(diff: BoxedExpression, varName: string): ((x: number) => number) | null {
  const key = `${varName}::${diff.latex}`;
  if (compileCache.has(key)) return compileCache.get(key)!;
  let fn: ((x: number) => number) | null = null;
  try {
    const compiled = diff.compile();
    fn = (x: number) => {
      try {
        const v = compiled({ [varName]: x });
        return typeof v === "number" ? v : NaN;
      } catch {
        return NaN;
      }
    };
  } catch {
    fn = null;
  }
  if (compileCache.size > 256) compileCache.clear();
  compileCache.set(key, fn);
  return fn;
}

function bisect(f: (x: number) => number, a: number, b: number): number | null {
  let fa = f(a);
  let fb = f(b);
  if (!isFinite(fa) || !isFinite(fb) || fa * fb > 0) return null;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (!isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-10 || b - a < 1e-10) return m;
    if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  return (a + b) / 2;
}

/** Minimize |f| on [a,b] (ternary search) — finds tangent/double roots a sign scan misses. */
function minAbs(f: (x: number) => number, a: number, b: number): number | null {
  for (let i = 0; i < 50; i++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (Math.abs(f(m1)) < Math.abs(f(m2))) b = m2; else a = m1;
  }
  const m = (a + b) / 2;
  return isFinite(f(m)) ? m : null;
}

function numericRoots(f: (x: number) => number): number[] {
  const out: number[] = [];
  const add = (r: number | null) => {
    if (r == null || !isFinite(r) || Math.abs(f(r)) > 1e-6) return;
    if (!out.some((o) => Math.abs(o - r) < 1e-4)) out.push(r);
  };
  let p2 = NaN;
  let p1 = f(ROOT_LO);
  for (let x = ROOT_LO + ROOT_STEP; x <= ROOT_HI + 1e-9; x += ROOT_STEP) {
    const cur = f(x);
    if (isFinite(p1) && isFinite(cur)) {
      if (p1 === 0) add(x - ROOT_STEP);
      if (p1 * cur < 0) {
        // A sign change is a root only if f→0 there (a pole would jump through ±∞).
        const r = bisect(f, x - ROOT_STEP, x);
        if (r != null && Math.abs(f(r)) < 1e-6) add(r);
      } else if (Math.abs(cur) < 1e-7) {
        add(x);
      } else if (isFinite(p2) && Math.abs(p1) < 1e-2 && Math.abs(p1) <= Math.abs(p2) && Math.abs(p1) <= Math.abs(cur)) {
        // Local min of |f| near zero → likely a tangent (double) root.
        add(minAbs(f, x - 2 * ROOT_STEP, x));
      }
    }
    p2 = p1;
    p1 = cur;
  }
  return out.map((r) => Number(r.toFixed(6))).sort((a, b) => a - b);
}

/** Two solution sets equal within tolerance. */
function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => Math.abs(x - b[i]) < 1e-4 * (1 + Math.abs(b[i])));
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
