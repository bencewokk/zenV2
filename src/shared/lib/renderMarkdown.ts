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

/**
 * Sanitize model-authored SVG before rendering it inline: keep only the <svg>…</svg>,
 * and strip scripts, event handlers, javascript: URLs, and foreignObject (which can
 * smuggle arbitrary HTML). Diagrams are draw-only — no interactivity needed.
 */
function sanitizeSvg(svg: string): string {
  const m = svg.match(/<svg[\s\S]*<\/svg>/i);
  let out = m ? m[0] : "";
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/javascript:/gi, "");
  return out;
}

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
  // Belt-and-suspenders: strip any <script> the model emitted as raw HTML.
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  html = html.replace(/@@ZENMATH(\d+)@@/g, (_m, i) => slots[Number(i)] ?? "");
  return html;
}
