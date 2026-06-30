/**
 * Sanitize authored SVG before rendering it inline: keep only the <svg>…</svg>,
 * and strip scripts, event handlers, javascript: URLs, and foreignObject (which
 * can smuggle arbitrary HTML). Diagrams are draw-only — no interactivity needed.
 *
 * Shared by the read-only markdown renderer and the editor's SVG node so both
 * apply the exact same allow-list.
 */
export function sanitizeSvg(svg: string): string {
  const m = svg.match(/<svg[\s\S]*<\/svg>/i);
  let out = m ? m[0] : "";
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/javascript:/gi, "");
  return out;
}
