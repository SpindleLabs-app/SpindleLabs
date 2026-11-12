// Hunt 2026-11-12 C: deleting a multi-profile extrude after one of its other sketches was deleted
// (its kept shape filed as "<extrude>/<sketch>"): the design must still open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readDesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { planDelete } from "../src/delete-ask.ts";
import { settleKept } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";
import { deleteItem } from "../src/timeline-edits.ts";
import { kernel } from "./several-hunt-helpers.ts";

test("delete sketch 2, then delete the extrude: the file opens (planDelete, and bare deleteItem)", async () => {
  const one = addSketch(freshDesign());
  const d1 = drawRectangle(one.doc, one.id, [0, 0], [10, 10]).doc;
  const two = addSketch(d1);
  const d2 = drawRectangle(two.doc, two.id, [30, 0], [40, 10]).doc;
  const made = extrudeSketch(d2, one.id, 2, false, undefined, null, [{ sketch: two.id }]);
  const gone = await settleKept(kernel, made.doc, deleteItem(made.doc, two.id));
  assert.deepEqual(Object.keys(gone.kept ?? {}), [`${made.id}/${two.id}`]);
  const planned = (await planDelete(kernel, gone, made.id)).next;
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(planned))), "planDelete");
  const bare = deleteItem(gone, made.id);
  console.log("bare deleteItem kept:", JSON.stringify(Object.keys(bare.kept ?? {})));
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(bare))), "deleteItem alone (timeline-bar barEdit)");
});
