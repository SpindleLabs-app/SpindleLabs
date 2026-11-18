// Hunt A7: the assistant's draw commands are refused in a sketch an extrude is built from ("the AI can't draw in it
// yet": the edit must be settled on the kernel first, commands.ts drawRefused), but only the extrude's FIRST profile's
// sketch is looked at (commands.ts builtFrom). In the sketch of a second profile the AI draws, nothing is settled.
// Run: node --experimental-strip-types --no-warnings --test journeys/_hunt-A-ai.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, designWorkspace } from "@fission/design";
import { app } from "./design-app.ts";
import { editSketch, empty, isSettled } from "./kept-app.ts";
import { extrudeSeveral, seen, fresh } from "./several-hunt-a-lib.ts";

for (const which of ["first", "second"] as const)
  test(`the AI's draw_line across the ${which} profile's rectangle, its sketch open: refused, or the extrude keeps its last shape (1,500 mm3)`, async () => {
    // Sketch 1: A (0,0)-(10,10). Sketch 2: B (20,0)-(40,10). Extrude 1 = A + B by 5 mm: 500 + 1,000 = 1,500 mm3.
    const s = addSketch(empty());
    let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
    const t = addSketch(d);
    d = drawRectangle(t.doc, t.id, [20, 0], [40, 10]).doc;
    const a = await app(d, designWorkspace);
    await extrudeSeveral(a, [{ c: [5, 5], sketch: s.id }, { c: [30, 5], sketch: t.id }], "5");
    await editSketch(a, which === "first" ? s.id : t.id);
    const x = which === "first" ? 5 : 30;
    let said = "drawn";
    try { await a.command({ op: "draw_line", x1: x, y1: -5, x2: x, y2: 15 } as never); } catch (e) { said = `refused: ${(e as Error).message}`; }
    if (a.sketching()) await a.finish();
    const got = { said, volume: seen(a).volume, failed: seen(a).failed, warning: seen(a).warning, error: seen(a).error, kept: Object.keys(a.doc().kept ?? {}), settled: await isSettled(a.doc()), fresh: (await fresh(a.doc())).status };
    console.log(which, JSON.stringify(got));
    await a.close();
    assert.deepEqual({ volume: got.volume, failed: got.failed, settled: got.settled }, { volume: 1500, failed: [], settled: true });
  });
