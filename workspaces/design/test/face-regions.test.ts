// Step 48d2: a flat face with holes is extruded as the region of its edges
// that is the face (face-extrude.ts `faceRegion`): told from each hole's
// inside by its exact area and centroid (`matchesFace`, at 0.9× and 1.1× of
// FACE_MATCH), refused in words when none or two match. On the real kernel:
// packages/testing/journeys/face-extrude.journey.ts (a plate's top and
// bottom, hand-worked volumes).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KernelCalls, SketchRegion, SketchRegions } from "@fission/core";
import { FACE_MATCH, FACE_TWO_REGIONS, faceOpen, faceRegion, matchesFace, onPlane } from "../src/face-extrude.ts";
import { addSketch, drawCircle, drawRectangle } from "../src/sketch.ts";
import { partDocument } from "../src/document.ts";

test("hand-worked: onPlane puts sketch (x, y) at origin + x·xAxis + y·(normal × xAxis)", () => {
  // The XY plane: (2, 3) is (2, 3, 0).
  assert.deepEqual(onPlane({ origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] }, [2, 3]), [2, 3, 0]);
  // Seen from below (normal −z, x along +x): y runs along (0, 0, −1) × (1, 0, 0) = (0, −1, 0), so (2, 3) from (0, 0, 5) is (2, −3, 5).
  assert.deepEqual(onPlane({ origin: [0, 0, 5], xAxis: [1, 0, 0], normal: [0, 0, -1] }, [2, 3]), [2, -3, 5]);
  // The plane x = 1 facing +x with x along +y: y runs along (1, 0, 0) × (0, 1, 0) = (0, 0, 1), so (2, 3) is (1, 2, 3).
  assert.deepEqual(onPlane({ origin: [1, 0, 0], xAxis: [0, 1, 0], normal: [1, 0, 0] }, [2, 3]), [1, 2, 3]);
});

test("matchesFace: the area within FACE_MATCH of the face's and the centroid within FACE_MATCH · √area; 0.9× matches, 1.1× doesn't", () => {
  const area = 400; // a 20 × 20 face: √400 = 20, so the centroid may be 20 · FACE_MATCH away
  const c = [10, 10, 0];
  assert.equal(matchesFace(area * (1 + 0.9 * FACE_MATCH), c, area, c), true);
  assert.equal(matchesFace(area * (1 - 0.9 * FACE_MATCH), c, area, c), true);
  assert.equal(matchesFace(area * (1 + 1.1 * FACE_MATCH), c, area, c), false);
  assert.equal(matchesFace(area * (1 - 1.1 * FACE_MATCH), c, area, c), false);
  assert.equal(matchesFace(area, [10 + 0.9 * 20 * FACE_MATCH, 10, 0], area, c), true);
  assert.equal(matchesFace(area, [10, 10, 1.1 * 20 * FACE_MATCH], area, c), false);
});

/** A kernel answering sketch_regions with `regions` (only that call). */
const answering = (regions: SketchRegion[], why?: string): KernelCalls =>
  ({ call: async (op: string) => {
    assert.equal(op, "sketch_regions");
    return { regions, loose: [], ...(why ? { why } : {}) } satisfies SketchRegions;
  } }) as unknown as KernelCalls;
const region = (area: number, centroid: [number, number], extrudes = true, refused?: string): SketchRegion => ({
  outer: [{ curve: "circle", index: 0, reversed: false }],
  holes: [],
  area,
  centroid,
  profile: { outer: { circle: { center: centroid, radius: 1 } }, holes: [], pieces: [] },
  holePieces: [],
  extrudes,
  ...(refused ? { refused } : {}),
});

test("faceRegion takes the one region that is the face; none, two, or one the kernel refuses are refused in words", async () => {
  const s = addSketch(partDocument("box", 10, 10, 10));
  const doc = drawCircle(drawRectangle(s.doc, s.id, [0, 0], [40, 30]).doc, s.id, [10, 15], 5).doc;
  const sketch = doc.sketches.find((k) => k.id === s.id)!;
  const face = { area: 1200 - 25 * Math.PI, centroid: [20.5, 15, 0] as [number, number, number], plane: { origin: [0, 0, 0] as [number, number, number], xAxis: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] } };
  const plate = region(face.area, [20.5, 15]);
  const disc = region(25 * Math.PI, [10, 15]);
  const got = await faceRegion(answering([disc, plate]), face, sketch);
  assert.ok("outline" in got && got.ref.centroid[0] === 20.5, "the plate, not the disc");
  assert.deepEqual(await faceRegion(answering([disc], "it has no closed region"), face, sketch), { refused: faceOpen("it has no closed region") });
  assert.deepEqual(await faceRegion(answering([disc]), face, sketch), { refused: faceOpen("no region of its edges is the face") });
  // A ring and a disc of one area round one centre: never guessed.
  assert.deepEqual(await faceRegion(answering([plate, { ...plate }]), face, sketch), { refused: faceOpen(FACE_TWO_REGIONS) });
  assert.deepEqual(await faceRegion(answering([region(face.area, [20.5, 15], false, "the curves meet too closely")]), face, sketch), { refused: faceOpen("the curves meet too closely") });
});
