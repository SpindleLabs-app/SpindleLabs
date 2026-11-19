// Turning a pointer press and release into a pick (step 17b). Pure, so the
// rules are unit-tested without a browser; viewer.ts does the raycast.

/** A press and release closer than this many CSS pixels is a click; further apart, the camera was dragged. */
export const CLICK_SLOP_PX = 4;

/** True when the pointer moved less than `CLICK_SLOP_PX` between press and release. */
export function isClick(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) < CLICK_SLOP_PX;
}

/**
 * A finger pressed this long (ms) without moving `CLICK_SLOP_PX` opens the
 * view's menu, as a right-click does (Chrome on Android's own long press is
 * about as long; Safari on iOS fires no contextmenu, so the viewer times it).
 */
export const HOLD_MS = 500;

/** How near on screen (CSS pixels) a press must be to a sketch point to drag it (step 47d3): the Select tool's pick reach. */
export const SKETCH_GRAB_PX = { mouse: 10, touch: 24 };

/** Which of these points on screen a press at `at` grabs: the nearest within `reach`, by index; null for none. */
export function nearestWithin(points: readonly ({ x: number; y: number } | null)[], at: { x: number; y: number }, reach: number): number | null {
  let best: number | null = null;
  let bestD = reach;
  points.forEach((p, i) => {
    if (!p) return;
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d <= bestD && (best === null || d < bestD)) [best, bestD] = [i, d];
  });
  return best;
}

/**
 * How near on screen (CSS pixels) a click must come to an offered corner to
 * pick it (Measure, 35e2l3): a corner wins over the edges meeting at it, so
 * the reach is a little wider than an edge's and wider again for a finger.
 * Exactly this far is a miss, as for an edge.
 */
export const CORNER_PICK_PX = { mouse: 8, touch: 16 };

/** The points on screen nearer than `reach` to `at`, by index, nearest first (ties keep index order); null points are skipped. */
export function pointsNear(points: readonly ({ x: number; y: number } | null)[], at: { x: number; y: number }, reach: number): number[] {
  const near: { i: number; d: number }[] = [];
  points.forEach((p, i) => {
    if (!p) return;
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d < reach) near.push({ i, d });
  });
  // Ties keep index order without a second key: `near` is filled in index order and Array.prototype.sort is stable
  // (ES2019), so a tie-break by index could never change the order (a mutant swapping it lived, #443).
  return near.sort((a, b) => a.d - b.d).map((n) => n.i);
}

/** A rectangle on screen in client (CSS) pixels, as getBoundingClientRect gives. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A point on screen (client pixels) in a view's normalised device
 * coordinates: −1…1 across, −1 (bottom) … 1 (top) up, so a raycast from
 * that view's camera goes through it. Null when the view has no size.
 * Each view of the one scene (split view, X3) has its own rectangle and
 * camera, so a point must be measured against the view it was pressed in.
 */
export function clientToNdc(client: { x: number; y: number }, rect: ClientRect): { x: number; y: number } | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return { x: ((client.x - rect.left) / rect.width) * 2 - 1, y: -((client.y - rect.top) / rect.height) * 2 + 1 };
}

/** The inverse of clientToNdc: a point in a view's device coordinates, in client pixels. */
export function ndcToClient(ndc: { x: number; y: number }, rect: ClientRect): { x: number; y: number } {
  return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
}

/**
 * The kernel face index of the display mesh's triangle `triangle` (from
 * `triangle_faces`), or null when nothing usable was hit: no triangle, or an
 * index outside the mesh (a stale hit on a mesh that was just replaced).
 */
export function faceOfTriangle(triangleFaces: ArrayLike<number>, triangle: number | null | undefined): number | null {
  if (triangle == null || !Number.isInteger(triangle) || triangle < 0 || triangle >= triangleFaces.length) return null;
  return triangleFaces[triangle];
}

// Edges (step 17c): an edge is picked when the pointer is within
// `EDGE_PICK_PX` of its drawn line on screen and nothing hides that spot;
// an edge wins over the face behind it.

/** How close (CSS pixels) the pointer must come to an edge's line to pick it. Exactly this far is a miss. */
export const EDGE_PICK_PX = 5;

/**
 * Relative slack when asking whether a face hides a point of an edge: a face
 * hit closer than `distance × (1 − EDGE_DEPTH_SLACK)` hides it. The faces
 * either side of an edge contain it, so a ray to the edge meets them at the
 * edge's own distance up to f32 rounding (~1e-7 relative); 1e-3 leaves room
 * for that and for the depth offset that draws edges on top of faces, yet
 * at 100 mm from the camera a face 0.1 mm in front still hides an edge.
 */
export const EDGE_DEPTH_SLACK = 1e-3;

/** A segment near the pointer: its number, where along it (0 at its first point, 1 at its second) and how far from the pointer, in pixels. */
export interface SegmentNear {
  segment: number;
  t: number;
  distance: number;
}

/**
 * Segments whose on-screen line passes within `radius` pixels of `p`, nearest
 * first (ties keep segment order). `screen` holds x, y per endpoint, two
 * endpoints per segment; a NaN coordinate marks an endpoint that cannot be
 * drawn (behind the camera), and its segment is skipped.
 */
export function segmentsNear(screen: ArrayLike<number>, p: { x: number; y: number }, radius = EDGE_PICK_PX): SegmentNear[] {
  const near: SegmentNear[] = [];
  for (let s = 0; 4 * s + 3 < screen.length; s++) {
    // Read one by one, not as a small array per segment: this runs over every edge of every body on each hover.
    const ax = screen[4 * s];
    const ay = screen[4 * s + 1];
    const bx = screen[4 * s + 2];
    const by = screen[4 * s + 3];
    if (!(Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(bx) && Number.isFinite(by))) continue;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Closest point on the segment: project p onto the line, clamp to the ends.
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy) / len2)) : 0;
    const distance = Math.hypot(ax + t * dx - p.x, ay + t * dy - p.y);
    if (distance < radius) near.push({ segment: s, t, distance });
  }
  return near.sort((a, b) => a.distance - b.distance || a.segment - b.segment);
}

/** The kernel edge index of segment `segment` (from `edge_line_edges`), or null when the index is outside the mesh. */
export function edgeOfSegment(segmentEdges: ArrayLike<number>, segment: number): number | null {
  return faceOfTriangle(segmentEdges, segment);
}

/**
 * Whether a point `pointDistance` from the camera is in view, given the
 * distance to the first face a ray towards it meets (null: none).
 */
export function unhidden(pointDistance: number, firstHit: number | null): boolean {
  return firstHit === null || firstHit >= pointDistance * (1 - EDGE_DEPTH_SLACK);
}

/**
 * What a click picks while origin planes are offered for a sketch (step
 * 26d), from whether the pointer's ray hit a face of the body and an
 * offered plane: the face whenever there is one, else the plane; null when
 * both missed. The planes are drawn behind the body (viewer.ts), so this
 * is what is seen: a face in front of a plane, behind it or lying in it is
 * what the pointer is on (from the home view the front plane's square
 * stands in front of the default box's top, which must stay pickable).
 */
export function planeOrFace(plane: boolean, face: boolean): "plane" | "face" | null {
  return face ? "face" : plane ? "plane" : null;
}

// Thin faces (Ben, 2026-11-19): a face only a few pixels wide on screen (a 1 mm plate's side, the end of a long bar)
// lies wholly inside the reach of its own edges and corners, so they used to take every click on it and the face
// could not be picked at all, least of all by a finger. Two rules give it back.

/**
 * Whether an edge or corner `distance` px from the pointer takes the pick from the face under the pointer, where that
 * face runs on for `beyond` px past the pointer, away from the edge or corner (Infinity: further than anyone asks).
 * Within `reach` it does, unless the pointer is in the face's middle half across: the face is `distance + beyond`
 * wide there, so the edge's quarter is `distance < (distance + beyond) / 4`, that is `3 · distance < beyond`. A face
 * at least four reaches wide (all but thin ones) loses nothing: there every point within reach of the edge is in
 * the edge's quarter. Exactly on the quarter line the face keeps it.
 */
export function edgeTakesPick(distance: number, beyond: number, reach: number): boolean {
  return distance < reach && 3 * distance < beyond;
}

/** How far past the pointer a face's run is ever measured (px): three reaches settle edgeTakesPick for any distance within reach. */
export const beyondNeeded = (reach: number) => 3 * reach;

/**
 * While only faces can be picked (TestLab's holds and loads, Shell's open faces, the plane-or-face prompt), a tap
 * this near a face narrower on screen than a fingertip (twice this across) picks it, ahead of a wider face under the
 * finger; and a tap this near the part, off it, picks the nearest face. A finger covers about 10 mm, some 40 CSS px;
 * this is a little more than its middle's slip and less than the gap between two thin faces worth telling apart.
 */
export const FACE_TAP_PX = 12;

/** What one ray of a tap's fan met at one pixel out from the tap: the face it first hit there (null: none) and how far out, px. */
export interface FanHit {
  face: number | null;
  at: number;
}

/** How far out (px) each ray of a tap's fan looks: past FACE_TAP_PX by enough to see a face starting there end again within 2·FACE_TAP_PX. */
export const FAN_PX = 3 * FACE_TAP_PX;

/**
 * The face a tap picks while only faces can be. `rays` holds an even number of directions fanned out from the tap,
 * the second half opposite the first in the same order (ray k + n/2 points the other way from ray k), each met every
 * pixel out from 0 (the tap itself) to FAN_PX. A face is thin when some ray crosses the whole of it, from where it
 * starts to where it ends, in fewer than 2·FACE_TAP_PX samples; for the tap's own face the crossing is along a ray and
 * its opposite together. The nearest thin face starting within FACE_TAP_PX wins (the tap's own at 0, so a thin face
 * tapped on keeps it); else the face under the tap; else, for a tap off the part, the nearest face met within
 * FACE_TAP_PX; null when there is none.
 */
export function faceForTap(rays: readonly (readonly FanHit[])[]): number | null {
  if (rays.length === 0 || rays.length % 2 !== 0) return null;
  const half = rays.length / 2;
  const under = rays[0][0]?.at === 0 ? rays[0][0].face : null;
  // The last sample of the run of one face starting at sample i.
  const runEnd = (ray: readonly FanHit[], i: number) => {
    let end = i;
    while (end + 1 < ray.length && ray[end + 1].face === ray[i].face) end++;
    return end;
  };
  let thin: { face: number; at: number } | null = null;
  let nearest: { face: number; at: number } | null = null;
  rays.forEach((ray, k) => {
    for (let i = 0; i < ray.length; i++) {
      const { face, at } = ray[i];
      if (face === null || at > FACE_TAP_PX || (i > 0 && ray[i - 1].face === face)) continue; // only where a face starts, within reach
      if (nearest === null || at < nearest.at) nearest = { face, at };
      const end = runEnd(ray, i);
      let crossed = end + 1 < ray.length;
      let across = ray[end].at - at + 1;
      if (i === 0) {
        // The tap's own face, across this way and back the other.
        const back = rays[(k + half) % rays.length];
        const backEnd = runEnd(back, 0);
        crossed &&= backEnd + 1 < back.length && back[0].face === face;
        across = ray[end].at + back[backEnd].at + 1;
      }
      if (crossed && across < 2 * FACE_TAP_PX && (thin === null || at < thin.at)) thin = { face, at };
    }
  });
  const found = thin as { face: number } | null;
  return found?.face ?? under ?? (nearest as { face: number } | null)?.face ?? null;
}

/** How many directions a tap's fan looks along: eight lines through the tap, both ways (faceForTap's opposites). */
export const FAN_DIRECTIONS = 16;

/**
 * A tap's fan for faceForTap: `look(dx, dy)` is the face under the screen point (dx, dy) px from the tap (null: none),
 * asked every pixel out to FAN_PX along each of `directions` (even) evenly turned directions, the first along +x.
 */
export function fanRays(look: (dx: number, dy: number) => number | null, directions = FAN_DIRECTIONS): FanHit[][] {
  const under = look(0, 0);
  return Array.from({ length: directions }, (_, k) => {
    const turn = (2 * Math.PI * k) / directions;
    const [ux, uy] = [Math.cos(turn), Math.sin(turn)];
    return Array.from({ length: FAN_PX + 1 }, (_, at) => ({ face: at === 0 ? under : look(at * ux, at * uy), at }));
  });
}
