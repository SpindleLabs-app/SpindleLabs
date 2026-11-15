// A symmetric extrude's preview and arrow are the body OK makes (app-wide hunt 2026-11-14, R-1 and R-2). With two
// profiles picked the preview was drawn all on one side of the sketch (z 0..10 for a 10 mm one) while OK made z -5..5;
// and the arrow handed to the view was the whole thickness long, so its tip stood beyond the end cap and each grab of
// it doubled the distance (the view starts a drag at the arrow's own length, and a symmetric drag to s is a distance of 2s).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayMesh } from "@fission/core";
import { addSketch, drawRectangle, partDocument, type DesignDocument } from "@fission/design";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;

function zRange(mesh: DisplayMesh | null): [number, number] | null {
  if (!mesh || mesh.positions.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < mesh.positions.length; i += 3) {
    lo = Math.min(lo, mesh.positions[i]);
    hi = Math.max(hi, mesh.positions[i]);
  }
  return [Math.round(lo * 1e6) / 1e6 + 0, Math.round(hi * 1e6) / 1e6 + 0];
}

/** Two sketches on XY, far from the box at the origin and from each other: a 10 x 10 square from (100, 0) and one from (200, 0). */
function twoSquares(): DesignDocument {
  const s1 = addSketch(partDocument("box", 10, 10, 10));
  const doc = drawRectangle(s1.doc, s1.id, [100, 0], [110, 10]).doc;
  const s2 = addSketch(doc);
  return drawRectangle(s2.doc, s2.id, [200, 0], [210, 10]).doc;
}

async function type(a: App, text: string) {
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}

async function run(several: boolean, typed: string) {
  const a = await app(twoSquares());
  a.$("#extrude")!.click();
  await a.settle();
  const [s1, s2] = a.doc().sketches.map((s) => s.id);
  await a.extrudePointer({ kind: "pick", profile: s1 });
  if (several) await a.extrudePointer({ kind: "pick", profile: s2, add: true });
  const both = a.$("#extrude-symmetric") as HTMLButtonElement;
  assert.ok(both, "Extrude has Symmetric");
  both.click();
  await a.settle();
  assert.equal(both.getAttribute("aria-pressed"), "true");
  await type(a, typed);
  const shown = a.extrudeShown()!;
  assert.deepEqual([shown.chosen, ...(shown.alsoChosen ?? [])], several ? [s1, s2] : [s1]);
  const preview = zRange(shown.preview);
  const arrow = shown.arrow;
  // The arrow grabbed and let go where it was grabbed: the view hands over the arrow's own length (viewer.ts dragArrow).
  await a.extrudePointer({ kind: "drag", distance: arrow!.distance, done: false });
  await a.extrudePointer({ kind: "drag", distance: arrow!.distance, done: true });
  const afterGrab = (a.$("#extrude-distance") as HTMLInputElement).value;
  const before = new Set(a.doc().timeline.features.map((f) => f.id));
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const made = a.doc().timeline.features.find((f) => !before.has(f.id));
  assert.ok(made, `an extrude was made: ${a.$("#extrude-error")?.textContent}`);
  assert.equal(made.intent.parameters.symmetric, true, "recorded symmetric");
  // The whole design's mesh: the box at the origin is z 0..10, so read only the vertices with x >= 100 (the extrude's).
  const mesh = a.mesh()!;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) if (mesh.positions[i] >= 99) { lo = Math.min(lo, mesh.positions[i + 2]); hi = Math.max(hi, mesh.positions[i + 2]); }
  await a.close();
  return { preview, arrow, afterGrab, madeZ: [lo, hi] };
}

// Hand working: a symmetric extrude of 10 mm from a sketch on XY (z = 0) goes half each way (extrude-symmetric.ts:
// "a 10 mm symmetric extrude is 10 mm thick with the sketch in its middle"), so z runs from -5 to +5, for one profile
// or several. Its arrow stands on the plane (base z = 0) and its tip on the end cap at z = 5, so it is 5 long; grabbed
// and let go on the same spot nothing was dragged, so the box still says 10 (it said 20, then 40, at each grab).
test("one profile, Symmetric, 10 mm: the preview is z -5..5, as the body made", async () => {
  const r = await run(false, "10");
  assert.deepEqual(r.madeZ, [-5, 5], "the body OK makes");
  assert.deepEqual(r.preview, [-5, 5], "the preview");
  assert.equal(r.arrow!.base[2], 0, "the arrow stands on the sketch's plane");
  assert.equal(r.arrow!.distance, 5, "the arrow's tip is on the end cap, z = 5");
  assert.equal(r.afterGrab, "10", "the arrow grabbed and let go leaves the distance");
});

test("two profiles, Symmetric, 10 mm: the preview is z -5..5, as the body made", async () => {
  const r = await run(true, "10");
  assert.deepEqual(r.madeZ, [-5, 5], "the body OK makes");
  assert.deepEqual(r.preview, [-5, 5], "the preview");
  assert.equal(r.arrow!.base[2], 0, "the arrow stands on the sketch's plane");
  assert.equal(r.arrow!.distance, 5, "the arrow's tip is on the end cap, z = 5");
  assert.equal(r.afterGrab, "10", "the arrow grabbed and let go leaves the distance");
});

test("two profiles, Symmetric, -10 typed: the sign is dropped, the preview is z -5..5, as the body made", async () => {
  const r = await run(true, "-10");
  assert.deepEqual(r.madeZ, [-5, 5], "the body OK makes");
  assert.deepEqual(r.preview, [-5, 5], "the preview");
});
