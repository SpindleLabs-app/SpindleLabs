// Bug sweep 2026-11-28, A1-2 (behind ?pattern with ?chamfer or ?shell): until a Pattern's copies are told apart in
// names (docs/progress/cad.md 61d), every face and edge name made from a copy's names is shared by the copies, even when
// a later item changed one copy and so left another's name looking unique. A Chamfer or Shell held by such a name broke
// when that other item moved, was suppressed or deleted. The tools now hold no name on a Pattern's copy.
// By hand: a 10 mm cube x 0..10 (Body 1); Pattern 1 a row of 3 along X 15 mm apart: Body 2 = piece:1 at x 15..25, Body 3
// = piece:2 at x 30..40; Pattern 2 joins Body 3 with a copy 5 along X (x 30..45). Body 2's top front edge (y 0, z 10)
// and its right face (x = 25) are the ones that looked unique.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { insertPattern, patternCopyMakers } from "../src/pattern.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";
import { heldNamesOf } from "../src/chamfer-tool.ts";
import { heldFaceNames } from "../src/shell-tool.ts";

const kernel = nodeKernel();

async function rowWithPattern2(): Promise<{ doc: DesignDocument; body2: string; body3: string }> {
  const p1 = insertPattern(partDocument("box", 10, 10, 10), ["body:feature-1"], { kind: "linear", direction: "X", spacing: 15, count: 3, join: false });
  const cache = new BodyCache(kernel);
  const b = await rebuildTimeline(p1.doc, cache, kernel);
  const doc1 = numberPieces(p1.doc, Object.keys(b.bodies), builtPieceFaces(b));
  await cache.close();
  const body2 = `body:${p1.id}/piece:1`;
  const body3 = `body:${p1.id}/piece:2`;
  return { doc: insertPattern(doc1, [body3], { kind: "linear", direction: "X", spacing: 5, count: 2, join: true }).doc, body2, body3 };
}

/** What the Chamfer tool holds for the top front edge (y 0, z 10) and the Shell tool for the face at x = `rightX` of `body`. */
async function held(doc: DesignDocument, body: string, rightX: number, copied: ReadonlySet<string>) {
  const cache = new BodyCache(kernel);
  try {
    const b = await rebuildTimeline(doc, cache, kernel);
    const v = await cache.view(b.bodies[body].handle);
    const on = (p: readonly number[]) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9;
    const edge = v.edge_vertices.findIndex(([u, w]) => on(v.vertex_points[u]) && on(v.vertex_points[w]));
    const right = v.face_centroids.findIndex((c, k) => Math.abs(c[0] - rightX) < 1e-9 && (v.face_normals[k]?.[0] ?? 0) > 0.999999);
    assert.ok(edge >= 0 && right >= 0);
    const [e] = await heldNamesOf(b.bodies, (x) => cache.view(x.handle), [{ body, edge }], copied);
    const [f] = await heldFaceNames(b.bodies, (x) => cache.view(x.handle), body, [right], copied);
    return { edge: e, face: f };
  } finally {
    await cache.close();
  }
}

test("a Pattern copy's edge and face have no name of their own for Chamfer and Shell, even once a later Pattern changed another copy; the body it copies keeps its names", async () => {
  const { doc, body2 } = await rowWithPattern2();
  const copied = patternCopyMakers(doc);
  assert.deepEqual([...copied], ["feature-2"], "Pattern 1 makes copies; Pattern 2 joins its copy into Body 3");
  // Without the rule the names looked unique (the hunt's repro): shown here so the test fails if that ever changes.
  const loose = await held(doc, body2, 25, new Set());
  assert.ok(loose.edge !== null && loose.face !== null, "Pattern 2 made Body 2's names look unique");
  const ruled = await held(doc, body2, 25, copied);
  assert.equal(ruled.edge, null, "Chamfer holds no name on Body 2");
  assert.equal(ruled.face, null, "Shell holds no name on Body 2");
  // Body 1, the cube copied, has names of its own (face:feature-1/...): both still held.
  const own = await held(doc, "body:feature-1", 10, copied);
  assert.ok(own.edge !== null && own.face !== null, "Body 1 keeps its names");
});

test("patternCopyMakers lists the Patterns whose copies are bodies of their own: a joined Pattern's copies become its bodies' faces, so it is not listed", () => {
  const plain = insertPattern(partDocument("box", 10, 10, 10), ["body:feature-1"], { kind: "linear", direction: "X", spacing: 15, count: 3, join: false });
  const joined = insertPattern(partDocument("box", 10, 10, 10), ["body:feature-1"], { kind: "linear", direction: "X", spacing: 5, count: 3, join: true });
  assert.deepEqual([...patternCopyMakers(plain.doc)], [plain.id]);
  assert.deepEqual([...patternCopyMakers(joined.doc)], []);
});
