// Picking several profiles in Extrude (Ben, 2026-11-11, Fusion's
// Ctrl-click; Design data version 18): the pure picking rules by hand,
// then the mounted Design workspace on the real kernel with a stand-in
// view: Ctrl (`add`) and Pick several add and take away, the panel says
// "N selected", ✕ and a plain click let the others go, the preview's
// volume worked out by hand, and OK saving one item that builds the
// bodies Fusion makes. The browser check is apps/fission/e2e/extrude-several.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, DisplayMesh } from "@fission/core";
import { app } from "../../../packages/testing/journeys/design-app.ts";
import { joinedMesh, joinedView, pickedCount, pickedWords, togglePick, type PickedProfile } from "../src/extrude-picks.ts";
import { moreProfiles } from "../src/extrude-profiles.ts";
import { addSketch, drawRectangle, partDocument, type DesignDocument } from "../src/index.ts";

const p = (id: string): PickedProfile => ({ id, sketch: "s", region: null });

test("hand-worked: adding, taking away, and the first taken away making the next one first", () => {
  let picks = togglePick({ first: null, more: [] }, p("a"));
  assert.deepEqual(picks, { first: p("a"), more: [] });
  picks = togglePick(picks, p("b"));
  picks = togglePick(picks, p("c"));
  assert.deepEqual(picks, { first: p("a"), more: [p("b"), p("c")] });
  assert.equal(pickedCount(picks), 3);
  assert.equal(pickedWords(picks, "Sketch 1"), "3 selected");
  // b again takes it away.
  picks = togglePick(picks, p("b"));
  assert.deepEqual(picks, { first: p("a"), more: [p("c")] });
  // The first taken away: c is first.
  picks = togglePick(picks, p("a"));
  assert.deepEqual(picks, { first: p("c"), more: [] });
  assert.equal(pickedWords(picks, "Sketch 1"), "Sketch 1");
  picks = togglePick(picks, p("c"));
  assert.deepEqual(picks, { first: null, more: [] });
  assert.equal(pickedCount(picks), 0);
});

test("hand-worked: two meshes drawn as one, the second's corners numbered after the first's", () => {
  const tri = (x: number): DisplayMesh => ({ positions: [x, 0, 0, x + 1, 0, 0, x, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], triangle_faces: [0], edge_lines: [x, 0, 0, x + 1, 0, 0], edge_line_edges: [0] });
  const m = joinedMesh([tri(0), tri(5)]);
  // The first has 3 points, so the second's 0, 1, 2 are 3, 4, 5.
  assert.deepEqual(m.indices, [0, 1, 2, 3, 4, 5]);
  assert.equal(m.positions.length, 18);
  assert.deepEqual(m.edge_lines.slice(6), [5, 0, 0, 6, 0, 0]);
  // Two boxes' views: volumes 6 and 24 add to 30, the box round both from (0,0,0) to (5,4,3).
  const view = (low: number[], high: number[], volume: number) => ({ mesh: tri(0), volume, bounds: [low, high] }) as unknown as BodyView;
  const v = joinedView([view([0, 0, 0], [1, 2, 3], 6), view([3, 1, 0], [5, 4, 2], 24)]);
  assert.equal(v.volume, 30);
  assert.deepEqual(v.bounds, [[0, 0, 0], [5, 4, 3]]);
});

/** Two 10 mm squares side by side (x 100..110 and 110..120) and one apart (x 130..140), all y 0..10, beside a 10 mm box. */
function threeSquares(): DesignDocument {
  const s = addSketch(partDocument("box", 10, 10, 10));
  let d = drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc;
  d = drawRectangle(d, s.id, [110, 0], [120, 10]).doc;
  return drawRectangle(d, s.id, [130, 0], [140, 10]).doc;
}

type App = Awaited<ReturnType<typeof app>>;
const panel = (a: App) => a.$("#extrude-panel")!;
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.max(1, Math.abs(want)), `${what}: ${got}, expected ${want}`);
async function type(a: App, text: string) {
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}
type Offer = { id: string; outline: { outer: { path?: { corners: number[] } } } };
/** The offered region whose outline's first corner has x between `lo` and `hi`. */
const squareAt = (a: App, lo: number, hi: number) =>
  (a.extrudeShown()!.profiles.filter((o) => !o.face) as unknown as Offer[]).find((o) => {
    const xs = (o.outline.outer.path?.corners ?? []).filter((_, i) => i % 2 === 0);
    return xs.length > 0 && Math.min(...xs) >= lo - 1e-9 && Math.max(...xs) <= hi + 1e-9;
  })!.id;

test("hand-worked: Ctrl-click adds, the panel says 3 selected, the preview is 3 squares by 5 mm; OK makes one item and two bodies", async () => {
  const a = await app(threeSquares());
  a.$("#extrude")!.click();
  await a.settle();
  const [left, right, far] = [squareAt(a, 100, 110), squareAt(a, 110, 120), squareAt(a, 130, 140)];
  await a.extrudePointer({ kind: "pick", profile: left });
  await a.extrudePointer({ kind: "pick", profile: right, add: true });
  await a.extrudePointer({ kind: "pick", profile: far, add: true });
  await type(a, "5");
  assert.equal(a.$("#extrude-profile")!.textContent, "3 selected");
  assert.deepEqual(a.extrudeShown()!.alsoChosen, [right, far]);
  assert.equal(a.extrudeShown()!.chosen, left);
  // Three 10 × 10 squares by 5 mm: 3 × 500 = 1,500 mm³.
  near(Number(panel(a).dataset.previewVolume), 1500, "preview");
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const f = a.doc().timeline.features.at(-1)!;
  assert.equal(moreProfiles(f).length, 2);
  assert.equal(a.history.undoLabel(), "Extrude Sketch 1");
  // The box (1,000) and the extrude's 1,500: the touching pair one body, the square apart another.
  near(a.volume(), 2500, "everything built");
  const bodies = a.window.document.querySelectorAll("[data-eye^=\"body-\"]").length;
  assert.equal(bodies, 3, "three bodies: the box, the pair, the square apart");
  assert.ok(await a.close());
});

test("Ctrl-click on a picked profile takes it away; a plain click picks only that one; ✕ clears all", async () => {
  const a = await app(threeSquares());
  a.$("#extrude")!.click();
  await a.settle();
  const [left, right, far] = [squareAt(a, 100, 110), squareAt(a, 110, 120), squareAt(a, 130, 140)];
  await a.extrudePointer({ kind: "pick", profile: left });
  await a.extrudePointer({ kind: "pick", profile: right, add: true });
  await a.extrudePointer({ kind: "pick", profile: far, add: true });
  await a.extrudePointer({ kind: "pick", profile: right, add: true });
  assert.equal(a.$("#extrude-profile")!.textContent, "2 selected");
  assert.deepEqual(a.extrudeShown()!.alsoChosen, [far]);
  // The first taken away: far is first, alone.
  await a.extrudePointer({ kind: "pick", profile: left, add: true });
  await a.settle();
  assert.equal(a.extrudeShown()!.chosen, far);
  assert.equal(a.extrudeShown()!.alsoChosen, undefined);
  assert.equal(a.$("#extrude-profile")!.textContent, "Sketch 1");
  await type(a, "2");
  near(Number(panel(a).dataset.previewVolume), 200, "the far square by 2");
  // A plain click lets the others go.
  await a.extrudePointer({ kind: "pick", profile: left, add: true });
  await a.extrudePointer({ kind: "pick", profile: right });
  assert.equal(a.extrudeShown()!.chosen, right);
  assert.equal(a.extrudeShown()!.alsoChosen, undefined);
  await a.extrudePointer({ kind: "pick", profile: left, add: true });
  (a.$("#extrude-clear") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.extrudeShown()!.chosen, null);
  assert.equal(a.extrudeShown()!.alsoChosen, undefined);
  assert.ok(await a.close());
});

test("Pick several (a phone's Ctrl): each tap adds, OK makes the two touching squares one body of 20 × 10 × 3 = 600 mm³", async () => {
  const a = await app(threeSquares());
  a.$("#extrude")!.click();
  await a.settle();
  const several = a.$("#extrude-several") as HTMLButtonElement;
  several.click();
  assert.equal(several.getAttribute("aria-pressed"), "true");
  const [left, right] = [squareAt(a, 100, 110), squareAt(a, 110, 120)];
  await a.extrudePointer({ kind: "pick", profile: left });
  await a.extrudePointer({ kind: "pick", profile: right });
  await type(a, "3");
  assert.equal(a.$("#extrude-profile")!.textContent, "2 selected");
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  // The box 1,000 and the pair joined, 600.
  near(a.volume(), 1600, "the box and the pair");
  assert.equal(a.window.document.querySelectorAll("[data-eye^=\"body-\"]").length, 2, "the box and one body for the pair");
  // Undo takes the whole extrude away in one step.
  await a.undo();
  near(a.volume(), 1000, "after Undo");
  assert.ok(await a.close());
});
