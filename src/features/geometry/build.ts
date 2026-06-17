import JXG from "jsxgraph";
import type { Construction, GeoObject } from "@/features/geometry/model";

const POINT = { size: 3, fillColor: "#6ea8fe", strokeColor: "#2f6bd8", highlightFillColor: "#9cc2ff" };
const DERIVED_POINT = { ...POINT, fillColor: "#b073e0", strokeColor: "#7a3fb0" };
const LINEISH = { strokeColor: "#4caf72", strokeWidth: 2, highlightStrokeColor: "#7fd6a0" };
const CIRCLE = { strokeColor: "#d99a3a", strokeWidth: 2, fillOpacity: 0 };
const POLY = { fillColor: "#6ea8fe", fillOpacity: 0.12, borders: { strokeColor: "#6ea8fe" } };

/**
 * Render a construction onto a board. Returns a map id→JXG element.
 * `onPointMove(id, x, y)` fires while dragging a free point so the model
 * can be kept in sync (the caller persists on drag end).
 */
export function buildConstruction(
  board: JXG.Board,
  c: Construction,
  onPointMove: (id: string, x: number, y: number) => void
): Map<string, JXG.GeometryElement> {
  const els = new Map<string, JXG.GeometryElement>();
  const pt = (id: string) => els.get(id) as JXG.Point | undefined;

  // Points first so references resolve.
  for (const o of c.objects) {
    if (o.kind !== "point") continue;
    const p = board.create("point", [o.x, o.y], { name: o.name, ...POINT, visible: !o.hidden });
    p.on("drag", () => onPointMove(o.id, p.X(), p.Y()));
    els.set(o.id, p);
  }

  for (const o of c.objects) {
    try {
      els.set(o.id, createDerived(board, o, pt, els));
    } catch {
      /* skip an object whose parents are missing */
    }
  }
  return els;
}

function createDerived(
  board: JXG.Board,
  o: GeoObject,
  pt: (id: string) => JXG.Point | undefined,
  els: Map<string, JXG.GeometryElement>
): JXG.GeometryElement {
  switch (o.kind) {
    case "segment":
      return board.create("segment", [pt(o.p1), pt(o.p2)], { ...LINEISH, visible: !o.hidden });
    case "line":
      return board.create("line", [pt(o.p1), pt(o.p2)], { ...LINEISH, visible: !o.hidden });
    case "ray":
      return board.create("line", [pt(o.p1), pt(o.p2)], {
        ...LINEISH,
        straightFirst: false,
        visible: !o.hidden,
      });
    case "circle":
      return board.create("circle", [pt(o.center), pt(o.through)], { ...CIRCLE, visible: !o.hidden });
    case "midpoint": {
      const m = board.create("midpoint", [pt(o.p1), pt(o.p2)], {
        name: o.name,
        ...DERIVED_POINT,
        visible: !o.hidden,
      });
      return m;
    }
    case "polygon":
      return board.create(
        "polygon",
        o.pts.map((id) => pt(id)),
        { ...POLY, visible: !o.hidden }
      );
    case "function":
      return board.create("functiongraph", [o.term], { ...LINEISH, visible: !o.hidden });
    case "point":
      return els.get(o.id)!; // already created
  }
}
