// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownInline } from "./renderMarkdown";
import { sanitizeSvg } from "./sanitizeSvg";

describe("untrusted rich text", () => {
  it("removes executable HTML while preserving ordinary formatting", () => {
    const html = renderMarkdown('# Hello\n<img src=x onerror="alert(1)"><a href="javascript:alert(2)">bad</a><script>alert(3)</script>');
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).not.toMatch(/onerror|javascript:|<script/i);
  });

  it("sanitizes compact AI-generated labels", () => {
    const html = renderMarkdownInline('<svg onload=alert(1)></svg> **safe**');
    expect(html).toContain("<strong>safe</strong>");
    expect(html).not.toMatch(/onload|alert/i);
  });

  it("removes active content from SVG diagrams", () => {
    const svg = sanitizeSvg('<svg><foreignObject><p>bad</p></foreignObject><circle onload="alert(1)" cx="4" cy="4" r="2"/></svg>');
    expect(svg).toContain("<circle");
    expect(svg).not.toMatch(/foreignObject|onload|alert/i);
  });
});

describe("math rendering", () => {
  const isKatex = (html: string) => /class="katex/.test(html);

  it("renders $$…$$ display and $…$ inline math", () => {
    expect(isKatex(renderMarkdown("$$E = mc^2$$"))).toBe(true);
    expect(isKatex(renderMarkdown("Let $x^2$ be."))).toBe(true);
  });

  it("renders ```math and ```latex fenced blocks as math, not code", () => {
    const math = renderMarkdown("```math\nE = mc^2\n```");
    expect(isKatex(math)).toBe(true);
    expect(math).not.toMatch(/<pre><code/);
    expect(isKatex(renderMarkdown("```latex\n\\int_0^1 x\\,dx\n```"))).toBe(true);
  });

  it("renders bare \\begin{…}\\end{…} display environments without $$ delimiters", () => {
    expect(isKatex(renderMarkdown("\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}"))).toBe(true);
    expect(isKatex(renderMarkdown("\\begin{cases} x & x>0 \\\\ 0 & x\\le 0 \\end{cases}"))).toBe(true);
  });

  it("leaves ordinary code fences as code blocks", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toMatch(/<pre><code/);
    expect(isKatex(html)).toBe(false);
  });
});
