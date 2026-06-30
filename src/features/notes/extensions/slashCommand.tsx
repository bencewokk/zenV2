import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { Editor, Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance } from "tippy.js";
import { useEffect, useImperativeHandle, useState, useRef, forwardRef } from "react";

interface Cmd {
  title: string;
  hint: string;
  keywords: string;
  run: (editor: Editor, range: Range) => void;
}

const COMMANDS: Cmd[] = [
  { title: "Heading 1", hint: "Big section title", keywords: "h1 title",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run() },
  { title: "Heading 2", hint: "Medium title", keywords: "h2 subtitle",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run() },
  { title: "Heading 3", hint: "Small title", keywords: "h3",
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run() },
  { title: "Bullet list", hint: "• item", keywords: "ul unordered bullet",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: "Numbered list", hint: "1. item", keywords: "ol ordered number",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: "Math block", hint: "Display equation", keywords: "math equation latex formula",
    run: (e, r) => e.chain().focus().deleteRange(r).insertMathBlock("").run() },
  { title: "Inline math", hint: "Math within text", keywords: "math inline latex formula",
    run: (e, r) => e.chain().focus().deleteRange(r).insertMathInline("").run() },
  { title: "Geometry", hint: "Interactive construction", keywords: "geometry graph plot geogebra point line circle jsxgraph",
    run: (e, r) => e.chain().focus().deleteRange(r).insertGeometry("").run() },
  { title: "SVG", hint: "Inline vector graphic", keywords: "svg image vector diagram draw graphic",
    run: (e, r) => e.chain().focus().deleteRange(r).insertSvg("").run() },
  { title: "Table", hint: "3×3 grid", keywords: "table grid",
    run: (e, r) => e.chain().focus().deleteRange(r)
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: "Quote", hint: "Block quote", keywords: "blockquote",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: "Code block", hint: "Monospace block", keywords: "code pre",
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: "Divider", hint: "Horizontal rule", keywords: "hr divider line",
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
];

interface ListProps {
  items: Cmd[];
  command: (cmd: Cmd) => void;
}

const CommandList = forwardRef<{ onKeyDown: (p: { event: KeyboardEvent }) => boolean }, ListProps>(
  (props, ref) => {
    const [sel, setSel] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => setSel(0), [props.items]);
    // keep the highlighted item scrolled into view during arrow navigation
    useEffect(() => {
      listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
    }, [sel]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSel((s) => (s + props.items.length - 1) % props.items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSel((s) => (s + 1) % props.items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = props.items[sel];
          if (item) props.command(item);
          return true;
        }
        return false;
      },
    }));

    if (!props.items.length) return null;
    return (
      <div className="zen-slash" ref={listRef}>
        {props.items.map((item, i) => (
          <button
            key={item.title}
            className={`zen-slash-item${i === sel ? " is-sel" : ""}`}
            onMouseEnter={() => setSel(i)}
            onClick={() => props.command(item)}
          >
            <span className="zen-slash-title">{item.title}</span>
            <span className="zen-slash-hint">{item.hint}</span>
          </button>
        ))}
      </div>
    );
  }
);
CommandList.displayName = "CommandList";

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<Cmd>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        startOfLine: false,
        command: ({ editor, range, props }) => props.run(editor, range),
        items: ({ query }) => {
          const q = query.toLowerCase();
          return COMMANDS.filter(
            (c) => c.title.toLowerCase().includes(q) || c.keywords.includes(q)
          ).slice(0, 10);
        },
        render: () => {
          let component: ReactRenderer<{ onKeyDown: (p: { event: KeyboardEvent }) => boolean }>;
          let popup: Instance[];
          return {
            onStart: (props) => {
              component = new ReactRenderer(CommandList, { props, editor: props.editor });
              if (!props.clientRect) return;
              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                animation: "scale",
                duration: [140, 100],
              });
            },
            onUpdate: (props) => {
              component.updateProps(props);
              if (props.clientRect)
                popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }
              return component.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              popup?.[0]?.destroy();
              component.destroy();
            },
          };
        },
      }),
    ];
  },
});
