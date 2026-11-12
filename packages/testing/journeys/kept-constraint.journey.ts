// Timeline hunt 2026-11-11 (A4): a constraint or a dimension that spoils the
// outline an extrude is built from leaves the extrude its last shape with the
// warning, and one that closes an outline again forgets the kept shape, as a
// drag, a delete or a drawing click does (the owner's rule, rebuild.ts
// settleKept). They were recorded without settling: the body disappeared, or
// an older shape came back at the next loss.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, designWorkspace, drawCircle, drawLine, drawRectangle, extrudeSketch, type DesignDocument } from "@fission/design";
import { regionRef, sketchRegions } from "../../../workspaces/design/src/regions.ts";
import { app, kernel } from "./design-app.ts";
import { deleteAt, dragPoint, drawLines, editSketch, empty, isSettled, seen, type App } from "./kept-app.ts";

/** Sketch 1 on XY: the four-sided outline (0,0) (40,0) (40,30) (0,30) as four lines with no constraints, extruded 20 (no region, as the assistant's extrudes and files from before regions): 40 · 30 · 20 = 24000 mm³. */
function quad(): { doc: DesignDocument; sketch: string; extrude: string } {
  const s = addSketch(empty());
  let doc = s.doc;
  const pts: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  for (let i = 0; i < 4; i++) {
    const sk = doc.sketches[0];
    const at = (p: [number, number]) => sk.points.find((q) => q.x === p[0] && q.y === p[1])?.id ?? p;
    doc = drawLine(doc, s.id, at(pts[i]), at(pts[(i + 1) % 4])).doc;
  }
  const made = extrudeSketch(doc, s.id, 20);
  return { doc: made.doc, sketch: s.id, extrude: made.id };
}

/** A constraint tool chosen from the sketch toolbar. */
async function tool(a: App, kind: string) {
  (a.$(`#sketch-tool-${kind}`) as HTMLButtonElement).click();
  await a.settle();
}

/** `text` typed in the Dimension tool's box, then Enter. */
async function typeDiameter(a: App, text: string) {
  const box = a.$("#typed-diameter") as HTMLInputElement;
  assert.ok(box, "the Diameter box");
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  box.dispatchEvent(new a.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event);
  await a.settle();
}

/** What the test reads after Finish Sketch. */
const after = (a: App, extrude: string) => ({ volume: seen(a).volume, failed: seen(a).failed, warned: seen(a).warning !== null, kept: a.doc().kept?.[extrude] !== undefined });

test("control: the corner (40,0) dragged to (20,40) crosses two sides: Extrude 1 keeps its last shape, 24000 mm³, with the warning", async () => {
  const { doc, sketch, extrude } = quad();
  const a = await app(doc, designWorkspace);
  assert.equal(seen(a).volume, 24000); // 40 · 30 · 20
  await editSketch(a, sketch);
  // (0,0) → (20,40) → (40,30) → (0,30): the side from (0,0) to (20,40) is y = 2x, which meets the top side y = 30 at (15,30).
  await dragPoint(a, [40, 0], [20, 40]);
  await a.finish();
  assert.deepEqual(after(a, extrude), { volume: 24000, failed: [], warned: true, kept: true });
  assert.ok(await a.close());
});

test("A4: Coincident on the corners (40,0) and (0,30) spoils the outline: Extrude 1 keeps its last shape, 24000 mm³, with the warning", async () => {
  const { doc, sketch, extrude } = quad();
  const a = await app(doc, designWorkspace);
  await editSketch(a, sketch);
  await tool(a, "coincident");
  await a.click(40, 0);
  await a.click(0, 30);
  assert.equal(a.history.undoLabel(), "Coincident", a.$("#sketch-error")?.textContent ?? "");
  // The two corners are one place now, so two of the four sides lie along each other: no outline.
  const [p, q] = [1, 3].map((k) => a.doc().sketches[0].points[k]);
  assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-6, JSON.stringify(a.doc().sketches[0].points));
  // Settled as it was recorded, before Finish Sketch: the shape is kept in the file, and settling it again changes nothing.
  const recorded = { kept: a.doc().kept?.[extrude] !== undefined, settled: await isSettled(a.doc()) };
  await a.key("clear-selection");
  await a.finish();
  assert.deepEqual({ ...after(a, extrude), recorded }, { volume: 24000, failed: [], warned: true, kept: true, recorded: { kept: true, settled: true } }, JSON.stringify(seen(a)));
  // One undo step: Undo is the whole plate built from its sketch, nothing kept.
  await a.undo();
  assert.deepEqual(after(a, extrude), { volume: 24000, failed: [], warned: false, kept: false });
  assert.ok(await a.close());
});

test("A4c: an open outline closed again by Coincident forgets the kept shape, so the next loss keeps the new 29200 mm³, not the old 24000", async () => {
  const { doc, sketch, extrude } = quad();
  const a = await app(doc, designWorkspace);
  await editSketch(a, sketch);
  await deleteAt(a, 40, 15); // the right side: Extrude 1 keeps 40 · 30 · 20
  assert.ok(a.doc().kept?.[extrude], "kept at the delete");
  await drawLines(a, [[40, 0], [60, 28]]); // a new side, its far end loose
  await tool(a, "coincident");
  await a.click(60, 28); // stays
  await a.click(40, 30); // moves onto it: the outline (0,0) (40,0) (60,28) (0,30) is closed
  assert.equal(a.history.undoLabel(), "Coincident", a.$("#sketch-error")?.textContent ?? "");
  // The sketch makes an outline again: nothing kept in the file from the Coincident on.
  const recorded = { kept: a.doc().kept?.[extrude] !== undefined, settled: await isSettled(a.doc()) };
  await a.key("clear-selection");
  await a.finish();
  // Shoelace of (0,0) (40,0) (60,28) (0,30): (0·0 − 40·0) + (40·28 − 60·0) + (60·30 − 0·28) + (0·0 − 0·30) = 2920, half 1460 mm²; × 20 = 29200 mm³.
  assert.deepEqual({ volume: seen(a).volume, warning: seen(a).warning }, { volume: 29200, warning: null });
  await editSketch(a, sketch);
  await deleteAt(a, 20, 0); // the bottom side: the last shape was the 29200 one
  await a.finish();
  assert.deepEqual({ ...after(a, extrude), recorded }, { volume: 29200, failed: [], warned: true, kept: true, recorded: { kept: false, settled: true } }, JSON.stringify(seen(a)));
  assert.ok(await a.close());
});

/** Sketch 1: the plate (0,0)-(40,30) and beside it a circle of radius 5 round (60,15); Extrude 1 is the plate's region by 20: 24000 mm³. */
async function plateAndCircle(): Promise<{ doc: DesignDocument; sketch: string; extrude: string }> {
  const s = addSketch(empty());
  let doc = drawRectangle(s.doc, s.id, [0, 0], [40, 30]).doc;
  doc = drawCircle(doc, s.id, [60, 15], 5).doc;
  const regions = await sketchRegions(kernel, doc.sketches[0]);
  const plate = regions.regions.find((r) => Math.hypot(r.centroid[0] - 20, r.centroid[1] - 15) < 1e-9)!;
  const made = extrudeSketch(doc, s.id, 20, false, regionRef(plate, regions.ids));
  return { doc: made.doc, sketch: s.id, extrude: made.id };
}

test("a new dimension that spoils the region: the circle's diameter typed 60 crosses the plate's right side, and Extrude 1 keeps 24000 mm³", async () => {
  const { doc, sketch, extrude } = await plateAndCircle();
  const a = await app(doc, designWorkspace);
  assert.equal(seen(a).volume, 24000);
  await editSketch(a, sketch);
  await tool(a, "dimension");
  await a.click(65, 15); // on the circle: its diameter, 10, waits in the box
  await typeDiameter(a, "60");
  // Radius 30 round (60,15): the circle reaches x = 30, across the plate's right side at x = 40, so the plate is no
  // longer one region bounded by its four sides.
  assert.equal(a.history.undoLabel(), "Dimension", a.$("#sketch-error")?.textContent ?? "");
  assert.equal(a.doc().sketches[0].curves.find((c) => c.kind === "circle")?.radius, 30);
  // Settled as it was recorded, before Finish Sketch: the shape is kept in the file.
  const recorded = { kept: a.doc().kept?.[extrude] !== undefined, settled: await isSettled(a.doc()) };
  await a.key("clear-selection");
  await a.key("clear-selection");
  await a.finish();
  assert.deepEqual({ ...after(a, extrude), recorded }, { volume: 24000, failed: [], warned: true, kept: true, recorded: { kept: true, settled: true } }, JSON.stringify(seen(a)));
  assert.ok(await a.close());
});

test("a dimension changed from its label: the diameter 10 made 60 keeps the plate, and made 10 again forgets the kept shape", async () => {
  const { doc, sketch, extrude } = await plateAndCircle();
  const a = await app(doc, designWorkspace);
  await editSketch(a, sketch);
  await tool(a, "dimension");
  await a.click(65, 15);
  await typeDiameter(a, "10");
  const dimension = a.doc().sketches[0].constraints.find((c) => c.kind === "diameter");
  assert.ok(dimension, a.$("#sketch-error")?.textContent ?? "");
  assert.equal(a.doc().kept, undefined);
  // Design asks whether the double-click's target is an Element, the page's global in a browser: lent to this test.
  const page = globalThis as { Element?: unknown };
  const had = page.Element;
  page.Element = a.window.Element;
  /** The dimension's label double-clicked (the viewport draws the labels; here one is put on the view by hand), and a diameter typed. */
  const change = async (text: string) => {
    const label = a.window.document.createElement("span") as unknown as HTMLElement;
    label.className = "sketch-label";
    label.dataset.dimension = dimension.id;
    a.$("[data-rebuilding]")!.append(label);
    label.dispatchEvent(new a.window.MouseEvent("dblclick", { bubbles: true }) as unknown as Event);
    await a.settle();
    label.remove();
    await typeDiameter(a, text);
  };
  await change("60");
  assert.equal(a.history.undoLabel(), "Change dimension", a.$("#sketch-error")?.textContent ?? "");
  assert.equal(a.doc().sketches[0].curves.find((c) => c.kind === "circle")?.radius, 30);
  const first = { kept: a.doc().kept?.[extrude] !== undefined, settled: await isSettled(a.doc()) };
  // Back to 10: the plate is its own region again, so the kept shape is forgotten.
  await change("10");
  assert.equal(a.doc().sketches[0].curves.find((c) => c.kind === "circle")?.radius, 5);
  const back = { kept: a.doc().kept?.[extrude] !== undefined, settled: await isSettled(a.doc()) };
  await change("60");
  page.Element = had;
  await a.key("clear-selection");
  await a.key("clear-selection");
  await a.finish();
  assert.deepEqual({ ...after(a, extrude), first, back }, { volume: 24000, failed: [], warned: true, kept: true, first: { kept: true, settled: true }, back: { kept: false, settled: true } }, JSON.stringify(seen(a)));
  assert.ok(await a.close());
});
