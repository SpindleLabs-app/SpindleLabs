// A Combine cut leaving the target in two pieces, the second piece moved up 50 and the target hidden; built with the
// checkout's own code and kernel after each step, its pieces numbered as the workspace does. ROOT is the checkout.
import { writeFileSync } from "node:fs";
const ROOT = process.env.ROOT!;
const { emptyProject, projectToJson } = await import(`${ROOT}/packages/core/src/index.ts`);
const { nodeKernel } = await import(`${ROOT}/packages/testing/src/node-kernel.ts`);
const D = await import(`${ROOT}/workspaces/design/src/document.ts`);
const R = await import(`${ROOT}/workspaces/design/src/rebuild.ts`);
const { insertMove, NO_MOVE } = await import(`${ROOT}/workspaces/design/src/move.ts`);
const { insertCombine } = await import(`${ROOT}/workspaces/design/src/combine.ts`);
const { hideBody } = await import(`${ROOT}/workspaces/design/src/timeline-edits.ts`);
const kernel = nodeKernel();
const toolX = Number(process.env.TOOLX ?? 10);
async function build(doc: any) {
  const cache = new R.BodyCache(kernel);
  const b = await R.rebuildTimeline(doc, cache, kernel);
  const bodies: Record<string, unknown> = {};
  for (const id of Object.keys(b.bodies).sort()) { const v = await cache.view(b.bodies[id].handle); bodies[id] = { volume: +v.volume.toFixed(6), bounds: v.bounds }; }
  for (const [k, x] of Object.entries(b.results)) if ((x as any).status !== "built") console.error(k, JSON.stringify(x).slice(0, 300));
  await cache.close();
  const numbered = R.builtPieceFaces ? D.numberPieces(doc, Object.keys(b.bodies), R.builtPieceFaces(b)) : D.numberPieces(doc, Object.keys(b.bodies));
  return { doc: numbered, bodies };
}
let doc: any = D.partDocument("box", 30, 10, 10);
const a = `body:${doc.timeline.features[0].id}`;
const t = D.insertPreset(doc, "box", 4, 20, 20); doc = t.doc;
const tool = `body:${t.id}`;
doc = insertMove(doc, [tool], { ...NO_MOVE, x: toolX, y: -5, z: -5 }).doc;
const c = insertCombine(doc, a, [tool], "cut"); doc = c.doc;
let r = await build(doc); doc = r.doc;
const steps: any[] = [{ step: "cut", bodies: r.bodies }];
const piece = Object.keys(r.bodies).find((id) => id.includes("/piece:"))!;
doc = insertMove(doc, [piece], { ...NO_MOVE, z: 50 }).doc;
r = await build(doc); doc = r.doc;
doc = hideBody(doc, a, true);
r = await build(doc); doc = r.doc;
steps.push({ step: `move ${piece} up 50, hide ${a}`, bodies: r.bodies, numbers: doc.bodies, hidden: doc.hidden });
const p = emptyProject("Cut pieces"); p.workspaces.design = doc;
writeFileSync(process.argv[2], projectToJson(p));
console.log(JSON.stringify({ version: doc.version, steps }));
