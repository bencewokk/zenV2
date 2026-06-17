export type Element =
  | { kind: "point"; name: string | null; x: number; y: number }
  | { kind: "function"; term: string }
  | { kind: "line"; a: string; b: string }; // through two named points

/**
 * Parse a geometry/graph spec (one definition per line) into element
 * descriptors. Supported forms:
 *   A = (1, 2)        named point
 *   (3, -1)           anonymous point
 *   y = x^2           function graph
 *   f(x) = sin(x)     function graph
 *   line AB           segment through points A and B
 */
export function parseSpec(spec: string): { elements: Element[]; errors: string[] } {
  const elements: Element[] = [];
  const errors: string[] = [];

  for (const raw of spec.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const named = line.match(/^([A-Za-z]\w*)\s*=\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/);
    if (named) {
      elements.push({ kind: "point", name: named[1], x: +named[2], y: +named[3] });
      continue;
    }

    const anon = line.match(/^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/);
    if (anon) {
      elements.push({ kind: "point", name: null, x: +anon[1], y: +anon[2] });
      continue;
    }

    const lineThrough = line.match(/^line\s+([A-Za-z]\w*)\s*([A-Za-z]\w*)$/i);
    if (lineThrough) {
      elements.push({ kind: "line", a: lineThrough[1], b: lineThrough[2] });
      continue;
    }

    const fn = line.match(/^(?:y|[A-Za-z]\(x\))\s*=\s*(.+)$/);
    if (fn) {
      elements.push({ kind: "function", term: fn[1] });
      continue;
    }

    errors.push(line);
  }

  return { elements, errors };
}
