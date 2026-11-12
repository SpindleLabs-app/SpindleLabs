import { writeFileSync } from "node:fs";
const ROOT = process.env.ROOT!;
const { emptyProject, projectToJson } = await import(`${ROOT}/packages/core/src/index.ts`);
const { nodeKernel } = await import(`${ROOT}/packages/testing/src/node-kernel.ts`);
const D = await import(`${ROOT}/workspaces/design/src/document.ts`);
const { extrudeSketch } = await import(`${ROOT}/workspaces/design/src/extrude.ts`);
const { insertMove, NO_MOVE } = await import(`${ROOT}/workspaces/design/src/move.ts`);
const { BodyCache, builtPieceFaces, rebuildTimeline } = await import(`${ROOT}/workspaces/design/src/rebuild.ts`);
const { addSketch, drawRectangle } = await import(`${ROOT}/workspaces/design/src/sketch.ts`);
const { hideBody } = await import(`${ROOT}/workspaces/design/src/timeline-edits.ts`);
const kernel = nodeKernel();
const out = process.argv[2];
const dup = await import(`${ROOT}/workspaces/design/src/duplicate.ts`).catch(() => null);

async function build(doc: any) {
  const cache = new BodyCache(kernel);
  const b = await rebuildTimeline(doc, cache, kernel);
  const bodies: Record<string, unknown> = {};
  for (const id of Object.keys(b.bodies).sort()) {
    const v = await cache.view(b.bodies[id].handle);
    bodies[id] = { volume: +v.volume.toFixed(6), bounds: v.bounds };
  }
  for (const [k, x] of Object.entries(b.results)) if ((x as any).status !== "built") console.error(k, JSON.stringify(x).slice(0, 300));
  await cache.close();
  const numbered = (D as any).numberPieces ? (builtPieceFaces ? (D as any).numberPieces(doc, Object.keys(b.bodies), builtPieceFaces(b)) : (D as any).numberPieces(doc, Object.keys(b.bodies))) : doc;
  return { doc: numbered, bodies };
}

let doc: any = D.partDocument("box", 10, 10, 10);
const cube = `body:${doc.timeline.features[0].id}`;
const s = addSketch(doc);
const e = extrudeSketch(drawRectangle(s.doc, s.id, [20, 0], [24, 4]).doc, s.id, 10, false, undefined, { operation: "join", bodies: [cube] });
doc = e.doc;
// A second Join extrude, overlapping the cube (x 8..12): wholly joined, so no piece of its own.
const s2 = addSketch(doc);
doc = extrudeSketch(drawRectangle(s2.doc, s2.id, [8, 2], [12, 6]).doc, s2.id, 5, false, undefined, { operation: "join", bodies: [cube] }).doc;
let r = await build(doc);
doc = r.doc;
const steps: any[] = [{ step: "join", bodies: r.bodies, numbers: doc.bodies }];
const pieces = Object.keys(r.bodies).filter((id) => id !== cube).sort();
// Move the last extrude-only body 100 along x.
const moved = pieces[pieces.length - 1];
doc = insertMove(doc, [moved], { ...NO_MOVE, x: 100 }).doc;
r = await build(doc); doc = r.doc;
steps.push({ step: `move ${moved}`, bodies: r.bodies });
if (dup) {
  doc = dup.insertDuplicates(doc, [pieces[0]]).doc;
  r = await build(doc); doc = r.doc;
  steps.push({ step: `duplicate ${pieces[0]}`, bodies: r.bodies });
}
doc = hideBody(doc, pieces[0], true);
r = await build(doc); doc = r.doc;
steps.push({ step: `hide ${pieces[0]}`, bodies: r.bodies, hidden: doc.hidden, numbers: doc.bodies });
const p = emptyProject("Join pieces");
p.workspaces.design = doc;
writeFileSync(out, projectToJson(p));
console.log(JSON.stringify({ version: doc.version, steps }, null, 1));
await (kernel as any).close?.();
