// Hunt 2026-11-12 C, finding C2: Edit feature on a multi-profile extrude
// offers the first profile's sketch's regions; picking the region that is
// already one of its other profiles is saved (`editFeature` ->
// `setExtrudeRegion`), leaving the same profile twice. The reader refuses
// that file, so the project saved after this edit does not open again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readDesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { editFeature } from "../src/feature-edit.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";
import { regionsOf, volumesOf } from "./several-hunt-helpers.ts";

test("C2: Edit feature picking the extrude's own other region leaves a file that won't open", async () => {
  // Squares x 0..10 and x 10..20 (touching), both picked: 20 x 10 x 5 = 1,000.
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  d = drawRectangle(d, s.id, [10, 0], [20, 10]).doc;
  const rs = await regionsOf(d, s.id);
  const left = rs.find((r) => Math.abs(r.c[0] - 5) < 1e-6)!.ref;
  const right = rs.find((r) => Math.abs(r.c[0] - 15) < 1e-6)!.ref;
  const made = extrudeSketch(d, s.id, 5, false, left, null, [{ sketch: s.id, region: right }]);
  // The file opens before the edit.
  readDesignDocument(JSON.parse(JSON.stringify(made.doc)));
  // Edit feature: the user clicks the right square (shaded as one of the sketch's regions) and OK: refused in words,
  // since the right square is already the extrude's second profile (it would be extruded twice and the file refused).
  assert.throws(() => editFeature(made.doc, made.id, { height: 5 }, undefined, right), /That region is already one of Extrude 1's profiles/);
  // The design as it was still builds 20 x 10 x 5 = 1,000 and opens.
  const out = await volumesOf(made.doc, made.id);
  assert.ok(Math.abs(out.vols.reduce((x, y) => x + y, 0) - 1000) < 1e-6, JSON.stringify(out.vols));
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(made.doc))));
});

import { app } from "../../../packages/testing/journeys/design-app.ts";
import { partDocument } from "../src/index.ts";

test("C2 in the app: Ctrl-pick two touching squares, OK, Edit feature, click the second square, OK: wrong volume and the file won't open", async () => {
  const s = addSketch(partDocument("box", 10, 10, 10));
  let d = drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc;
  d = drawRectangle(d, s.id, [110, 0], [120, 10]).doc;
  const a = await app(d);
  a.$("#extrude")!.click();
  await a.settle();
  type Offer = { id: string; outline: { outer: { path?: { corners: number[] } } } };
  const at = (lo: number) => (a.extrudeShown()!.profiles.filter((o) => !o.face) as unknown as Offer[]).find((o) => Math.min(...(o.outline.outer.path?.corners ?? []).filter((_, i) => i % 2 === 0)) === lo)!.id;
  await a.extrudePointer({ kind: "pick", profile: at(100) });
  await a.extrudePointer({ kind: "pick", profile: at(110), add: true });
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = "5";
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  // Box 1,000 + 20 x 10 x 5 = 1,000.
  assert.ok(Math.abs(a.volume() - 2000) < 1e-6, `before edit ${a.volume()}`);
  const id = a.doc().timeline.features.at(-1)!.id;
  assert.equal(await a.menu(id, "edit"), null);
  await a.settle();
  const offers = (a.extrudeShown()?.profiles ?? []) as unknown as Offer[];
  console.log("edit offers", offers.length, "chosen", a.extrudeShown()?.chosen);
  await a.extrudePointer({ kind: "pick", profile: offers.find((o) => Math.min(...(o.outline.outer.path?.corners ?? []).filter((_, i) => i % 2 === 0)) === 110)!.id });
  // Refused at the click, in words, with nothing chosen anew.
  assert.match(a.$("#feature-edit")!.textContent ?? "", /That region is already one of Extrude 1's profiles/);
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  await a.settle();
  console.log("after edit volume", a.volume(), "undo label", a.history.undoLabel());
  const saved = JSON.parse(JSON.stringify(a.doc()));
  // Undo and Redo go through the project's JSON as an opened file does.
  await a.undo();
  console.log("after undo volume", a.volume());
  let redoErr: unknown = null;
  try { a.history.redo(); await a.settle(); } catch (e) { redoErr = e; }
  console.log("redo:", redoErr === null ? "ok" : String(redoErr), "volume", a.volume());
  assert.equal(redoErr, null, "Redo works");
  // Box 1,000 + the two squares 20 x 10 x 5 = 1,000, as before the edit.
  assert.ok(Math.abs(a.volume() - 2000) < 1e-6, `after edit ${a.volume()}`);
  assert.ok(await a.close());
  assert.doesNotThrow(() => readDesignDocument(saved), "the saved design opens again");
});
