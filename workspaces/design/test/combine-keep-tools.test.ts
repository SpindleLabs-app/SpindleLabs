// Combine bug hunt 2026-11-06: the browser's bodies (designBodies, as the workspace's failed set feeds it) agree with what the rebuild holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { bodyItem, insertPreset, isPiece, numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteItem, suppressItem, moveMarker } from "../src/timeline-edits.ts";
import { designBodies } from "../src/browser.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();

function boxes(...list: [[number, number, number], [number, number, number]][]): { doc: DesignDocument; bodies: string[] } {
  let doc: DesignDocument | null = null;
  const bodies: string[] = [];
  for (const [[w, d, h], [x, y, z]] of list) {
    let id: string;
    if (doc === null) {
      doc = partDocument("box", w, d, h);
      id = doc.timeline.features[0].id;
    } else ({ doc, id } = insertPreset(doc, "box", w, d, h));
    bodies.push(`body:${id}`);
    if (x !== 0 || y !== 0 || z !== 0) doc = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x, y, z }).doc;
  }
  return { doc: doc!, bodies };
}

/** As workspace.ts buildPart: rebuild, number pieces, failed = failed results + numbered pieces absent; then the browser's bodies vs the rebuild's. */
async function agree(doc0: DesignDocument, label: string) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc0, cache, kernel);
  const doc = numberPieces(doc0, Object.keys(build.bodies));
  const build2 = await rebuildTimeline(doc, cache, kernel);
  const absent = (doc.bodies ?? []).flatMap((b) => (isPiece(b.id) && build2.results[bodyItem(b.id)!]?.status === "built" && !(b.id in build2.bodies) ? [b.id] : []));
  const failed = new Set([...Object.keys(build2.results).filter((id) => build2.results[id].status === "failed"), ...absent]);
  const browser = designBodies(doc, failed).map((b) => b.body).sort();
  const held = Object.keys(build2.bodies).sort();
  await cache.close();
  assert.deepEqual(browser, held, `${label}: ${JSON.stringify(Object.fromEntries(Object.entries(build2.results).map(([k, r]) => [k, r.status === "failed" ? r.message : r.status])))}`);
  return { doc, build: build2 };
}

// Cube A x 0..10; cube B x 5..15 (moved 5,5,5); cube C x 20..30 apart; bar for pieces.
const three = () => boxes([[10, 10, 10], [0, 0, 0]], [[10, 10, 10], [5, 5, 5]], [[10, 10, 10], [8, 8, -5]]);

test("keep tools on and off: browser bodies match the rebuild's", async () => {
  for (const keep of [false, true]) {
    const { doc, bodies } = three();
    const c1 = insertCombine(doc, bodies[0], [bodies[1]], "cut", keep);
    await agree(c1.doc, `cut keep ${keep}`);
    // A second Combine using the (kept or used-up) tool as its tool.
    const c2 = insertCombine(c1.doc, bodies[2], [bodies[1]], "join", false);
    await agree(c2.doc, `second uses tool, keep ${keep}`);
    // ...as its target.
    const c3 = insertCombine(c1.doc, bodies[1], [bodies[2]], "join", false);
    await agree(c3.doc, `second targets tool, keep ${keep}`);
    // A Move of the tool after the Combine.
    const mv = insertMove(c1.doc, [bodies[1]], { ...NO_MOVE, x: 50 });
    await agree(mv.doc, `move tool after, keep ${keep}`);
  }
});

test("deletes, suppress and rollback around Combines: browser bodies match the rebuild's", async () => {
  const { doc: d0, bodies } = boxes([[100, 20, 10], [0, 0, 0]], [[10, 40, 20], [30, -10, -5]], [[5, 5, 30], [80, 5, -10]]);
  const c1 = insertCombine(d0, bodies[0], [bodies[1]], "cut");
  const piece = `body:${c1.id}/piece:1`;
  const d1 = numberPieces(c1.doc, [piece]);
  const c2 = insertCombine(d1, piece, [bodies[2]], "cut");
  const { doc } = await agree(c2.doc, "two combines");
  for (const f of doc.timeline.features) {
    await agree(deleteItem(doc, f.id), `delete ${f.provenance.self.label}`);
    await agree(suppressItem(doc, f.id, true), `suppress ${f.provenance.self.label}`);
    await agree(moveMarker(doc, f.id), `marker at ${f.provenance.self.label}`);
  }
  // Combine 2 uses the bar (target of Combine 1) as a tool, the piece as target.
  const c3 = insertCombine(d1, piece, [bodies[0]], "join");
  const { doc: d3 } = await agree(c3.doc, "join bar into piece");
  for (const f of d3.timeline.features) await agree(deleteItem(d3, f.id), `delete ${f.provenance.self.label} (join)`);
});
