// One Extrude Cut through two boxes in the running Design workspace
// (happy-dom, the real kernel), SL #538 item 1: the second box is cut right
// across first, then Move 1 is edited through its panel so the first box is
// cut right across too. Every chunk of both boxes must still be a body: in
// the view, in the Bodies folder, in the design opened afresh, and Undo
// gives back what was there. Until the extrude's pieces were numbered once
// for the whole item, the new chunk of the first box took the number the
// second box's chunk was remembered with and one overwrote the other: a
// 10,400 mm³ chunk gone, when the box that was cut later was picked first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, extrudeSketch, insertMove, insertPreset, partDocument, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

const NO = { x: 0, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 };

for (const order of ["Box 1 picked first", "Box 2 picked first"] as const)
  test(`hand-worked (${order}): a Cut through two boxes, Move 1 edited so both are cut across: four bodies, 41,600 mm³, live, opened afresh, and undone`, async () => {
    // Box 1 40 × 30 × 20 moved to x −10..30, Box 2 the same at x 100..140; the slot x 20..150, y 13..17, z 0..30.
    let doc: DesignDocument = partDocument("box", 40, 30, 20);
    const one = `body:${doc.timeline.features[0].id}`;
    const move = insertMove(doc, [one], { ...NO, x: -10 });
    const box2 = insertPreset(move.doc, "box", 40, 30, 20);
    const two = `body:${box2.id}`;
    doc = insertMove(box2.doc, [two], { ...NO, x: 100 }).doc;
    const s = addSketch(doc);
    const e = extrudeSketch(drawRectangle(s.doc, s.id, [20, 13], [150, 17]).doc, s.id, 30, false, undefined, { operation: "cut", bodies: order === "Box 1 picked first" ? [one, two] : [two, one] });
    const a = await app(e.doc);
    const rows = (of = a) => [...of.window.document.querySelectorAll<HTMLElement>(".tree-row")].map((r) => r.dataset.node ?? "").filter((n) => /^body-\d+$/.test(n));
    // By hand: the slot notches Box 1 (x 20..30): 24,000 − 10 × 4 × 20 = 23,200; it cuts Box 2 right across:
    // 24,000 − 40 × 4 × 20 = 20,800 in two chunks. 44,000 in three bodies: the boxes, and Box 2's far chunk, Body 3.
    assert.ok(close(a.volume(), 44000), `before the edit the view holds ${a.volume()} mm³`);
    assert.deepEqual(rows(), ["body-1", "body-2", "body-3"]);

    // Move 1 opened by a double-click, X typed as 30, OK: Box 1 is at x 30..70, wholly inside the slot's length.
    await a.doubleClick(move.id);
    const x = a.$("#move-x") as HTMLInputElement;
    x.value = "30";
    x.dispatchEvent(new a.window.Event("input") as unknown as Event);
    await a.settle();
    (a.$("#move-ok") as HTMLButtonElement).click();
    await a.settle();
    // By hand: each box is 24,000 − 3,200 = 20,800 in two chunks of 40 × 13 × 20 = 10,400: 41,600 in four bodies.
    assert.ok(close(a.volume(), 41600), `after the edit the view holds ${a.volume()} mm³, expected 41,600 (each chunk is 10,400)`);
    // Box 1's new chunk is a new body, Body 4; Box 2's chunk is still Body 3. No piece changed, so nothing is warned.
    assert.deepEqual(rows(), ["body-1", "body-2", "body-3", "body-4"]);
    assert.equal(a.warning(), null);
    assert.equal(a.error(), "");
    const numbered = (a.doc().bodies ?? []).map((b) => `${b.id} ${b.number}`);
    assert.deepEqual(numbered, [`${one} 1`, `${two} 2`, `body:${e.id}/piece:1 3`, `body:${e.id}/piece:2 4`]);

    // The design as saved, opened afresh: the same four bodies and 41,600.
    const fresh = await app(JSON.parse(JSON.stringify(a.doc())) as DesignDocument);
    assert.ok(close(fresh.volume(), 41600), `opened afresh the view holds ${fresh.volume()} mm³`);
    assert.deepEqual(rows(fresh), ["body-1", "body-2", "body-3", "body-4"]);

    // Undo: Box 1 back at x −10..30, notched only: 44,000 in three bodies.
    await a.undo();
    assert.ok(close(a.volume(), 44000), `after Undo the view holds ${a.volume()} mm³`);
    assert.deepEqual(rows(), ["body-1", "body-2", "body-3"]);
  });
