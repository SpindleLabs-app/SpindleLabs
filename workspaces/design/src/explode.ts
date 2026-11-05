// Exploded view (Ben, 2026-11-04): Inspect ▾ Exploded view draws every body
// shown pushed away from the middle of the design, so parts that sit inside
// or against each other can be seen apart. It is view only: the design, its
// timeline and its files are unchanged, and nothing goes on Undo.
//
// The rule, per body: the middle of its bounding box is moved straight away
// from the middle of the whole design's bounding box by `spread` (0..1)
// times its distance from it plus the design's longest side S, so bodies
// that overlap almost middle on middle still come apart (by S at 0.5, by 2S
// at 1) and those further out move further. Bodies sharing a middle
// (a pin in a ring) would not move apart that way, so after the first the
// rest of each such group are lifted along Z, one step each in build order,
// a step being the group's tallest height times `spread` (clear of each
// other at 1).

import type { DisplayMesh } from "@fission/core";
import { mappedMesh } from "./move-tool.ts";
import type { Scene, ShownBody } from "./scene.ts";

/** The slider's start: half way. */
export const EXPLODE_DEFAULT = 0.5;

type Point = [number, number, number];
type Box = { lo: Point; hi: Point };

/** The bounding box of `positions` (three numbers to a point); null for none. */
function boxOf(positions: readonly number[]): Box | null {
  if (positions.length < 3) return null;
  const lo: Point = [Infinity, Infinity, Infinity];
  const hi: Point = [-Infinity, -Infinity, -Infinity];
  for (let n = 0; n + 2 < positions.length; n += 3) {
    for (let k = 0; k < 3; k++) {
      const x = positions[n + k];
      if (!Number.isFinite(x)) continue;
      if (x < lo[k]) lo[k] = x;
      if (x > hi[k]) hi[k] = x;
    }
  }
  return lo.every(Number.isFinite) ? { lo, hi } : null;
}

const middle = (b: Box): Point => [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2];

/** `spread` held to 0..1, NaN as 0. */
const held = (spread: number) => (Number.isFinite(spread) ? Math.min(1, Math.max(0, spread)) : spread === Infinity ? 1 : 0);

/** How far each body (by id) is drawn from where it is, at `spread` (0..1, held there). */
export function explodeOffsets(bodies: readonly Pick<ShownBody, "body" | "view">[], spread: number): Map<string, Point> {
  const s = held(spread);
  const boxes = bodies.map((b) => boxOf(b.view.mesh.positions));
  const all = boxOf(boxes.flatMap((b) => (b ? [...b.lo, ...b.hi] : [])));
  const out = new Map<string, Point>();
  if (all === null) {
    for (const b of bodies) out.set(b.body, [0, 0, 0]);
    return out;
  }
  const centre = middle(all);
  // Two middles are the same within a millionth of the design's size (and never closer than 1e-9 mm).
  const size = Math.max(...[0, 1, 2].map((k) => all.hi[k] - all.lo[k]));
  const same = Math.max(1e-9, size * 1e-6);
  const groups: { at: Point; members: number[] }[] = [];
  bodies.forEach((_, i) => {
    const box = boxes[i];
    if (box === null) return;
    const m = middle(box);
    const g = groups.find((x) => x.at.every((v, k) => Math.abs(v - m[k]) <= same));
    if (g) g.members.push(i);
    else groups.push({ at: m, members: [i] });
  });
  for (const b of bodies) out.set(b.body, [0, 0, 0]);
  if (s === 0 || bodies.length < 2) return out;
  for (const g of groups) {
    const out3 = g.at.map((v, k) => v - centre[k]);
    const far = Math.hypot(...out3);
    // A body at the middle of all (within `same`) is not pushed: there is no way out from where it is.
    const push = out3.map((v) => (far <= same ? 0 : s * (v + (v / far) * size))) as Point;
    const tallest = Math.max(...g.members.map((i) => boxes[i]!.hi[2] - boxes[i]!.lo[2]));
    g.members.forEach((i, j) => out.set(bodies[i].body, [push[0], push[1], push[2] + j * tallest * s]));
  }
  return out;
}

/** The scene's mesh with each body drawn at its exploded place; the mesh itself at spread 0. */
export function explodedMesh(scene: Scene, spread: number): DisplayMesh {
  if (held(spread) === 0) return scene.mesh;
  const at = explodeOffsets(scene.bodies, spread);
  return mappedMesh(scene, (body) => {
    const d = at.get(body);
    if (!d || d.every((x) => x === 0)) return null;
    return (p, vector) => (vector ? [p[0], p[1], p[2]] : [p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
  });
}

/** The slider's value (a percentage, 0 to 100) as a spread, held to 0..1; anything else is the default. */
export function readSpread(text: string): number {
  const n = Number(text);
  return text.trim() === "" || !Number.isFinite(n) ? EXPLODE_DEFAULT : held(n / 100);
}
