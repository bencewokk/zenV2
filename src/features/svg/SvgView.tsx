import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { sanitizeSvg } from "@/shared/lib/sanitizeSvg";

/**
 * Node view for an inline SVG block. Toggles between a sanitized preview and a
 * raw-source editor. The unsanitized source is kept in the node attr; sanitizing
 * happens only at render time so editing never loses content.
 */
export function SvgView({ node, updateAttributes, selected }: NodeViewProps) {
  const svg: string = node.attrs.svg ?? "";
  const [editing, setEditing] = useState(() => !svg.trim());
  const clean = sanitizeSvg(svg);

  return (
    <NodeViewWrapper
      className={`zen-svg-node ${selected ? "is-selected" : ""}`}
      onDoubleClick={() => setEditing(true)}
    >
      {editing ? (
        <div className="zen-svg-edit">
          <textarea
            className="zen-svg-source"
            value={svg}
            autoFocus
            spellCheck={false}
            placeholder="Paste or write SVG markup — <svg …>…</svg>"
            onChange={(e) => updateAttributes({ svg: e.target.value })}
          />
          <button
            type="button"
            className="zen-svg-done"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(false)}
          >
            Done
          </button>
        </div>
      ) : clean ? (
        <div
          className="zen-svg"
          title="Double-click to edit"
          dangerouslySetInnerHTML={{ __html: clean }}
        />
      ) : (
        <div className="zen-svg-empty" onClick={() => setEditing(true)}>
          Empty SVG — click to add markup
        </div>
      )}
    </NodeViewWrapper>
  );
}
