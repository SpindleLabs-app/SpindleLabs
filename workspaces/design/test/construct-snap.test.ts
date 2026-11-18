// Step 59a3b2: a sketch snaps onto construction points (construct-snap.ts
// `constructSnapPoints`, snap.ts `BodySnaps.constructs`). Every place is
// worked out by hand from the frames: a point p seen square onto a plane
// with origin o, x axis x and normal n lands at ((p − o)·x, (p − o)·(n × x)),
// whatever its height off the plane. Then the reach at 0.9× and 1.1× of
// SNAP_PIXELS, what wins where several snaps meet, every way a point is
// hidden (its eye, the Construction folder's, suppressed, rolled back, after
// the sketch), and one real-kernel case: the box's corner made a point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SketchXY } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertConstruct } from "../src/construct.ts";
import { cornerRef, type ConstructAnswer } from "../src/construct-data.ts";
import { constructSnapPoints } from "../src/construct-snap.ts";
import { EYE_FOLDERS, partDocument, type DesignDocument } from "../src/document.ts";
import { addConstructSketch, addSketch, sketchPlane } from "../src/sketch.ts";
import { hideRow, moveMarker, suppressItem } from "../src/timeline-edits.ts";
import type { EdgeTarget } from "../src/face-edges.ts";
import type { LineTool } from "../src/sketch-tool.ts";
import { MARK_PIXELS, SNAP_PIXELS, snapLabel, snapMarks, snapOnSketch, snapTargets, type BodySnaps } from "../src/snap.ts";
import { BodyCache, followedDoc, rebuildTimeline } from "../src/rebuild.ts";
import { designNames } from "../src/boolean-names.ts";
import { namedBody } from "../src/built-body.ts";
import { heldEdgeNames } from "../src/design-edges.ts";

const point = (at: [number, number, number]): ConstructAnswer => ({ kind: "point", point: at });
const PLANE: ConstructAnswer = { kind: "plane", point: [0, 0, 0], normal: [0, 0, 1], near: [0, 0, 0] };
const AXIS: ConstructAnswer = { kind: "axis", point: [0, 0, 0], direction: [1, 0, 0], near: [0, 0, 0] };
const box = () => partDocument("box", 40, 30, 20);

/** A construction point kept at `at` (the answer the rebuild keeps; the snap reads only that), then a sketch on `plane` after it. */
function pointThenSketch(at: [number, number, number], plane: "XY" | "XZ" | "YZ" = "XY", doc: DesignDocument = box()) {
  const c = insertConstruct(doc, "point_at", { point: "O" }, undefined, point(at));
  const s = addSketch(c.doc, plane);
  return { doc: s.doc, point: c.id, sketch: s.id };
}
const snapsOf = (doc: DesignDocument, sketch: string) => constructSnapPoints(doc, sketch, sketchPlane(doc, sketch));
const line = (sketch: string): LineTool => ({ kind: "line", sketch, from: null });
const body = (constructs: readonly SketchXY[]): BodySnaps => ({ curves: [], corners: [], constructs });

test("hand-worked: a point at the box's corner (40, 30, 20) lands at (40, 30) on XY, (40, 20) on XZ, (30, 20) on YZ", () => {
  // XY: o = 0, x = (1, 0, 0), n = (0, 0, 1), n × x = (0, 1, 0): (40, 30); the 20 up is along n and dropped.
  const xy = pointThenSketch([40, 30, 20], "XY");
  assert.deepEqual(snapsOf(xy.doc, xy.sketch), [[40, 30]]);
  // XZ: x = (1, 0, 0), n = (0, −1, 0), n × x = (−1·0 − 0·0, 0·1 − 0·0, 0·0 − (−1)·1) = (0, 0, 1): (40, 20).
  const xz = pointThenSketch([40, 30, 20], "XZ");
  assert.deepEqual(snapsOf(xz.doc, xz.sketch), [[40, 20]]);
  // YZ: x = (0, 1, 0), n = (1, 0, 0), n × x = (0, 0, 1): (30, 20).
  const yz = pointThenSketch([40, 30, 20], "YZ");
  assert.deepEqual(snapsOf(yz.doc, yz.sketch), [[30, 20]]);
});

test("hand-worked: on a construction plane 10 above XY the same corner still lands at (40, 30)", () => {
  // The plane z = 10, normal (0, 0, 1); its sketch's frame: origin (0, 0, 10), x the world's x seen on it, (1, 0, 0).
  const plane = insertConstruct(box(), "offset_plane", { plane: "XY" }, 10, { kind: "plane", point: [0, 0, 10], normal: [0, 0, 1], near: [0, 0, 10] });
  const c = insertConstruct(plane.doc, "point_at", { point: "O" }, undefined, point([40, 30, 20]));
  const s = addConstructSketch(c.doc, plane.id);
  const frame = sketchPlane(s.doc, s.id);
  assert.deepEqual([frame.origin, frame.xAxis, frame.normal], [[0, 0, 10], [1, 0, 0], [0, 0, 1]]);
  // p − o = (40, 30, 10): x 40, y (n × x = (0, 1, 0)) 30; the 10 above the plane dropped.
  assert.deepEqual(snapsOf(s.doc, s.id), [[40, 30]]);
});

test("hand-worked: a point off the plane, below it, snaps to its foot", () => {
  // (10, 5, −7) under XY: its foot (10, 5, 0), so (10, 5).
  const { doc, sketch } = pointThenSketch([10, 5, -7]);
  assert.deepEqual(snapsOf(doc, sketch), [[10, 5]]);
  // Pixel 0.5 mm, reach 5 mm: the pointer at (12, 6) is √(4 + 1) ≈ 2.24 away, so it lands on (10, 5) exactly.
  const s = snapOnSketch(doc, line(sketch), [12, 6], [12, 6], 0.5, [], body(snapsOf(doc, sketch)));
  assert.deepEqual(s, { kind: "construction", at: [10, 5] });
  assert.equal(snapLabel(s), "construction point 10,5");
});

test("the reach: 0.9 × SNAP_PIXELS away snaps, 1.1 × does not", () => {
  const { doc, sketch } = pointThenSketch([40, 30, 20]);
  const pixel = 0.5;
  const reach = SNAP_PIXELS * pixel; // 5 mm
  const near: SketchXY = [40 + 0.9 * reach, 30];
  const far: SketchXY = [40 + 1.1 * reach, 30];
  assert.deepEqual(snapOnSketch(doc, line(sketch), near, near, pixel, [], body(snapsOf(doc, sketch))), { kind: "construction", at: [40, 30] });
  // 5.5 mm off and no point or line-up near: the rounded point. (Its row y = 30 is no guide: a construction point is no row.)
  assert.deepEqual(snapOnSketch(doc, line(sketch), far, far, pixel, [], body(snapsOf(doc, sketch))), { kind: "grid", at: far });
});

test("a construction point is never a column or row to line up with", () => {
  const { doc, sketch } = pointThenSketch([40, 30, 20]);
  // (70, 30.5): 0.5 off the point's row, 30 off it: no snap, only the grid's point.
  const t = snapTargets(doc.sketches.find((s) => s.id === sketch)!, line(sketch), [], body(snapsOf(doc, sketch)));
  assert.ok(!t.rows.some((r) => r[1] === 30) && !t.columns.some((c) => c[0] === 40), JSON.stringify(t));
  assert.deepEqual(snapOnSketch(doc, line(sketch), [70, 30.5], [70, 30.5], 0.5, [], body(snapsOf(doc, sketch))), { kind: "grid", at: [70, 30.5] });
});

test("order: a body's corner at the same place wins (and pins); the construction point wins over the origin", () => {
  const { doc, sketch } = pointThenSketch([40, 30, 20]);
  const corner: EdgeTarget = { at: [40, 30], kind: "endpoint", name: "corner", feature: "feature-1" };
  const s = snapOnSketch(doc, line(sketch), [41, 31], [41, 31], 0.5, [corner], body(snapsOf(doc, sketch)));
  assert.deepEqual(s, { kind: "endpoint", at: [40, 30], edge: true });
  // A construction point at the world's origin: listed before the origin, so taken there.
  const o = pointThenSketch([0, 0, 0]);
  assert.deepEqual(snapOnSketch(o.doc, line(o.sketch), [1, 1], [1, 1], 0.5, [], body(snapsOf(o.doc, o.sketch))), { kind: "construction", at: [0, 0] });
});

test("its mark: a square with an X through it, MARK_PIXELS out", () => {
  const m = MARK_PIXELS * 0.5;
  const marks = snapMarks({ kind: "construction", at: [10, 5] }, 0.5);
  // Four sides of the square (10 ± m, 5 ± m), then its two diagonals.
  assert.equal(marks.length, 6);
  assert.deepEqual(marks[4], [[10 - m, 5 - m], [10 + m, 5 + m]]);
  assert.deepEqual(marks[5], [[10 - m, 5 + m], [10 + m, 5 - m]]);
});

test("hidden by its eye or the Construction folder's, suppressed, rolled back or after the sketch: never snapped to", () => {
  const { doc, point: id, sketch } = pointThenSketch([40, 30, 20]);
  assert.equal(snapsOf(doc, sketch).length, 1);
  assert.deepEqual(snapsOf(hideRow(doc, id, true), sketch), []);
  assert.deepEqual(snapsOf(hideRow(doc, EYE_FOLDERS.constructions, true), sketch), []);
  // Shown again: back.
  assert.equal(snapsOf(hideRow(hideRow(doc, id, true), id, false), sketch).length, 1);
  assert.deepEqual(snapsOf(suppressItem(doc, id, true), sketch), []);
  // The marker on the box: the point rolled back.
  assert.deepEqual(snapsOf(moveMarker(doc, "feature-1"), sketch), []);
  // The sketch first, the point after it: the sketch sees nothing after it (as with bodies).
  const s = addSketch(box());
  const late = insertConstruct(s.doc, "point_at", { point: "O" }, undefined, point([40, 30, 20]));
  assert.deepEqual(snapsOf(late.doc, s.id), []);
  // A sketch not in the timeline sees none.
  assert.deepEqual(constructSnapPoints(doc, "sketch-404", sketchPlane(doc, sketch)), []);
});

test("planes and axes are not points to snap to", () => {
  const p = insertConstruct(box(), "offset_plane", { plane: "XY" }, 5, PLANE);
  const a = insertConstruct(p.doc, "axis_along", { line: "X" }, undefined, AXIS);
  const s = addSketch(a.doc);
  assert.deepEqual(snapsOf(s.doc, s.id), []);
});

test("several points, in timeline order", () => {
  const one = pointThenSketch([1, 2, 3]);
  const two = insertConstruct(box(), "point_at", { point: "O" }, undefined, point([1, 2, 3]));
  const three = insertConstruct(two.doc, "point_at", { point: "O" }, undefined, point([-4, 5, 6]));
  const s = addSketch(three.doc);
  assert.deepEqual(snapsOf(one.doc, one.sketch), [[1, 2]]);
  assert.deepEqual(snapsOf(s.doc, s.id), [[1, 2], [-4, 5]]);
});

test("real kernel: a point made at the box's top corner (40, 30, 20), built, snaps a sketch on XY at (40, 30)", async () => {
  const kernel = nodeKernel();
  const doc0 = box();
  // The held names of the three edges meeting at (40, 30, 20).
  const cache = new BodyCache(kernel);
  let edges: string[];
  try {
    const build = await rebuildTimeline(doc0, cache, kernel);
    const ids = Object.keys(build.bodies);
    const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
    const view = list[0].view;
    const held = heldEdgeNames(designNames(list), 0);
    const v = view.vertex_points.findIndex((q) => [40, 30, 20].every((x, i) => Math.abs(q[i] - x) < 1e-9));
    edges = view.edge_vertices.flatMap((ends, e) => (ends.includes(v) ? [held[e]!] : []));
  } finally {
    await cache.clear();
  }
  assert.equal(edges.length, 3);
  // Inserted with a wrong answer (the origin): the rebuild finds the corner and the settled design keeps it.
  const c = insertConstruct(doc0, "point_at", { point: cornerRef(edges) }, undefined, point([0, 0, 0]));
  const settle = new BodyCache(kernel);
  let doc: DesignDocument;
  try {
    doc = followedDoc(c.doc, await rebuildTimeline(c.doc, settle, kernel));
  } finally {
    await settle.close();
  }
  const s = addSketch(doc);
  assert.deepEqual(snapsOf(s.doc, s.id), [[40, 30]]);
});

// Planted bugs: construct-snap.ts loaded from a temporary copy with one change; each must fail a check above.
const SOURCE = new URL("../src/construct-snap.ts", import.meta.url);
const PLANTS = [
  { name: "plane-ignored", find: "[inSketch(d.answer.point, plane)]", replace: "[[d.answer.point[0], d.answer.point[1]] as SketchXY]" },
  { name: "after-the-sketch-too", find: "d.answer.kind === \"point\" && before.has(d.item)", replace: "d.answer.kind === \"point\"" },
  { name: "hidden-too", find: "drawnConstructs(doc, null)", replace: "doc.timeline.features.filter((f) => f.intent.type === \"construct\" && !f.suppressed).map((f) => ({ item: f.id, answer: f.intent.parameters.answer as unknown as ConstructAnswerT }))" },
];

test("planted bugs in construct-snap.ts are caught; the copy unplanted passes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "construct-snap-"));
  try {
    const load = async (name: string, find: string, replace: string) => {
      let text = readFileSync(SOURCE, "utf8");
      assert.equal(text.split(find).length, 2, `${name}: the text must be there once`);
      text = text.replace(find, replace).replace('import type { Plane, SketchXY } from "@fission/core";', 'import type { Plane, SketchXY } from "@fission/core";\ntype ConstructAnswerT = import("./construct-data.ts").ConstructAnswer;');
      text = text.replace(/(from |import\()"\.\/([^"]+)"/g, (_, k, f) => `${k}"${new URL(f, SOURCE).href}"`);
      const file = join(dir, `${name}.ts`);
      writeFileSync(file, text);
      return (await import(pathToFileURL(file).href)) as typeof import("../src/construct-snap.ts");
    };
    const checks = (m: typeof import("../src/construct-snap.ts")): string | null => {
      const of = (d: DesignDocument, s: string) => m.constructSnapPoints(d, s, sketchPlane(d, s));
      const xz = pointThenSketch([40, 30, 20], "XZ");
      if (JSON.stringify(of(xz.doc, xz.sketch)) !== "[[40,20]]") return "XZ";
      const s = addSketch(box());
      const late = insertConstruct(s.doc, "point_at", { point: "O" }, undefined, point([40, 30, 20]));
      if (of(late.doc, s.id).length !== 0) return "after";
      const h = pointThenSketch([40, 30, 20]);
      if (of(hideRow(h.doc, h.point, true), h.sketch).length !== 0) return "hidden";
      return null;
    };
    assert.equal(checks(await load("unplanted", "export function", "export function")), null);
    for (const p of PLANTS) assert.notEqual(checks(await load(p.name, p.find, p.replace)), null, `${p.name} was not caught`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
