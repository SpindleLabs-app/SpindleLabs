// Timeline hunt 2026-11-11 (A3): `regionNow`, the region an extrude saves
// said again as its sketch makes it now, and what the project graph makes of
// a region refreshed that way. The kernel's answers here are written out by
// hand; the app's side, on the real kernel, is
// packages/testing/journeys/region-redrawn.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChangeNotes, DependencyGraph, type SketchRegion } from "@fission/core";
import type { DesignDocument } from "../src/document.ts";
import { extrudeSketch, setExtrudeRegion } from "../src/extrude.ts";
import { syncGraph } from "../src/graph.ts";
import { REDRAWN_CENTROID, regionNow, type RegionRef } from "../src/regions.ts";
import { addSketch, drawRectangle, movePoint } from "../src/sketch.ts";

/** The kernel's region round lines `places` (their places in its list), its middle `centroid`: only what `regionNow` reads. */
const region = (places: readonly number[], centroid: [number, number]) => ({ outer: places.map((index) => ({ curve: "line", index, reversed: false })), centroid }) as unknown as SketchRegion;
const ids = (line: string[]) => ({ line, arc: [], circle: [] });
const named = (curves: readonly string[], centroid: [number, number]): RegionRef => ({ outer: curves.map((curve) => ({ curve, reversed: false })), centroid });

test("hand-worked: a region that is as it was saved is the saved object; one reshaped is saved where it lies now", () => {
  const ref = named(["a", "b", "c", "d"], [20, 15]);
  // The 40 × 30 plate as picked: the same four lines, the same middle.
  assert.equal(regionNow([region([0, 1, 2, 3], [20, 15])], ids(["a", "b", "c", "d"]), ref), ref);
  // Made 60 wide by a drag: the same lines, its middle now (30, 15).
  assert.deepEqual(regionNow([region([0, 1, 2, 3], [30, 15])], ids(["a", "b", "c", "d"]), ref), named(["a", "b", "c", "d"], [30, 15]));
  // The kernel starting the loop at another line: the same loop, said as the kernel says it now.
  assert.deepEqual(regionNow([region([1, 2, 3, 0], [20, 15])], ids(["a", "b", "c", "d"]), ref), named(["b", "c", "d", "a"], [20, 15]));
});

test("hand-worked: a side drawn again (line d gone, line e in its place) is found by its shape and named by its curves as they are", () => {
  const ref = named(["a", "b", "c", "d"], [20, 15]);
  assert.deepEqual(regionNow([region([0, 1, 2, 3], [20, 15])], ids(["a", "b", "c", "e"]), ref), named(["a", "b", "c", "e"], [20, 15]));
  // At 0.9 × REDRAWN_CENTROID from the saved middle it is the same shape, saved where it is; at 1.1 × it is another region: nothing to save.
  assert.deepEqual(regionNow([region([0, 1, 2, 3], [20 + 0.9 * REDRAWN_CENTROID, 15])], ids(["a", "b", "c", "e"]), ref), named(["a", "b", "c", "e"], [20 + 0.9 * REDRAWN_CENTROID, 15]));
  assert.equal(regionNow([region([0, 1, 2, 3], [20 + 1.1 * REDRAWN_CENTROID, 15])], ids(["a", "b", "c", "e"]), ref), undefined);
  // No region at all (the side deleted, not yet drawn again).
  assert.equal(regionNow([], ids(["a", "b", "c"]), ref), undefined);
});

/** Sketch 1 (the 40 × 30 plate), Extrude 1 of its region, and a print plate in another workspace reading Extrude 1. */
function linked() {
  const s = addSketch({ version: 16, nextId: 1, profiles: [], sketches: [], timeline: { features: [] } } as unknown as DesignDocument);
  const rect = drawRectangle(s.doc, s.id, [0, 0], [40, 30]);
  const e = extrudeSketch(rect.doc, s.id, 10, false, named(rect.ids, [20, 15]));
  const g = new DependencyGraph();
  const notes = new ChangeNotes();
  syncGraph(g, e.doc, null, notes);
  g.set({ id: "plate", label: "Print plate", workspace: "slice", cost: "cheap" }, [e.id]);
  for (const id of g.stale()) g.markFresh(id);
  /** The print plate's note after the design becomes `next`: the words after its colon. */
  const edit = (next: DesignDocument) => {
    syncGraph(g, next, e.doc, notes);
    return notes.current(g).filter((n) => n.node === "plate").map((n) => n.text.replace(/^[^:]*: /, "").replace(/ in Design\..*$/, ""));
  };
  return { doc: e.doc, sketch: s.id, extrude: e.id, ids: rect.ids, edit };
}

test("a sketch reshaped, its extrude's region saved where it lies now: the note names the sketch the person changed, not the extrude", () => {
  const d = linked();
  // The corner (40, 0) moved to (60, 0), and the region saved again as settling does: the same lines, the new middle (76/3, 14).
  const corner = d.doc.sketches[0].points.find((p) => p.x === 40 && p.y === 0)!.id;
  const moved = movePoint(d.doc, d.sketch, corner, 60, 0);
  const settled = setExtrudeRegion(moved, named(d.ids, [76 / 3, 14]), d.extrude);
  assert.deepEqual(d.edit(settled), ["you changed Sketch 1"]);
});

test("Edit feature's region pick, the sketch as it was: the note names the extrude", () => {
  const d = linked();
  assert.deepEqual(d.edit(setExtrudeRegion(d.doc, named(d.ids, [20, 16]), d.extrude)), ["you changed Extrude 1"]);
});
