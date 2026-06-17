import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathView } from "@/features/math/MathView";

const latexAttr = {
  latex: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute("data-latex") ?? "",
    renderHTML: (attrs: { latex: string }) => ({ "data-latex": attrs.latex }),
  },
};

/** Block (display) math: $$ ... $$ on its own line. */
export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => latexAttr,
  parseHTML: () => [{ tag: "div[data-math-block]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-math-block": "" })],
  renderText: ({ node }) => `$$${node.attrs.latex}$$`,
  addNodeView: () => ReactNodeViewRenderer(MathView),
  addCommands() {
    return {
      insertMathBlock:
        (latex = "") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});

/** Inline math: $ ... $ within a line of text. */
export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => latexAttr,
  parseHTML: () => [{ tag: "span[data-math-inline]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-math-inline": "" })],
  renderText: ({ node }) => `$${node.attrs.latex}$`,
  addNodeView: () => ReactNodeViewRenderer(MathView),
  addCommands() {
    return {
      insertMathInline:
        (latex = "") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathBlock: { insertMathBlock: (latex?: string) => ReturnType };
    mathInline: { insertMathInline: (latex?: string) => ReturnType };
  }
}
