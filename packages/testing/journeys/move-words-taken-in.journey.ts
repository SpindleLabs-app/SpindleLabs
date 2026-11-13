// SL #641 item 3 (save hunt 2026-11-12, C3): after an edit makes a Move take in a new piece (SL #583 item 2), the
// timeline bar still described the Move as it was ("Move 2 / Combine 1 moved …") until something drew the bar again,
// while the file and a reopened design said what it holds now ("… 2 bodies …"). In the app around Design on the real
// kernel, the recipe of combine-split-move.journey.ts: the bar's words for the Move after the edit are the reopened
// design's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertCombine, insertMove, insertPreset, movedBodies, NO_MOVE, partDocument } from "@fission/design";
import { app } from "./design-app.ts";

test("after an edit makes Move 2 take in a new piece, the bar's words for it are the ones the reopened design shows", async () => {
  // As combine-split-move.journey.ts: Box 2 60 deep cuts the bar Move 2 lifts in two; Move 2 then lifts both pieces.
  let doc = partDocument("box", 100, 40, 10);
  let slot: string;
  ({ doc, id: slot } = insertPreset(doc, "box", 10, 30, 30));
  doc = insertMove(doc, [`body:${slot}`], { ...NO_MOVE, x: 30, y: -10, z: -10 }).doc;
  const c = insertCombine(doc, "body:feature-1", [`body:${slot}`], "cut");
  const m = insertMove(c.doc, ["body:feature-1"], { ...NO_MOVE, z: 50 });
  const a = await app(m.doc, designWorkspace);
  const words = () => a.$(`[data-item="${m.id}"]`)?.title ?? null;
  const before = words();
  assert.ok(before !== null && !/2 bodies/.test(before), `at first: ${before}`);
  assert.equal(await a.menu(slot, "edit"), null);
  (a.$("#edit-depth") as HTMLInputElement).value = "60";
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  assert.deepEqual(movedBodies(a.doc().timeline.features.find((f) => f.id === m.id)!), ["body:feature-1", `body:${c.id}/piece:1`]);
  const live = words();
  const saved = a.doc();
  assert.ok(await a.close(), "every body freed");
  // Worked by hand: Move 2 now holds two bodies, the bar and the new piece, so its words count them: "2 bodies".
  const reopened = await app(saved, designWorkspace);
  const fresh = reopened.$(`[data-item="${m.id}"]`)?.title ?? null;
  assert.match(fresh ?? "", /2 bodies/);
  assert.equal(live, fresh, "the bar after the edit says what the reopened design says");
  assert.ok(await reopened.close(), "every body freed");
});
