import { marked } from "marked";
import type { JSONContent } from "@tiptap/react";

/**
 * Convert a markdown string into a TipTap document matching the editor's
 * StarterKit schema (headings, bold/italic/strike/code, lists, blockquotes,
 * code blocks, rules). The AI writes notes in markdown; without this the text
 * would be stored as literal `#`/`**` characters and never render as formatting.
 *
 * Uses marked's tokenizer (no DOM) so it runs anywhere. Markdown links collapse
 * to their visible text since the editor schema has no link mark.
 */

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Token = any;

function textNode(text: string, marks: Mark[]): JSONContent {
  const node: JSONContent = { type: "text", text };
  if (marks.length) node.marks = marks.map((m) => ({ ...m }));
  return node;
}

function pushText(out: JSONContent[], text: string | undefined, marks: Mark[]) {
  if (text) out.push(textNode(text, marks)); // ProseMirror forbids empty text nodes
}

/** Split a text run on `$...$`, emitting inline math nodes between text. */
function pushInline(out: JSONContent[], text: string | undefined, marks: Mark[]) {
  if (!text) return;
  const re = /\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) pushText(out, text.slice(last, m.index), marks);
    out.push({ type: "mathInline", attrs: { latex: m[1].trim() } });
    last = re.lastIndex;
  }
  if (last < text.length) pushText(out, text.slice(last), marks);
}

/** Flatten inline tokens into text nodes, carrying active marks down recursively. */
function inlineTokens(tokens: Token[] | undefined, marks: Mark[] = []): JSONContent[] {
  if (!tokens) return [];
  const out: JSONContent[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "strong":
        out.push(...inlineTokens(t.tokens, [...marks, { type: "bold" }]));
        break;
      case "em":
        out.push(...inlineTokens(t.tokens, [...marks, { type: "italic" }]));
        break;
      case "del":
        out.push(...inlineTokens(t.tokens, [...marks, { type: "strike" }]));
        break;
      case "codespan":
        pushText(out, t.text, [...marks, { type: "code" }]);
        break;
      case "br":
        out.push({ type: "hardBreak" });
        break;
      case "link":
      case "text":
      case "escape":
      case "html":
        if (t.tokens?.length) out.push(...inlineTokens(t.tokens, marks));
        else pushInline(out, t.text, marks);
        break;
      default:
        if (t.tokens?.length) out.push(...inlineTokens(t.tokens, marks));
        else pushInline(out, t.text, marks);
    }
  }
  return out;
}

function listItemContent(item: Token): JSONContent[] {
  const content = blockTokens(item.tokens ?? []);
  return content.length ? content : [{ type: "paragraph" }];
}

/** Map block-level tokens to TipTap block nodes. */
function blockTokens(tokens: Token[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading":
        out.push({ type: "heading", attrs: { level: Math.min(6, t.depth || 1) }, content: inlineTokens(t.tokens) });
        break;
      case "paragraph": {
        // A paragraph that is only display math → a math block.
        const bm = (t.text ?? "").trim().match(/^(?:\$\$|\\\[)([\s\S]+?)(?:\$\$|\\\])$/);
        if (bm) { out.push({ type: "mathBlock", attrs: { latex: bm[1].trim() } }); break; }
        out.push({ type: "paragraph", content: inlineTokens(t.tokens) });
        break;
      }
      case "text":
        out.push({ type: "paragraph", content: t.tokens ? inlineTokens(t.tokens) : (t.text ? [textNode(t.text, [])] : []) });
        break;
      case "blockquote":
        out.push({ type: "blockquote", content: blockTokens(t.tokens) });
        break;
      case "list": {
        const node: JSONContent = {
          type: t.ordered ? "orderedList" : "bulletList",
          content: (t.items ?? []).map((it: Token) => ({ type: "listItem", content: listItemContent(it) })),
        };
        if (t.ordered && typeof t.start === "number" && t.start !== 1) node.attrs = { start: t.start };
        out.push(node);
        break;
      }
      case "code":
        // ```svg fences become rendered SVG nodes, mirroring the read-only renderer.
        if ((t.lang ?? "").toLowerCase() === "svg") {
          out.push({ type: "svg", attrs: { svg: t.text ?? "" } });
          break;
        }
        out.push({ type: "codeBlock", attrs: t.lang ? { language: t.lang } : {}, content: t.text ? [textNode(t.text, [])] : [] });
        break;
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "space":
      case "html":
        break; // ignore blank lines and raw HTML blocks
      default:
        if (t.tokens) out.push(...blockTokens(t.tokens));
    }
  }
  return out;
}

/** Parse markdown into a TipTap doc; always returns at least one block. */
export function mdToDoc(markdown: string): JSONContent {
  const src = (markdown ?? "").replace(/\r\n/g, "\n");
  let content: JSONContent[] = [];
  try {
    content = blockTokens(marked.lexer(src) as Token[]);
  } catch {
    content = [];
  }
  if (!content.length) content = [{ type: "paragraph" }];
  return { type: "doc", content };
}
