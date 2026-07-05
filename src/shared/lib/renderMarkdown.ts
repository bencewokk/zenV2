import { marked } from "marked";
import katex from "katex";
import "katex/dist/katex.min.css";
import { sanitizeSvg } from "@/shared/lib/sanitizeSvg";
import { sanitizeHtml } from "@/shared/lib/sanitizeHtml";

/**
 * Render markdown to HTML with LaTeX math support, for read-only display (AI
 * chat, quiz cards). Math is rendered with KaTeX: `$...$` inline, `$$...$$` (or
 * `\[...\]`) display, `\(...\)` inline. Math is extracted before marked runs so
 * markdown parsing can't mangle backslashes/underscores inside formulae.
 */

/** Render a single LaTeX expression to HTML via KaTeX (shared with the math workspace). */
export function renderLatex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false });
  } catch {
    return display ? `$$${tex}$$` : `$${tex}$`;
  }
}

const renderMath = renderLatex;

export function renderMarkdown(src: string): string {
  const slots: string[] = [];
  const stash = (html: string) => `@@ZENMATH${slots.push(html) - 1}@@`;

  let s = src ?? "";
  // Stash ```svg fenced diagrams first (sanitized) so their text/coords aren't
  // mangled by markdown or the math rules.
  s = s.replace(/```svg\s*\n?([\s\S]*?)```/gi, (_m, svg) => {
    const clean = sanitizeSvg(String(svg).trim());
    return clean ? stash(`<div class="zen-svg">${clean}</div>`) : "";
  });
  // Display math first so $$ isn't eaten by the single-$ rule.
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => stash(renderMath(tex, true)));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex) => stash(renderMath(tex, true)));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex) => stash(renderMath(tex, false)));
  s = s.replace(/\$([^$\n]+?)\$/g, (_m, tex) => stash(renderMath(tex, false)));

  let html = marked.parse(s) as string;
  html = html.replace(/@@ZENMATH(\d+)@@/g, (_m, i) => slots[Number(i)] ?? "");
  return sanitizeHtml(html);
}

/** Inline variant used inside compact labels and list rows. */
export function renderMarkdownInline(src: string): string {
  return sanitizeHtml(marked.parseInline(src ?? "") as string);
}
