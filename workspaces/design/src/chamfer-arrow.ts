// Chamfer's drag arrow and its red "won't cut" wedge (Ben, 2026-11-16: "type
// a number and blind guess" is gone). Pure, so it is unit-tested by hand.
//
// The cut, as the kernel makes it (and as its own notes describe it in its
// words): for a straight edge from P along t between face F1 (the face that
// runs the edge forwards, `edge_faces[e][0]`) and F2, the directions square
// to the edge into each face are a = n1 × t and b = n2 × (−t). The cut's
// cross-section is the triangle P, P + d1·a, P + d2·b; Flip swaps the two
// faces (so d1 is measured along F2). For a distance and an angle θ off the
// first face, the sine rule in that triangle (angle φ between a and b at P,
// θ at P + d1·a) gives d2 = d1 sin θ / sin(φ + θ).
//
// The arrow lies on the face the first distance is measured along, its
// foot on the cut's contact line (P + d1·a at the edge's middle), pointing on
// along that face: dragging it along the face sets the first distance, the
// number in the Distance box, exactly (one mm of drag is one mm of chamfer).
// The workspace hands it to the viewport as Extrude's arrow (`ExtrudeArrow`,
// with `pickBodies`, so clicks still pick edges).
//
// When the kernel refuses the chamfer, the wedge it would have cut off each
// edge it names (else every picked edge) is drawn in see-through red, so the
// user sees where it fails, not only why (an inside corner shows its wedge
// in the empty corner; a chamfer too wide shows the wedge running off the
// face).

import type { BodyView, ChamferSize, DisplayMesh, ExtrudeArrow, KernelInput } from "@fission/core";

type Vec3 = [number, number, number];

const sub = (p: readonly number[], q: readonly number[]): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const add = (p: readonly number[], q: readonly number[]): Vec3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const scale = (p: readonly number[], s: number): Vec3 => [p[0] * s, p[1] * s, p[2] * s];
const dot = (p: readonly number[], q: readonly number[]): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: readonly number[], q: readonly number[]): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
function unit(p: readonly number[]): Vec3 | null {
  const n = Math.hypot(p[0], p[1], p[2]);
  return n > 0 && Number.isFinite(n) ? [p[0] / n, p[1] / n, p[2] / n] : null;
}

/** What the arrow and the wedge read of a body's view. */
export type ChamferFacts = Pick<BodyView, "edge_types" | "edge_faces" | "edge_vertices" | "vertex_points" | "face_normals" | "edge_middles">;

/** The edge's frame as the kernel cuts it: its ends, its middle and the directions into the first and second face (after Flip). Null for an edge that isn't a straight line between two flat faces. */
export function edgeFrame(view: ChamferFacts, edge: number, flip: boolean): { p0: Vec3; p1: Vec3; mid: Vec3; a: Vec3; b: Vec3 } | null {
  if (!Number.isInteger(edge) || edge < 0 || edge >= view.edge_types.length || view.edge_types[edge] !== "line") return null;
  const faces = view.edge_faces[edge];
  const ends = view.edge_vertices[edge];
  if (faces == null || ends === undefined) return null;
  const n1 = view.face_normals[faces[0]];
  const n2 = view.face_normals[faces[1]];
  const p0 = view.vertex_points[ends[0]];
  const p1 = view.vertex_points[ends[1]];
  if (n1 == null || n2 == null || p0 === undefined || p1 === undefined) return null;
  const t = unit(sub(p1, p0));
  if (t === null) return null;
  const a = unit(cross(n1, t));
  const b = unit(cross(n2, scale(t, -1)));
  if (a === null || b === null) return null;
  const mid = view.edge_middles[edge] ?? scale(add(p0, p1), 0.5);
  return { p0: [...p0], p1: [...p1], mid: [...mid] as Vec3, ...(flip ? { a: b, b: a } : { a, b }) };
}

/** The two distances (mm) along the first and second face for `size`, with the faces' directions `a` and `b`; null for an angle the faces leave no room for. */
export function chamferDistances(size: ChamferSize, a: readonly number[], b: readonly number[]): [number, number] | null {
  if ("equal" in size) return [size.equal, size.equal];
  if ("two" in size) return [size.two[0], size.two[1]];
  const [d1, degrees] = size.angle;
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const theta = (degrees * Math.PI) / 180;
  const s = Math.sin(phi + theta);
  // φ + θ at 180° (sin rounding to about 1e-16, not 0) leaves no far contact line: none, as the kernel refuses it.
  if (!(s > 1e-12)) return null;
  return [d1, (d1 * Math.sin(theta)) / s];
}

/** The arrow for edge `edge` with the first distance `d1` (mm): on the first face, its foot on the cut's contact line at the edge's middle. */
export function chamferArrow(view: ChamferFacts, edge: number, flip: boolean, d1: number): ExtrudeArrow | null {
  const frame = edgeFrame(view, edge, flip);
  if (frame === null || !(d1 > 0)) return null;
  return { base: frame.mid, direction: frame.a, distance: d1 };
}

/** The step a dragged distance snaps to (mm), and the least it goes to: never 0, which cuts nothing. */
export const CHAMFER_DRAG_STEP = 0.1;

/**
 * A dragged distance (mm along the arrow) as the Distance box takes it:
 * rounded to the nearest CHAMFER_DRAG_STEP, at least one step (a drag back
 * past the edge stops there), at most `max`; written without float dust
 * (0.30000000000000004 is 0.3).
 */
export function snapChamfer(s: number, max: number): number {
  if (!Number.isFinite(s)) return CHAMFER_DRAG_STEP;
  const steps = Math.max(1, Math.round(s / CHAMFER_DRAG_STEP));
  return Math.min(max, Number((steps * CHAMFER_DRAG_STEP).toFixed(1)));
}

/** The edges a kernel refusal names (its `edge` inputs), keeping only those picked; every picked edge when it names none of them (a size, say). */
export function refusedEdges(inputs: readonly KernelInput[], picked: readonly number[]): number[] {
  const named = inputs.flatMap((i) => (i.input === "edge" && picked.includes(i.edge) ? [i.edge] : []));
  return named.length > 0 ? [...new Set(named)] : [...picked];
}

/**
 * The wedge the chamfer would cut off each of `edges` at `size` (the
 * triangle P, P + d1·a, P + d2·b carried from the edge's start to its end),
 * as a display mesh the viewport draws see-through: two end triangles and
 * three sides, wound outwards, with the wedge's nine edges as lines. Edges
 * it can't place (curved, unknown) are left out; null when none is left.
 */
export function wedgeMesh(view: ChamferFacts, edges: readonly number[], size: ChamferSize, flip: boolean): DisplayMesh | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const lines: number[] = [];
  for (const e of edges) {
    const f = edgeFrame(view, e, flip);
    if (f === null) continue;
    const d = chamferDistances(size, f.a, f.b) ?? (["equal" in size ? size.equal : "two" in size ? size.two[0] : size.angle[0], "equal" in size ? size.equal : "two" in size ? size.two[0] : size.angle[0]] as [number, number]);
    const ring = (p: Vec3): Vec3[] => [p, add(p, scale(f.a, d[0])), add(p, scale(f.b, d[1]))];
    const [s, t] = [ring(f.p0), ring(f.p1)];
    const middle = scale(add(add(add(s[0], s[1]), s[2]), add(add(t[0], t[1]), t[2])), 1 / 6);
    // Each face as its own corners with its flat normal, turned to face away from the wedge's middle.
    const face = (corners: Vec3[]) => {
      const n = unit(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])));
      if (n === null) return;
      const out = dot(n, sub(corners[0], middle)) < 0;
      const ordered = out ? [...corners].reverse() : corners;
      const normal = out ? scale(n, -1) : n;
      const start = positions.length / 3;
      for (const c of ordered) positions.push(...c), normals.push(...normal);
      for (let k = 1; k + 1 < ordered.length; k++) indices.push(start, start + k, start + k + 1);
    };
    face(s);
    face(t);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      face([s[i], s[j], t[j], t[i]]);
      lines.push(...s[i], ...s[j], ...t[i], ...t[j], ...s[i], ...t[i]);
    }
  }
  if (indices.length === 0) return null;
  return { positions, normals, indices, triangle_faces: indices.filter((_, k) => k % 3 === 0).map(() => 0), edge_lines: lines, edge_line_edges: Array.from({ length: lines.length / 6 }, () => 0) };
}
