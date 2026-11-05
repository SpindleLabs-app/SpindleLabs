// 36d: where the kernel refused a Combine is pointed at in the viewport
// (refusal-overlay.ts), with the real kernel's own places.

import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayPlaces, SEVERITY_COLOURS } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, type FeatureResult } from "../src/rebuild.ts";
import { refusalOverlay, REFUSAL_OVERLAY } from "../src/refusal-overlay.ts";

const kernel = nodeKernel();

/** Two 10 mm cubes, the second moved by (x, y, z), joined. */
async function joined(x: number, y: number, z: number): Promise<{ doc: DesignDocument; results: Record<string, FeatureResult>; id: string }> {
  let doc = partDocument("box", 10, 10, 10);
  const a = `body:${doc.timeline.features[0].id}`;
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  doc = insertMove(doc, [`body:${id}`], { ...NO_MOVE, x, y, z }).doc;
  const c = insertCombine(doc, a, [`body:${id}`], "join");
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(c.doc, cache, kernel);
  await cache.close();
  return { doc: c.doc, results: build.results, id: c.id };
}

test("a Join of two cubes sharing only an edge points at that edge, and one sharing only a corner at that corner", async () => {
  // Cube A spans 0..10 on every axis; cube B moved by (10, 0, 10) spans x 10..20, y 0..10, z 10..20. They meet where
  // x = 10 and z = 10 both hold, for every y both share (0..10): the edge from (10, 0, 10) to (10, 10, 10), worked from
  // the two boxes, not from the kernel.
  const edge = await joined(10, 0, 10);
  const r = edge.results[edge.id];
  assert.equal(r.status, "failed");
  const overlay = refusalOverlay(edge.doc.timeline.features, edge.results);
  assert.deepEqual(overlay, {
    id: REFUSAL_OVERLAY,
    label: "Where Combine 1 can't be made",
    detail: r.status === "failed" ? r.message : "",
    marks: [],
    places: [{ severity: "error", from: [10, 0, 10], to: [10, 10, 10] }],
  });
  // Drawn as one line in the error colour.
  assert.deepEqual(overlayPlaces([overlay!]), { points: [], lines: [{ from: [10, 0, 10], to: [10, 10, 10], colour: SEVERITY_COLOURS.error }] });
  // Moved by (10, 10, 10), B spans 10..20 on every axis: the only point in both is (10, 10, 10), a corner, drawn as a dot.
  const corner = await joined(10, 10, 10);
  const places = refusalOverlay(corner.doc.timeline.features, corner.results)?.places ?? [];
  assert.deepEqual(places.map((p) => ("point" in p ? p.point : [p.from, p.to])), [[10, 10, 10]]);
  // Moved apart by 1 mm (x 11..21): two pieces, nothing refused, no overlay.
  const apart = await joined(11, 0, 10);
  assert.equal(apart.results[apart.id].status, "built");
  assert.equal(refusalOverlay(apart.doc.timeline.features, apart.results), null);
});

test("every refused Combine with places is in the overlay in timeline order; others are not", () => {
  const f = (id: string, label: string) => ({ id, provenance: { self: { label } } });
  const features = [f("a", "Box 1"), f("b", "Combine 1"), f("c", "Combine 2"), f("d", "Combine 3"), f("e", "Combine 4")];
  const gap = { at: "gap" as const, from: [10, 0, 5] as [number, number, number], to: [10.0005, 0, 5] as [number, number, number] };
  const results: Record<string, FeatureResult> = {
    a: { status: "built", bodies: [], holds: [] } as unknown as FeatureResult,
    // Refused, but with nowhere to point (the tool swallowing the target): the row's words are enough.
    b: { status: "failed", cause: "error", message: "Combine 1 can't be made: the tool covers the whole target, so nothing would be left" },
    c: { status: "failed", cause: "error", message: "Combine 2 can't be made: too thin", thin: [gap] },
    d: { status: "suppressed" },
    e: { status: "failed", cause: "error", message: "Combine 4 can't be made: touches", touches: [{ at: "corner", point: [1, 2, 3] }, { at: "edge", from: [0, 0, 0], to: [0, 0, 5] }] },
  };
  assert.deepEqual(refusalOverlay(features, results), {
    id: REFUSAL_OVERLAY,
    label: "Where 2 Combines can't be made",
    detail: "Combine 2 can't be made: too thin\nCombine 4 can't be made: touches",
    marks: [],
    places: [
      { severity: "error", from: [10, 0, 5], to: [10.0005, 0, 5] },
      { severity: "error", point: [1, 2, 3] },
      { severity: "error", from: [0, 0, 0], to: [0, 0, 5] },
    ],
  });
  // Only the swallowing one refused: nothing to point at, so no overlay.
  assert.equal(refusalOverlay(features, { b: results.b }), null);
});
