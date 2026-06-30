import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { SvgView } from "@/features/svg/SvgView";

/** Inline vector graphic block. Raw SVG source persisted in attrs, rendered (sanitized) by the node view. */
export const Svg = Node.create({
  name: "svg",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      svg: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-svg") ?? "",
        renderHTML: (attrs: { svg: string }) => ({ "data-svg": attrs.svg }),
      },
    };
  },

  parseHTML: () => [{ tag: "div[data-svg]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-svg": "" })],
  renderText: ({ node }) => "```svg\n" + node.attrs.svg + "\n```",
  addNodeView: () => ReactNodeViewRenderer(SvgView),

  addCommands() {
    return {
      insertSvg:
        (svg = "") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { svg } }),
    };
  },

  // Pasting raw <svg>…</svg> (as text) drops in an SVG node instead of literal code.
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey("svgPaste"),
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const m = text.match(/<svg[\s\S]*<\/svg>/i);
            if (!m) return false;
            const node = type.create({ svg: m[0] });
            const tr = view.state.tr.replaceSelectionWith(node);
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    svg: { insertSvg: (svg?: string) => ReturnType };
  }
}
