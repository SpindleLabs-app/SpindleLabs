// An OK that asks the person first (a Cut that removes nothing, cut-ask.ts) holds its step in the history while the
// question is open, so an Undo pressed meanwhile still waits for the answer (main.ts `whenIdle`). But nothing changes
// by itself while the box waits for the person: the history must say no work is running then (`working`), or the
// monkey's settle (e2e/monkey.mjs, `fissionTest.historyBusy`) waits 6 s for a page that is waiting for it (SL #397,
// seed 202611121 at action 1699: a Combine Cut of two bodies far apart, its question open, `held` true for good).
// Design on the real kernel in happy-dom (design-app.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertCombine, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown } from "@fission/design";
import { app } from "./design-app.ts";

setCombineShown(true); // the app's ?combine, as the monkey runs

/** Settles until the question box is open (the kernel's check answers first), at most 200 settles. */
async function untilAsked(a: Awaited<ReturnType<typeof app>>) {
  for (let i = 0; i < 200 && !(a.$("#cut-ask") as unknown as { open: boolean } | null)?.open; i++) await a.settle();
}

test("a Combine Cut's question is a wait for the person: held, but no work running, until it is answered (SL #397)", async () => {
  // Box 1 40 × 30 × 20 at the origin, Box 2 a 10 mm cube moved to x 100..110: 60 mm apart, so the Cut removes nothing
  // and OK asks first (the Combine is edited from Join to Cut, as in combine-words.journey.ts).
  let doc = partDocument("box", 40, 30, 20);
  const box2 = insertPreset(doc, "box", 10, 10, 10);
  doc = insertMove(box2.doc, [`body:${box2.id}`], { ...NO_MOVE, x: 100 }).doc;
  const c = insertCombine(doc, "body:feature-1", [`body:${box2.id}`], "join");
  const a = await app(c.doc, designWorkspace);
  try {
    await a.doubleClick(c.id);
    const op = a.$("#combine-operation") as unknown as HTMLSelectElement;
    op.value = "cut";
    op.dispatchEvent(new a.window.Event("change") as never);
    await a.settle();
    const before = a.doc();
    a.$("#combine-ok")!.click();
    await untilAsked(a);
    assert.equal(a.$("#cut-ask-go")!.textContent, "Delete Box 2", "the question is open");
    assert.equal(a.history.busy(), true, "the OK is still held: an Undo pressed now waits for the answer");
    assert.equal(a.history.working(), false, "but nothing runs by itself while the person is asked");
    // Still so however long the person takes.
    await a.settle();
    assert.equal(a.history.working(), false);
    a.$("#cut-ask-go")!.click();
    await a.settle();
    assert.equal(a.history.busy(), false, "answered: the OK recorded and let go");
    assert.equal(a.history.working(), false);
    assert.notEqual(a.doc(), before, "the Cut was recorded");
  } finally {
    await a.close();
  }
});

test("a Combine Cut's question answered Cancel lets the held OK go too, recording nothing", async () => {
  let doc = partDocument("box", 40, 30, 20);
  const box2 = insertPreset(doc, "box", 10, 10, 10);
  doc = insertMove(box2.doc, [`body:${box2.id}`], { ...NO_MOVE, x: 100 }).doc;
  const c = insertCombine(doc, "body:feature-1", [`body:${box2.id}`], "join");
  const a = await app(c.doc, designWorkspace);
  try {
    await a.doubleClick(c.id);
    const op = a.$("#combine-operation") as unknown as HTMLSelectElement;
    op.value = "cut";
    op.dispatchEvent(new a.window.Event("change") as never);
    await a.settle();
    const before = a.doc();
    a.$("#combine-ok")!.click();
    await untilAsked(a);
    assert.equal(a.history.working(), false);
    a.$("#cut-ask-cancel")!.click();
    await a.settle();
    assert.equal(a.history.busy(), false);
    assert.equal(a.history.working(), false);
    assert.equal(a.doc(), before, "nothing recorded");
  } finally {
    await a.close();
  }
});
