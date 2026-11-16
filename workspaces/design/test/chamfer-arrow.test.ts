// Chamfer's drag arrow and red wedge (chamfer-arrow.ts, Ben 2026-11-16), on
// the real kernel. The hand-worked numbers are beside each assertion; the
// kernel's own chamfer faces are a second, independent check of where the
// arrow and the wedge stand.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyHandle, BodyView, ChamferSize } from "@fission/core";
import { KernelError } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { chamferArrow, chamferDistances, CHAMFER_DRAG_STEP, edgeFrame, refusedEdges, snapChamfer, wedgeMesh } from "../src/chamfer-arrow.ts";
import { partDocument } from "../src/document.ts";
import type { ShapeKind } from "../src/profiles.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { cylinderView } from "./views.ts";

const kernel = nodeKernel();
const near = (got: number, want: number, what = "") => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${what} ${got}, expected ${want}`);
const nearPoint = (got: readonly number[], want: readonly number[], what = "") => got.forEach((g, k) => near(g, want[k], `${what}[${k}]`));

/** A preset's body as the kernel builds it: its handle (held until `done`) and view. */
async function built(kind: ShapeKind, w: number, d: number, h: number): Promise<{ handle: BodyHandle; view: BodyView; done: () => Promise<void> }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(partDocument(kind, w, d, h), cache, kernel);
  const body = build.bodies["body:feature-1"];
  return { handle: body.handle, view: await cache.view(body.handle), done: () => cache.close() };
}

/** The 10 mm cube's top front edge (y = 0, z = 10, x 0..10). */
function topFront(view: BodyView): number {
  const on = (p: readonly number[]) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9;
  const edges = view.edge_vertices.flatMap(([a, b], e) => (on(view.vertex_points[a]) && on(view.vertex_points[b]) ? [e] : []));
  assert.equal(edges.length, 1);
  return edges[0];
}

/** The volume a closed triangle mesh holds, by the divergence theorem (sum of signed tetrahedra from the origin): positive when wound outwards. */
function meshVolume(positions: readonly number[], indices: readonly number[]): number {
  let v = 0;
  for (let k = 0; k < indices.length; k += 3) {
    const [a, b, c] = [0, 1, 2].map((i) => positions.slice(3 * indices[k + i], 3 * indices[k + i] + 3));
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

test("hand-worked: the arrow for a 2 mm chamfer of the cube's top front edge stands on its first face, 2 mm back from the edge's middle", async () => {
  const cube = await built("box", 10, 10, 10);
  try {
    const e = topFront(cube.view);
    const first = cube.view.face_normals[cube.view.edge_faces[e]![0]]!;
    const arrow = chamferArrow(cube.view, e, false, 2)!;
    // The edge's middle is (5, 0, 10). The first face is the one running the edge forwards: if it is the top (normal +z),
    // the top lies at y > 0 from the edge, so the way into it is (0, 1, 0) and the foot (5, 2, 10); if it is the front
    // (normal −y), the front lies below z = 10, so the way is (0, 0, −1) and the foot (5, 0, 8).
    nearPoint(arrow.base, [5, 0, 10], "base");
    near(arrow.distance, 2, "distance");
    if (first[2] > 0.5) nearPoint(arrow.direction, [0, 1, 0], "direction on the top");
    else {
      nearPoint(first, [0, -1, 0], "the first face is the front");
      nearPoint(arrow.direction, [0, 0, -1], "direction down the front");
    }
    // Flip stands it on the other face.
    const flipped = chamferArrow(cube.view, e, true, 2)!;
    near(Math.abs(flipped.direction[1]) + Math.abs(flipped.direction[2]), 1, "on the other face");
    assert.notDeepEqual(flipped.direction, arrow.direction);
  } finally {
    await cube.done();
  }
});

test("hand-worked: distance and angle on a square edge, 2 mm at 30°: d2 = 2 sin 30° / sin(90° + 30°) = 2 / √3", () => {
  const d = chamferDistances({ angle: [2, 30] }, [0, 1, 0], [0, 0, -1])!;
  near(d[0], 2);
  near(d[1], 2 / Math.sqrt(3));
  // At 45° both distances are equal (tan 45° = 1); an angle the faces leave no room for (φ + θ ≥ 180°) has none.
  near(chamferDistances({ angle: [2, 45] }, [0, 1, 0], [0, 0, -1])![1], 2);
  assert.equal(chamferDistances({ angle: [2, 90] }, [0, 1, 0], [0, 0, -1]), null);
});

test("hand-worked: the red wedge of a 10 mm edge holds the material the chamfer takes off: 10 · 2 · 2 / 2 = 20 mm³, and 10 · 2 · 3 / 2 = 30 mm³, wound outwards", async () => {
  const cube = await built("box", 10, 10, 10);
  try {
    const e = topFront(cube.view);
    const equal = wedgeMesh(cube.view, [e], { equal: 2 }, false)!;
    near(meshVolume(equal.positions, equal.indices), 20, "equal");
    const two = wedgeMesh(cube.view, [e], { two: [2, 3] }, true)!;
    near(meshVolume(two.positions, two.indices), 30, "two, flipped");
    assert.equal(two.edge_lines.length, 9 * 6, "nine edges, two points of three numbers each");
    // Every corner lies in the cube: x 0..10, y 0..3, z 7..10.
    for (let k = 0; k < two.positions.length; k += 3) {
      const [x, y, z] = two.positions.slice(k, k + 3);
      assert.ok(x > -1e-9 && x < 10 + 1e-9 && y > -1e-9 && y < 3 + 1e-9 && z > 7 - 1e-9 && z < 10 + 1e-9, `corner ${x}, ${y}, ${z}`);
    }
    // Two edges: twice the material; an edge it can't place (none there) is left out, and with none left there is no mesh.
    const right = cube.view.edge_vertices.findIndex(([a, b]) => [a, b].every((v) => Math.abs(cube.view.vertex_points[v][0] - 10) < 1e-9 && Math.abs(cube.view.vertex_points[v][2] - 10) < 1e-9));
    near(meshVolume(...((m) => [m.positions, m.indices] as const)(wedgeMesh(cube.view, [e, right, 999], { equal: 2 }, false)!)), 40, "two edges");
    assert.equal(wedgeMesh(cube.view, [999], { equal: 2 }, false), null);
  } finally {
    await cube.done();
  }
});

/** The corners of the chamfer's own face in the kernel's answer for edge `e` of `view` at `size`, sorted. */
async function kernelChamferCorners(handle: BodyHandle, e: number, size: ChamferSize, flip: boolean): Promise<number[][]> {
  const out = await kernel.call("body_chamfer", handle, [e], size, flip);
  try {
    const view = await kernel.call("body_view", out.body);
    const face = out.faces.findIndex((f) => f.from === "edge");
    const corners = new Set<number>();
    view.edge_faces.forEach((pair, k) => pair?.includes(face) && view.edge_vertices[k].forEach((v) => corners.add(v)));
    return [...corners].map((v) => view.vertex_points[v]).sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  } finally {
    await kernel.call("body_free", out.body);
  }
}

test("the wedge's chamfer face is the kernel's own, corner for corner, for every size kind, flipped and not (an independent check of a, b, d1, d2)", async () => {
  const cube = await built("box", 10, 10, 10);
  try {
    const sizes: ChamferSize[] = [{ equal: 2 }, { two: [2, 3] }, { angle: [2, 30] }, { angle: [1.5, 60] }];
    // Every edge of the cube, so each way an edge can run is met.
    for (let e = 0; e < cube.view.edges; e++) {
      for (const size of sizes) {
        for (const flip of "equal" in size ? [false] : [false, true]) {
          const f = edgeFrame(cube.view, e, flip)!;
          const [d1, d2] = chamferDistances(size, f.a, f.b)!;
          const at = (p: number[], dir: number[], d: number) => p.map((c, k) => c + d * dir[k]);
          const mine = [at(f.p0, f.a, d1), at(f.p1, f.a, d1), at(f.p0, f.b, d2), at(f.p1, f.b, d2)].sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
          const theirs = await kernelChamferCorners(cube.handle, e, size, flip);
          assert.equal(theirs.length, 4);
          mine.forEach((p, k) => nearPoint(p, theirs[k], `edge ${e} ${JSON.stringify(size)} flip ${flip}`));
          // And the arrow's foot is on the first contact line, at the edge's middle.
          const arrow = chamferArrow(cube.view, e, flip, d1)!;
          nearPoint(at(arrow.base, arrow.direction, arrow.distance), at(f.mid, f.a, d1));
        }
      }
    }
  } finally {
    await cube.done();
  }
});

test("an inside corner the kernel refuses names its edge: that edge's wedge is drawn, lying in the empty corner (the way into the first face heads out of the second)", async () => {
  const bracket = await built("l-bracket", 40, 20, 30);
  try {
    let found = 0;
    for (let e = 0; e < bracket.view.edges; e++) {
      if (bracket.view.edge_types[e] !== "line") continue;
      let refused: KernelError | null = null;
      try {
        const out = await kernel.call("body_chamfer", bracket.handle, [e], { equal: 1 }, false);
        await kernel.call("body_free", out.body);
      } catch (err) {
        refused = err as KernelError;
      }
      if (refused === null || !/inside corner/.test(refused.message) || /ends at/.test(refused.message)) continue;
      found++;
      assert.ok(refused instanceof KernelError);
      assert.deepEqual(refusedEdges(refused.inputs, [e]), [e], "the refusal names the edge");
      const f = edgeFrame(bracket.view, e, false)!;
      const second = bracket.view.face_normals[bracket.view.edge_faces[e]![1]]!;
      assert.ok(f.a[0] * second[0] + f.a[1] * second[1] + f.a[2] * second[2] > 0.5, "inside: the wedge lies outside the body");
      const wedge = wedgeMesh(bracket.view, [e], { equal: 1 }, false)!;
      // The bracket's outline is drawn in x, y (its inside corner at 0.3 of each) and extruded 30 mm up z, so its inside
      // edge is the 30 mm upright one at (12, 6): 30 · 1 · 1 / 2 = 15 mm³.
      const [p, q] = bracket.view.edge_vertices[e].map((v) => bracket.view.vertex_points[v]);
      nearPoint([p[0], p[1], Math.abs(q[2] - p[2])], [12, 6, 30], "the inside edge");
      near(meshVolume(wedge.positions, wedge.indices), 15, "the wedge");
    }
    assert.equal(found, 1, "an L-bracket has one inside edge");
  } finally {
    await bracket.done();
  }
});

test("refusedEdges: the picked edges a refusal names; every picked edge when it names none of them", () => {
  assert.deepEqual(refusedEdges([{ input: "edge", body: 0, edge: 3 }], [1, 3]), [3]);
  assert.deepEqual(refusedEdges([{ input: "edge", body: 0, edge: 3 }, { input: "edge", body: 0, edge: 3 }], [3, 1]), [3], "once");
  assert.deepEqual(refusedEdges([{ input: "param", name: "distance" }], [1, 3]), [1, 3], "a size");
  assert.deepEqual(refusedEdges([{ input: "edge", body: 0, edge: 7 }], [1, 3]), [1, 3], "an edge not picked");
  assert.deepEqual(refusedEdges([], [2]), [2]);
});

test("snapChamfer: 0.1 mm steps, never below one step, never past the most a chamfer holds; boundaries either side of each half step", () => {
  assert.equal(CHAMFER_DRAG_STEP, 0.1);
  assert.equal(snapChamfer(2.26, 1e6), 2.3);
  assert.equal(snapChamfer(2.24, 1e6), 2.2);
  // Either side of 0.15, the half step between 0.1 and 0.2 (0.9× and 1.1× of the half step past 0.1).
  assert.equal(snapChamfer(0.1 + 0.05 * 0.9, 1e6), 0.1);
  assert.equal(snapChamfer(0.1 + 0.05 * 1.1, 1e6), 0.2);
  // A drag back to, or past, the edge stops at one step: a chamfer of 0 cuts nothing.
  assert.equal(snapChamfer(0.04, 1e6), 0.1);
  assert.equal(snapChamfer(0, 1e6), 0.1);
  assert.equal(snapChamfer(-5, 1e6), 0.1);
  assert.equal(snapChamfer(Number.NaN, 1e6), 0.1);
  assert.equal(snapChamfer(0.3, 1e6), 0.3, "no float dust: 3 · 0.1 is 0.30000000000000004");
  assert.equal(snapChamfer(7, 5), 5);
});

test("no arrow for a curved edge, an edge not there, or no distance", () => {
  const cylinder = cylinderView(5, 10);
  assert.equal(chamferArrow(cylinder, 0, false, 1), null);
  assert.equal(edgeFrame(cylinder, 99, false), null);
  assert.equal(edgeFrame(cylinder, -1, false), null);
});

test("no arrow at no distance", async () => {
  const cube = await built("box", 10, 10, 10);
  try {
    assert.equal(chamferArrow(cube.view, 0, false, 0), null);
    assert.equal(chamferArrow(cube.view, 0, false, -1), null);
    assert.notEqual(chamferArrow(cube.view, 0, false, 0.001), null);
  } finally {
    await cube.done();
  }
});
