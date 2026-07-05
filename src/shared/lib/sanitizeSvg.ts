import DOMPurify from "dompurify";

/**
 * Sanitize authored SVG before rendering it inline: keep only the <svg>…</svg>,
 * and strip scripts, event handlers, javascript: URLs, and foreignObject (which
 * can smuggle arbitrary HTML). Diagrams are draw-only — no interactivity needed.
 *
 * Shared by the read-only markdown renderer and the editor's SVG node so both
 * apply the exact same allow-list.
 */
export function sanitizeSvg(svg: string): string {
  const match = svg.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return "";
  return DOMPurify.sanitize(match[0], {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script", "style"],
  });
}
