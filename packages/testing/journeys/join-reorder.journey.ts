// SL #538 item 3 (hunt 2026-11-11, B2), in the Design app on the real
// kernel: two boxes joined by an Extrude Join, then Move 2 lifting the
// joined body z +5. Dragging Box 2 to the front of the timeline used to be
// allowed without a word; it handed the joined body Box 2's id, so Move 2
// went red and the body dropped back to z 0..20. Now the drop line is
// refused with the timeline's words, nothing is recorded, and the body
// stays lifted. A drag of the sketch to the front, which leaves the joined
// boxes' order alone, still moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, extrudeSketch, insertMove, insertPreset, NO_MOVE, partDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;

/** happy-dom lays nothing out: the bar's items given a layout, 40 px apart from x = 100, the row at y 760..792. */
function layOut(a: App) {
  const W = a.window as unknown as { HTMLElement: typeof HTMLElement };
  W.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
    if (this.classList.contains("timeline-bar-item")) {
      const items = [...this.parentElement!.querySelectorAll(".timeline-bar-item")];
      return rect(100 + 40 * items.indexOf(this), 764, 30, 24);
    }
    if (this.classList.contains("timeline-bar")) return rect(100, 760, 600, 32);
    if (this.classList.contains("timeline-marker")) return rect(0, 760, 800, 32);
    return rect(0, 0, 0, 0);
  } as never;
}

/** A mouse drag of bar item `id` to the gap before the item at `place`; what the drop line and its note said. */
function drag(a: App, id: string, place: number) {
  const li = a.$(`.timeline-bar-item[data-item="${id}"]`)!;
  const P = (a.window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent;
  const at = 100 + 40 * place - 5;
  const from = 100 + 40 * [...li.parentElement!.querySelectorAll(".timeline-bar-item")].indexOf(li) + 15;
  li.dispatchEvent(new P("pointerdown", { bubbles: true, button: 0, pointerId: 7, pointerType: "mouse", clientX: from, clientY: 776 }));
  li.dispatchEvent(new P("pointermove", { bubbles: true, button: 0, pointerId: 7, pointerType: "mouse", clientX: at, clientY: 776 }));
  const state = a.$(".timeline-reorder-line")?.dataset.state;
  const words = a.$(".timeline-reorder-note")?.textContent ?? "";
  li.dispatchEvent(new P("pointerup", { bubbles: true, button: 0, pointerId: 7, pointerType: "mouse", clientX: at, clientY: 776 }));
  return { state, words };
}

const zRange = (a: App) => {
  const p = a.mesh()!.positions;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 2; i < p.length; i += 3) (lo = Math.min(lo, p[i])), (hi = Math.max(hi, p[i]));
  return [lo, hi];
};
const failed = (a: App) => [...a.window.document.querySelectorAll<HTMLElement>(".timeline-bar-item[data-failed]")].map((li) => li.dataset.item);
const order = (a: App) => a.doc().timeline.features.map((f) => f.id);

/** The hunter's design: Box 1 and Box 2 (40 × 30 × 20, Box 2 moved x +100), the rectangle x 30..110, y 10..20 extruded 10 joining both, Move 2 lifting the joined body z +5. */
function design() {
  const doc = partDocument("box", 40, 30, 20);
  const box1 = doc.timeline.features[0].id;
  const b2 = insertPreset(doc, "box", 40, 30, 20);
  const move1 = insertMove(b2.doc, [`body:${b2.id}`], { ...NO_MOVE, x: 100 });
  const s = addSketch(move1.doc);
  const e = extrudeSketch(drawRectangle(s.doc, s.id, [30, 10], [110, 20]).doc, s.id, 10, false, undefined, { operation: "join", bodies: [`body:${box1}`, `body:${b2.id}`] });
  return { doc: insertMove(e.doc, [`body:${box1}`], { ...NO_MOVE, z: 5 }).doc, box2: b2.id, sketch: s.id };
}

test("hand-worked, in the app: Box 2 dragged in front of Box 1 under a Join is refused in words, and the joined body stays lifted", async () => {
  const d = design();
  const a = await app(d.doc);
  layOut(a);
  // One body: 24,000 + 24,000 + the pad 80 × 10 × 10 = 8,000, less its two 10 × 10 × 10 overlaps: 54,000 mm³, lifted
  // by Move 2 from z 0..20 to z 5..25.
  assert.ok(close(a.volume(), 54000), `the view holds ${a.volume()} mm³`);
  assert.deepEqual(zRange(a), [5, 25]);
  assert.deepEqual(failed(a), []);
  const before = order(a);
  const undo = a.history.undoLabel();
  const r = drag(a, d.box2, 0);
  await a.settle();
  assert.equal(r.state, "refused");
  assert.equal(r.words, "Box 2 can't go before Box 1: Extrude 1 joins their bodies, and the joined body is the one made first");
  // Nothing recorded: the same order, no new undo step, the body still lifted and nothing red.
  assert.deepEqual(order(a), before);
  assert.equal(a.history.undoLabel(), undo);
  assert.ok(close(a.volume(), 54000), `after the drop the view holds ${a.volume()} mm³`);
  assert.deepEqual(zRange(a), [5, 25]);
  assert.deepEqual(failed(a), []);
  assert.ok(await a.close(), "bodies left in the kernel");
});

test("the control, in the app: Sketch 1 dragged to the front still moves, and the joined body stays lifted", async () => {
  const d = design();
  const a = await app(d.doc);
  layOut(a);
  const r = drag(a, d.sketch, 0);
  await a.settle();
  assert.equal(r.state, "moves");
  assert.equal(order(a)[0], d.sketch);
  // The sketch is on XY and makes no body: the same 54,000 mm³ at z 5..25.
  assert.ok(close(a.volume(), 54000), `the view holds ${a.volume()} mm³`);
  assert.deepEqual(zRange(a), [5, 25]);
  assert.deepEqual(failed(a), []);
  assert.ok(await a.close(), "bodies left in the kernel");
});
