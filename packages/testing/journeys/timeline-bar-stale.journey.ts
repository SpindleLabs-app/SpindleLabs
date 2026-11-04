// Bug hunt 2 (C1, 2026-11-04): the timeline bar while an edit is still being
// settled (a design with a sketch on a face settles every edit with the
// kernel before it builds), on the real Design and the real WASM kernel. The
// bar shows the design's order as soon as a drop is recorded, so a second
// drag made at once goes where its line showed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayMesh } from "@fission/core";
import { partDocument } from "@fission/design";
import { app, close } from "./design-app.ts";
import { insert } from "./selection-hunt-helpers.ts";

type App = Awaited<ReturnType<typeof app>>;

function faceWhere(mesh: DisplayMesh, on: (p: number[]) => boolean): number {
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const ok = [0, 1, 2].every((k) => {
      const i = mesh.indices[3 * t + k];
      return on([mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]);
    });
    all.set(f, (all.get(f) ?? true) && ok);
  });
  const found = [...all].filter(([, ok]) => ok).map(([f]) => f);
  assert.equal(found.length, 1);
  return found[0];
}

/** happy-dom lays nothing out: the bar's items given a layout, 40 px apart from x = 100, the row at y 760..792. */
function layOut(a: App) {
  const W = a.window as unknown as { HTMLElement: typeof HTMLElement };
  const proto = W.HTMLElement.prototype;
  proto.getBoundingClientRect = function (this: HTMLElement) {
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

/** A mouse drag of bar item `id` to between the items at places `place` − 1 and `place` of the bar as drawn now (not waited for). */
function drag(a: App, id: string, place: number) {
  const li = a.$(`.timeline-bar-item[data-item="${id}"]`)!;
  const P = (a.window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent;
  const at = 100 + 40 * place - 5; // the gap before item `place`
  const from = 100 + 40 * [...li.parentElement!.querySelectorAll(".timeline-bar-item")].indexOf(li) + 15;
  li.dispatchEvent(new P("pointerdown", { bubbles: true, button: 0, pointerId: 7, pointerType: "mouse", clientX: from, clientY: 776 }));
  li.dispatchEvent(new P("pointermove", { bubbles: true, button: 0, pointerId: 7, pointerType: "mouse", clientX: at, clientY: 776 }));
  const line = a.$(".timeline-reorder-line");
  const state = line?.dataset.state;
  li.dispatchEvent(new P("pointerup", { bubbles: true, button: 0, pointerId: 7, pointerType: "mouse", clientX: at, clientY: 776 }));
  return state;
}

const barOrder = (a: App) => [...a.window.document.querySelectorAll<HTMLElement>(".timeline-bar-item[data-item]")].map((li) => li.dataset.item!);
const docOrder = (a: App) => a.doc().timeline.features.map((f) => f.id);

/** Box 1, Sketch 1 on its top with a 20 × 20 square, Extrude 1 of it by 10, then a cylinder and a sphere inserted. */
async function faceDesign() {
  const a = await app(partDocument("box", 40, 30, 20));
  layOut(a);
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a.mesh()!, (p) => p[2] === 20) });
  for (const [x, y] of [[10, 5], [30, 5], [30, 25], [10, 25], [10.3, 4.8]]) await a.click(x, y);
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = "10";
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  await insert(a, "cylinder");
  await insert(a, "sphere");
  return a;
}

test("sanity: the drag helper reorders as a person's drag does, with the kernel answering", async () => {
  const a = await faceDesign();
  const [b, s, e, c, p] = docOrder(a);
  assert.deepEqual(barOrder(a), [b, s, e, c, p]);
  assert.equal(drag(a, p, 3), "moves");
  await a.settle();
  assert.deepEqual(docOrder(a), [b, s, e, p, c], "the sphere dropped before the cylinder");
  assert.deepEqual(barOrder(a), [b, s, e, p, c]);
  assert.equal(a.history.undoLabel(), "Move Sphere 1 in the timeline");
  assert.ok(await a.close());
});

test("a drop recorded while the kernel is busy: the bar shows the new order at once, and a second drag made on it lands where its line showed", async () => {
  const a = await faceDesign();
  const [b, s, e, c, p] = docOrder(a);
  a.hold(); // a slow kernel (a phone, a big design): the edit's settle is still being answered
  assert.equal(drag(a, p, 3), "moves"); // Sphere 1 dropped between Extrude 1 and Cylinder 1
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(docOrder(a), [b, s, e, p, c], "the drop is recorded at once");
  const shown = barOrder(a);
  // Second drag, on the bar as shown: Extrude 1 dropped between the 4th and 5th items shown.
  const intended = [...shown];
  intended.splice(intended.indexOf(e), 1);
  intended.splice(3, 0, e);
  const state = drag(a, e, 4);
  await a.release();
  const got = { barAfterFirstDrop: shown, secondLineSaid: state, intended, finalOrder: docOrder(a) };
  // What should hold: the bar shows the design's order as soon as the drop is recorded, so the second drag goes where its line was.
  assert.deepEqual({ bar: shown, final: docOrder(a) }, { bar: [b, s, e, p, c], final: intended }, JSON.stringify(got));
  assert.ok(await a.close());
});
