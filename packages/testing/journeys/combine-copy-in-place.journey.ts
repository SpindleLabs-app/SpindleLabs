// SL #624 item 3 (broken-solids hunt, 2026-11-12), in the app around Design
// (design-app.ts) on the real kernel: a body made by a Combine, copied with
// Ctrl+D so the Copy lies exactly on it, then the two picked in the Combine
// panel as target and tool. Join and Intersect each give the one body; before
// the fix OK was refused with "a body can't be its own tool (tool 1 is the
// target)", which is not what the person picked. Unit cases: workspaces/design
// test/combine-copy-in-place.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyReference, designWorkspace, insertCombine, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown } from "@fission/design";
import { app } from "./design-app.ts";

setCombineShown(true);

for (const operation of ["join", "intersect"] as const) {
  test(`a joined body and its Copy in place, Combine ${operation}: one 1,500 mm3 body`, async () => {
    // Box 1 (10 mm cube) and Box 2 (10 mm cube moved 5 along x) joined by Combine 1: Body 1 is x 0..15, 10 x 10 across = 1,500 mm3.
    const two = insertPreset(partDocument("box", 10, 10, 10), "box", 10, 10, 10);
    const moved = insertMove(two.doc, [`body:${two.id}`], { ...NO_MOVE, x: 5 }).doc;
    const a = await app(insertCombine(moved, "body:feature-1", [`body:${two.id}`], "join").doc, designWorkspace);
    const before = a.doc().timeline.features.length;
    a.selection.set([bodyReference("body:feature-1")]);
    await a.settle();
    await a.key("duplicate-bodies"); // Ctrl+D: Copy 1 (Body 2) lies exactly on Box 1 (Body 1)
    const copy = a.doc().timeline.features[before].id;
    a.selection.clear();
    await a.settle();
    a.$("#modify-menu")!.click();
    await a.settle();
    a.$("#modify-menu-combine")!.click();
    await a.settle();
    a.selection.set([bodyReference("body:feature-1")]); // the target's row clicked
    await a.settle();
    a.selection.set([bodyReference("body:feature-1"), bodyReference(`body:${copy}`)]); // then the tool's
    await a.settle();
    assert.equal(`${a.$("#combine-target-names")!.textContent} | ${a.$("#combine-tools-names")!.textContent}`, "Body 1 | Body 3");
    const select = a.$("#combine-operation") as HTMLSelectElement;
    select.value = operation;
    select.dispatchEvent(new a.window.Event("change") as never);
    (a.$("#combine-ok") as HTMLButtonElement).click();
    await a.settle();
    const e = a.$("#combine-error");
    const refusal = e && !e.hidden ? e.textContent : null;
    // By hand: two equal 1,500 mm3 bodies in the same place joined, or what they share, is that one body, 1,500 mm3.
    assert.equal(refusal, null, "the two bodies are different bodies: Body 3 is not Body 1");
    assert.equal(a.doc().timeline.features.filter((f) => f.intent.type === "combine").length, 2, "Combine 2 is recorded");
    assert.equal(Math.round(a.volume()), 1500);
    assert.ok(await a.close(), "every body freed");
  });
}
