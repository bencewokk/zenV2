import { Node, mergeAttributes } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance } from "tippy.js";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useNotes } from "@/features/notes/store";

/**
 * Inline [[wiki-link]] node (DESIGN.md #11). Clicking dispatches `zen:navigate`,
 * which the app listens for to open the target note.
 */
export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-note-id"),
        renderHTML: (attrs) => (attrs.noteId ? { "data-note-id": attrs.noteId } : {}),
      },
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-label") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-wiki-link]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-wiki-link": "",
        class: "zen-wikilink",
        href: "#",
      }),
      `${HTMLAttributes["data-label"] ?? ""}`,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs.label}]]`;
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<{ id: string; title: string }>({
        editor: this.editor,
        pluginKey: new PluginKey("wikiLink"),
        char: "[[",
        startOfLine: false,
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: this.name, attrs: { noteId: props.id, label: props.title } },
              { type: "text", text: " " },
            ])
            .run();
        },
        items: ({ query }) => {
          const notes = Object.values(useNotes.getState().notes);
          const q = query.toLowerCase();
          return notes
            .filter((n) => n.title.toLowerCase().includes(q))
            .slice(0, 8)
            .map((n) => ({ id: n.id, title: n.title || "Untitled" }));
        },
        render: () => {
          let component: ReactRenderer<{ onKeyDown: (p: { event: KeyboardEvent }) => boolean }>;
          let popup: Instance[];
          return {
            onStart: (props) => {
              component = new ReactRenderer(LinkList, { props, editor: props.editor });
              if (!props.clientRect) return;
              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
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

interface LinkListProps {
  items: { id: string; title: string }[];
  command: (item: { id: string; title: string }) => void;
}

const LinkList = forwardRef<
  { onKeyDown: (p: { event: KeyboardEvent }) => boolean },
  LinkListProps
>((props, ref) => {
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setSel(0), [props.items]);
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

  if (!props.items.length)
    return <div className="zen-slash"><div className="zen-slash-empty">No notes</div></div>;
  return (
    <div className="zen-slash" ref={listRef}>
      {props.items.map((item, i) => (
        <button
          key={item.id}
          className={`zen-slash-item${i === sel ? " is-sel" : ""}`}
          onMouseEnter={() => setSel(i)}
          onClick={() => props.command(item)}
        >
          <span className="zen-slash-title">{item.title}</span>
        </button>
      ))}
    </div>
  );
});
LinkList.displayName = "LinkList";
