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
