import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { GeometryView } from "@/features/geometry/GeometryView";

/** Interactive geometry/graph block backed by JSXGraph; spec persisted in attrs. */
export const Geometry = Node.create({
  name: "geometry",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      spec: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-spec") ?? "",
        renderHTML: (attrs: { spec: string }) => ({ "data-spec": attrs.spec }),
      },
    };
  },

  parseHTML: () => [{ tag: "div[data-geometry]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-geometry": "" })],
  renderText: () => "[geometry]",
  addNodeView: () => ReactNodeViewRenderer(GeometryView),

  addCommands() {
    return {
      insertGeometry:
        (spec = "") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { spec } }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    geometry: { insertGeometry: (spec?: string) => ReturnType };
  }
}
