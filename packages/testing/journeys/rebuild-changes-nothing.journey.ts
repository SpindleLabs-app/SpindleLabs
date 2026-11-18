// The rule the seeded sessions check at their end (SL #641): a rebuild of a design the rebuild just wrote changes
// nothing (`rebuildChanges` in design-app.ts). Here, that the check passes a design the app wrote and catches one the
// rebuild still changes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertCombine, insertMove, insertPreset, NO_MOVE, partDocument } from "@fission/design";
import { app, rebuildChanges } from "./design-app.ts";

/** Box 1 and Box 2 30 mm apart, joined by Combine 1: two pieces, the second new to the data until a rebuild numbers it. */
function joinApart() {
  let doc = partDocument("box", 10, 10, 10);
  let second: string;
  ({ doc, id: second } = insertPreset(doc, "box", 10, 10, 10));
  doc = insertMove(doc, [`body:${second}`], { ...NO_MOVE, x: 30 }).doc;
  return insertCombine(doc, "body:feature-1", [`body:${second}`], "join");
}

test("a design the app has built and written rebuilds to itself", async () => {
  const a = await app(partDocument("box", 40, 30, 20), designWorkspace);
  const written = a.doc();
  assert.ok(await a.close());
  assert.equal(await rebuildChanges(written), null);
});

test("a design the rebuild still changes is caught, saying where: a Combine's new piece not yet numbered", async () => {
  // Worked by hand: Box 1 is Body 1 and Box 2 Body 2 in the data as made; the Join of boxes 30 mm apart leaves two
  // pieces, and the second, new to the data, is numbered only by a rebuild (numberPieces): Body 3. So the data as made
  // is not what the rebuild writes, and the check must say so; once the app has written it, it rebuilds to itself.
  const made = joinApart();
  const changed = await rebuildChanges(made.doc);
  assert.ok(changed !== null, "the unnumbered piece was not caught");
  assert.match(changed, /the rebuild changed the design it wrote/);
  // Where: the bodies list, which gains the piece as Body 3 (the counter of body numbers, 3 in the data, moves on).
  assert.match(changed, /"nextBody": 3/);
  const a = await app(made.doc, designWorkspace);
  const written = a.doc();
  assert.ok(await a.close());
  assert.ok(written.bodies?.some((b) => b.id === `body:${made.id}/piece:1` && b.number === 3), "the piece is Body 3");
  assert.equal(await rebuildChanges(written), null);
});
