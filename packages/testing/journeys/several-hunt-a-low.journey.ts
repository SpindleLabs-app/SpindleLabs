// Hunt A, low: (L1) after OK only the FIRST profile's sketch is hidden (workspace.ts usedSketchHidden(made.doc, source.sketch));
// (L2) the preview's volume adds the prisms (extrude-picks.ts joinedView), so two overlapping profiles of two sketches
// preview more than OK makes. Run: node --experimental-strip-types --no-warnings --test journeys/_hunt-A-low.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, designWorkspace } from "@fission/design";
import { app } from "./design-app.ts";
import { empty } from "./kept-app.ts";
import { extrudeSeveral, seen } from "./several-hunt-a-lib.ts";

test("L1: both sketches of a two-sketch extrude are hidden after OK, as the one sketch of a one-profile extrude is", async () => {
  const s = addSketch(empty());
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  const t = addSketch(d);
  d = drawRectangle(t.doc, t.id, [20, 0], [40, 10]).doc;
  const a = await app(d, designWorkspace);
  await extrudeSeveral(a, [{ c: [5, 5], sketch: s.id }, { c: [30, 5], sketch: t.id }], "5");
  const hidden = a.doc().hidden ?? [];
  console.log("hidden after OK:", JSON.stringify(hidden));
  await a.close();
  assert.deepEqual([...hidden].sort(), [s.id, t.id].sort());
});
// L2 (the preview's volume adds the prisms of two overlapping sketches' profiles) is left for later; its repro stays in
// the hunt's folder.
