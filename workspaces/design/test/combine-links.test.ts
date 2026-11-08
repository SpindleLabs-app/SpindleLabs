// Step 35f1f2d: other workspaces' links to a Combine's result. What Design
// lists for the others (the Slice page's plate) and what a link finds hand
// over a Combine's result, each of its pieces, and a copy of it, as the
// triangles the kernel holds; asked for as an exact solid, it says in words
// that only the kernel holds it, never a wrong body. Every number is worked
// out by hand from the cubes' corners beside it, on the real rebuild and
// kernel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, emptyProject, type StableId } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, type DesignDocument } from "../src/document.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { changedMove, insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, builtPieceFaces, rebuildTimeline } from "../src/rebuild.ts";
import { designLookup, registerDesign } from "../src/representations.ts";
import { joinBodies, shownBodies } from "../src/scene.ts";

const kernel = nodeKernel();
const registry = () => {
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  return r;
};
const projectWith = (doc: DesignDocument) => ({ ...emptyProject(), workspaces: { design: doc } });

// Cube A x/y/z 0..10 (feature-1); cube B the same (feature-2) moved (5, 5, 5) (feature-3); B joined to A (feature-4):
// body:feature-1, x/y/z 0..15, 1000 + 1000 − 125 = 1875 mm³.
function joined(): DesignDocument {
  let doc = partDocument("box", 10, 10, 10);
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 5, y: 5, z: 5 }).doc;
  return insertCombine(doc, "body:feature-1", ["body:feature-2"], "join").doc;
}

// A bar x 0..50, y/z 0..10 (feature-1); two slabs 10 × 20 × 20 (feature-2, feature-3) moved (10, −5, −5) and
// (30, −5, −5) (feature-4, feature-5), so x 10..20 and 30..40 through the whole bar; both cut from it (feature-6):
// three pieces, x 0..10, 20..30 and 40..50, each 10 × 10 × 10 = 1000 mm³. The first keeps the bar's body, the other two
// are the Combine's (one item for both, so listing by item would show one). Numbered once a rebuild shows them, as the
// app does (workspace.ts).
async function split(): Promise<DesignDocument> {
  let doc = partDocument("box", 50, 10, 10);
  doc = insertPreset(doc, "box", 10, 20, 20).doc;
  doc = insertPreset(doc, "box", 10, 20, 20).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 10, y: -5, z: -5 }).doc;
  doc = insertMove(doc, ["body:feature-3"], { ...NO_MOVE, x: 30, y: -5, z: -5 }).doc;
  doc = insertCombine(doc, "body:feature-1", ["body:feature-2", "body:feature-3"], "cut").doc;
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  await cache.close();
  return numberPieces(doc, Object.keys(build.bodies), builtPieceFaces(build));
}

/** A mesh's volume (the sum of each triangle's signed tetrahedron with the origin, p0 · (p1 × p2) / 6) and its bounds. */
function measure(positions: readonly number[], indices: readonly number[]) {
  const p = (i: number) => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [p(indices[t]), p(indices[t + 1]), p(indices[t + 2])];
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  const lo = [0, 1, 2].map((k) => Math.min(...positions.filter((_, i) => i % 3 === k)));
  const hi = [0, 1, 2].map((k) => Math.max(...positions.filter((_, i) => i % 3 === k)));
  const r = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
  return { volume: r(volume), bounds: [lo.map(r), hi.map(r)] };
}

/** What the plate shows: each listed body's label and its mesh measured, or the words it failed with. */
async function plate(doc: DesignDocument) {
  const r = registry();
  const out: { label: string; volume?: number; bounds?: number[][]; error?: string }[] = [];
  for (const o of r.objectsOf("design", projectWith(doc))) {
    try {
      const { representation } = await r.deliver(o, ["mesh"]);
      assert.equal(representation.kind, "mesh");
      if (representation.kind === "mesh") out.push({ label: o.label, ...measure(representation.positions, representation.indices) });
    } catch (e) {
      out.push({ label: o.label, error: (e as Error).message });
    }
  }
  return out;
}

test("hand-worked: the plate lists a Combine's result as one body and hands over its 1,875 mm³ at x/y/z 0..15", async () => {
  assert.deepEqual(await plate(joined()), [{ label: "Body 1", volume: 1875, bounds: [[0, 0, 0], [15, 15, 15]] }]);
  // It follows an earlier edit: B moved to (8, 8, 8) overlaps A by 2 × 2 × 2 = 8, so 2000 − 8 = 1992 mm³ at 0..18.
  assert.deepEqual(await plate(changedMove(joined(), "feature-3", { ...NO_MOVE, x: 8, y: 8, z: 8 })), [{ label: "Body 1", volume: 1992, bounds: [[0, 0, 0], [18, 18, 18]] }]);
});

test("hand-worked: a cut that splits a bar in three lists every piece, each 1,000 mm³ where it is", async () => {
  const got = (await plate(await split())).sort((a, b) => a.bounds![0][0] - b.bounds![0][0]);
  assert.deepEqual(
    got.map((g) => ({ volume: g.volume, bounds: g.bounds })),
    [
      { volume: 1000, bounds: [[0, 0, 0], [10, 10, 10]] },
      { volume: 1000, bounds: [[20, 0, 0], [30, 10, 10]] },
      { volume: 1000, bounds: [[40, 0, 0], [50, 10, 10]] },
    ],
  );
  assert.equal(new Set(got.map((g) => g.label)).size, 3, "each piece its own Body row's name");
});

test("hand-worked: a Mirror body of a Combine's result across YZ is on the plate too, x −15..0, beside its source", async () => {
  const { doc } = insertDuplicates(joined(), ["body:feature-1"], "YZ");
  const got = (await plate(doc)).sort((a, b) => a.bounds![0][0] - b.bounds![0][0]);
  assert.deepEqual(
    got.map((g) => ({ volume: g.volume, bounds: g.bounds })),
    [
      { volume: 1875, bounds: [[-15, 0, 0], [0, 15, 15]] },
      { volume: 1875, bounds: [[0, 0, 0], [15, 15, 15]] },
    ],
  );
});

test("a link to a Combine's result, by its face or by its item, hands over the joined body; as an exact solid it says only the kernel holds it", async () => {
  const doc = joined();
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const scene = joinBodies(await shownBodies(doc, build, cache), build);
  await cache.close();
  const lookup = designLookup(doc, scene, kernel);
  const r = registry();
  const sources = [
    { kind: "geometry" as const, origin: { workspace: "design", id: "feature-1", label: "B's top" }, ref: { kind: "face" as const, id: "face:feature-2/top" as StableId } },
    { kind: "geometry" as const, origin: { workspace: "design", id: "feature-1", label: "Body 1" }, ref: { kind: "body" as const, id: "body:feature-1" as StableId } },
    { kind: "object" as const, origin: { workspace: "design", id: "feature-1", label: "Box 1" } },
  ];
  for (const s of sources) {
    const o = lookup(s);
    assert.ok(o !== null && !("unresolved" in o), `${s.origin.label} found`);
    const { representation } = await r.deliver(o, ["mesh"]);
    assert.ok(representation.kind === "mesh");
    assert.deepEqual(measure(representation.positions, representation.indices), { volume: 1875, bounds: [[0, 0, 0], [15, 15, 15]] }, s.origin.label);
    await assert.rejects(r.deliver(o, ["solid"]), /only the kernel holds it/);
  }
  // B, used up by the join, is no body of its own any more: a link to it is gone.
  assert.equal(lookup({ kind: "geometry", origin: { workspace: "design", id: "feature-2", label: "Body 2" }, ref: { kind: "body", id: "body:feature-2" as StableId } }), null);
});

test("a design with no Combine hands its bodies over as before: by their item, an exact solid", async () => {
  const doc = partDocument("box", 10, 10, 10);
  const r = registry();
  const [o] = r.objectsOf("design", projectWith(doc));
  assert.deepEqual(Object.keys(o).sort(), ["document", "id", "label", "type"]);
  const { representation } = await r.deliver(o, ["solid"]);
  assert.deepEqual(representation, { kind: "solid", spec: { box: { width: 10, depth: 10, height: 10 } } });
});
