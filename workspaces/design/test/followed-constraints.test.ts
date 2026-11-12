// Issue #517 (app bug hunt 2026-11-11, A2): a rectangle drawn from a body's
// corner kept only 1 of its 4 Horizontal/Vertical constraints, because a
// constraint could name no point that follows a body (pinned to an edge or
// projected). A typed size or a body edit then bent it into a trapezoid.
// From Design data version 17 a constraint may name followed points as long
// as one of its points is the sketch's own: the solver fixes the followed
// ones where the body puts them (constraints.ts `solverRequest`) and the
// rebuild solves again after following (47d4). A constraint naming only
// followed points (both ends of a side lying on the body, a Fix on a pinned
// point) holds nothing the body doesn't, and could only fight it: refused.
// On the real kernel's solver and build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { DESIGN_VERSION, partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addConstraint, squaredRectangle } from "../src/constraints.ts";
import type { EdgeTarget } from "../src/face-edges.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { editFeature } from "../src/feature-edit.ts";
import { BodyCache, followedDoc, rebuildTimeline } from "../src/rebuild.ts";
import { addFaceSketch, drawRectangle, pinNewPoints } from "../src/sketch.ts";
import { shapeClick, startShape } from "../src/sketch-shapes.ts";

const kernel = nodeKernel();
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const places = (doc: DesignDocument, id: string) => sketchOf(doc, id).points.map((p) => [p.x, p.y]);
const near = (got: number[][], want: number[][], what: string) =>
  assert.ok(got.length === want.length && got.every((p, k) => Math.hypot(p[0] - want[k][0], p[1] - want[k][1]) < 1e-9), `${what}: ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);

/** On a 40 × 30 × 20 box's top (sketch x, y = world x, y): its front left corner and the middle of its front top edge. */
const CORNER: EdgeTarget = { at: [0, 0], kind: "endpoint", name: "front+left&front+top&left+top", feature: "feature-1" };
const MIDDLE: EdgeTarget = { at: [20, 0], kind: "midpoint", name: "front+top", feature: "feature-1" };
const BACK_RIGHT: EdgeTarget = { at: [40, 30], kind: "endpoint", name: "back+right&back+top&right+top", feature: "feature-1" };

function onTop() {
  return addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
}

/** The rectangle (0, 0) to (20, 10) on the top, as the Rectangle tool makes it (squared), then pinned as its clicks are. */
function rectangleFromCorner() {
  const { doc, id } = onTop();
  const made = drawRectangle(doc, id, [0, 0], [20, 10]);
  const squared = squaredRectangle(made.doc, id, made.ids);
  return { doc: pinNewPoints(doc, squared, id, [CORNER, MIDDLE]), id };
}

async function rebuilt(doc: DesignDocument) {
  const build = await rebuildTimeline(doc, new BodyCache(kernel), kernel);
  return { build, doc: followedDoc(doc, build) };
}

test("#517 hand-worked: a rectangle from the box's corner to its edge's middle keeps 3 of its 4 sides squared, and the file opens again", () => {
  const { doc, id } = rectangleFromCorner();
  const s = sketchOf(doc, id);
  // Corners (0, 0) pinned, (20, 0) pinned, (20, 10), (0, 10). The bottom side lies on the box's
  // front edge, both its ends followed: its Horizontal could only fight the body, so it goes.
  // The right and left sides (Vertical) and the top (Horizontal) each have a free end: kept.
  assert.deepEqual(s.pins?.map((p) => p.name), [CORNER.name, MIDDLE.name]);
  assert.deepEqual(s.constraints.map((c) => c.kind), ["vertical", "horizontal", "vertical"]);
  assert.equal(DESIGN_VERSION, 18);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(doc))), doc);
});

test("#517 hand-worked: the box made 60 wide moves the edge's middle to (30, 0), and the rectangle follows as a rectangle", async () => {
  const { doc, id } = rectangleFromCorner();
  const { build, doc: drawn } = await rebuilt(editFeature(doc, "feature-1", { width: 60 }));
  // The front top edge now runs 0 to 60: its middle is (30, 0). The right side's Vertical takes
  // (20, 10) to (30, 10) (the least move keeping x the same as (30, 0)); the top's Horizontal and
  // the left's Vertical already hold. So a 30 × 10 rectangle, not the 2,500 mm³ trapezoid of the bug.
  near(places(drawn, id), [[0, 0], [30, 0], [30, 10], [0, 10]], "the corners");
  const r = build.results[id];
  assert.ok(r.status === "built" && r.constraints === undefined, "no warning: the constraints hold");
});

test("#517 hand-worked: a width typed on the rectangle's top side keeps it square, its pinned corners staying on the box", async () => {
  const { doc, id } = rectangleFromCorner();
  const s = sketchOf(doc, id);
  const [, , c, d] = s.points; // (20, 10) and (0, 10)
  const got = await addConstraint(kernel, doc, id, { kind: "distance", a: d.id, b: c.id, value: 30 });
  // The pinned (0, 0) and (20, 0) can't move, nor (0, 10) on the left Vertical above (0, 0)... but the
  // right Vertical holds (20, 10) above (20, 0), so a top 30 long can't hold: refused, nothing bent.
  assert.ok("refused" in got, "a top of 30 fights the right side standing on the pinned middle");
  assert.deepEqual(sketchOf(doc, id).points, s.points);
});

test("#517: a centre rectangle with a corner on the box's back right corner keeps its other sides squared and follows the box made wider", async () => {
  const { doc: start, id } = onTop();
  let tool = startShape("centre-rectangle", id);
  let doc = start;
  for (const p of [[30, 25], [40, 30]] as const) {
    const r = shapeClick(doc, tool, p);
    [doc, tool] = [r.doc, r.tool];
  }
  doc = pinNewPoints(start, doc, id, [BACK_RIGHT]);
  // Corners (40, 30) pinned, (20, 30), (20, 20), (40, 20): every side has a free end, so all four stay.
  assert.equal(sketchOf(doc, id).constraints.length, 4);
  const { build, doc: drawn } = await rebuilt(editFeature(doc, "feature-1", { width: 60 }));
  // The corner goes to (60, 30); the two sides through it keep (20, 30) level with it and (40, 20)
  // under it, so (60, 20): a 40 × 10 rectangle, with its construction diagonals' centre at (40, 25).
  near(places(drawn, id).slice(0, 4), [[60, 30], [20, 30], [20, 20], [60, 20]], "the corners");
  assert.ok(build.results[id].status === "built");
});

test("#517: a constraint naming only followed points is refused, and a file holding one doesn't open", async () => {
  const { doc, id } = rectangleFromCorner();
  const [a, b] = sketchOf(doc, id).points;
  const both = await addConstraint(kernel, doc, id, { kind: "horizontal", a: a.id, b: b.id });
  assert.ok("refused" in both && /follow/.test(both.refused), "both ends on the body");
  const fix = await addConstraint(kernel, doc, id, { kind: "fix", point: a.id });
  assert.ok("refused" in fix && /follow/.test(fix.refused), "a Fix on a pinned point");
  const bad = { ...doc, sketches: doc.sketches.map((s) => (s.id === id ? { ...s, constraints: [...s.constraints, { id: `constraint-${doc.nextId}`, kind: "horizontal", a: a.id, b: b.id }] } : s)), nextId: doc.nextId + 1 };
  assert.throws(() => readDesignDocument(JSON.parse(JSON.stringify(bad))), /only points that follow a body/);
});

test("#517 version 17: version 16 data holding a constraint on a followed point is refused, saying so; without one it opens as 17", () => {
  const { doc } = rectangleFromCorner();
  const raw = JSON.parse(JSON.stringify(doc));
  assert.throws(() => readDesignDocument({ ...raw, version: 16 }), { message: "Design data says version 16 but has a constraint on a point that follows a body, which version 17 brought" });
  // The same rectangle drawn away from the box's edges (nothing pinned): version 16 could hold it, so it opens as 17.
  const { doc: top, id } = onTop();
  const made = drawRectangle(top, id, [5, 5], [15, 15]);
  const free = JSON.parse(JSON.stringify(squaredRectangle(made.doc, id, made.ids)));
  assert.equal(readDesignDocument({ ...free, version: 16 }).version, 18);
});
