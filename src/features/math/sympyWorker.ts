/// <reference lib="webworker" />

import { loadPyodide, version, type PyodideAPI } from "pyodide";
import type { SympyRequest, SympyResponse } from "@/features/math/sympyTypes";

declare const self: DedicatedWorkerGlobalScope;

const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

let pyodidePromise: Promise<PyodideAPI> | null = null;
let ready = false;

function post(response: SympyResponse): void {
  self.postMessage(response);
}

async function runtime(): Promise<PyodideAPI> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const pyodide = await loadPyodide({
        indexURL: PYODIDE_BASE,
        packageBaseUrl: PYODIDE_BASE,
      });
      await pyodide.loadPackage("sympy");
      await pyodide.runPythonAsync(PY_SETUP);
      ready = true;
      return pyodide;
    })();
  }
  return pyodidePromise;
}

self.onmessage = (event: MessageEvent<SympyRequest>) => {
  const request = event.data;
  void handle(request);
};

async function handle(request: SympyRequest): Promise<void> {
  if (request.op === "status" && ready) {
    post({ id: request.id, ok: true, value: "ready" });
    return;
  }
  try {
    const pyodide = await runtime();
    if (request.op === "status") {
      post({ id: request.id, ok: true, value: "ready" });
      return;
    }
    pyodide.globals.set("ZEN_SYMPY_PAYLOAD", JSON.stringify(request));
    const raw = await pyodide.runPythonAsync("zen_sympy_handle(ZEN_SYMPY_PAYLOAD)");
    const payload = JSON.parse(String(raw)) as Omit<SympyResponse, "id">;
    post({ id: request.id, ...payload } as SympyResponse);
  } catch (error) {
    post({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "SymPy failed",
    });
  }
}

const PY_SETUP = String.raw`
import json
import re
import sympy as sp
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
)

try:
    from sympy.parsing.latex import parse_latex
except Exception:
    parse_latex = None

TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)

def _balanced(s, start):
    if start >= len(s) or s[start] != "{":
        return None, start
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                return s[start + 1:i], i + 1
    return None, start

def _replace_command_two_args(s, command, fmt):
    while command in s:
        i = s.find(command)
        a, j = _balanced(s, i + len(command))
        if a is None:
            break
        b, k = _balanced(s, j)
        if b is None:
            break
        s = s[:i] + fmt(_latex_to_sympy_text(a), _latex_to_sympy_text(b)) + s[k:]
    return s

def _replace_command_one_arg(s, command, fmt):
    while command in s:
        i = s.find(command)
        a, j = _balanced(s, i + len(command))
        if a is None:
            break
        s = s[:i] + fmt(_latex_to_sympy_text(a)) + s[j:]
    return s

def _latex_to_sympy_text(src):
    s = (src or "").strip()
    s = s.replace("\\left", "").replace("\\right", "")
    s = s.replace("\\,", "").replace("\\;", "").replace("\\:", "")
    s = _replace_command_two_args(s, "\\frac", lambda a, b: f"(({a})/({b}))")
    s = _replace_command_one_arg(s, "\\sqrt", lambda a: f"sqrt({a})")
    replacements = {
        "\\cdot": "*",
        "\\times": "*",
        "\\pi": "pi",
        "\\theta": "theta",
        "\\alpha": "alpha",
        "\\beta": "beta",
        "\\gamma": "gamma",
        "\\Delta": "Delta",
        "\\sin": "sin",
        "\\cos": "cos",
        "\\tan": "tan",
        "\\sec": "sec",
        "\\csc": "csc",
        "\\cot": "cot",
        "\\ln": "log",
        "\\log": "log",
        "\\exp": "exp",
    }
    for k, v in replacements.items():
        s = s.replace(k, v)
    s = re.sub(r"([A-Za-z]+)\s*\{([^{}]+)\}", r"\1(\2)", s)
    s = s.replace("{", "(").replace("}", ")")
    s = s.replace("^", "**")
    s = s.replace("=", "-(") + ")" if "=" in s and not s.strip().startswith("Eq(") else s
    return s

def _parse(src):
    raw = (src or "").strip()
    if not raw:
        raise ValueError("empty expression")
    if parse_latex is not None:
        try:
            return parse_latex(raw)
        except Exception:
            pass
    text = _latex_to_sympy_text(raw)
    return parse_expr(text, transformations=TRANSFORMS, evaluate=False)

def _expr(src):
    return sp.simplify(_parse(src))

def _to_latex(expr):
    try:
        return sp.latex(expr)
    except Exception:
        return str(expr)

def _free_symbols(*exprs):
    out = set()
    for expr in exprs:
        out |= set(expr.free_symbols)
    return sorted(out, key=lambda x: x.name)

def _equivalent(a, b):
    ea = _expr(a)
    eb = _expr(b)
    try:
        diff = sp.simplify(ea - eb)
        if diff == 0:
            return True
    except Exception:
        pass
    symbols = _free_symbols(ea, eb)
    if not symbols:
        return bool(sp.N(ea) == sp.N(eb))
    samples = [-3, -1, 0, 1, 2, 5]
    compared = 0
    for base in samples:
        subs = {sym: base + i for i, sym in enumerate(symbols)}
        try:
            va = complex(sp.N(ea.subs(subs)))
            vb = complex(sp.N(eb.subs(subs)))
        except Exception:
            continue
        compared += 1
        if abs(va - vb) > 1e-7 * (1 + abs(vb)):
            return False
    return compared > 0

def _constant_ratio(a, b):
    ea = _expr(a)
    eb = _expr(b)
    symbols = _free_symbols(ea, eb)
    samples = [-3, -1, 1, 2, 5]
    ratios = []
    for base in samples:
        subs = {sym: base + i for i, sym in enumerate(symbols)}
        try:
            den = complex(sp.N(eb.subs(subs)))
            if abs(den) < 1e-9:
                continue
            ratios.append(complex(sp.N(ea.subs(subs))) / den)
        except Exception:
            continue
    if len(ratios) < 2:
        return None
    mean = sum(ratios) / len(ratios)
    if abs(mean - 1) < 1e-7 or abs(mean) < 1e-9:
        return None
    if all(abs(r - mean) < 1e-7 * (1 + abs(mean)) for r in ratios):
        return float(mean.real) if abs(mean.imag) < 1e-9 else None
    return None

def _check_answer(student, target):
    s = (student or "").strip()
    t = (target or "").strip()
    if not t:
        return {"verdict": "unknown"}
    if not s:
        return {"verdict": "empty"}
    try:
        if s == t:
            return {"verdict": "correct"}
        if _equivalent(s, t):
            return {"verdict": "equivalent", "note": "Verified by SymPy."}
        if _equivalent(s, "-(" + t + ")"):
            return {"verdict": "wrong", "note": "Sign error - SymPy says this is the negation of the expected answer."}
        ratio = _constant_ratio(s, t)
        if ratio is not None:
            return {"verdict": "wrong", "note": "Off by a constant factor (x" + format(ratio, ".4g") + ")."}
        return {"verdict": "wrong"}
    except Exception as exc:
        return {"verdict": "unknown", "note": str(exc)}

def _split_lines(latex):
    s = (latex or "").strip()
    m = re.match(r"^\\displaylines\s*\{([\s\S]*)\}$", s)
    if m:
        s = m.group(1)
    depth = 0
    out = []
    buf = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth = max(0, depth - 1)
        if depth == 0 and c == "\\" and i + 1 < len(s) and s[i + 1] == "\\":
            line = "".join(buf).replace("&", " ").strip()
            if line:
                out.append(line)
            buf = []
            i += 2
            continue
        buf.append(c)
        i += 1
    line = "".join(buf).replace("&", " ").strip()
    if line:
        out.append(line)
    return out

def _check_derivation(latex):
    lines = _split_lines(latex)
    steps = [{"verdict": "unknown"} for _ in lines]
    for i in range(1, len(lines)):
        steps[i] = _check_answer(lines[i], lines[i - 1])
    return {"lines": lines, "steps": steps}

def zen_sympy_handle(payload_json):
    payload = json.loads(payload_json)
    op = payload.get("op")
    try:
        if op == "simplify":
            return json.dumps({"ok": True, "value": _to_latex(sp.simplify(_parse(payload.get("latex", ""))))})
        if op == "evaluate":
            return json.dumps({"ok": True, "value": _to_latex(sp.N(_parse(payload.get("latex", ""))))})
        if op == "equivalent":
            return json.dumps({"ok": True, "value": "equivalent" if _equivalent(payload.get("student", ""), payload.get("target", "")) else "not equivalent"})
        if op == "checkAnswer":
            return json.dumps({"ok": True, "value": _check_answer(payload.get("student", ""), payload.get("target", ""))})
        if op == "checkDerivation":
            return json.dumps({"ok": True, "value": _check_derivation(payload.get("latex", ""))})
        return json.dumps({"ok": False, "error": "Unknown SymPy op"})
    except Exception as exc:
        return json.dumps({"ok": False, "error": str(exc)})
`;
