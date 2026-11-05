import type { DisplayMesh, Framing } from "@fission/core";

export type { Framing };

/** How far a body may reach past the framed sphere before re-framing. */
export const FIT_SLACK = 1.5;

/**
 * Whether the camera should re-frame: the first body; a body that no longer
 * fits comfortably in the framed sphere (its own sphere reaches past 1.5×
 * the framed radius, because it grew or moved); or one that shrank more
 * than tenfold and would be a speck. Smaller edits keep the user's view.
 */
export function needsRefit(last: Framing | null, now: Framing): boolean {
  if (!(now.radius > 0)) return false;
  if (last === null) return true;
  const shift = Math.hypot(...now.centre.map((c, i) => c - last.centre[i]));
  return shift + now.radius > FIT_SLACK * last.radius || now.radius < 0.1 * last.radius;
}

/**
 * Sphere around the selected faces' triangles and edges' segments of a
 * display mesh: the centre of their bounding box and half its diagonal, as
 * the viewer frames a whole body. Radius 0 when nothing listed is in the mesh.
 */
export function selectionFraming(
  mesh: Pick<DisplayMesh, "positions" | "indices" | "triangle_faces" | "edge_lines" | "edge_line_edges">,
  faces: readonly number[],
  edges: readonly number[],
): Framing {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const add = (points: readonly number[], i: number) => {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], points[3 * i + k]);
      hi[k] = Math.max(hi[k], points[3 * i + k]);
    }
  };
  const faceSet = new Set(faces);
  mesh.triangle_faces.forEach((face, t) => {
    if (faceSet.has(face)) for (let j = 0; j < 3; j++) add(mesh.positions, mesh.indices[3 * t + j]);
  });
  const edgeSet = new Set(edges);
  mesh.edge_line_edges.forEach((edge, s) => {
    if (edgeSet.has(edge)) [2 * s, 2 * s + 1].forEach((i) => add(mesh.edge_lines, i));
  });
  if (!(lo[0] <= hi[0])) return { centre: [0, 0, 0], radius: 0 };
  const centre = lo.map((l, k) => (l + hi[k]) / 2) as [number, number, number];
  return { centre, radius: Math.hypot(...hi.map((h, k) => h - lo[k])) / 2 };
}

/** The sphere Look At frames when there is nothing to frame (no body, nothing drawn): 50 mm round the plane's origin. */
export const LOOK_AT_EMPTY_RADIUS = 50;

/**
 * The mesh vertices that lie in `plane` (within `tolerance` mm of it), as points: the corners of the face or faces a
 * sketch on that plane sits on (U7a2). `positions` is x, y, z per vertex; the plane's `normal` is unit length.
 */
export function pointsInPlane(positions: ArrayLike<number>, plane: { origin: readonly number[]; normal: readonly number[] }, tolerance = 1e-3): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>();
  const [ox, oy, oz] = plane.origin;
  const [nx, ny, nz] = plane.normal;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (!(Math.abs((x - ox) * nx + (y - oy) * ny + (z - oz) * nz) <= tolerance)) continue;
    const key = `${x},${y},${z}`; // a corner is in many triangles
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([x, y, z]);
  }
  return out;
}

/** Room left round a face Look At frames, so its edges are not on the view's border under the floating cards (U7a2): 10 %. */
export const LOOK_AT_FACE_MARGIN = 1.1;

/**
 * How many separate pieces the mesh is: vertices at the same place are one, and a triangle joins its three. Two bodies
 * that do not touch are two pieces; a body with a hole is one. `positions` is x, y, z per vertex, `indices` three per triangle.
 */
export function pieceCount(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  const id = new Map<string, number>();
  const parent: number[] = [];
  const vertex = (i: number): number => {
    const key = `${Math.round(positions[3 * i] * 1e5)},${Math.round(positions[3 * i + 1] * 1e5)},${Math.round(positions[3 * i + 2] * 1e5)}`;
    let n = id.get(key);
    if (n === undefined) {
      n = parent.length;
      id.set(key, n);
      parent.push(n);
    }
    return n;
  };
  const find = (n: number): number => {
    while (parent[n] !== n) n = parent[n] = parent[parent[n]];
    return n;
  };
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [vertex(indices[t]), vertex(indices[t + 1]), vertex(indices[t + 2])];
    parent[find(b)] = find(a);
    parent[find(c)] = find(a);
  }
  return new Set(parent.map((_, n) => find(n))).size;
}

/**
 * What a sketch on a face frames (U7a2): the face (`inPlane`, the body's corners in its plane) and the sketch's ends, with
 * LOOK_AT_FACE_MARGIN round them, but never looser than `whole` (the whole body and the sketch): a face as big as the
 * body frames the body, as before; a small face of a big body fills the view. Only for one body (`pieces` 1): with others
 * in the scene the picture keeps all of it, so what the sketch can snap or project from stays in view.
 */
export function faceFraming(inPlane: readonly (readonly number[])[], extra: readonly (readonly number[])[], whole: Framing, fallback: readonly number[], pieces = 1): Framing {
  if (inPlane.length < 3 || pieces !== 1) return whole;
  const face = lookAtFraming([...inPlane, ...extra], fallback);
  const radius = face.radius * LOOK_AT_FACE_MARGIN;
  return radius < whole.radius ? { centre: face.centre, radius } : whole;
}

/**
 * What Look At frames: the box around `points` (the body's bounding-box
 * corners and the edited sketch's ends, model space), as its centre and
 * half its diagonal like a body is framed; with no points, or all of them
 * in one place, LOOK_AT_EMPTY_RADIUS round `fallback` (the plane's origin)
 * or round that one place.
 */
export function lookAtFraming(points: readonly (readonly number[])[], fallback: readonly number[]): Framing {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    if (!p.every(Number.isFinite)) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  if (!(lo[0] <= hi[0])) return { centre: [fallback[0], fallback[1], fallback[2]], radius: LOOK_AT_EMPTY_RADIUS };
  const centre = lo.map((l, k) => (l + hi[k]) / 2) as [number, number, number];
  const radius = Math.sqrt(hi.reduce((s, h, k) => s + (h - lo[k]) ** 2, 0)) / 2;
  return { centre, radius: radius > 0 ? radius : LOOK_AT_EMPTY_RADIUS };
}

/**
 * What the home view and the standard views frame (Fit, and the camera a
 * new part gets): the box round the body's box corners and every finished
 * sketch's line ends, lost ones too, its half diagonal the radius (hunt
 * 26h: a sketch whose face a shape change took away was left out, and at
 * 375 px sat under the view cube). Points that aren't numbers are skipped;
 * radius 0 with nothing to frame.
 */
export function partFraming(points: readonly (readonly number[])[]): Framing {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    if (p.length !== 3 || !p.every(Number.isFinite)) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  if (!(lo[0] <= hi[0])) return { centre: [0, 0, 0], radius: 0 };
  const centre = lo.map((l, k) => (l + hi[k]) / 2) as [number, number, number];
  return { centre, radius: Math.sqrt(hi.reduce((s, h, k) => s + (h - lo[k]) ** 2, 0)) / 2 };
}
