import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import JXG from "jsxgraph";
import "@/features/geometry/jsxgraph.css";
import {
  type Construction,
  type GeoObject,
  parseConstruction,
  serializeConstruction,
  genId,
  nextPointName,
  removeWithDependents,
  describe,
} from "@/features/geometry/model";
import { buildConstruction } from "@/features/geometry/build";

type Tool =
  | "move" | "point" | "segment" | "line" | "ray"
  | "circle" | "midpoint" | "polygon" | "delete";

const TOOLS: { id: Tool; label: string; hint: string; needs: number }[] = [
  { id: "move", label: "Move", hint: "Select & drag points", needs: 0 },
  { id: "point", label: "Point", hint: "Click to place a point", needs: 1 },
  { id: "segment", label: "Segment", hint: "Click two points", needs: 2 },
  { id: "line", label: "Line", hint: "Click two points", needs: 2 },
  { id: "ray", label: "Ray", hint: "Click start then direction", needs: 2 },
  { id: "circle", label: "Circle", hint: "Click center then a point on it", needs: 2 },
  { id: "midpoint", label: "Midpoint", hint: "Click two points", needs: 2 },
  { id: "polygon", label: "Polygon", hint: "Click points, then Finish", needs: 99 },
  { id: "delete", label: "Delete", hint: "Click an object to remove it", needs: 0 },
];

let boardSeq = 0;

export function GeometryView({ node, updateAttributes, selected }: NodeViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`jxg-${boardSeq++}`);

  const [con, setCon] = useState<Construction>(() => parseConstruction(node.attrs.spec ?? ""));
  const [tool, setTool] = useState<Tool>("move");
  const [pending, setPending] = useState<string[]>([]);

  const conRef = useRef(con);
  const toolRef = useRef(tool);
  const pendingRef = useRef(pending);
  conRef.current = con;
  toolRef.current = tool;
  pendingRef.current = pending;

  const dragDirty = useRef(false);

  // Persist + update state together.
  const commit = useCallback(
    (next: Construction) => {
      conRef.current = next;
      setCon(next);
      updateAttributes({ spec: serializeConstruction(next) });
    },
    [updateAttributes]
  );

  // Snap to an existing point within tolerance, else create one.
  const snapOrCreate = useCallback(
    (c: Construction, ux: number, uy: number, tolUser: number): { c: Construction; id: string } => {
      for (const o of c.objects) {
        if (o.kind === "point" && Math.hypot(o.x - ux, o.y - uy) < tolUser) return { c, id: o.id };
      }
      const id = genId();
      const x = Math.round(ux * 2) / 2;
      const y = Math.round(uy * 2) / 2;
      const point: GeoObject = { id, kind: "point", x, y, name: nextPointName(c) };
      return { c: { ...c, objects: [...c.objects, point] }, id };
    },
    []
  );

  const onCanvasDown = useCallback(
    (board: JXG.Board, e: PointerEvent) => {
      const t = toolRef.current;
      if (t === "move") return;
      const usr = board.getUsrCoordsOfMouse(e);
      const ux = usr[0];
      const uy = usr[1];
      const tolUser = 12 / board.unitX;
      let c = conRef.current;

      if (t === "delete") {
        // nearest point first, then any object under the cursor
        let hit: string | null = null;
        let best = tolUser;
        for (const o of c.objects) {
          if (o.kind === "point") {
            const d = Math.hypot(o.x - ux, o.y - uy);
            if (d < best) { best = d; hit = o.id; }
          }
        }
        if (!hit) {
          const off = JXG.getOffset(board.containerObj);
          const abs = JXG.getPosition(e);
          const sx = abs[0] - off[0];
          const sy = abs[1] - off[1];
          for (const o of c.objects) {
            const el = elsRef.current.get(o.id) as unknown as {
              hasPoint?: (x: number, y: number) => boolean;
            } | undefined;
            if (el && typeof el.hasPoint === "function" && el.hasPoint(sx, sy)) { hit = o.id; break; }
          }
        }
        if (hit) commit(removeWithDependents(c, hit));
        return;
      }

      if (t === "point") {
        const r = snapOrCreate(c, ux, uy, tolUser);
        commit(r.c);
        return;
      }

      // multi-point tools: collect points, then build
      const r = snapOrCreate(c, ux, uy, tolUser);
      c = r.c;
      const next = [...pendingRef.current, r.id];

      if (t === "polygon") {
        commit(c);
        setPending(next);
        return;
      }

      if (next.length < 2) {
        commit(c);
        setPending(next);
        return;
      }

      const [p1, p2] = next;
      const id = genId();
      let obj: GeoObject;
      if (t === "circle") obj = { id, kind: "circle", center: p1, through: p2 };
      else if (t === "midpoint") obj = { id, kind: "midpoint", p1, p2, name: nextPointName(c) };
      else obj = { id, kind: t, p1, p2 };
      commit({ ...c, objects: [...c.objects, obj] });
      setPending([]);
    },
    [commit, snapOrCreate]
  );

  const onCanvasDownRef = useRef(onCanvasDown);
  onCanvasDownRef.current = onCanvasDown;
  const elsRef = useRef<Map<string, JXG.GeometryElement>>(new Map());

  // (Re)build the board whenever the construction changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!host.id) host.id = idRef.current;
    host.innerHTML = "";

    let board: JXG.Board | null = null;
    try {
      board = JXG.JSXGraph.initBoard(host, {
        boundingbox: con.bbox ?? [-8, 6, 8, -6],
        axis: true,
        grid: true,
        showCopyright: false,
        showNavigation: true,
        keepAspectRatio: true,
        pan: { enabled: true, needTwoFingers: false },
        zoom: { wheel: true, needShift: false },
      });

      elsRef.current = buildConstruction(board, conRef.current, (id, x, y) => {
        const obj = conRef.current.objects.find((o) => o.id === id);
        if (obj && obj.kind === "point") { obj.x = x; obj.y = y; dragDirty.current = true; }
      });

      const b = board;
      b.on("down", (e: Event) => onCanvasDownRef.current(b, e as PointerEvent));
      b.on("up", () => {
        if (dragDirty.current) {
          dragDirty.current = false;
          commit({ ...conRef.current, objects: conRef.current.objects.map((o) => ({ ...o })) });
        }
      });
    } catch {
      /* swallow JSXGraph init errors so the editor never crashes */
    }

    const created = board;
    return () => {
      try { if (created) JXG.JSXGraph.freeBoard(created); } catch { /* freed */ }
    };
  }, [con, commit]);

  const activeHint = TOOLS.find((t) => t.id === tool)?.hint ?? "";

  const byId = new Map(con.objects.map((o) => [o.id, o]));

  return (
    <NodeViewWrapper
      className={`zen-geometry ${selected ? "is-selected" : ""}`}
      onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
    >
      {/* Toolbar */}
      <div className="zen-geo-toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`zen-geo-tool${tool === t.id ? " is-active" : ""}`}
            title={t.hint}
            onClick={() => { setTool(t.id); setPending([]); }}
          >
            {t.label}
          </button>
        ))}
        {tool === "polygon" && pending.length >= 3 && (
          <button
            className="zen-geo-tool is-finish"
            onClick={() => {
              const id = genId();
              commit({ ...conRef.current, objects: [...conRef.current.objects, { id, kind: "polygon", pts: pending }] });
              setPending([]);
            }}
          >
            ✓ Finish
          </button>
        )}
      </div>

      <div className="zen-geometry-grid">
        <div ref={hostRef} className="zen-geometry-board" />
        <div className="zen-geometry-side">
          <div className="zen-geo-hint">{activeHint}{pending.length ? ` · ${pending.length} selected` : ""}</div>
          <div className="zen-geo-objects">
            {con.objects.length === 0 && <div className="zen-geo-empty">No objects yet</div>}
            {con.objects.map((o) => (
              <div key={o.id} className="zen-geo-obj">
                <span className="truncate">{describe(o, byId)}</span>
                <button
                  className="zen-geo-del"
                  title="Delete"
                  onClick={() => commit(removeWithDependents(conRef.current, o.id))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            className="zen-geo-clear"
            onClick={() => { commit({ objects: [] }); setPending([]); }}
          >
            Clear all
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
