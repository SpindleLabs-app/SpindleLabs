// Through all (Ben 2026-11-14, Design data version 23): a Cut or Intersect
// extrude that goes through every body it picks, however thick they are
// now. The hand-worked cases are built by the real rebuild on the real
// kernel, each expected volume worked out from the boxes and the sketch
// beside it, never from the code; the one Ben asked for first: the part
// made thicker after the hole was cut, where a typed distance stops
// halfway and Through all still goes right through. Then the length rule's
// limits at 0.9× and 1.1×, the data (the reader's refusals, the version
// step) and the edits that keep it only on a Cut or Intersect.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodySpec } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changePreset, DESIGN_VERSION, insertPreset, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch, isThrough, setExtrudeOperation, setExtrudeSymmetric, setExtrudeThrough, type OperationChoice } from "../src/extrude.ts";
import { farthestAhead, THROUGH_NO_SYMMETRIC, THROUGH_ONLY_CUT, THROUGH_PAST, throughDistance, throughWords, withDistance } from "../src/extrude-through.ts";
import { REACH } from "../src/extrude-operation.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { MAX_TYPED, MIN_TYPED } from "../src/typed-entry.ts";

const kernel = nodeKernel();

/** A box `[w, d, h]` with its low corner moved to `at`; its body "body:<item>". */
function box(size: [number, number, number], at: [number, number, number]): { doc: DesignDocument; body: string; item: string } {
  const doc = partDocument("box", ...size);
  const item = doc.timeline.features[0].id;
  const moved = at.some((v) => v !== 0) ? insertMove(doc, [`body:${item}`], { ...NO_MOVE, x: at[0], y: at[1], z: at[2] }).doc : doc;
  return { doc: moved, body: `body:${item}`, item };
}

/** `doc` with the square x 2..6, y 2..6 (16 mm²) sketched on XY (z = 0) and extruded `distance` mm (down when `flip`) with `choice`, through all when `through`. */
function squareCut(doc: DesignDocument, distance: number, choice: OperationChoice, through: boolean, flip = false): { doc: DesignDocument; id: string } {
  const s = addSketch(doc);
  const drawn = drawRectangle(s.doc, s.id, [2, 2], [6, 6]).doc;
  const e = extrudeSketch(drawn, s.id, distance, flip, undefined, choice);
  return { doc: through ? setExtrudeThrough(e.doc, true, e.id) : e.doc, id: e.id };
}

async function built(doc: DesignDocument): Promise<{ build: TimelineBuild; volume: (body: string) => Promise<number>; close: () => Promise<void> }> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, volume: async (body) => (await cache.view(build.bodies[body].handle)).volume, close: () => cache.close() };
}

const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, want), `${what}: ${got}, expected ${want}`);

test("hand-worked: a hole cut through all still goes right through after the plate is made thicker; a typed 6 mm stops halfway", async () => {
  // The plate: 10 × 10 × 10 moved 5 down, x 0..10, y 0..10, z −5..5 (1,000 mm³), so the sketch's plane z = 0 is inside it and no
  // face of the cut lies on a face of the plate. The square 2..6 (16 mm²) cut up from z = 0: through all removes z 0..5,
  // 16 × 5 = 80, leaving 920. A typed 6 mm (z 0..6) removes the same 80 today.
  const plate = box([10, 10, 10], [0, 0, -5]);
  const choice = { operation: "cut" as const, bodies: [plate.body] };
  const through = squareCut(plate.doc, 6, choice, true);
  const typed = squareCut(plate.doc, 6, choice, false);
  for (const [what, doc] of [["through all", through.doc], ["typed 6 mm", typed.doc]] as const) {
    const b = await built(doc);
    assert.equal(b.build.results[doc.timeline.features.at(-1)!.id].status, "built", what);
    near(await b.volume(plate.body), 920, `${what}, 10 mm plate`);
    await b.close();
  }
  // The plate made 30 high: z −5..25 (3,000 mm³). Through all now removes z 0..25, 16 × 25 = 400, leaving 2,600: still
  // right through. The typed 6 mm removes only z 0..6, 16 × 6 = 96, leaving 2,904: the hole silently stops at z = 6.
  const thicker = (d: DesignDocument) => changePreset(d, plate.item, "box", 10, 10, 30);
  const t = await built(thicker(through.doc));
  near(await t.volume(plate.body), 2600, "through all, 30 mm plate");
  await t.close();
  const f = await built(thicker(typed.doc));
  near(await f.volume(plate.body), 2904, "typed 6 mm, 30 mm plate (the control: it stops halfway)");
  await f.close();
});

test("hand-worked: flipped it goes down through all; Intersect through all keeps the column; two plates are both cut", async () => {
  const plate = box([10, 10, 10], [0, 0, -5]);
  // Flipped: from z = 0 down to the plate's bottom, z −5..0: 16 × 5 = 80 removed, 920 left.
  const down = squareCut(plate.doc, 3, { operation: "cut", bodies: [plate.body] }, true, true);
  const d = await built(down.doc);
  near(await d.volume(plate.body), 920, "flipped");
  await d.close();
  // Intersect up: only what the plate shares with the square's column z 0..5 is kept, 16 × 5 = 80.
  const inter = squareCut(plate.doc, 1, { operation: "intersect", bodies: [plate.body] }, true);
  const i = await built(inter.doc);
  near(await i.volume(plate.body), 80, "intersect");
  await i.close();
  // A second plate 10 × 10 × 4 at z 20..24 above the first: through all reaches it too (its top at 24, so the extrude runs
  // z 0..25), cutting 16 × 4 = 64 from its 400: 336. The first plate 920 as before.
  const two = insertPreset(plate.doc, "box", 10, 10, 4);
  const lifted = insertMove(two.doc, [`body:${two.id}`], { ...NO_MOVE, z: 20 }).doc;
  const both = squareCut(lifted, 1, { operation: "cut", bodies: [plate.body, `body:${two.id}`] }, true);
  const b = await built(both.doc);
  near(await b.volume(plate.body), 920, "lower plate");
  near(await b.volume(`body:${two.id}`), 336, "upper plate");
  await b.close();
});

test("a Through all cut pointing away from every body it picks fails in words, naming Flip", async () => {
  // The plate z 1..11, wholly above the sketch's plane; flipped, the cut goes down from z = 0, away from it.
  const plate = box([10, 10, 10], [0, 0, 1]);
  const away = squareCut(plate.doc, 5, { operation: "cut", bodies: [plate.body] }, true, true);
  const b = await built(away.doc);
  const r = b.build.results[away.id];
  assert.equal(r.status, "failed");
  assert.equal((r as { message: string }).message, "Extrude 1 goes through all, but no body it works on lies ahead of its sketch: Flip turns it round.");
  await b.close();
  // Control: not flipped it goes up through the plate, z 1..11, 16 × 10 = 160 removed: 840.
  const up = squareCut(plate.doc, 5, { operation: "cut", bodies: [plate.body] }, true);
  const u = await built(up.doc);
  near(await u.volume(plate.body), 840, "up through the plate");
  await u.close();
});

// The length rule alone, on an extrude going up from z = 0 on XY (no frame), so a box's reach ahead is its top z.
const UP: BodySpec = { extrude: { profile: { outer: [] } as never, distance: 1 } };
const slab = (top: number): [[number, number, number], [number, number, number]] => [[0, 0, top - 10], [10, 10, top]];

test("hand-worked: the length is the farthest box corner ahead plus THROUGH_PAST, along the frame's way", () => {
  // Up from z = 0: boxes reaching z 5 and z 24 → 24 + 1 = 25.
  assert.equal(throughDistance(UP, [slab(5), slab(24)]), 24 + THROUGH_PAST);
  // Flipped: the way is −z, a box z −7..3 reaches 7 ahead → 8.
  assert.equal(throughDistance({ extrude: { ...(UP as { extrude: object }).extrude, flip: true } } as BodySpec, [[[0, 0, -7], [1, 1, 3]]]), 8);
  // A frame at (0, 0, 2) facing +x: the box x −3..9 reaches 9 − 0 = 9 along x (its z doesn't count) → 10.
  const side: BodySpec = { extrude: { profile: { outer: [] } as never, distance: 1, frame: { origin: [0, 0, 2], x: [0, 1, 0], normal: [1, 0, 0] } } };
  assert.equal(farthestAhead(side, [[[-3, 0, 50], [9, 1, 60]]]), 9);
  assert.equal(throughDistance(side, [[[-3, 0, 50], [9, 1, 60]]]), 10);
  // withDistance changes the distance only.
  assert.deepEqual(withDistance(side, 10), { extrude: { ...(side as { extrude: object }).extrude, distance: 10 } });
});

test("boundaries: a box reaching 0.9 × REACH ahead counts as behind, 1.1 × REACH goes through; the 1 km cap at 0.9× and 1.1× of MIN_TYPED short of it", () => {
  assert.equal(throughDistance(UP, [slab(0.9 * REACH)]), "behind");
  assert.equal(throughDistance(UP, [slab(1.1 * REACH)]), 1.1 * REACH + THROUGH_PAST);
  assert.equal(throughDistance(UP, [slab(-3)]), "behind", "wholly behind");
  assert.equal(throughDistance(UP, []), "behind", "no boxes");
  // Reaching MAX_TYPED − 1.1 × MIN_TYPED: 1 km is MIN_TYPED past it and more, so the extrude is capped at 1 km.
  assert.equal(throughDistance(UP, [slab(MAX_TYPED - 1.1 * MIN_TYPED)]), MAX_TYPED);
  // Reaching MAX_TYPED − 0.9 × MIN_TYPED: even 1 km would end less than MIN_TYPED past it: refused.
  assert.equal(throughDistance(UP, [slab(MAX_TYPED - 0.9 * MIN_TYPED)]), "too-far");
  assert.equal(throughWords("Extrude 2", "too-far"), "Extrude 2 goes through all, but its bodies reach past 1 km from its sketch, the largest size the modeller works at.");
});

test("Through all only on a Cut or Intersect, never symmetric; Join or a new body drops it; the distance typed is kept", () => {
  const plate = box([10, 10, 10], [0, 0, -5]);
  const s = addSketch(plate.doc);
  const drawn = drawRectangle(s.doc, s.id, [2, 2], [6, 6]).doc;
  const fresh = extrudeSketch(drawn, s.id, 7);
  assert.throws(() => setExtrudeThrough(fresh.doc, true, fresh.id), { message: THROUGH_ONLY_CUT });
  const join = extrudeSketch(drawn, s.id, 7, false, undefined, { operation: "join", bodies: [plate.body] });
  assert.throws(() => setExtrudeThrough(join.doc, true, join.id), { message: THROUGH_ONLY_CUT });
  const cut = squareCut(plate.doc, 7, { operation: "cut", bodies: [plate.body] }, true);
  const f = () => cut.doc.timeline.features.find((x) => x.id === cut.id)!;
  assert.equal(isThrough(f()), true);
  assert.equal(f().intent.parameters.distance, 7, "the typed distance kept");
  assert.equal(f().intent.summary, `Extrude ${f().provenance.from[0].label} through all, cut from ${plate.doc.timeline.features[0].provenance.self.label}`);
  assert.equal(setExtrudeThrough(cut.doc, true, cut.id), cut.doc, "already through: the same document");
  assert.throws(() => setExtrudeSymmetric(cut.doc, true, cut.id), { message: THROUGH_NO_SYMMETRIC });
  const sym = setExtrudeSymmetric(squareCut(plate.doc, 7, { operation: "cut", bodies: [plate.body] }, false).doc, true, cut.id);
  assert.throws(() => setExtrudeThrough(sym, true, cut.id), { message: THROUGH_NO_SYMMETRIC });
  // Off again: by its 7 mm.
  const off = setExtrudeThrough(cut.doc, false, cut.id).timeline.features.find((x) => x.id === cut.id)!;
  assert.equal(Object.hasOwn(off.intent.parameters, "through"), false);
  assert.match(off.intent.summary, / by 7 mm, cut from /);
  // Made a Join or a new body: Through all goes; kept for Intersect.
  for (const [choice, kept] of [[{ operation: "join", bodies: [plate.body] }, false], [null, false], [{ operation: "intersect", bodies: [plate.body] }, true]] as const) {
    const changed = setExtrudeOperation(cut.doc, cut.id, choice).timeline.features.find((x) => x.id === cut.id)!;
    assert.equal(isThrough(changed), kept, JSON.stringify(choice));
  }
});

test("the data: version 23 holds through and reads back the same; the reader refuses each break of it", () => {
  const plate = box([10, 10, 10], [0, 0, -5]);
  const cut = squareCut(plate.doc, 7, { operation: "cut", bodies: [plate.body] }, true);
  assert.equal(DESIGN_VERSION, 27);
  const saved = JSON.parse(JSON.stringify(cut.doc));
  assert.deepEqual(readDesignDocument(saved), cut.doc, "round trip");
  const withParams = (patch: (p: Record<string, unknown>) => Record<string, unknown>, version = 23) => ({
    ...saved,
    version,
    timeline: { ...saved.timeline, features: saved.timeline.features.map((f: { id: string; intent: { parameters: Record<string, unknown> } }) => (f.id === cut.id ? { ...f, intent: { ...f.intent, parameters: patch(f.intent.parameters) } } : f)) },
  });
  assert.throws(() => readDesignDocument(withParams((p) => p, 22)), { message: "Design data says version 22 but has a Through all extrude, which version 23 brought" });
  assert.throws(() => readDesignDocument(withParams((p) => ({ ...p, through: false }))), { message: `Design feature ${cut.id}: through must be true or left out, not false` });
  assert.throws(() => readDesignDocument(withParams((p) => ({ ...p, operation: "join" }))), { message: `Design feature ${cut.id} goes through all but is not a Cut or Intersect: only those have bodies to go through` });
  assert.throws(() => readDesignDocument(withParams((p) => ({ ...p, symmetric: true }))), { message: `Design feature ${cut.id} goes through all and is symmetric: Through all goes one way from its sketch` });
  // Controls: version 22 without it opens, upgraded; Intersect through all opens.
  const { through: _, ...plain } = saved.timeline.features.at(-1).intent.parameters;
  assert.equal(readDesignDocument(withParams(() => plain, 22)).version, 27);
  assert.equal(readDesignDocument(withParams((p) => ({ ...p, operation: "intersect" }))).version, 27);
});

const { Window } = await import("happy-dom");
const page = () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  const slot = doc.createElement("aside");
  doc.body.append(slot);
  return { win, slot };
};

test("the Extrude panel: Through all is off until Cut or Intersect, takes the box's place, greys Symmetric, lets go for a Join", async () => {
  const { extrudePanel } = await import("../src/extrude-panel.ts");
  const { win, slot } = page();
  const said: [boolean, string][] = [];
  const ops: string[] = [];
  const p = extrudePanel(slot, { distance: () => {}, flip: () => {}, clear: () => {}, ok: () => {}, cancel: () => {}, through: (on, typed) => said.push([on, typed]), operation: (op) => ops.push(op) });
  p.show("Sketch 1", "0", true);
  const through = slot.querySelector<HTMLButtonElement>("#extrude-through")!;
  const both = slot.querySelector<HTMLButtonElement>("#extrude-symmetric")!;
  const input = slot.querySelector<HTMLInputElement>("#extrude-distance")!;
  const words = slot.querySelector<HTMLElement>("#extrude-through-words")!;
  const select = slot.querySelector<HTMLSelectElement>("#extrude-operation")!;
  const choose = (op: string) => {
    select.value = op;
    select.dispatchEvent(new win.Event("change"));
  };
  assert.deepEqual([through.hidden, through.disabled, through.title], [false, true, THROUGH_ONLY_CUT], "New body: off, saying why");
  choose("join");
  assert.equal(through.disabled, true, "Join: off");
  choose("cut");
  assert.equal(through.disabled, false, "Cut: on");
  through.click();
  // At 0 mm (where Extrude starts) the box becomes 1, so Flip has a sign to turn.
  assert.deepEqual(said, [[true, "1"]]);
  assert.deepEqual([p.through, input.hidden, words.hidden, both.disabled], [true, true, false, true]);
  // Flip still turns it round.
  slot.querySelector<HTMLButtonElement>("#extrude-flip")!.click();
  assert.equal(p.typed, "-1");
  choose("intersect");
  assert.equal(p.through, true, "Intersect keeps it");
  // A Join has nothing to go through: it lets go, the box and Symmetric are back, and the workspace is told.
  choose("join");
  assert.deepEqual([p.through, input.hidden, words.hidden, both.disabled, through.disabled], [false, false, true, false, true]);
  assert.deepEqual(said.at(-1), [false, "-1"]);
  assert.deepEqual(ops, ["join", "cut", "intersect", "join"]);
  // Without the Operation row (Combine hidden) it is not there to press.
  p.show("Sketch 1", "5");
  assert.equal(slot.querySelector<HTMLButtonElement>("#extrude-through")!.hidden, true);
  // Symmetric pressed first greys it.
  p.show("Sketch 1", "5", true);
  choose("cut");
  slot.querySelector<HTMLButtonElement>("#extrude-symmetric")!.click();
  assert.equal(slot.querySelector<HTMLButtonElement>("#extrude-through")!.disabled, true);
  p.hide();
  assert.equal(p.through, false, "closed: off");
});

test("the Edit feature panel: Through all ticked for a Cut greys the distance and Symmetric; a Join unticks it; read by OK", async () => {
  const { featureEditPanel } = await import("../src/feature-edit-panel.ts");
  const { win, slot } = page();
  const p = featureEditPanel(slot, { ok: () => {}, cancel: () => {} });
  p.show({ id: "feature-3", name: "Extrude 1", shape: "sketch-extrude", sizes: { height: 5 }, keys: ["height"], flip: false, symmetric: false, through: true });
  const through = () => slot.querySelector<HTMLInputElement>("#edit-through")!;
  // Before the Operation row is filled in (Combine hidden): kept as saved, not to be changed.
  assert.deepEqual([through().checked, through().disabled, p.through], [true, true, true]);
  p.showOperation("cut");
  const distance = slot.querySelector<HTMLInputElement>("#edit-height")!;
  const both = slot.querySelector<HTMLInputElement>("#edit-symmetric")!;
  assert.deepEqual([through().checked, through().disabled, distance.disabled, both.disabled], [true, false, true, true]);
  through().checked = false;
  through().dispatchEvent(new win.Event("change"));
  assert.deepEqual([p.through, distance.disabled, both.disabled], [false, false, false]);
  through().checked = true;
  through().dispatchEvent(new win.Event("change"));
  const select = slot.querySelector<HTMLSelectElement>("#edit-operation")!;
  select.value = "join";
  select.dispatchEvent(new win.Event("change"));
  assert.deepEqual([p.through, through().disabled, distance.disabled], [false, true, false], "a Join lets go");
  // A preset has no such box.
  p.show({ id: "feature-1", name: "Box 1", shape: "box", sizes: { width: 1, depth: 1, height: 1 }, keys: ["width", "depth", "height"] });
  assert.equal(p.through, null);
});
