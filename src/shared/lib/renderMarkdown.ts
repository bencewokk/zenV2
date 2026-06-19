import { marked } from "marked";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Render markdown to HTML with LaTeX math support, for read-only display (AI
 * chat, quiz cards). Math is rendered with KaTeX: `$...$` inline, `$$...$$` (or
 * `\[...\]`) display, `\(...\)` inline. Math is extracted before marked runs so
 * markdown parsing can't mangle backslashes/underscores inside formulae.
 */

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false });
  } catch {
    return display ? `$$${tex}$$` : `$${tex}$`;
  }
}

export function renderMarkdown(src: string): string {
  const slots: string[] = [];
  const stash = (html: string) => `@@ZENMATH${slots.push(html) - 1}@@`;

  let s = src ?? "";
  // Display math first so $$ isn't eaten by the single-$ rule.
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => stash(renderMath(tex, true)));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex) => stash(renderMath(tex, true)));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex) => stash(renderMath(tex, false)));
  s = s.replace(/\$([^$\n]+?)\$/g, (_m, tex) => stash(renderMath(tex, false)));

  let html = marked.parse(s) as string;
  html = html.replace(/@@ZENMATH(\d+)@@/g, (_m, i) => slots[Number(i)] ?? "");
  return html;
}
