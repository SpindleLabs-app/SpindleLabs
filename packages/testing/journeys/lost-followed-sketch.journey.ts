// Bug hunt 2 (C2, 2026-11-04): an extrude whose sketch follows a body (a
// corner snapped to a box's corner, 27c, or edges projected from it, 27d)
// and loses its outline when that body changes keeps its last shape with a
// warning, as the owner's rule for a lost sketch says (24d2, rebuild.ts
// settleKept), instead of failing and taking its body away. It failed when
// the design had no sketch on a face (the app skipped settling the edit),
// and settleKept decided the kept shapes before the snapped points moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSketch,
  BodyCache,
  changePreset,
  designWorkspace,
  drawLine,
  extrudeSketch,
  insertMove,
  joinBodies,
  NO_MOVE,
  partDocument,
  pinNewPoints,
  projectEdges,
  projectPick,
  rebuildTimeline,
  settleKept,
  shownBodies,
  type DesignDocument,
  type EdgeTarget,
} from "@fission/design";
import { app, close, kernel } from "./design-app.ts";

const CORNER = "back+bottom&back+right&bottom+right"; // Box 1's bottom back right corner, (width, depth, 0)

/**
 * `doc` with Sketch 1 on XY: the four-sided outline (0, −20), (60, −20), (60, 40), `last`, its last corner snapped to
 * Box 1's bottom back right corner (`last` itself), extruded 5.
 */
function snapped(start: DesignDocument, last: [number, number]): DesignDocument {
  const s = addSketch(start);
  let doc = s.doc;
  const pts: [number, number][] = [[0, -20], [60, -20], [60, 40], last];
  for (let i = 0; i < 4; i++) {
    const sk = doc.sketches.find((x) => x.id === s.id)!;
    const at = (p: [number, number]) => sk.points.find((q) => q.x === p[0] && q.y === p[1])?.id ?? p;
    doc = drawLine(doc, s.id, at(pts[i]), at(pts[(i + 1) % 4])).doc;
  }
  const corner: EdgeTarget = { at: last, kind: "endpoint", name: CORNER, feature: "feature-1" };
  doc = pinNewPoints(s.doc, doc, s.id, [corner]);
  return extrudeSketch(doc, s.id, 5).doc;
}
/** Box 1 (40 × 30 × 20) and Sketch 1 snapped to its corner (40, 30). */
const design = () => snapped(partDocument("box", 40, 30, 20), [40, 30]);

test("hand-worked: the design builds: the box 40 · 30 · 20 = 24000 and the outline's shoelace area 2100 × 5 = 10500 mm³", async () => {
  // Shoelace of (0,−20), (60,−20), (60,40), (40,30): Σ(x_i·y_{i+1} − x_{i+1}·y_i) = (0 + 1200) + (2400 + 1200) + (1800 − 1600) + (0 + 800) = 4200, half 2100.
  const a = await app(design(), designWorkspace);
  assert.ok(close(a.volume(), 24000 + 10500), `${a.volume()}`);
  assert.equal(a.warning(), null);
  assert.ok(await a.close());
});

test("Box 1 made 80 wide by Edit feature: the snapped corner goes to (80, 30), the outline crosses itself, and Extrude 1 keeps its last shape with a warning", async () => {
  const a = await app(design(), designWorkspace);
  const extrude = a.doc().timeline.features.at(-1)!.id;
  assert.equal(await a.menu("feature-1", "edit"), null);
  (a.$("#edit-width") as HTMLInputElement).value = "80";
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  const s = a.doc().sketches[0];
  assert.ok(s.points.some((p) => p.x === 80 && p.y === 30), `the snapped corner followed to (80, 30): ${JSON.stringify(s.points)}`);
  const failed = a.$(`.timeline-bar-item[data-item="${extrude}"]`)!.dataset.failed === "true";
  // 80 · 30 · 20 = 48000 for the box, and the kept outline 10500.
  const got = { volume: a.volume(), extrudeFailed: failed, warning: a.warning(), kept: a.doc().kept?.[extrude] !== undefined, error: a.error() };
  assert.deepEqual({ failed: got.extrudeFailed, kept: got.kept, volume: close(got.volume, 48000 + 10500), warned: got.warning !== null }, { failed: false, kept: true, volume: true, warned: true }, JSON.stringify(got));
  assert.ok(await a.close());
});

test("settleKept on its own (as the naming harness settles every edit): the extrude whose snapped corner crossed its outline keeps the shape and builds", async () => {
  const before = design();
  const after = changePreset(before, "feature-1", "box", 80, 30, 20);
  const settled = await settleKept(kernel, before, after);
  const cache = new BodyCache(kernel);
  try {
    const b = await rebuildTimeline(settled, cache, kernel);
    const r = b.results[settled.timeline.features.at(-1)!.id];
    assert.deepEqual({ kept: settled.kept !== undefined, status: r.status }, { kept: true, status: "built" }, JSON.stringify(r));
  } finally {
    await cache.clear();
  }
});

test("a Move edited so it drags the snapped corner across the outline: the extrude keeps its last shape with a warning", async () => {
  // Box 1 40 × 30 × 20 moved 10 along X by Move 1 (x 10..50), then Sketch 1 snapped to its corner, now (50, 30).
  // Shoelace of (0,−20), (60,−20), (60,40), (50,30): (0 + 1200) + (2400 + 1200) + (1800 − 2000) + (−1000 − 0) = 3600,
  // half 1800, × 5 = 9000. Move 1 made 50 along X: the corner goes to (90, 30), and the side from it back to (0, −20)
  // crosses x = 60 at y = −20 + 50 · 60/90 ≈ 13.3, on the side (60, −20) to (60, 40).
  const moved = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], { ...NO_MOVE, x: 10 });
  const start = snapped(moved.doc, [50, 30]);
  const a = await app(start, designWorkspace);
  assert.ok(close(a.volume(), 24000 + 9000), `as drawn: ${a.volume()}`);
  const extrude = a.doc().timeline.features.at(-1)!.id;
  await a.doubleClick(moved.id);
  const x = a.$("#move-x") as HTMLInputElement;
  assert.equal(x.value, "10", "the edit opened on Move 1");
  x.value = "50";
  x.dispatchEvent(new a.window.Event("input") as unknown as Event);
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  const s = a.doc().sketches[0];
  assert.ok(s.points.some((p) => p.x === 90 && p.y === 30), `the snapped corner followed to (90, 30): ${JSON.stringify(s.points)}`);
  const failed = a.$(`.timeline-bar-item[data-item="${extrude}"]`)!.dataset.failed === "true";
  const got = { volume: a.volume(), extrudeFailed: failed, warning: a.warning(), kept: a.doc().kept?.[extrude] !== undefined, error: a.error() };
  assert.deepEqual({ failed: got.extrudeFailed, kept: got.kept, volume: close(got.volume, 24000 + 9000), warned: got.warning !== null }, { failed: false, kept: true, volume: true, warned: true }, JSON.stringify(got));
  assert.ok(await a.close());
});

test("projected edges: Box 1 made 80 wide takes its projected edge away from the lines that close on it, and the extrude keeps its last shape with a warning", async () => {
  // Box 1 40 × 30 × 20; Sketch 1 on XY with the box's top right edge projected (seen from above, the line (40, 0) to
  // (40, 30)) and two lines of its own, (40, 0) to (70, 15) to (40, 30), closing on it: a triangle of base 30 and height
  // 30, 450 mm², extruded 5: 24000 + 2250. Box 1 made 80 wide: the projected edge goes to x = 80, its ends meet neither
  // line, so it is left out of the outline (profileCurves) and the outline is open. Kept: 80 · 30 · 20 + 2250 = 50250.
  let doc = partDocument("box", 40, 30, 20);
  const s = addSketch(doc);
  doc = s.doc;
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const scene = joinBodies(await shownBodies(doc, build, cache));
    const k = scene.bodies.findIndex((b) => b.feature === "feature-1");
    const view = scene.bodies[k].view;
    const edge = view.edge_vertices.findIndex((vs) => vs.length === 2 && vs.every((v) => view.vertex_points[v][0] === 40 && view.vertex_points[v][2] === 20));
    assert.ok(edge >= 0, "the box has a top right edge, x = 40 and z = 20");
    const r = build.results[s.id];
    assert.ok(r?.status === "built" && r.placement);
    const pick = projectPick(doc, s.id, scene, r.placement.plane, { edge: scene.edgeStart[k] + edge });
    assert.equal(pick.note, null);
    assert.equal(pick.edges.length, 1);
    doc = projectEdges(doc, s.id, pick.edges).doc;
  } finally {
    await cache.clear();
  }
  doc = drawLine(doc, s.id, [40, 0], [70, 15]).doc;
  doc = drawLine(doc, s.id, [70, 15], [40, 30]).doc;
  doc = extrudeSketch(doc, s.id, 5).doc;
  const a = await app(doc, designWorkspace);
  assert.ok(close(a.volume(), 24000 + 2250), `as drawn: ${a.volume()}`);
  const extrude = a.doc().timeline.features.at(-1)!.id;
  assert.equal(await a.menu("feature-1", "edit"), null);
  (a.$("#edit-width") as HTMLInputElement).value = "80";
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  const failed = a.$(`.timeline-bar-item[data-item="${extrude}"]`)!.dataset.failed === "true";
  const got = { volume: a.volume(), extrudeFailed: failed, warning: a.warning(), kept: a.doc().kept?.[extrude] !== undefined, error: a.error() };
  assert.deepEqual({ failed: got.extrudeFailed, kept: got.kept, volume: close(got.volume, 48000 + 2250), warned: got.warning !== null }, { failed: false, kept: true, volume: true, warned: true }, JSON.stringify(got));
  assert.ok(await a.close());
});
