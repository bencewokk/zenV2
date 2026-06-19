import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { MocBlockView } from "@/features/notes/MocBlockView";

/** Transaction meta flag that lets us programmatically remove the otherwise-undeletable block. */
export const MOC_ALLOW_REMOVE = "allowMocRemoval";

export function countMocBlocks(doc: PMNode): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === "mocBlock") n += 1;
  });
  return n;
}

/**
 * Map-of-Content block: an in-document block that lists the open note's child
 * notes. It behaves like any other block (draggable, positionable) but a
 * ProseMirror guard forbids deleting it — removal only happens when the MOC
 * flag is toggled off, via a transaction carrying MOC_ALLOW_REMOVE.
 */
export const MocBlock = Node.create({
  name: "mocBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML: () => [{ tag: "div[data-moc]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-moc": "" })],
  renderText: () => "",
  addNodeView: () => ReactNodeViewRenderer(MocBlockView),

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("mocBlockGuard"),
        // Reject any transaction that would drop a MOC block, unless explicitly allowed.
        filterTransaction(tr, state) {
          if (tr.getMeta(MOC_ALLOW_REMOVE) || !tr.docChanged) return true;
          return countMocBlocks(tr.doc) >= countMocBlocks(state.doc);
        },
      }),
    ];
  },
});
