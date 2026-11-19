// SL #759 item 4 (Design data version 30): a body extruded from a sketch the rebuild places (here a face of Box 1
// pulled out 20 mm) now starts its own frame from that sketch's, so a block drawn on it follows Box 1's Move. Files saved
// before (version 29) recorded the block's body frame without it; they are marked `unbased` as they are read, built
// exactly where they were, then written by today's rule (the mark taken off) so a later Move edit carries the block.
// Each file is a real version 29 design saved by main cd89748's own Design app (the hunter's steps, R/_hunt-R-merged-
// top-extrude-join.ts), kept exactly as saved; every place below is worked out by hand from the boxes' corners.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { DESIGN_VERSION, migrateDesignV29, numberPieces, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { changedMove, moveValues } from "../src/move.ts";
import { BodyCache, builtPieceFaces, followedDoc, rebuildTimeline } from "../src/rebuild.ts";

const kernel = await nodeKernel();
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
const file = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`files/${name}`, import.meta.url), "utf8"));

/** The design after its rebuilds have settled (followed and numbered, as the app takes them in), and the block's bounds. */
async function settled(doc: DesignDocument): Promise<{ doc: DesignDocument; block: number[][] | null }> {
  const cache = new BodyCache(kernel);
  try {
    let d = doc;
    let build = await rebuildTimeline(d, cache, kernel);
    for (let i = 0; i < 4; i++) {
      const next = numberPieces(followedDoc(d, build), Object.keys(build.bodies), builtPieceFaces(build));
      if (next === d) break;
      d = next;
      build = await rebuildTimeline(d, cache, kernel);
    }
    let block: number[][] | null = null;
    for (const b of Object.values(build.bodies)) {
      const v = await cache.view(b.handle);
      if (Math.abs(v.volume - 500) < 1e-6) block = v.bounds.map((p: number[]) => p.map(r6));
    }
    return { doc: d, block };
  } finally {
    await cache.close();
  }
}

const moveTo = (d: DesignDocument, x: number) => changedMove(d, "feature-2", { ...moveValues(d.timeline.features.find((f) => f.id === "feature-2")!), x });
const blockSketch = (d: DesignDocument) => d.sketches.find((s) => s.id === "sketch-21")!;

// Worked by hand. Box 1 is 40 × 30 × 20, moved by Move 1; its right face (x = 10 + 40 = 50 with Move 1 at x 10) pulled
// out 20 mm gives the part x 50..70; the 10 × 10 rectangle drawn round (cx, 15) on its top, extruded 5, is the block
// x cx−5..cx+5, y 10..20, z 20..25. As saved by main the block is at cx = 60 (x 55..65). "-moved" had Move 1 edited to
// x 20 before the block was drawn (everything 10 further: the part x 60..80, the block at cx = 70, x 65..75).
// Move 1 edited to x 30 moves Box 1, the part pulled out of its face and the block on it along by 30 − 10 = 20 (or
// 30 − 20 = 10 for "-moved"): x 75..85 in all three.
for (const [name, was] of [["v29-block-on-pulled-join.json", 55], ["v29-block-on-pulled-new.json", 55], ["v29-block-on-pulled-new-moved.json", 65]] as const) {
  test(`${name}: opens marked, builds where it was saved, loses the mark, then follows Move 1`, async () => {
    const saved = file(name);
    assert.equal(saved.version, 29, "a real version 29 file");
    const opened = readDesignDocument(saved);
    assert.equal(opened.version, DESIGN_VERSION);
    assert.equal(blockSketch(opened).face?.unbased, true, "the block's sketch is marked as drawn before version 30");
    const first = await settled(opened);
    assert.deepEqual(first.block, [[was, 10, 20], [was + 10, 20, 25]], "built exactly where it was saved");
    assert.equal(Object.hasOwn(blockSketch(first.doc).face!, "unbased"), false, "the first rebuild took the mark off");
    // Today's rule from now on: the same place built again, and saved and opened the same.
    const again = await settled(readDesignDocument(JSON.parse(JSON.stringify(first.doc))));
    assert.deepEqual(again.block, first.block);
    // The owner's call (2026-11-19, "make it follow"): Move 1 edited to x 30 takes the block with it.
    const moved = await settled(moveTo(first.doc, 30));
    assert.deepEqual(moved.block, [[75, 10, 20], [85, 20, 25]]);
  });
}

test("the mark is what keeps an old file still: read as version 30 without it, the block jumps (the test can fail)", async () => {
  const saved = file("v29-block-on-pulled-new.json");
  // The upgrade left out: the old body frame read by today's rule (every face sketch's `unbased` never set).
  const unmarked = readDesignDocument({ ...saved, version: DESIGN_VERSION });
  assert.equal(Object.hasOwn(blockSketch(unmarked).face!, "unbased"), false);
  const { block } = await settled(unmarked);
  assert.notDeepEqual(block, [[55, 10, 20], [65, 20, 25]], "without the mark the old block would move on opening");
});

test("the upgrade on its own: every face sketch with a body frame marked, nothing else changed; refusals", () => {
  const saved = file("v29-block-on-pulled-join.json");
  const up = migrateDesignV29(saved) as { version: number; sketches: { id: string; face?: Record<string, unknown> }[] };
  assert.equal(up.version, 30);
  for (const s of up.sketches) assert.equal(s.face?.unbased, s.face?.body === undefined ? undefined : true, s.id);
  assert.deepEqual(migrateDesignV29({ version: 29 }), { version: 30 });
  // Version 29 data never holds the mark; version 30 holds it only as true, with a body frame.
  const marked = (v: number, face: (f: Record<string, unknown>) => Record<string, unknown>) => ({ ...saved, version: v, sketches: (saved.sketches as { face?: Record<string, unknown> }[]).map((s) => (s.face ? { ...s, face: face(s.face) } : s)) });
  assert.throws(() => readDesignDocument(marked(29, (f) => ({ ...f, unbased: true }))), /says version 29 but has a sketch marked as drawn before version 30/);
  assert.throws(() => readDesignDocument(marked(30, (f) => ({ ...f, unbased: false }))), /unbased must be true, on a sketch with a body frame, not false/);
  assert.throws(() => readDesignDocument(marked(30, ({ body: _, ...f }) => ({ ...f, unbased: true }))), /unbased must be true, on a sketch with a body frame/);
});
