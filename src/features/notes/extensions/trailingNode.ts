import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Guarantees the document always ends with an empty paragraph, so there is
 * always a place to click/type after a trailing atom block (e.g. math).
 */
export const TrailingNode = Extension.create({
  name: "trailingNode",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("trailingNode"),
        appendTransaction(_tr, _old, state) {
          const last = state.doc.lastChild;
          if (last && last.type.name === "paragraph") return null;
          const paragraph = state.schema.nodes.paragraph;
          if (!paragraph) return null;
          return state.tr.insert(state.doc.content.size, paragraph.create());
        },
      }),
    ];
  },
});
