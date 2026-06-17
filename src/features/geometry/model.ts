/**
 * Construction model for the GeoGebra-style geometry block.
 * This (not the JSXGraph board) is the source of truth and what gets persisted.
 * Objects reference each other by id, so dependents update when a parent moves.
 */

export type GeoObject =
  | { id: string; kind: "point"; x: number; y: number; name: string; hidden?: boolean }
  | { id: string; kind: "segment"; p1: string; p2: string; hidden?: boolean }
  | { id: string; kind: "line"; p1: string; p2: string; hidden?: boolean }
  | { id: string; kind: "ray"; p1: string; p2: string; hidden?: boolean }
  | { id: string; kind: "circle"; center: string; through: string; hidden?: boolean }
  | { id: string; kind: "polygon"; pts: string[]; hidden?: boolean }
  | { id: string; kind: "midpoint"; p1: string; p2: string; name: string; hidden?: boolean }
  | { id: string; kind: "function"; term: string; hidden?: boolean };

export interface Construction {
  objects: GeoObject[];
  bbox?: [number, number, number, number];
}

export const emptyConstruction: Construction = { objects: [] };

export function parseConstruction(raw: string): Construction {
  if (!raw) return { ...emptyConstruction };
  try {
    const c = JSON.parse(raw) as Construction;
    if (Array.isArray(c.objects)) return c;
  } catch {
    /* not JSON (legacy text spec) — start fresh */
  }
  return { ...emptyConstruction };
}

export function serializeConstruction(c: Construction): string {
  return JSON.stringify(c);
}

let seq = 0;
export function genId(): string {
  return `g${Date.now().toString(36)}_${seq++}`;
}

/** Next free point label: A..Z, then A1, B1, … */
export function nextPointName(c: Construction): string {
  const used = new Set(
    c.objects
      .filter((o) => o.kind === "point" || o.kind === "midpoint")
      .map((o) => (o as { name: string }).name)
  );
  for (let round = 0; round < 100; round++) {
    for (let i = 0; i < 26; i++) {
      const name = String.fromCharCode(65 + i) + (round === 0 ? "" : String(round));
      if (!used.has(name)) return name;
    }
  }
  return genId();
}

/** Remove an object and anything that depends on it (recursively). */
export function removeWithDependents(c: Construction, id: string): Construction {
  const doomed = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of c.objects) {
      if (doomed.has(o.id)) continue;
      const refs = objectRefs(o);
      if (refs.some((r) => doomed.has(r))) {
        doomed.add(o.id);
        changed = true;
      }
    }
  }
  return { ...c, objects: c.objects.filter((o) => !doomed.has(o.id)) };
}

/** Ids this object references (its parents). */
export function objectRefs(o: GeoObject): string[] {
  switch (o.kind) {
    case "segment":
    case "line":
    case "ray":
    case "midpoint":
      return [o.p1, o.p2];
    case "circle":
      return [o.center, o.through];
    case "polygon":
      return o.pts;
    default:
      return [];
  }
}

/** Human-readable label for the algebra panel. */
export function describe(o: GeoObject, byId: Map<string, GeoObject>): string {
  const nm = (id: string) => {
    const p = byId.get(id);
    return p && (p.kind === "point" || p.kind === "midpoint") ? p.name : "?";
  };
  switch (o.kind) {
    case "point":
      return `${o.name} = (${round(o.x)}, ${round(o.y)})`;
    case "midpoint":
      return `${o.name} = midpoint(${nm(o.p1)}, ${nm(o.p2)})`;
    case "segment":
      return `segment ${nm(o.p1)}${nm(o.p2)}`;
    case "line":
      return `line ${nm(o.p1)}${nm(o.p2)}`;
    case "ray":
      return `ray ${nm(o.p1)}${nm(o.p2)}`;
    case "circle":
      return `circle (${nm(o.center)}, through ${nm(o.through)})`;
    case "polygon":
      return `polygon ${o.pts.map(nm).join("")}`;
    case "function":
      return `f(x) = ${o.term}`;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
