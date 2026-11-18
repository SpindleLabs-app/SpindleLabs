// Hunt A6: the Delete question for the sketch of an extrude's SECOND profile says the extrude "has no shape to keep
// and fails"; confirmed, the extrude keeps its last shape with a warning (as the owner's rule says, and as the same
// question says for the first profile's sketch). Run: node --experimental-strip-types --no-warnings --test journeys/_hunt-A-delete-words.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, designWorkspace } from "@fission/design";
import { app } from "./design-app.ts";
import { empty } from "./kept-app.ts";
import { extrudeSeveral, seen, items } from "./several-hunt-a-lib.ts";

for (const which of ["first", "second"] as const)
  test(`deleting the sketch of the ${which} profile: the question says what then happens (Extrude 1 keeps its last shape)`, async () => {
    // Sketch 1: A (0,0)-(10,10). Sketch 2: B (20,0)-(40,10). Extrude 1 = A + B by 5 mm: 500 + 1,000 = 1,500 mm3.
    const s = addSketch(empty());
    let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
    const t = addSketch(d);
    d = drawRectangle(t.doc, t.id, [20, 0], [40, 10]).doc;
    const a = await app(d, designWorkspace);
    await extrudeSeveral(a, [{ c: [5, 5], sketch: s.id }, { c: [30, 5], sketch: t.id }], "5");
    await a.menu(which === "first" ? s.id : t.id, "delete");
    const words = a.$("#delete-ask-words")!.textContent!;
    (a.$("#delete-ask-confirm") as HTMLButtonElement).click();
    await a.settle();
    const after = { volume: seen(a).volume, failed: seen(a).failed, warning: seen(a).warning };
    console.log(which, "| asked:", words, "| then:", JSON.stringify(after));
    await a.close();
    assert.deepEqual({ volume: after.volume, failed: after.failed }, { volume: 1500, failed: [] }); // it does keep its last shape
    assert.match(words, /keeps its last shape/);
    assert.doesNotMatch(words, /has no shape to keep and fails/);
  });
