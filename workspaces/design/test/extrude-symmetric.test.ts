// Symmetric extrude (step 53a1, Design data version 21): half the distance
// each way from the sketch's plane, the distance the whole thickness. The
// hand-worked cases are built by the real rebuild on the real kernel, every
// expected box and volume worked out from the sketch and the distance
// beside it, never from the code; then the data (the reader's refusals, the
// version step), Edit feature, the preview's spec against the rebuild's for
// seeded distances (self-consistency, on top of the hand cases), the arrow
// and the panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodySpec, BodyView } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { arrowOf, extrudeSketch, featureSpec, isFlipped, isSymmetric, previewSpec, setExtrudeFlip, setExtrudeSymmetric, symmetricDrag, SYMMETRIC_NO_FLIP } from "../src/extrude.ts";
import { centredSpec, XY_FRAME } from "../src/extrude-symmetric.ts";
import { editableFeature, editFeature } from "../src/feature-edit.ts";
import { drawnFrame } from "../src/face-sketch.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { buildSpec } from "../src/spec.ts";
import { addFaceSketch, addSketch, drawCircle, drawRectangle } from "../src/sketch.ts";
import { deleteItem } from "../src/timeline-edits.ts";
import { settleKept } from "../src/rebuild.ts";
import { extrudePanel } from "../src/extrude-panel.ts";
import { snapDistance } from "@fission/viewport";

const kernel = nodeKernel();
type Box = [[number, number, number], [number, number, number]];

/** `doc` with a rectangle from `a` to `c` on origin plane `plane`, extruded `distance` mm, symmetric. */
function symmetricRect(doc: DesignDocument | null, a: [number, number], c: [number, number], distance: number, plane: "XY" | "XZ" | "YZ" = "XY") {
  const s = addSketch(doc ?? emptyDoc(), plane);
  const drawn = drawRectangle(s.doc, s.id, a, c).doc;
  const e = extrudeSketch(drawn, s.id, distance);
  return { doc: setExtrudeSymmetric(e.doc, true, e.id), id: e.id, sketch: s.id };
}

/** An empty design: a box made and deleted, so the counters are a real design's. */
function emptyDoc(): DesignDocument {
  return deleteItem(partDocument("box", 1, 1, 1), "feature-1");
}

/** Every built body's box and volume, by item. */
async function built(doc: DesignDocument): Promise<Record<string, { box: Box; volume: number; view: BodyView }>> {
  const cache = new BodyCache(kernel);
  try {
    const b = await rebuildTimeline(doc, cache, kernel);
    const out: Record<string, { box: Box; volume: number; view: BodyView }> = {};
    for (const [id, r] of Object.entries(b.results)) {
      assert.ok(r.status !== "failed", `${id}: ${JSON.stringify(r)}`);
      assert.equal((r as { warning?: unknown }).warning, undefined, `${id} warned`);
    }
    for (const [body, held] of Object.entries(b.bodies)) {
      const view = await cache.view(held.handle);
      out[body] = { box: view.bounds, volume: view.volume, view };
    }
    return out;
  } finally {
    await cache.close();
  }
}

const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${what}: ${got}, expected ${want}`);
const nearBox = (got: Box, want: Box, what: string) => got.forEach((c, i) => c.forEach((v, k) => near(v, want[i][k], `${what} ${i ? "high" : "low"} ${"xyz"[k]}`)));

test("hand-worked: a 10 × 10 square on XY, symmetric 10 mm and 7 mm, reaches half each way", async () => {
  // Square x 0..10, y 0..10 on z = 0. Symmetric 10: z −5..5, 10 × 10 × 10 = 1000 mm³ (a one-way extrude would be z 0..10).
  const ten = symmetricRect(null, [0, 0], [10, 10], 10);
  const b10 = await built(ten.doc);
  nearBox(b10[`body:${ten.id}`].box, [[0, 0, -5], [10, 10, 5]], "symmetric 10");
  near(b10[`body:${ten.id}`].volume, 1000, "volume 10");
  // 7 mm: 3.5 each way, z −3.5..3.5, 700 mm³.
  const seven = symmetricRect(null, [0, 0], [10, 10], 7);
  const b7 = await built(seven.doc);
  nearBox(b7[`body:${seven.id}`].box, [[0, 0, -3.5], [10, 10, 3.5]], "symmetric 7");
  near(b7[`body:${seven.id}`].volume, 700, "volume 7");
});

test("hand-worked: on the XZ and YZ planes, centred on the plane", async () => {
  // XZ: the sketch's (u, v) are world (x, z), its normal −y (Fusion's front plane, face-sketch.ts). A rectangle u 0..4,
  // v 0..6, symmetric 8: y −4..4, x 0..4, z 0..6, 4 × 6 × 8 = 192 mm³.
  const xz = symmetricRect(null, [0, 0], [4, 6], 8, "XZ");
  const bxz = await built(xz.doc);
  nearBox(bxz[`body:${xz.id}`].box, [[0, -4, 0], [4, 4, 6]], "XZ");
  near(bxz[`body:${xz.id}`].volume, 192, "XZ volume");
  // YZ: (u, v) world (y, z), normal +x. u 0..4, v 0..6, symmetric 2: x −1..1.
  const yz = symmetricRect(null, [0, 0], [4, 6], 2, "YZ");
  const byz = await built(yz.doc);
  nearBox(byz[`body:${yz.id}`].box, [[-1, 0, 0], [1, 4, 6]], "YZ");
});

test("hand-worked: on a box's top and bottom faces, centred on the face (the bottom's own flip kept)", async () => {
  // A 40 × 30 × 20 box; a circle r 5 at (20, 15) on its top (z = 20), symmetric 10: a cylinder z 15..25, x 15..25, y 10..20,
  // π × 25 × 10 = 785.398… mm³ (a new body, half inside the box).
  const box = partDocument("box", 40, 30, 20);
  const top = addFaceSketch(box, { plane: "face:feature-1/top", feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  const circle = drawCircle(top.doc, top.id, [20, 15], 5).doc;
  const e = extrudeSketch(circle, top.id, 10);
  const doc = setExtrudeSymmetric(e.doc, true, e.id);
  const b = await built(doc);
  nearBox(b[`body:${e.id}`].box, [[15, 10, 15], [25, 20, 25]], "on top");
  near(b[`body:${e.id}`].volume, Math.PI * 250, "cylinder");
  // The bottom (z = 0) faces down (side −1): its one-way extrude is flipped to go out, down. Symmetric 6: z −3..3.
  const bottom = addFaceSketch(box, { plane: "face:feature-1/bottom", feature: "feature-1" }, drawnFrame([0, 0, -1], [20, 15, 0]));
  const c2 = drawCircle(bottom.doc, bottom.id, [20, 15], 5).doc;
  const e2 = extrudeSketch(c2, bottom.id, 6);
  const b2 = await built(setExtrudeSymmetric(e2.doc, true, e2.id));
  nearBox(b2[`body:${e2.id}`].box, [[15, 10, -3], [25, 20, 3]], "on the bottom");
});

test("hand-worked: Join and Cut with a symmetric extrude through a cube", async () => {
  // Cube x 0..10, y 0..10, z −5..5 (a 10 mm box moved down 5). A square x 2..6, y 2..6 (16 mm²) on XY, symmetric 20: z −10..10,
  // sticking 5 mm out of the cube's top and bottom. Join: 1000 + 16 × (5 + 5) = 1160 mm³. Cut: the hole through, 1000 − 16 × 10 = 840.
  for (const [operation, want] of [["join", 1160], ["cut", 840]] as const) {
    let doc = partDocument("box", 10, 10, 10);
    doc = insertMove(doc, ["body:feature-1"], { ...NO_MOVE, z: -5 }).doc;
    const s = addSketch(doc);
    const drawn = drawRectangle(s.doc, s.id, [2, 2], [6, 6]).doc;
    const e = extrudeSketch(drawn, s.id, 20, false, undefined, { operation, bodies: ["body:feature-1"] });
    const b = await built(setExtrudeSymmetric(e.doc, true, e.id));
    near(b["body:feature-1"].volume, want, operation);
    nearBox(b["body:feature-1"].box, operation === "join" ? [[0, 0, -10], [10, 10, 10]] : [[0, 0, -5], [10, 10, 5]], operation);
  }
});

test("hand-worked: several profiles, each centred; a deleted sketch's kept shape stays centred", async () => {
  // Two sketches' squares apart, x 0..4 (Sketch 1) and x 10..14 (Sketch 2, picked as a second profile), symmetric 6: two
  // bodies, each z −3..3, 4 × 4 × 6 = 96 mm³.
  const s = addSketch(emptyDoc());
  const one = drawRectangle(s.doc, s.id, [0, 0], [4, 4]).doc;
  const t = addSketch(one);
  const two = drawRectangle(t.doc, t.id, [10, 0], [14, 4]).doc;
  const several = extrudeSketch(two, s.id, 6, false, undefined, null, [{ sketch: t.id }]);
  const b = await built(setExtrudeSymmetric(several.doc, true, several.id));
  const boxes = Object.values(b).map((x) => x.box).sort((p, q) => p[0][0] - q[0][0]);
  assert.equal(boxes.length, 2);
  nearBox(boxes[0], [[0, 0, -3], [4, 4, 3]], "first profile");
  nearBox(boxes[1], [[10, 0, -3], [14, 4, 3]], "second profile");
  for (const x of Object.values(b)) near(x.volume, 96, "each");
  // Kept shape: the sketch deleted, the extrude keeps its last shape (owner's rule) and stays centred.
  const plain = symmetricRect(null, [0, 0], [10, 10], 4);
  const gone = await settleKept(kernel, plain.doc, deleteItem(plain.doc, plain.sketch));
  const cache = new BodyCache(kernel);
  try {
    const r = await rebuildTimeline(gone, cache, kernel);
    const res = r.results[plain.id];
    assert.equal(res.status, "built", JSON.stringify(res));
    const v = await cache.view(r.bodies[`body:${plain.id}`].handle);
    nearBox(v.bounds, [[0, 0, -2], [10, 10, 2]], "kept shape");
  } finally {
    await cache.close();
  }
});

test("the faces keep their roles and names: a symmetric extrude is named as the same extrude one way", async () => {
  const sym = symmetricRect(null, [0, 0], [10, 10], 10);
  const one = setExtrudeSymmetric(sym.doc, false, sym.id);
  const [a, b] = [await built(sym.doc), await built(one)];
  const roles = (v: BodyView) => v.face_roles.map((r) => r?.role).sort();
  assert.deepEqual(roles(a[`body:${sym.id}`].view), roles(b[`body:${sym.id}`].view));
  assert.deepEqual(roles(a[`body:${sym.id}`].view), ["end", "side", "side", "side", "side", "start"]);
  // The start cap is at z = −5 (the plane moved back), the end cap at +5: the end cap is still the far one along +z.
  const capZ = (v: BodyView, role: string) => v.face_centroids[v.face_roles.findIndex((r) => r?.role === role)][2];
  near(capZ(a[`body:${sym.id}`].view, "start"), -5, "start cap");
  near(capZ(a[`body:${sym.id}`].view, "end"), 5, "end cap");
});

test("the data: Symmetric drops Flip, says so in the summary, and opens again as saved", () => {
  const s = addSketch(emptyDoc());
  const drawn = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  const flipped = extrudeSketch(drawn, s.id, 5, true);
  assert.equal(isFlipped(flipped.doc.timeline.features.at(-1)!), true);
  const sym = setExtrudeSymmetric(flipped.doc, true, flipped.id);
  const f = sym.timeline.features.find((x) => x.id === flipped.id)!;
  assert.deepEqual([isSymmetric(f), isFlipped(f), f.intent.parameters.flip, f.intent.parameters.symmetric], [true, false, undefined, true]);
  assert.match(f.intent.summary, /by 5 mm, symmetric$/);
  assert.equal(setExtrudeSymmetric(sym, true, flipped.id), sym, "already symmetric: the same document");
  const off = setExtrudeSymmetric(sym, false, flipped.id).timeline.features.find((x) => x.id === flipped.id)!;
  assert.equal(Object.hasOwn(off.intent.parameters, "symmetric"), false, "left out when off");
  assert.match(off.intent.summary, /by 5 mm$/);
  assert.throws(() => setExtrudeFlip(sym, true, flipped.id), { message: SYMMETRIC_NO_FLIP });
  assert.throws(() => setExtrudeSymmetric(sym, "yes" as unknown as boolean, flipped.id), /needs true or false/);
  assert.throws(() => setExtrudeSymmetric(partDocument("box", 1, 1, 1), true, "feature-1"), /is not an extrude of a sketch/);
  const read = readDesignDocument(JSON.parse(JSON.stringify(sym)));
  assert.deepEqual(read, sym);
  assert.equal(read.version, 22);
});

test("the reader refuses a symmetric that is not true, a symmetric flip, and version 19 or 20 data holding one; older data without opens", () => {
  const sym = symmetricRect(null, [0, 0], [10, 10], 10);
  const json = () => JSON.parse(JSON.stringify(sym.doc));
  const params = (d: { timeline: { features: { id: string; intent: { parameters: Record<string, unknown> } }[] } }) => d.timeline.features.find((f) => f.id === sym.id)!.intent.parameters;
  const no = json();
  params(no).symmetric = false;
  assert.throws(() => readDesignDocument(no), new RegExp(`Design feature ${sym.id}: symmetric must be true or left out, not false`));
  const both = json();
  params(both).flip = true;
  assert.throws(() => readDesignDocument(both), new RegExp(`Design feature ${sym.id} is symmetric and flipped`));
  for (const v of [19, 20]) assert.throws(() => readDesignDocument({ ...json(), version: v }), new RegExp(`says version ${v} but has a symmetric extrude, which version 21 brought`));
  const plain = json();
  delete params(plain).symmetric;
  for (const v of [19, 20]) assert.equal(readDesignDocument({ ...plain, version: v }).version, 22, "older data is read as it is");
});

test("Edit feature: Symmetric ticked or unticked with the distance, Flip not read while it is ticked", () => {
  const s = addSketch(emptyDoc());
  const drawn = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  const e = extrudeSketch(drawn, s.id, 5, true);
  assert.deepEqual([editableFeature(e.doc, e.id).flip, editableFeature(e.doc, e.id).symmetric], [true, false]);
  // Ticked, with Flip still ticked in its (greyed) box and a new distance: symmetric 8, no flip.
  const on = editFeature(e.doc, e.id, { height: 8 }, true, undefined, true);
  const f = on.timeline.features.find((x) => x.id === e.id)!;
  assert.deepEqual([f.intent.parameters.distance, isSymmetric(f), isFlipped(f)], [8, true, false]);
  assert.deepEqual([editableFeature(on, e.id).flip, editableFeature(on, e.id).symmetric], [false, true]);
  // Unticked: one way again, Flip read.
  const off = editFeature(on, e.id, { height: 8 }, true, undefined, false);
  const g = off.timeline.features.find((x) => x.id === e.id)!;
  assert.deepEqual([isSymmetric(g), isFlipped(g)], [false, true]);
  assert.equal(editFeature(on, e.id, { height: 8 }, false, undefined, true), on, "nothing changed: the same document");
  assert.throws(() => editFeature(partDocument("box", 1, 1, 1), "feature-1", {}, undefined, undefined, true), /has no Symmetric/);
  assert.equal(editableFeature(partDocument("box", 1, 1, 1), "feature-1").symmetric, undefined);
});

const square = { outer: { path: { corners: [0, 0, 10, 0, 10, 10, 0, 10], bulges: [] } }, holes: [] };

test("hand-worked: the centred spec moves the frame's origin back half the distance along the way it goes", () => {
  // XY, 10 mm up: the origin to z = −5.
  assert.deepEqual(centredSpec({ extrude: { profile: square, distance: 10 } }), { extrude: { profile: square, distance: 10, frame: { origin: [0, 0, -5], x: [1, 0, 0], normal: [0, 0, 1] } } });
  // A frame on the bottom of a box (normal +z, flipped to go down): the way is −z, so the origin goes up 3, to z = 3 − 3... from z = 0 to +3.
  const frame = { origin: [1, 2, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
  assert.deepEqual(centredSpec({ extrude: { profile: square, distance: 6, frame, flip: true } }), { extrude: { profile: square, distance: 6, frame: { ...frame, origin: [1, 2, 3] }, flip: true } });
  // A slanted frame, normal (0.6, 0.8, 0), 5 mm: back 2.5 along it, (−1.5, −2, 0).
  const slant = { origin: [0, 0, 0] as [number, number, number], x: [0, 0, 1] as [number, number, number], normal: [0.6, 0.8, 0] as [number, number, number] };
  assert.deepEqual(centredSpec({ extrude: { profile: square, distance: 5, frame: slant } }), { extrude: { profile: square, distance: 5, frame: { ...slant, origin: [-1.5, -2, 0] } } });
  const box: BodySpec = { box: { width: 1, depth: 1, height: 1 } };
  assert.equal(centredSpec(box), box);
  assert.deepEqual(XY_FRAME, { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] });
});

test("seeded: the preview's symmetric spec is exactly the rebuild's for the extrude OK records, on XY and on a back face", async () => {
  let seed = Number(process.env.FISSION_SEED ?? 531);
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const box = partDocument("box", 40, 30, 20);
  const sources: [DesignDocument, string][] = [];
  const xy = addSketch(emptyDoc());
  sources.push([drawRectangle(xy.doc, xy.id, [0, 0], [10, 10]).doc, xy.id]);
  const bottom = addFaceSketch(box, { plane: "face:feature-1/bottom", feature: "feature-1" }, drawnFrame([0, 0, -1], [20, 15, 0]));
  sources.push([drawCircle(bottom.doc, bottom.id, [20, 15], 5).doc, bottom.id]);
  for (const [doc, sketch] of sources) {
    const base = extrudeSketch(doc, sketch, 1);
    const baseSpec = await featureSpec(kernel, base.doc, base.doc.timeline.features.find((f) => f.id === base.id)!);
    for (let i = 0; i < 100; i++) {
      const signed = (rand() < 0.5 ? -1 : 1) * 10 ** (rand() * 6 - 3);
      const made = extrudeSketch(doc, sketch, Math.abs(signed));
      const sym = setExtrudeSymmetric(made.doc, true, made.id);
      const want = await featureSpec(kernel, sym, sym.timeline.features.find((f) => f.id === made.id)!);
      assert.deepEqual(previewSpec(baseSpec, signed, true), want, `seed ${seed}, ${signed} mm`);
    }
  }
});

test("hand-worked: the arrow of a symmetric preview stands on the plane, half the thickness long; a drag to s is 2s", () => {
  // Caps at z −3.5 (start) and +3.5 (end) of a 7 mm symmetric extrude of the 10 mm square: the arrow from (5, 5, 0) up, 3.5 long,
  // whichever sign the box had.
  const view = { face_roles: [{ role: "start" }, { role: "end" }], face_centroids: [[5, 5, -3.5], [5, 5, 3.5]] } as unknown as BodyView;
  for (const signed of [7, -7]) assert.deepEqual(arrowOf(view, signed, true), { base: [5, 5, 0], direction: [0, 0, 1], distance: 3.5 });
  // One way, the same caps from a −7 would point down from the start cap (as before 53a1).
  assert.deepEqual(arrowOf(view, -7), { base: [5, 5, -3.5], direction: [0, 0, -1], distance: -7 });
  // A drag of the tip to 3.4 mm: 6.8, whole mm 7; to −2 (past the plane): 4, the same body; to 0.2: 0.4 → never 0, 1.
  assert.equal(symmetricDrag(3.4, snapDistance), 7);
  assert.equal(symmetricDrag(-2, snapDistance), 4);
  assert.equal(symmetricDrag(0.2, snapDistance), 1);
});

test("buildSpec (Edit feature's reach, other workspaces' views) builds an extrude where its frame and flip put it", async () => {
  // Regression (found with 53a1): buildSpec sent only the profile and distance to make_extrude, so a flipped or framed extrude
  // came back on XY going up. The 10 mm square flipped 5 mm: z −5..0; centred 6 mm: z −3..3; on a frame at z = 20: z 20..24.
  const flipped = await buildSpec(kernel, { extrude: { profile: square, distance: 5, flip: true } });
  nearBox(flipped.bounds, [[0, 0, -5], [10, 10, 0]], "flipped");
  const centred = await buildSpec(kernel, centredSpec({ extrude: { profile: square, distance: 6 } }));
  nearBox(centred.bounds, [[0, 0, -3], [10, 10, 3]], "centred");
  const framed = await buildSpec(kernel, { extrude: { profile: square, distance: 4, frame: { origin: [0, 0, 20], x: [1, 0, 0], normal: [0, 0, 1] } } });
  nearBox(framed.bounds, [[0, 0, 20], [10, 10, 24]], "framed");
  const plain = await buildSpec(kernel, { extrude: { profile: square, distance: 4 } });
  nearBox(plain.bounds, [[0, 0, 0], [10, 10, 4]], "plain, as before");
});

test("buildSpec frees the body it built even when the kernel fails the first free (fault injection T6b)", async () => {
  // Regression (journeys' fault injection, every kernel call failing once in turn): with a framed or flipped extrude now built
  // in the body store, a body_free failing once left the body held for good. Tried once more at once, as the cache does when
  // closed (there is no next chance): the store's count is back where it started, and the view is still the 5 mm flipped square.
  const before = await kernel.call("body_count");
  let frees = 0;
  const failing = { call: ((op: string, ...args: unknown[]) => {
    if (op === "body_free" && ++frees === 1) return Promise.reject(new Error("injected kernel failure (body_free)"));
    return (kernel.call as (op: string, ...a: unknown[]) => Promise<unknown>)(op, ...args);
  }) as typeof kernel.call };
  const view = await buildSpec(failing as typeof kernel, { extrude: { profile: square, distance: 5, flip: true } });
  nearBox(view.bounds, [[0, 0, -5], [10, 10, 0]], "flipped, free failed once");
  assert.equal(frees, 2, "the free was tried a second time");
  assert.equal(await kernel.call("body_count"), before, "nothing left held");
});

const { Window } = await import("happy-dom");

test("the panel: Symmetric makes a negative distance positive, greys Flip and says so; pressed again, Flip is back", () => {
  const win = new Window();
  const doc = win.document as unknown as Document;
  const slot = doc.createElement("aside");
  doc.body.append(slot);
  const said: [boolean, string][] = [];
  const p = extrudePanel(slot, { distance: () => {}, flip: () => {}, clear: () => {}, ok: () => {}, cancel: () => {}, symmetric: (on, typed) => said.push([on, typed]) });
  p.show("Sketch 1", "-12");
  const both = slot.querySelector<HTMLButtonElement>("#extrude-symmetric")!;
  const flip = slot.querySelector<HTMLButtonElement>("#extrude-flip")!;
  assert.equal(p.symmetric, false);
  both.click();
  assert.deepEqual(said, [[true, "12"]]);
  assert.deepEqual([p.symmetric, flip.disabled, both.getAttribute("aria-pressed")], [true, true, "true"]);
  both.click();
  assert.deepEqual(said[1], [false, "12"]);
  assert.deepEqual([p.symmetric, flip.disabled], [false, false]);
  p.hide();
  assert.equal(p.symmetric, false, "closed: off");
});

test("the Edit feature panel: Symmetric ticked greys Flip and is sent with the sizes and with OK", async () => {
  const { featureEditPanel } = await import("../src/feature-edit-panel.ts");
  const win = new Window();
  const doc = win.document as unknown as Document;
  const slot = doc.createElement("aside");
  doc.body.append(slot);
  const sizes: unknown[][] = [];
  const oks: unknown[][] = [];
  const p = featureEditPanel(slot, { ok: (...a) => oks.push(a), cancel: () => {}, sizes: (...a) => sizes.push(a) });
  p.show({ id: "feature-3", name: "Extrude 1", shape: "sketch-extrude", sizes: { height: 5 }, keys: ["height"], flip: true, symmetric: false });
  const both = slot.querySelector<HTMLInputElement>("#edit-symmetric")!;
  const flip = slot.querySelector<HTMLInputElement>("#edit-flip")!;
  assert.deepEqual([both.checked, flip.disabled], [false, false]);
  both.checked = true;
  both.dispatchEvent(new win.Event("change"));
  assert.equal(flip.disabled, true, "Flip greyed while symmetric");
  assert.deepEqual(sizes.at(-1), [{ height: "5" }, true, true]);
  slot.querySelector<HTMLButtonElement>("#feature-edit-ok")!.click();
  assert.deepEqual(oks.at(-1), [{ height: "5" }, true, true]);
  // A preset has neither box.
  p.show({ id: "feature-1", name: "Box 1", shape: "box", sizes: { width: 1, depth: 1, height: 1 }, keys: ["width", "depth", "height"] });
  assert.equal(slot.querySelector("#edit-symmetric"), null);
  // An extrude opened symmetric: ticked, Flip greyed from the start.
  p.show({ id: "feature-3", name: "Extrude 1", shape: "sketch-extrude", sizes: { height: 5 }, keys: ["height"], flip: false, symmetric: true });
  assert.deepEqual([slot.querySelector<HTMLInputElement>("#edit-symmetric")!.checked, slot.querySelector<HTMLInputElement>("#edit-flip")!.disabled], [true, true]);
});
