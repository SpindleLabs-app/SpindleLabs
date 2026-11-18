// Hunt 2026-11-12 C, finding C1: in the mounted app, Ctrl-click a square and
// a circle of one sketch (far apart, not even touching), type 5, OK. The
// preview shows both prisms; OK records the item; the rebuild then fails it
// ("booleans take flat faces only for now"), so the beginner gets a red item
// and no body at all, not even the square.

import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../../../packages/testing/journeys/design-app.ts";
import { volumesOf } from "./several-hunt-helpers.ts";
import { addSketch, drawCircle, drawRectangle, partDocument, type DesignDocument } from "../src/index.ts";

type App = Awaited<ReturnType<typeof app>>;
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want)), `${what}: ${got}, expected ${want}`);
async function type(a: App, text: string) {
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}

/** A 10 mm box, and a sketch with a square x 100..110 and a circle r 5 at (130, 5), 15 mm apart. */
function squareAndCircle(): DesignDocument {
  const s = addSketch(partDocument("box", 10, 10, 10));
  const d = drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc;
  return drawCircle(d, s.id, [130, 5], 5).doc;
}

test("C1: a square and a circle apart, Ctrl-picked and OK'd: two bodies, 500 + 125pi mm3", async () => {
  const a = await app(squareAndCircle());
  a.$("#extrude")!.click();
  await a.settle();
  const offers = a.extrudeShown()!.profiles.filter((o) => !o.face) as unknown as { id: string; outline: { outer: { circle?: unknown } } }[];
  const square = offers.find((o) => !("circle" in o.outline.outer))!.id;
  const circle = offers.find((o) => "circle" in o.outline.outer)!.id;
  await a.extrudePointer({ kind: "pick", profile: square });
  await a.extrudePointer({ kind: "pick", profile: circle, add: true });
  await type(a, "5");
  assert.equal(a.$("#extrude-profile")!.textContent, "2 selected");
  // Preview: 10 x 10 x 5 = 500 plus pi 5^2 x 5 = 125pi.
  near(Number(a.$("#extrude-panel")!.dataset.previewVolume), 500 + 125 * Math.PI, "preview");
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const f = a.doc().timeline.features.at(-1)!;
  // OK recorded it (the bug: OK checked only the first profile).
  assert.equal(f.intent.type, "extrude");
  console.log("error line:", JSON.stringify(a.error()));
  assert.equal(a.error(), "");
  // Built from the recorded design on the kernel (exact volumes; the app's display mesh cuts the circle into
  // straight pieces, so its volume is a little under): the square 10 x 10 x 5 = 500 and the disc pi 5^2 x 5 = 125pi,
  // two bodies since they never meet.
  const out = await volumesOf(a.doc(), f.id);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  assert.deepEqual(out.vols.map((v) => Math.round(v * 1e6) / 1e6).sort((x, y) => x - y), [Math.round(125 * Math.PI * 1e6) / 1e6, 500]);
  assert.ok(await a.close());
});

/** A 10 mm box, sketch 2 with a square x 100..110, y 0..10 and sketch 3 with a circle r 5 at `centre`. */
function squareThenCircle(centre: [number, number]): { doc: DesignDocument; sketches: string[] } {
  const s1 = addSketch(partDocument("box", 10, 10, 10));
  const d1 = drawRectangle(s1.doc, s1.id, [100, 0], [110, 10]).doc;
  const s2 = addSketch(d1);
  return { doc: drawCircle(s2.doc, s2.id, centre, 5).doc, sketches: [s1.id, s2.id] };
}

async function pickBoth(a: App) {
  a.$("#extrude")!.click();
  await a.settle();
  const offers = a.extrudeShown()!.profiles.filter((o) => !o.face) as unknown as { id: string; outline: { outer: { circle?: unknown } } }[];
  await a.extrudePointer({ kind: "pick", profile: offers.find((o) => !("circle" in o.outline.outer))!.id });
  await a.extrudePointer({ kind: "pick", profile: offers.find((o) => "circle" in o.outline.outer)!.id, add: true });
  await type(a, "5");
  assert.equal(a.$("#extrude-profile")!.textContent, "2 selected");
}

test("C1: a square and a circle of two sketches that overlap: OK refuses in plain words and records nothing", async () => {
  // The circle r 5 at (110, 5) overlaps the square's right side: the prisms must be joined, and the kernel's booleans
  // take flat faces only for now, so OK says so before anything is recorded.
  const { doc } = squareThenCircle([110, 5]);
  const a = await app(doc);
  const before = a.doc().timeline.features.length;
  await pickBoth(a);
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.doc().timeline.features.length, before, "nothing recorded");
  assert.match(a.$("#extrude-panel")!.textContent ?? "", /curved sides can only be extruded together when they don't touch or overlap/);
  assert.ok(await a.close());
});

test("C6: profiles of two sketches apart: after OK both sketches are hidden, and the bodies are 500 and 125pi", async () => {
  const { doc, sketches } = squareThenCircle([130, 5]);
  const a = await app(doc);
  await pickBoth(a);
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const f = a.doc().timeline.features.at(-1)!;
  assert.equal(f.intent.type, "extrude");
  for (const s of sketches) assert.ok((a.doc().hidden ?? []).includes(s), `${s} hidden: ${JSON.stringify(a.doc().hidden)}`);
  const out = await volumesOf(a.doc(), f.id);
  assert.deepEqual(out.vols.map((v) => Math.round(v * 1e6) / 1e6).sort((x, y) => x - y), [Math.round(125 * Math.PI * 1e6) / 1e6, 500]);
  assert.ok(await a.close());
});
