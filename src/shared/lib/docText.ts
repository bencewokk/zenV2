import type { JSONContent } from "@tiptap/react";

/** Flatten a TipTap doc to plain text (newline per block). */
export function docToText(doc: JSONContent | null): string {
  if (!doc) return "";
  const lines: string[] = [];
  const walk = (node: JSONContent, into: string[]) => {
    if (node.text) into.push(node.text);
    for (const c of node.content ?? []) walk(c, into);
  };
  const blockTypes = new Set(["paragraph", "heading", "listItem", "tableRow", "blockquote"]);
  const visit = (node: JSONContent) => {
    if (blockTypes.has(node.type ?? "")) {
      const parts: string[] = [];
      walk(node, parts);
      lines.push(parts.join(" "));
    } else {
      for (const c of node.content ?? []) visit(c);
    }
  };
  visit(doc);
  return lines.filter(Boolean).join("\n");
}
