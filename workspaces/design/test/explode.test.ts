// Exploded view (Ben, 2026-11-04): each body drawn pushed away from the
// middle of the design, view only. Hand-worked from boxes.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayMesh } from "@fission/core";
import { EXPLODE_DEFAULT, explodedMesh, explodeOffsets, readSpread } from "../src/explode.ts";
import type { Scene, ShownBody } from "../src/scene.ts";

/** A box from `lo` to `hi` as a body: its 8 corners as points (one triangle, so the lists hold), one edge line from lo to hi, normals +Z. */
function boxBody(id: string, lo: readonly number[], hi: readonly number[]): ShownBody {
  const positions: number[] = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) positions.push(x, y, z);
  const mesh: DisplayMesh = { positions, normals: positions.map((_, i) => (i % 3 === 2 ? 1 : 0)), indices: [0, 1, 2], triangle_faces: [0], edge_lines: [...lo, ...hi], edge_line_edges: [0] };
  return { body: id, feature: id.slice(5), place: 1, view: { mesh, faces: 1, edges: 1 }, names: { faces: [], edges: [] } } as unknown as ShownBody;
}

function sceneOf(bodies: ShownBody[]): Scene {
  const mesh: DisplayMesh = { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] };
  for (const b of bodies) {
    const first = mesh.positions.length / 3;
    mesh.positions.push(...b.view.mesh.positions);
    mesh.normals.push(...b.view.mesh.normals);
    mesh.indices.push(...b.view.mesh.indices.map((i) => i + first));
    mesh.triangle_faces.push(mesh.triangle_faces.length);
    mesh.edge_lines.push(...b.view.mesh.edge_lines);
    mesh.edge_line_edges.push(mesh.edge_line_edges.length);
  }
  return { bodies, mesh, faceStart: bodies.map((_, i) => i), edgeStart: bodies.map((_, i) => i) };
}

const close = (got: readonly number[] | undefined, want: readonly number[], what: string) => {
  assert.ok(got, `${what}: no offset`);
  got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) <= 1e-12, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
};

test("two boxes side by side move apart along the line between their middles: the spread times their distance out plus the design's size", () => {
  // A: [0,1]³, B: [3,4]×[0,1]×[0,1]. The whole design's box is [0,4]×[0,1]×[0,1], its middle (2, 0.5, 0.5), its
  // longest side S = 4. A's middle (0.5, 0.5, 0.5) is 1.5 left of it, B's (3.5, 0.5, 0.5) 1.5 right. Each moves
  // spread × (its distance out + S) outward: at 0.5, 0.5 × (1.5 + 4) = 2.75, A to the left and B to the right.
  const a = boxBody("body:feature-1", [0, 0, 0], [1, 1, 1]);
  const b = boxBody("body:feature-2", [3, 0, 0], [4, 1, 1]);
  const at = explodeOffsets([a, b], 0.5);
  close(at.get("body:feature-1"), [-2.75, 0, 0], "A");
  close(at.get("body:feature-2"), [2.75, 0, 0], "B");
  // Spread 1: 1.5 + 4 = 5.5 each.
  close(explodeOffsets([a, b], 1).get("body:feature-2"), [5.5, 0, 0], "B at 1");
});

test("a body in the middle stays put while those around it move out, in 3D", () => {
  // Middle C: [-1,1]³ (middle 0,0,0); D: [4,6]×[4,6]×[-1,1] (middle 5,5,0); E: [-6,-4]×[-6,-4]×[-1,1] (middle -5,-5,0).
  // The design's box is [-6,6]×[-6,6]×[-1,1], middle (0,0,0), S = 12. At spread 0.2: C stays; D is (5,5,0) out, the
  // way (1,1,0)/√2, so it moves 0.2 × ((5,5,0) + 12 (1,1,0)/√2) = (1 + 2.4/√2) along X and Y each; E the same the other way.
  const c = boxBody("body:feature-1", [-1, -1, -1], [1, 1, 1]);
  const d = boxBody("body:feature-2", [4, 4, -1], [6, 6, 1]);
  const e = boxBody("body:feature-3", [-6, -6, -1], [-4, -4, 1]);
  const at = explodeOffsets([c, d, e], 0.2);
  close(at.get("body:feature-1"), [0, 0, 0], "C in the middle");
  const d2 = 1 + 2.4 / Math.SQRT2;
  close(at.get("body:feature-2"), [d2, d2, 0], "D");
  close(at.get("body:feature-3"), [-d2, -d2, 0], "E");
});

test("bodies sharing a middle (a pin in a ring) are lifted apart along Z in build order, clear of each other at spread 1", () => {
  // A pin [-1,1]×[-1,1]×[0,4] (middle z 2, 4 tall) and a ring [-3,3]×[-3,3]×[1,3] (middle z 2, 2 tall) share the middle (0,0,2):
  // pushing out from the middle moves neither, so the later one is lifted by the tallest height of the two (4) times the spread.
  // At spread 1 the ring goes to z 5..7, above the pin's top at 4; at 0.5 it is lifted 2.
  const pin = boxBody("body:feature-1", [-1, -1, 0], [1, 1, 4]);
  const ring = boxBody("body:feature-2", [-3, -3, 1], [3, 3, 3]);
  close(explodeOffsets([pin, ring], 1).get("body:feature-2"), [0, 0, 4], "ring at 1");
  close(explodeOffsets([pin, ring], 1).get("body:feature-1"), [0, 0, 0], "the pin, first, stays");
  close(explodeOffsets([pin, ring], 0.5).get("body:feature-2"), [0, 0, 2], "ring at 0.5");
});

test("nothing moves at spread 0, for one body, or for no bodies; a bad spread is read as the default or clamped", () => {
  const a = boxBody("body:feature-1", [0, 0, 0], [1, 1, 1]);
  const b = boxBody("body:feature-2", [3, 0, 0], [4, 1, 1]);
  for (const [, p] of explodeOffsets([a, b], 0)) close(p, [0, 0, 0], "spread 0");
  close(explodeOffsets([b], 1).get("body:feature-2"), [0, 0, 0], "one body has nothing to move away from");
  assert.equal(explodeOffsets([], 1).size, 0);
  // Spread past 1 is held at 1, below 0 at 0, NaN taken as 0 (the view never jumps).
  close(explodeOffsets([a, b], 7).get("body:feature-2"), [5.5, 0, 0], "held at 1");
  close(explodeOffsets([a, b], -1).get("body:feature-2"), [0, 0, 0], "held at 0");
  close(explodeOffsets([a, b], Number.NaN).get("body:feature-2"), [0, 0, 0], "NaN is 0");
  // The slider's words: a percentage 0..100, else the default.
  assert.equal(readSpread("25"), 0.25);
  assert.equal(readSpread("100"), 1);
  assert.equal(readSpread("abc"), EXPLODE_DEFAULT);
  assert.equal(readSpread("150"), 1);
});

test("the exploded mesh moves each body's points and edge lines by its offset, never a normal, and keeps every list", () => {
  const a = boxBody("body:feature-1", [0, 0, 0], [1, 1, 1]);
  const b = boxBody("body:feature-2", [3, 0, 0], [4, 1, 1]);
  const scene = sceneOf([a, b]);
  const m = explodedMesh(scene, 0.5);
  // A moves -2.75 and B +2.75 along X (the first test): A's first corner (0,0,0) goes to (-2.75,0,0), B's (3,0,0) to
  // (5.75,0,0), and B's line (3,0,0)-(4,1,1) to (5.75,0,0)-(6.75,1,1).
  close(m.positions.slice(0, 3), [-2.75, 0, 0], "A's first corner");
  close(m.positions.slice(24, 27), [5.75, 0, 0], "B's first corner");
  close(m.edge_lines.slice(6, 12), [5.75, 0, 0, 6.75, 1, 1], "B's line");
  assert.deepEqual(m.normals, scene.mesh.normals);
  for (const k of ["positions", "normals", "indices", "triangle_faces", "edge_lines", "edge_line_edges"] as const) assert.equal(m[k].length, scene.mesh[k].length, k);
  assert.equal(explodedMesh(scene, 0), scene.mesh, "spread 0 is the mesh itself");
});
