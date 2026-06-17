import { useMemo, useState, useRef, useEffect } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNotes } from "@/features/notes/store";
import { useHome, type HomeTarget } from "@/features/home/store";
import { matchesFilter, isFilterActive } from "@/features/filtering/filter";
import {
  flattenTree,
  projectDrop,
  subtreeIds,
  rootIdOf,
  colorForRoot,
  INDENT,
  type FlatNode,
} from "@/features/notes/tree";

export function Sidebar() {
  const notes = useNotes((s) => s.notes);
  const filter = useNotes((s) => s.filter);
  const selectedId = useNotes((s) => s.selectedId);
  const select = useNotes((s) => s.select);
  const create = useNotes((s) => s.create);
  const remove = useNotes((s) => s.remove);
  const toggleCollapse = useNotes((s) => s.toggleCollapse);
  const move = useNotes((s) => s.move);
  const rename = useNotes((s) => s.rename);
  const launchDeepWork = useHome((s) => s.launchDeepWork);
  const [menu, setMenu] = useState<{ x: number; y: number; target: HomeTarget } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const filtering = isFilterActive(filter);

  // When filtering, show a flat matching list; otherwise the full tree.
  const flat: FlatNode[] = useMemo(() => {
    if (filtering) {
      return Object.values(notes)
        .filter((n) => matchesFilter(n, filter))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((note) => ({ note, depth: 0, hasChildren: false }));
    }
    return flattenTree(notes);
  }, [notes, filter, filtering]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setOffsetX(0);
  }
  function onDragMove(e: DragMoveEvent) {
    setOffsetX(e.delta.x);
  }
  async function onDragEnd(e: DragEndEvent) {
    const active = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    setActiveId(null);
    if (!overId) return;

    const activeIndex = flat.findIndex((f) => f.note.id === active);
    const overIndex = flat.findIndex((f) => f.note.id === overId);
    if (activeIndex < 0 || overIndex < 0) return;

    const { parentId } = projectDrop(flat, activeIndex, overIndex, offsetX);
    // forbid dropping a node into its own subtree
    if (parentId && subtreeIds(notes, active).has(parentId)) return;

    const siblings = Object.values(notes)
      .filter((n) => n.parentId === parentId && n.id !== active)
      .sort((a, b) => a.order - b.order);
    const order = siblings.length ? siblings[siblings.length - 1].order + 1 : 0;
    await move(active, parentId, order);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">
          {filtering ? "Results" : "Notes"}
        </span>
        <button
          className="rounded px-1.5 text-lg leading-none text-[var(--text-dim)] hover:text-[var(--text)]"
          title="New note"
          onClick={() => create(null)}
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-3">
        {flat.length === 0 && (
          <div className="px-3 py-2 text-sm text-[var(--text-dim)]">
            {filtering ? "No matches" : "No notes yet — click +"}
          </div>
        )}
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={flat.map((f) => f.note.id)}
            strategy={verticalListSortingStrategy}
          >
            {flat.map((f) => (
              <Row
                key={f.note.id}
                node={f}
                draggable={!filtering}
                selected={selectedId === f.note.id}
                dimDepth={activeId === f.note.id ? Math.round(offsetX / INDENT) : 0}
                color={colorForRoot(rootIdOf(notes, f.note.id))}
                onSelect={() => select(f.note.id)}
                onToggle={() => toggleCollapse(f.note.id)}
                onAddChild={() => create(f.note.id)}
                onDelete={() => remove(f.note.id)}
                onRename={(title) => void rename(f.note.id, title)}
                onOpenDeepWork={(event) => {
                  event.preventDefault();
                  setMenu({ x: event.clientX, y: event.clientY, target: { type: "note", id: f.note.id } });
                }}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {menu && (
        <div
          className="zen-anim-pop fixed z-50 min-w-[180px] rounded-[12px] border border-[var(--border)] bg-[rgba(18,19,24,0.96)] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur"
          style={{ left: menu.x, top: menu.y, transformOrigin: "top left" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="block w-full rounded-[10px] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--bg-elev)]"
            onClick={() => {
              launchDeepWork(menu.target);
              setMenu(null);
            }}
          >
            Add to Deep Work
          </button>
        </div>
      )}
    </div>
  );
}

function Row(props: {
  node: FlatNode;
  draggable: boolean;
  selected: boolean;
  dimDepth: number;
  color: string;
  onSelect: () => void;
  onToggle: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onOpenDeepWork: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const { node, draggable } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.note.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft.trim() !== node.note.title) props.onRename(draft.trim());
  }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.note.id,
    disabled: !draggable || editing,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-stretch gap-1 rounded pr-1 [transition:background-color_var(--motion-fast)_var(--ease-out)] ${
        props.selected ? "bg-[var(--accent-dim)]" : "hover:bg-[var(--bg-elev)]"
      }`}
      onContextMenu={props.onOpenDeepWork}
    >
      {/* tree-color accent: solid for roots, faint for descendants */}
      <span
        aria-hidden="true"
        className="my-0.5 shrink-0 rounded-full"
        style={{ width: 2, background: props.color, opacity: node.depth === 0 ? 1 : 0.45 }}
      />

      {/* indent guide rails — one vertical line per ancestor level */}
      {Array.from({ length: node.depth }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="shrink-0 self-stretch"
          style={{
            width: INDENT - 1,
            marginLeft: i === 0 ? 2 : 0,
            borderLeft: `1px solid ${i === node.depth - 1 ? `${props.color}55` : "rgba(255,255,255,0.08)"}`,
          }}
        />
      ))}

      {node.hasChildren ? (
        <button
          className="zen-pressable w-4 shrink-0 self-center text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={props.onToggle}
          title="Collapse / expand"
        >
          {node.note.collapsed ? "▸" : "▾"}
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(node.note.title);
              setEditing(false);
            }
          }}
          className="flex-1 rounded bg-[var(--bg)] px-1 py-1 text-sm outline-none ring-1 ring-[var(--accent)]"
        />
      ) : (
        <button
          className={`flex-1 self-center truncate py-1 text-left text-sm ${node.depth === 0 ? "font-medium text-[var(--text)]" : "text-[var(--text-dim)]"}`}
          onClick={props.onSelect}
          onDoubleClick={() => {
            setDraft(node.note.title);
            setEditing(true);
          }}
          title="Double-click to rename"
          {...(draggable ? { ...attributes, ...listeners } : {})}
        >
          {node.note.title || "Untitled"}
          {node.note.inbox && <span className="ml-1 text-[10px] text-[var(--text-dim)]">·in</span>}
        </button>
      )}

      <button
        className="zen-pressable hidden shrink-0 self-center px-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)] group-hover:block"
        title="Add child note"
        onClick={props.onAddChild}
      >
        +
      </button>
      <button
        className="zen-pressable hidden shrink-0 self-center px-1 text-xs text-[var(--text-dim)] hover:text-[var(--danger)] group-hover:block"
        title="Delete note"
        onClick={props.onDelete}
      >
        ✕
      </button>
    </div>
  );
}
