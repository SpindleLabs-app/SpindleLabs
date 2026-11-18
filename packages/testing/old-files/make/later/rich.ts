// A design using each version's additions, made with checkout ROOT's own functions up to LEVEL (the Design data
// version whose features to use), built on its own kernel with pieces numbered; saved with units in inches.
import { writeFileSync } from "node:fs";
const ROOT = process.env.ROOT!;
const LEVEL = Number(process.env.LEVEL);
const { emptyProject, projectToJson } = await import(`${ROOT}/packages/core/src/index.ts`);
const { nodeKernel } = await import(`${ROOT}/packages/testing/src/node-kernel.ts`);
const D = await import(`${ROOT}/workspaces/design/src/document.ts`);
const R = await import(`${ROOT}/workspaces/design/src/rebuild.ts`);
const M = await import(`${ROOT}/workspaces/design/src/move.ts`);
const S = await import(`${ROOT}/workspaces/design/src/sketch.ts`);
const E = await import(`${ROOT}/workspaces/design/src/extrude.ts`);
const T = await import(`${ROOT}/workspaces/design/src/timeline-edits.ts`);
const C = await import(`${ROOT}/workspaces/design/src/construction.ts`);
const kernel = nodeKernel();
async function build(doc: any) {
  const cache = new R.BodyCache(kernel);
  const b = await R.rebuildTimeline(doc, cache, kernel);
  const bodies: Record<string, unknown> = {};
  for (const id of Object.keys(b.bodies).sort()) { const v = await cache.view(b.bodies[id].handle); bodies[id] = { volume: +v.volume.toFixed(4), bounds: v.bounds.map((p: number[]) => p.map((x) => +x.toFixed(6))) }; }
  const failed = Object.entries(b.results).filter(([, x]: any) => x.status !== "built").map(([k, x]: any) => `${k}:${x.status}:${x.message ?? ""}`);
  await cache.close();
  const numbered = R.builtPieceFaces ? D.numberPieces(doc, Object.keys(b.bodies), R.builtPieceFaces(b)) : D.numberPieces(doc, Object.keys(b.bodies));
  return { doc: numbered, bodies, failed };
}
let doc: any = D.partDocument("box", 40, 30, 20);
const box = doc.timeline.features[0].id;
// Sketch 1: rectangle x 50..60, y 0..10 plus a construction line across it; extruded 5 (a new body).
let s = S.addSketch(doc); doc = S.drawRectangle(s.doc, s.id, [50, 0], [60, 10]).doc;
const ln = S.drawLine(doc, s.id, [50, 0], [60, 10]); doc = C.toggleConstruction(ln.doc, s.id, [ln.id]).doc;
const e1 = E.extrudeSketch(doc, s.id, 5); doc = e1.doc;
let r = await build(doc); doc = r.doc;
// Sketch 2: circle r 2 at (20, 15), fit-tagged (14), extruded 20 cutting the box (10) or as its own body.
s = S.addSketch(doc);
doc = S.drawRectangle(s.doc, s.id, [18, 13], [22, 17]).doc;
const e2 = LEVEL >= 10 ? E.extrudeSketch(doc, s.id, 20, false, undefined, { operation: "cut", bodies: [`body:${box}`] }) : E.extrudeSketch(doc, s.id, 20);
doc = e2.doc; r = await build(doc); doc = r.doc;
// Sketch 3, not extruded: a circle r 2 at (5, 5), fit-tagged (14).
s = S.addSketch(doc);
doc = (LEVEL >= 14 ? S.drawCircle(s.doc, s.id, [5, 5], 2, { role: "hole", kind: "bolt-normal" }) : S.drawCircle(s.doc, s.id, [5, 5], 2)).doc;
// Move the rectangle body up 7 (scaled 2 about its corner from 12).
const mv = LEVEL >= 12 ? M.insertMove(doc, [`body:${e1.id}`], { ...M.NO_MOVE, pivotX: 50, scale: 2 }, "scale") : M.insertMove(doc, [`body:${e1.id}`], { ...M.NO_MOVE, z: 7 });
doc = mv.doc; r = await build(doc); doc = r.doc;
// A copy of the box (11), mirrored across YZ (12), then suppressed.
if (LEVEL >= 11) {
  const Dup = await import(`${ROOT}/workspaces/design/src/duplicate.ts`);
  const d = LEVEL >= 12 ? Dup.insertDuplicates(doc, [`body:${box}`], "YZ") : Dup.insertDuplicates(doc, [`body:${box}`]);
  doc = d.doc; r = await build(doc); doc = r.doc;
  doc = T.suppressItem(doc, d.ids[0], true); r = await build(doc); doc = r.doc;
}
doc = T.hideBody(doc, `body:${box}`, true); r = await build(doc); doc = r.doc;
const p = emptyProject("Rich"); p.units = { length: "in" }; p.workspaces.design = doc;
writeFileSync(process.argv[2], projectToJson(p));
console.log(JSON.stringify({ version: doc.version, bodies: r.bodies, failed: r.failed }));
