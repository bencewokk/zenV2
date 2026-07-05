import DOMPurify from "dompurify";

/** Sanitize untrusted rich text before it reaches `dangerouslySetInnerHTML`. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    FORBID_TAGS: ["base", "embed", "form", "iframe", "object", "script", "style"],
    FORBID_ATTR: ["srcdoc"],
  });
}
