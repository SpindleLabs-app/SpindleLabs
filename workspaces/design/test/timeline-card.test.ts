// The timeline item's card (timeline-card.ts; Ben, 2026-11-05: "11. Box 4
// box" told him nothing): its words for every kind of item, a sketch's
// outline, the body picture's view, shading, depth and edge rules (with the
// edge depth allowance's 0.9× and 1.1× boundaries), the pictures drawn once
// and kept, and the card on the bar (hover, keyboard, finger, off in the
// browser checks). The real layout, both themes and both widths are
// apps/fission/e2e/timeline-card.mjs's.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Feature } from "@fission/core";
import { insertPreset, partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import type { Scene } from "../src/scene.ts";
import { DOUBLE_CLICK_MS, showTimelineBar, timelineBarItems, type TimelineBarItem } from "../src/timeline-bar.ts";
import {
  bodyPicture,
  cardFacts,
  EDGE_SHADE,
  LIGHT,
  mixed,
  ownBodies,
  painted,
  pictureFit,
  project,
  rasterPicture,
  rgbOf,
  shadeOf,
  sketchContent,
  sketchOutline,
  VIEW_FROM,
  type PaintBody,
} from "../src/timeline-card.ts";

const { Window } = await import("happy-dom");

const close = (a: number, b: number, what: string, slack = 1e-9) => assert.ok(Math.abs(a - b) <= slack, `${what}: ${a} is not ${b}`);

/** Box 1 (feature-1), Sketch 1 (sketch-2), Extrude 1 of it by 10 (feature-3). */
const threeItems = () => extrudeSketch(addSketch(partDocument("box", 40, 30, 20)).doc, "sketch-2", 10).doc;
const facts = (doc: DesignDocument, id: string, slow?: ReadonlySet<string>, failed?: ReadonlySet<string>, warnings?: ReadonlyMap<string, string>, reasons?: ReadonlyMap<string, string>) => {
  const { items } = timelineBarItems(doc, failed, warnings, (s) => s, reasons);
  const i = doc.timeline.features.findIndex((f) => f.id === id);
  return cardFacts(doc, doc.timeline.features[i], items[i], i, slow);
};
const withSketch = (doc: DesignDocument, sketch: Sketch): DesignDocument => ({ ...doc, sketches: doc.sketches.map((s) => (s.id === sketch.id ? sketch : s)) });
const feature = (id: string, type: string, parameters: Record<string, unknown>, summary: string, label: string, dependsOn: string[] = []): Feature =>
  ({ id, intent: { type, parameters, summary }, dependsOn, suppressed: false, provenance: { self: { workspace: "design", id, label }, from: [] } }) as unknown as Feature;
const plainItem = (id: string): TimelineBarItem => ({ id, label: "", description: "", icon: "feature", suppressed: false, rolledBack: false, greyed: null, failed: false, warning: null, reason: null });

// ---------------------------------------------------------------- words

test("the card names each kind of item and its key values in words, worked by hand", () => {
  const doc = threeItems();
  // A box of width 40, depth 30, height 20 (partDocument's order): "40 × 30 × 20 mm", and what the three numbers are.
  assert.deepEqual(facts(doc, "feature-1"), { name: "Box 1", number: 1, kind: "Box", details: ["40 × 30 × 20 mm", "width × depth × height"], status: null });
  // An empty sketch on XY, second in the timeline: its place from its summary "Sketch 1 on the XY plane", capitalised.
  assert.deepEqual(facts(doc, "sketch-2"), { name: "Sketch 1", number: 2, kind: "Sketch", details: ["On the XY plane", "Empty: nothing drawn yet"], status: null });
  // Extrude 1 of Sketch 1 by 10: the distance and the sketch it comes from, by name.
  assert.deepEqual(facts(doc, "feature-3"), { name: "Extrude 1", number: 3, kind: "Extrude", details: ["10 mm from Sketch 1", "A new body"], status: null });
  // A flipped extrude says so.
  const flipped = { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f.id === "feature-3" ? { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, flip: true } } } : f)) } };
  assert.deepEqual(facts(flipped, "feature-3").details, ["10 mm from Sketch 1, flipped", "A new body"]);
  // A cylinder of diameter 16 and height 30; a sphere of diameter 20.
  const cyl = insertPreset(partDocument("box", 1, 1, 1), "cylinder", 16, 16, 30).doc;
  assert.deepEqual(facts(cyl, cyl.timeline.features[1].id).details, ["⌀16 mm, 30 mm high"]);
  assert.equal(facts(cyl, cyl.timeline.features[1].id).kind, "Cylinder");
  const sph = insertPreset(partDocument("box", 1, 1, 1), "sphere", 20, 20, 20).doc;
  assert.deepEqual([facts(sph, sph.timeline.features[1].id).kind, ...facts(sph, sph.timeline.features[1].id).details], ["Sphere", "⌀20 mm"]);
});

test("a Move, a Rotate and a Combine: their kind, and their summary as the detail", () => {
  const box = partDocument("box", 10, 10, 10);
  const move = feature("feature-9", "move", { x: 5, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 }, "Move Box 1 by (5, 0, 0) mm", "Move 1", ["feature-1"]);
  const turn = feature("feature-9", "move", { x: 0, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 90, pivotX: 0, pivotY: 0, pivotZ: 0 }, "Rotate Box 1, turned 90° about Z", "Rotate 1", ["feature-1"]);
  const cut = feature("feature-9", "combine", { target: "feature-1", tools: ["feature-2"], operation: "cut", keepTools: false }, "Cut Box 2 from Box 1", "Combine 1");
  assert.deepEqual(cardFacts(box, move, plainItem("feature-9"), 4), { name: "Move 1", number: 5, kind: "Move", details: ["Move Box 1 by (5, 0, 0) mm"], status: null });
  assert.equal(cardFacts(box, turn, plainItem("feature-9"), 4).kind, "Rotate");
  assert.deepEqual([cardFacts(box, cut, plainItem("feature-9"), 4).kind, ...cardFacts(box, cut, plainItem("feature-9"), 4).details], ["Combine: cut", "Cut Box 2 from Box 1"]);
  for (const op of ["join", "intersect"]) assert.equal(cardFacts(box, feature("f", "combine", { operation: op }, "s", "C"), plainItem("f"), 0).kind, `Combine: ${op}`);
  // A kind the card doesn't know: "Feature", with its summary.
  assert.deepEqual(cardFacts(box, feature("f", "fillet", {}, "Fillet 2 edges", "Fillet 1"), plainItem("f"), 0).details, ["Fillet 2 edges"]);
});

test("why an item isn't built: suppressed, after the marker, greyed, failed, too slow, a warning", () => {
  const doc = threeItems();
  const off = (d: DesignDocument, id: string, ...rest: Parameters<typeof facts> extends [unknown, unknown, ...infer R] ? R : never) => facts(d, id, ...rest).status;
  const suppressed = { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f.id === "sketch-2" ? { ...f, suppressed: true } : f)) } };
  assert.deepEqual(off(suppressed, "sketch-2"), { words: "Suppressed: not built", tone: "off" });
  // Its extrude is greyed by it (26e): named.
  assert.deepEqual(off(suppressed, "feature-3"), { words: "Not built: Sketch 1 is suppressed", tone: "off" });
  const rolled = { ...doc, timeline: { ...doc.timeline, marker: "feature-1" } };
  assert.deepEqual(off(rolled, "feature-3"), { words: "After the rollback marker: not built yet", tone: "off" });
  assert.equal(off(rolled, "feature-1"), null, "the item before the marker builds");
  assert.deepEqual(off(doc, "feature-3", new Set(), new Set(["feature-3"])), { words: "Failed to build", tone: "bad" });
  assert.deepEqual(off(doc, "feature-3", new Set(["feature-3"]), new Set(["feature-3"])), { words: "Failed: took the kernel too long", tone: "bad" });
  assert.deepEqual(off(doc, "feature-3", new Set(), new Set(), new Map([["feature-3", "it keeps its last shape"]])), { words: "Warning: it keeps its last shape", tone: "bad" });
});

test("#505: a failed item's card says why in the rebuild's words", () => {
  const doc = threeItems();
  const why = new Map([["feature-3", "Box 2 doesn't reach Body 1."]]);
  assert.deepEqual(facts(doc, "feature-3", new Set(), new Set(["feature-3"]), undefined, why).status, { words: "Failed: Box 2 doesn't reach Body 1.", tone: "bad" });
  // Took too long keeps its own words even when a reason is held.
  assert.deepEqual(facts(doc, "feature-3", new Set(["feature-3"]), new Set(["feature-3"]), undefined, why).status, { words: "Failed: took the kernel too long", tone: "bad" });
});

test("a sketch's content counted in words", () => {
  const pts = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }, { id: "c", x: 0, y: 1 }];
  const sk = (curves: Sketch["curves"]): Sketch => ({ id: "s", points: pts, curves, constraints: [] });
  assert.equal(sketchContent(undefined), "Empty: nothing drawn yet");
  assert.equal(sketchContent(sk([{ id: "l", kind: "line", start: "a", end: "b" }])), "1 line");
  assert.equal(sketchContent(sk([{ id: "l", kind: "line", start: "a", end: "b" }, { id: "m", kind: "line", start: "b", end: "c" }, { id: "o", kind: "circle", centre: "a", radius: 2 }])), "2 lines and 1 circle");
  assert.equal(sketchContent(sk([{ id: "l", kind: "line", start: "a", end: "b" }, { id: "r", kind: "arc", start: "b", end: "c", centre: "a" }, { id: "o", kind: "circle", centre: "a", radius: 2 }])), "1 line, 1 arc and 1 circle");
});

// ---------------------------------------------------------------- sketch outline

const P = (id: string, x: number, y: number) => ({ id, x, y });

test("sketchOutline: a 10 mm square's path and its padded view box, worked by hand", () => {
  const sq: Sketch = {
    id: "s",
    points: [P("a", 0, 0), P("b", 10, 0), P("c", 10, 10), P("d", 0, 10)],
    curves: [{ id: "1", kind: "line", start: "a", end: "b" }, { id: "2", kind: "line", start: "b", end: "c" }, { id: "3", kind: "line", start: "c", end: "d" }, { id: "4", kind: "line", start: "d", end: "a" }],
    constraints: [],
  };
  const o = sketchOutline(sq)!;
  // y turned down: (10, 10) is drawn at (10, −10). The box 0..10 both ways, padded 8% of 10 = 0.8 each side:
  // from (−0.8, −10.8) on screen, 11.6 across both ways.
  assert.equal(o.d, "M0 0L10 0M10 0L10 -10M10 -10L0 -10M0 -10L0 0");
  assert.equal(o.viewBox, "-0.8 -10.8 11.6 11.6");
  assert.equal(sketchOutline({ ...sq, curves: [] }), null);
  assert.equal(sketchOutline(undefined), null);
});

test("sketchOutline: an arc runs counter-clockwise, so its box holds the side it passes and not the other", () => {
  // A half circle of radius 10 round (0, 0) from (10, 0) to (−10, 0), counter-clockwise: over the top through
  // (0, 10), so the box is x −10..10, y 0..10 (never down to −10). Screen sweep 0 (counter-clockwise seen with y
  // down), not the large arc (exactly half way round).
  const half: Sketch = { id: "s", points: [P("a", 10, 0), P("b", -10, 0), P("o", 0, 0)], curves: [{ id: "r", kind: "arc", start: "a", end: "b", centre: "o" }], constraints: [] };
  const o = sketchOutline(half)!;
  assert.equal(o.d, "M10 0A10 10 0 0 0 -10 0");
  // 20 across, padded 1.6: x from −11.6, 23.2 wide; y on screen from −10 − 1.6 = −11.6, 10 + 3.2 = 13.2 high.
  assert.equal(o.viewBox, "-11.6 -11.6 23.2 13.2");
  // The same ends the other way round (from (−10, 0) to (10, 0)) passes under: y −10..0.
  const under = sketchOutline({ ...half, curves: [{ id: "r", kind: "arc", start: "b", end: "a", centre: "o" }] })!;
  assert.equal(under.viewBox, "-11.6 -1.6 23.2 13.2");
  // Three quarters round, from (10, 0) to (0, −10): the large arc, and the box holds (0, 10) and (−10, 0).
  const most = sketchOutline({ ...half, points: [...half.points, P("c", 0, -10)], curves: [{ id: "r", kind: "arc", start: "a", end: "c", centre: "o" }] })!;
  assert.equal(most.d, "M10 0A10 10 0 1 0 0 10");
  assert.equal(most.viewBox, "-11.6 -11.6 23.2 23.2");
});

test("sketchOutline: a circle as two half circles, its box its centre ± its radius", () => {
  const c: Sketch = { id: "s", points: [P("o", 5, 5)], curves: [{ id: "c", kind: "circle", centre: "o", radius: 5 }], constraints: [] };
  const o = sketchOutline(c)!;
  assert.equal(o.d, "M0 -5A5 5 0 1 0 10 -5A5 5 0 1 0 0 -5");
  // 0..10 both ways, padded 0.8.
  assert.equal(o.viewBox, "-0.8 -10.8 11.6 11.6");
  // A curve naming a point that isn't there draws nothing rather than throwing.
  assert.equal(sketchOutline({ ...c, curves: [{ id: "l", kind: "line", start: "o", end: "gone" }] }), null);
});

// ---------------------------------------------------------------- body picture

test("project: the view from in front, right and above, worked by hand", () => {
  // Seen from (1, −1, 1)/√3 with z up: right is z × view = (1, 1, 0)/√2 and up is view × right = (−1, 1, 2)/√6.
  // (1, 0, 0) lies 1/√2 to the right, 1/√6 down, 1/√3 toward the viewer.
  const [r, u, d] = project([1, 0, 0]);
  close(r, 1 / Math.SQRT2, "right");
  close(u, -1 / Math.sqrt(6), "up");
  close(d, 1 / Math.sqrt(3), "depth");
  // (0, 0, 1) straight up: 2/√6 up, not right at all.
  const z = project([0, 0, 1]);
  close(z[0], 0, "right");
  close(z[1], 2 / Math.sqrt(6), "up");
  close(z[2], 1 / Math.sqrt(3), "depth");
  // The point the viewer looks from is nearest of all: depth 1 for the unit vector itself.
  close(project(VIEW_FROM)[2], 1, "depth");
});

test("shadeOf: a top face's light, worked by hand; full facing the light, dimmest facing away, either winding", () => {
  // LIGHT ∝ view − 0.35 right + 0.5 up: z = 1/√3 + 0.5 · 2/√6 = 0.57735 + 0.40825 = 0.98560; x = 0.57735 − 0.24749
  // − 0.20412 = 0.12574; y = −0.57735 − 0.24749 + 0.20412 = −0.62072; length √(0.01581 + 0.38529 + 0.97141) =
  // 1.17154, so its z is 0.84128 and a top face (0, 0, 1) is 0.35 + 0.65 × 0.84128 = 0.89683.
  close(shadeOf([0, 0, 1]), 0.89683, "a top face", 1e-5);
  close(shadeOf([0, 0, -1]), 0.89683, "the same face wound the other way", 1e-5);
  close(shadeOf(LIGHT), 1, "facing the light");
  // The view with its light-ward part taken out, n = V − (V·L)L: at right angles to the light (n·L = 0) yet still
  // toward the viewer (n·V = 1 − (V·L)² > 0), so unlit: the least, 0.35.
  const vl = VIEW_FROM[0] * LIGHT[0] + VIEW_FROM[1] * LIGHT[1] + VIEW_FROM[2] * LIGHT[2];
  close(shadeOf([0, 1, 2].map((i) => VIEW_FROM[i] - vl * LIGHT[i])), 0.35, "edge-on to the light");
  // A triangle wound the other way (its normal −L, away from the viewer): its viewer-side faces the light, so 1.
  close(shadeOf([-LIGHT[0], -LIGHT[1], -LIGHT[2]]), 1, "either winding");
});

const square = (z: number, half: number, own: boolean, cx = 0, cy = 0): PaintBody => ({
  positions: [cx - half, cy - half, z, cx + half, cy - half, z, cx + half, cy + half, z, cx - half, cy + half, z],
  indices: [0, 1, 2, 0, 2, 3],
  own,
});
const pixel = (rgba: Uint8ClampedArray, width: number, x: number, y: number) => [...rgba.slice(4 * (y * width + x), 4 * (y * width + x) + 4)];
const RED_GREEN = { own: "#ff0000", rest: "#00ff00" };

test("rasterPicture: the nearer surface shows whatever order the bodies come in", () => {
  // A 20 mm floor at z 0 (own, red) and an 8 mm tile at z 1 over its middle (green). The picture's middle is the
  // view's line through the bodies' middle: on the tile the point (1, −1, 1) (right 0, up −2/√6 + 2/√6 = 0), depth
  // (1 + 1 + 1)/√3 = 1.73; on the floor (0, 0, 0), depth 0. So the tile is nearer there and shows, either order.
  // The fit's middle is the middle of all the corners' span, which is the floor's (the tile lies inside it, raised
  // 1 mm, so the up span grows by 2/√6 at the top only): about 0.4 mm off, well inside the tile. Checked
  // a few pixels round the middle too.
  const W = 80;
  const H = 60;
  for (const bodies of [[square(0, 10, true), square(1, 4, false)], [square(1, 4, false), square(0, 10, true)]]) {
    const rgba = rasterPicture(bodies, W, H, RED_GREEN)!;
    for (const [x, y] of [[40, 30], [39, 29], [41, 31]]) {
      const [r, g, , a] = pixel(rgba, W, x, y);
      assert.equal(r, 0, `no red at (${x}, ${y})`);
      assert.ok(g > 100, `green at (${x}, ${y}): ${g}`);
      assert.equal(a, 255);
    }
    // Near the floor's corner (9, 9, 0), 5 mm past the tile both ways: red.
    const fit = pictureFit(bodies, W, H)!;
    const c = project([9, 9, 0]);
    const [r, g] = pixel(rgba, W, Math.floor(fit.x + c[0] * fit.scale), Math.floor(fit.y - c[1] * fit.scale));
    assert.ok(r > 100 && g === 0, `the floor away from the tile is red: ${r}, ${g}`);
    // Its shade: a top face, 0.89683 of 255 = 228.7 (worked above).
    close(r, 229, "the floor's red", 1);
    // A corner of the picture: no body, clear.
    assert.deepEqual(pixel(rgba, W, 0, 0), [0, 0, 0, 0]);
  }
  assert.equal(rasterPicture([], W, H, RED_GREEN), null);
  assert.equal(rasterPicture([{ positions: [NaN, 0, 0], indices: [0, 0, 0], own: true }], W, H, RED_GREEN), null);
});

/**
 * An edge in front of or behind a face square to the viewer by `behind` mm
 * (0.01 of the depth span is let through, so an edge on its own face shows),
 * the span set to 100 mm by a speck far back: is it drawn at the middle?
 */
function edgeShows(behind: number): boolean {
  const v = VIEW_FROM;
  const right = [1 / Math.SQRT2, 1 / Math.SQRT2, 0];
  const up = [-1 / Math.sqrt(6), 1 / Math.sqrt(6), 2 / Math.sqrt(6)];
  const at = (r: number, u: number, d: number) => [0, 1, 2].map((i) => r * right[i] + u * up[i] + d * v[i]);
  // The face: a 40 mm square at depth 0, square to the view; the speck: a tiny triangle at depth −100, at its corner.
  const face: PaintBody = { positions: [...at(-20, -20, 0), ...at(20, -20, 0), ...at(20, 20, 0), ...at(-20, 20, 0)], indices: [0, 1, 2, 0, 2, 3], own: true };
  const speck: PaintBody = { positions: [...at(-20, -20, -100), ...at(-19.9, -20, -100), ...at(-20, -19.9, -100)], indices: [0, 1, 2], own: true };
  // The edge: a line across the middle at depth −behind, in the green body.
  const edge: PaintBody = { positions: [], indices: [], edges: [...at(-10, 0, -behind), ...at(10, 0, -behind)], own: false };
  const W = 60;
  const rgba = rasterPicture([face, speck, edge], W, W, RED_GREEN)!;
  const fit = pictureFit([face, speck], W, W)!;
  const [, g] = pixel(rgba, W, Math.floor(fit.x), Math.floor(fit.y));
  // The picture's middle row: the line's dot two samples high, centred on the boundary between this row's samples
  // and the row above's, covers half of this pixel's SAMPLES × SAMPLES; the rest is the red face. So when drawn its
  // green is half of EDGE_SHADE × 255 = 0.45 × 255 / 2 = 57.4.
  if (g > 0) assert.equal(g, Math.floor((255 * EDGE_SHADE) / 2), `an edge is ${EDGE_SHADE} of its colour, over half the pixel`);
  return g > 0;
}

test("rasterPicture: an edge shows unless a face is nearer than 1% of the depth span; 0.9× shows, 1.1× hides", () => {
  // The span is 100 mm (face at 0, speck at −100), so the allowance is 1 mm.
  assert.equal(edgeShows(-5), true, "in front of the face");
  assert.equal(edgeShows(0), true, "on the face");
  assert.equal(edgeShows(0.9), true, "0.9 mm behind: within the allowance");
  assert.equal(edgeShows(1.1), false, "1.1 mm behind: hidden");
  assert.equal(edgeShows(20), false, "well behind");
});

test("rgbOf and mixed: the colours CSS gives, read; a third of the way from one to another", () => {
  assert.deepEqual(rgbOf("#4aa8ff"), [74, 168, 255]);
  assert.deepEqual(rgbOf("#fff"), [255, 255, 255]);
  assert.deepEqual(rgbOf("rgb(1, 2, 3)"), [1, 2, 3]);
  assert.deepEqual(rgbOf("rgba(10, 20, 30, 0.5)"), [10, 20, 30]);
  assert.equal(rgbOf("blue"), null);
  // 0 → 255 a third of the way is 85; 30 → 0 is 20.
  assert.equal(mixed("rgb(0, 30, 255)", "rgb(255, 0, 255)", 1 / 3), "rgb(85, 20, 255)");
  assert.equal(mixed("blue", "#000", 0.5), "blue");
});

// ---------------------------------------------------------------- whose bodies, and kept pictures

const fakeScene = (bodies: { body: string; feature: string }[]): Scene =>
  ({ bodies: bodies.map((b) => ({ ...b, place: 1, names: {}, view: { mesh: { positions: square(0, 5, false).positions, indices: [0, 1, 2, 0, 2, 3], normals: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] } } })) }) as unknown as Scene;

test("ownBodies: a feature's own bodies, a Move's moved bodies, none for a sketch", () => {
  const scene = fakeScene([{ body: "body:feature-1", feature: "feature-1" }, { body: "body:feature-2", feature: "feature-2" }, { body: "body:feature-5/1", feature: "feature-5" }, { body: "body:feature-5/2", feature: "feature-5" }]);
  assert.deepEqual([...ownBodies(scene, feature("feature-2", "box", {}, "", ""))], [1]);
  assert.deepEqual([...ownBodies(scene, feature("feature-5", "combine", {}, "", ""))], [2, 3], "a Combine's pieces");
  assert.deepEqual([...ownBodies(scene, feature("feature-9", "move", { bodies: ["body:feature-1", "body:feature-5/2"] }, "", ""))], [0, 3]);
  assert.deepEqual([...ownBodies(scene, feature("feature-9", "move", {}, "", "", ["feature-2"]))], [1], "an old Move names its items");
  assert.deepEqual([...ownBodies(scene, feature("feature-2", "sketch", {}, "", ""))], []);
});

/** A page whose canvases paint (happy-dom's don't): every createImageData and putImageData counted. */
function paintingPage() {
  const window = new Window();
  const doc = window.document as unknown as Document;
  let urls = 0;
  const make = doc.createElement.bind(doc);
  (doc as { createElement: unknown }).createElement = (tag: string) => {
    const el = make(tag) as HTMLCanvasElement;
    if (tag === "canvas") {
      (el as { getContext: unknown }).getContext = () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => {} });
      (el as { toDataURL: unknown }).toDataURL = () => `data:image/png;base64,${++urls}`;
    }
    return el;
  };
  return doc;
}

test("bodyPicture: drawn the first time it is asked for, then kept for the scene, item and colours", () => {
  const doc = paintingPage();
  const scene = fakeScene([{ body: "body:feature-1", feature: "feature-1" }]);
  const box = feature("feature-1", "box", {}, "", "");
  const colours = { own: "#ff0000", rest: "#00ff00" };
  const before = painted.count;
  const first = bodyPicture(doc, scene, box, colours);
  assert.ok(first?.startsWith("data:image/png"));
  assert.equal(bodyPicture(doc, scene, box, colours), first, "the same picture");
  assert.equal(painted.count, before + 1, "painted once");
  // Another theme's colours, another item, or a new scene (an edit rebuilt): painted again.
  assert.notEqual(bodyPicture(doc, scene, box, { own: "#0000ff", rest: "#00ff00" }), first);
  bodyPicture(doc, scene, feature("feature-2", "box", {}, "", ""), colours);
  bodyPicture(doc, fakeScene([{ body: "body:feature-1", feature: "feature-1" }]), box, colours);
  assert.equal(painted.count, before + 4);
  // A page with no canvas to paint on: no picture, and nothing thrown.
  const plain = new Window().document as unknown as Document;
  assert.equal(bodyPicture(plain, fakeScene([]), box, colours), null);
});

// ---------------------------------------------------------------- the card on the bar

function bar(doc: DesignDocument, opts: { noTips?: boolean; picked?: string; scene?: Scene } = {}) {
  const window = new Window({ width: 1280, height: 800 });
  if (opts.noTips) (window as unknown as { __noTooltips: boolean }).__noTooltips = true;
  const page = window.document as unknown as Document;
  const slot = page.createElement("div");
  page.body.append(slot);
  const draw = (picked: string | null) => showTimelineBar(slot, doc, { picked, scene: () => opts.scene ?? null });
  draw(opts.picked ?? null);
  const item = (id: string) => slot.querySelector<HTMLElement>(`.timeline-bar-item[data-item="${id}"]`)!;
  const fire = (el: Element, type: string, pointerType = "mouse") => {
    const e = new window.MouseEvent(type, { bubbles: type !== "pointerenter" && type !== "pointerleave" });
    Object.defineProperty(e, "pointerType", { value: pointerType });
    el.dispatchEvent(e as unknown as Event);
  };
  const card = () => page.getElementById("timeline-card");
  return { window, page, slot, item, fire, card, draw };
}

test("hovering an item shows its card above the bar, and leaving hides it; the app's own hover box stays away", () => {
  const { item, fire, card } = bar(threeItems());
  assert.equal(card(), null, "no card before a hover");
  assert.ok(item("feature-1").hasAttribute("data-own-tip"), "the app's tooltip holds the title back and shows nothing (tooltip.ts)");
  fire(item("feature-1"), "pointerenter");
  assert.equal(card()!.hidden, false);
  assert.equal(card()!.dataset.item, "feature-1");
  assert.equal(card()!.querySelector(".timeline-card-name")!.textContent, "Box 1");
  assert.equal(card()!.querySelector(".timeline-card-number")!.textContent, "#1");
  assert.equal(card()!.querySelector(".timeline-card-kind")!.textContent, "Box");
  assert.deepEqual([...card()!.querySelectorAll(".timeline-card-detail")].map((d) => d.textContent), ["40 × 30 × 20 mm", "width × depth × height"]);
  assert.equal(item("feature-1").getAttribute("aria-describedby"), "timeline-card");
  // The title is still there, whole, for screen readers and the checks that read it.
  assert.equal(item("feature-1").title, "1. Box 1\nBox: 40 × 30 × 20 mm");
  fire(item("feature-1"), "pointerleave");
  assert.equal(card()!.hidden, true);
  assert.equal(item("feature-1").hasAttribute("aria-describedby"), false);
  // Another item: the same card, refilled.
  fire(item("feature-3"), "pointerenter");
  assert.equal(card()!.querySelector(".timeline-card-name")!.textContent, "Extrude 1");
  // A press (perhaps a drag) hides it.
  fire(item("feature-3"), "pointerdown");
  assert.equal(card()!.hidden, true);
});

test("a sketch's card draws its outline; an item not built says why", () => {
  const sketched = withSketch(threeItems(), { id: "sketch-2", points: [P("a", 0, 0), P("b", 10, 0), P("c", 0, 10)], curves: [{ id: "1", kind: "line", start: "a", end: "b" }, { id: "2", kind: "line", start: "b", end: "c" }, { id: "3", kind: "line", start: "c", end: "a" }], constraints: [] });
  const rolled = { ...sketched, timeline: { ...sketched.timeline, marker: "sketch-2" } };
  const { item, fire, card } = bar(rolled);
  fire(item("sketch-2"), "pointerenter");
  assert.equal(card()!.querySelector(".timeline-card-picture")!.getAttribute("data-picture"), "outline");
  assert.equal(card()!.querySelector("path")!.getAttribute("d"), "M0 0L10 0M10 0L0 -10M0 -10L0 0");
  assert.equal(card()!.querySelectorAll(".timeline-card-detail")[1].textContent, "3 lines");
  fire(item("feature-3"), "pointerenter");
  assert.equal(card()!.querySelector(".timeline-card-status")!.textContent, "After the rollback marker: not built yet");
  assert.equal(card()!.querySelector(".timeline-card-picture"), null, "nothing built, so no picture");
});

test("the keyboard: focusing an item shows its card, leaving it hides it", () => {
  const { item, card } = bar(threeItems());
  item("feature-3").dispatchEvent(new (item("feature-3").ownerDocument.defaultView as unknown as typeof globalThis).Event("focus"));
  assert.equal(card()!.dataset.item, "feature-3");
  item("feature-3").dispatchEvent(new (item("feature-3").ownerDocument.defaultView as unknown as typeof globalThis).Event("blur"));
  assert.equal(card()!.hidden, true);
});

test("a finger has no hover: the item it picks shows its card once the pick settles; a mouse's pick doesn't", async () => {
  const doc = threeItems();
  const { item, fire, card, draw, window } = bar(doc);
  fire(item("sketch-2"), "pointerenter", "touch");
  assert.equal(card(), null, "a finger's enter shows nothing");
  fire(item("sketch-2"), "pointerdown", "touch");
  draw("sketch-2"); // the app picks it and draws the bar again
  assert.equal(card()?.hidden ?? true, true, "not at once: a second tap may still come");
  await new Promise((r) => window.setTimeout(r, DOUBLE_CLICK_MS + 100));
  assert.equal(card()!.hidden, false);
  assert.equal(card()!.dataset.item, "sketch-2");
  // The pick ends (tapped again): the card goes with the redraw.
  draw(null);
  assert.equal(card()!.hidden, true);
  // A mouse's pick shows no card of its own (its hover does).
  fire(item("feature-1"), "pointerdown", "mouse");
  draw("feature-1");
  await new Promise((r) => window.setTimeout(r, DOUBLE_CLICK_MS + 100));
  assert.equal(card()!.hidden, true);
});

test("the browser checks switch the cards off with the tooltips, so a hover covers nothing they probe", () => {
  const { item, fire, card } = bar(threeItems(), { noTips: true });
  fire(item("feature-1"), "pointerenter");
  assert.equal(card(), null);
});
