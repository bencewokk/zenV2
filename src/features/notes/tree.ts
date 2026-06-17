import type { Note } from "@/shared/lib/types";

export interface FlatNode {
  note: Note;
  depth: number;
  hasChildren: boolean;
}

/** Build a depth-annotated, pre-order flat list of the visible tree. */
export function flattenTree(notes: Record<string, Note>): FlatNode[] {
  const byParent = new Map<string | null, Note[]>();
  for (const n of Object.values(notes)) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

  const out: FlatNode[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const note of byParent.get(parentId) ?? []) {
      const hasChildren = (byParent.get(note.id)?.length ?? 0) > 0;
      out.push({ note, depth, hasChildren });
      if (hasChildren && !note.collapsed) visit(note.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

export const INDENT = 16;

/** Stable hue palette for top-level note trees. */
const TREE_COLORS = [
  "#6ea8fe", "#4caf72", "#f6685e", "#d99a3a",
  "#b073e0", "#3fb6c0", "#e06aa6", "#8fb04a",
];

/** Resolve the root ancestor id of a note (walks up parentId). */
export function rootIdOf(notes: Record<string, Note>, id: string): string {
  let cur = notes[id];
  const seen = new Set<string>();
  while (cur && cur.parentId && notes[cur.parentId] && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = notes[cur.parentId];
  }
  return cur?.id ?? id;
}

/** Deterministic color for a tree, keyed by its root note id. */
export function colorForRoot(rootId: string): string {
  let h = 0;
  for (let i = 0; i < rootId.length; i++) h = (h * 31 + rootId.charCodeAt(i)) >>> 0;
  return TREE_COLORS[h % TREE_COLORS.length];
}

/**
 * Given a reordered flat list and a horizontal drag offset, compute where the
 * dragged node lands: its new parent and depth. Adapted from the dnd-kit
 * sortable-tree example.
 */
export function projectDrop(
  items: FlatNode[],
  activeIndex: number,
  overIndex: number,
  dragOffsetX: number
): { parentId: string | null; depth: number } {
  const moved = arrayMove(items, activeIndex, overIndex);
  const prev = moved[overIndex - 1];
  const next = moved[overIndex + 1];
  const dragDepth = Math.round(dragOffsetX / INDENT);
  const projected = items[activeIndex].depth + dragDepth;
  const maxDepth = prev ? prev.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.max(minDepth, Math.min(projected, maxDepth));

  let parentId: string | null = null;
  if (depth > 0 && prev) {
    if (depth === prev.depth) parentId = prev.note.parentId;
    else if (depth > prev.depth) parentId = prev.note.id;
    else {
      const ancestor = moved
        .slice(0, overIndex)
        .reverse()
        .find((n) => n.depth === depth);
      parentId = ancestor?.note.parentId ?? null;
    }
  }
  return { parentId, depth };
}

export function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** Ids of a node and all its descendants — used to forbid dropping into self. */
export function subtreeIds(notes: Record<string, Note>, rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const n of Object.values(notes)) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        added = true;
      }
    }
  }
  return ids;
}
