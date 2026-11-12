// SL #677 item 5: the warning line under an Extrude Join that reaches
// nothing names the extrude's own new body the way the Bodies list does,
// the same on its first build as after a remount or a fresh open of the
// same file (it said "Extrude 1" first and "Body 3" after). On the real
// kernel, in the app around Design (design-app.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { addSketch, deleteItem, designWorkspace, drawRectangle, extrudeSketch, insertCombine, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app } from "./design-app.ts";

/** The design as a saved project file reads it back. */
function throughFile(doc: DesignDocument): DesignDocument {
  const text = projectToJson({ ...emptyProject("words"), workspaces: { design: doc } });
  return projectFromJson(text, [designWorkspace]).workspaces.design as DesignDocument;
}

/**
 * Box 1 (4 mm cube) lifted to z 5..9 by Move 1, Box 2 the same at x 10..14
 * by Move 2, then a 2 x 2 square on the ground extruded 1 mm up (z 0..1)
 * set to Join Body 1 and Body 2. It touches neither, so the Join adds
 * nothing: Box 2 and the extrude's own block stay separate bodies.
 * Bodies by number: Box 1 is Body 1, Box 2 is Body 2, and the extrude's own
 * block is the next body made, Body 3.
 */
function design(): DesignDocument {
  let doc = partDocument("box", 4, 4, 4);
  doc = insertMove(doc, ["body:feature-1"], { ...NO_MOVE, z: 5 }).doc;
  const box2 = insertPreset(doc, "box", 4, 4, 4);
  doc = insertMove(box2.doc, [`body:${box2.id}`], { ...NO_MOVE, x: 10, z: 5 }).doc;
  const s = addSketch(doc);
  return extrudeSketch(drawRectangle(s.doc, s.id, [1, 1], [3, 3]).doc, s.id, 1, false, undefined, { operation: "join", bodies: ["body:feature-1", `body:${box2.id}`] }).doc;
}

test("an Extrude Join that reaches nothing names its own block Body 3 on the first build, after a remount and opened fresh (SL #677 item 5)", async () => {
  const want = "Extrude 1: Body 2 and Body 3 add nothing to Body 1.";
  const a = await app(design(), designWorkspace);
  assert.equal(a.warning(), want, "first build");
  await a.remount();
  assert.equal(a.warning(), want, "after a remount");
  const saved = throughFile(a.doc());
  await a.close();
  const b = await app(saved, designWorkspace);
  assert.equal(b.warning(), want, "opened fresh from the saved file");
  await b.close();
});

// ---- The Combine panel's words (SL #677 item 5) ----

setCombineShown(true);

/** Modify ▾ Combine, as a person opens it. */
async function openCombine(a: Awaited<ReturnType<typeof app>>) {
  a.$("#modify-menu")!.click();
  await a.settle();
  a.$("#modify-menu-combine")!.click();
  await a.settle();
}
const hint = (a: Awaited<ReturnType<typeof app>>) => (a.$("#combine-hint")!.hidden ? null : a.$("#combine-hint")!.textContent);

test("Combine with fewer than two bodies says it needs two, not to click a body that isn't there", async () => {
  // An empty design: a box made then deleted, so no body at all.
  const empty = await app(deleteItem(partDocument("box", 10, 10, 10), "feature-1"), designWorkspace);
  await openCombine(empty);
  assert.equal(hint(empty), "Combine needs two bodies: make them first with Insert or Extrude");
  await empty.close();
  // One box, picked as the target by opening Combine with it selected: nothing is left to be a tool.
  const one = await app(partDocument("box", 10, 10, 10), designWorkspace);
  one.selection.set([{ kind: "body", id: "body:feature-1" } as never]);
  await one.settle();
  await openCombine(one);
  assert.equal(hint(one), "Combine needs two bodies: add another with Insert or Extrude");
  await one.close();
  // Two boxes: the hint asks for the picks as before.
  const two = await app(insertPreset(partDocument("box", 10, 10, 10), "box", 5, 5, 5).doc, designWorkspace);
  await openCombine(two);
  assert.equal(hint(two), "Combine: click or tap the body to change");
  await two.close();
});

test("an edited Combine names a used-up tool by its item, and a deleted one by the name it had, never a number off the list or a raw id", async () => {
  // Box 1 40 x 30 x 20 at the origin, Box 2 a 10 mm cube moved to x 100..110: far apart.
  // Joined they stay two lumps (Fusion's way): the list shows Body 1 and Body 3 (Box 2's lump), no Body 2.
  let doc = partDocument("box", 40, 30, 20);
  const box2 = insertPreset(doc, "box", 10, 10, 10);
  doc = insertMove(box2.doc, [`body:${box2.id}`], { ...NO_MOVE, x: 100 }).doc;
  const c = insertCombine(doc, "body:feature-1", [`body:${box2.id}`], "join");
  const a = await app(c.doc, designWorkspace);
  await a.doubleClick(c.id);
  assert.equal(a.$("#combine-tools-names")!.textContent, "Box 2");
  const op = a.$("#combine-operation") as unknown as HTMLSelectElement;
  op.value = "cut";
  op.dispatchEvent(new a.window.Event("change") as never);
  await a.settle();
  a.$("#combine-ok")!.click();
  await a.settle();
  // The Cut removes nothing (Box 2 is 60 mm away), so OK asks first; the body it would delete is Box 2, which the list doesn't call Body 2.
  assert.equal(a.$("#cut-ask-go")!.textContent, "Delete Box 2");
  assert.doesNotMatch(a.$("#cut-ask-words")!.textContent!, /Body 2/);
  a.$("#cut-ask-cancel")!.click();
  await a.settle();
  await a.close();
  // Box 2 deleted: the Combine fails ("Box 2 was deleted…"), and its panel names the tool as it was.
  const b = await app(deleteItem(c.doc, box2.id), designWorkspace);
  await b.doubleClick(c.id);
  assert.equal(b.$("#combine-tools-names")!.textContent, "Box 2 (deleted)");
  await b.close();
});
