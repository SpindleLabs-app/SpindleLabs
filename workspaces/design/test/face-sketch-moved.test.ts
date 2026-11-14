// A sketch on a face of a moved body (35e2h): it is carried by what the
// Moves before it did to the face's body since it was drawn (face-sketch.ts
// `bodyFrame`, `carried`, `frameNow`'s carry), so a Move edited to slide
// the face along itself, or to turn it about its normal, takes the sketch
// with it; the face's plane still has the last word. Hand-worked frames,
// the face-pick and file paths, and seeded checks against the Move
// preview's own arithmetic (move-tool.ts `movedPoint`, a separate path).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodySpec, BodyView, Motion, Plane } from "@fission/core";
import { bodyFrame, carried, frameNow, sketchMiddle, squared } from "../src/face-sketch.ts";
import { addFaceSketch } from "../src/sketch.ts";
import { partDocument, readDesignDocument } from "../src/document.ts";
import { moveMotions, NO_MOVE, type MoveValues } from "../src/move.ts";
import { movedPoint } from "../src/move-tool.ts";
import { sketchSpot } from "../src/face-pick.ts";
import { joinBodies, type ShownBody } from "../src/scene.ts";
import { nameBody } from "../src/naming.ts";
import { boxView } from "./views.ts";
import { ownPoints } from "../src/rebuild.ts";
import type { Sketch } from "../src/document.ts";

type Vec3 = [number, number, number];
const plane = (origin: number[], xAxis: number[], normal: number[]): Plane => ({ origin: origin as Vec3, xAxis: xAxis as Vec3, normal: normal as Vec3 });
const SHAPE = { box: { size: [40, 30, 20] } } as unknown as BodySpec;
const movedBy = (moves: Motion[]): BodySpec => ({ moved: { body: SHAPE as never, moves } });
const QUARTER = Math.PI / 2;

function near(got: readonly number[], want: readonly number[], what: string, within = 1e-12) {
  for (const [k, x] of got.entries()) assert.ok(Math.abs(x - want[k]) <= within, `${what}: [${got}] want [${want}]`);
}
function nearPlane(got: Plane | null, want: Plane, what: string, within = 1e-12) {
  assert.ok(got !== null, `${what}: no frame`);
  near(got.origin, want.origin, `${what} origin`, within);
  near(got.xAxis, want.xAxis, `${what} x`, within);
  near(got.normal, want.normal, `${what} normal`, within);
}

/** The top of the 40 × 30 × 20 box as drawn unmoved: rule 8 gives the world's XY lifted to z = 20. */
const TOP = plane([0, 0, 20], [1, 0, 0], [0, 0, 1]);

test("hand-worked: bodyFrame is where a body's moves put the world's frame, in order", () => {
  assert.equal(bodyFrame(SHAPE), null, "a body never moved");
  assert.equal(bodyFrame(movedBy([])), null, "moved by nothing");
  nearPlane(bodyFrame(movedBy([{ move: [3, 4, 5] }])), plane([3, 4, 5], [1, 0, 0], [0, 0, 1]), "shifted");
  // A quarter turn counter-clockwise looking down +z (the axis needn't be
  // unit) about the line through (10, 0, 0): the origin is (−10, 0) from the
  // pivot, and (a, b) → (−b, a) takes it to (0, −10), so (10, −10, 0); x
  // turns to y; the normal is the axis, so it stays.
  nearPlane(bodyFrame(movedBy([{ turn: { pivot: [10, 0, 0], axis: [0, 0, 2], angle: QUARTER } }])), plane([10, -10, 0], [0, 1, 0], [0, 0, 1]), "turned about z");
  // A quarter turn about +x through the origin: (y, z) → (−z, y), so the normal (0, 0, 1) goes to (0, −1, 0) and x stays.
  nearPlane(bodyFrame(movedBy([{ turn: { pivot: [0, 0, 0], axis: [1, 0, 0], angle: QUARTER } }])), plane([0, 0, 0], [1, 0, 0], [0, -1, 0]), "turned about x");
  // Order counts: shifted (1, 0, 0) then turned a quarter about z through the origin puts the origin at (0, 1, 0), not (1, 0, 0).
  nearPlane(bodyFrame(movedBy([{ move: [1, 0, 0] }, { turn: { pivot: [0, 0, 0], axis: [0, 0, 1], angle: QUARTER } }])), plane([0, 1, 0], [0, 1, 0], [0, 0, 1]), "shift then turn");
});

test("hand-worked: carried maps points and directions from one body frame to another, and is nothing for the same frame", () => {
  assert.equal(carried(undefined, undefined), null, "never moved");
  const at = plane([5, 0, 0], [1, 0, 0], [0, 0, 1]);
  assert.equal(carried(at, { ...at }), null, "moved, but not since drawn");
  // From the world to shifted (7, 3, 0): a point moves with it, a direction doesn't.
  const slide = carried(undefined, plane([7, 3, 0], [1, 0, 0], [0, 0, 1]))!;
  near(slide([1, 2, 3], false), [8, 5, 3], "point");
  near(slide([1, 2, 3], true), [1, 2, 3], "direction");
  // From shifted (5, 0, 0) to turned a quarter about z at the origin: (6, 0, 0) is 1 along the old x; the new x is y, so (0, 1, 0).
  near(carried(at, plane([0, 0, 0], [0, 1, 0], [0, 0, 1]))!([6, 0, 0], false), [0, 1, 0], "back and turned");
});

test("hand-worked: a sketch on the top slides and turns with its face when a Move before it is edited (35e2h)", () => {
  // Slid (7, 3, 0) since drawn, the top's middle now at (27, 18, 20): the origin slides with it, x as it was.
  nearPlane(frameNow(TOP, [0, 0, 1], [27, 18, 20], carried(undefined, plane([7, 3, 0], [1, 0, 0], [0, 0, 1]))), plane([7, 3, 20], [1, 0, 0], [0, 0, 1]), "slid");
  // Before 35e2h the origin stayed where the world's origin meets the plane: (0, 0, 20). Without a carry it still does.
  nearPlane(frameNow(TOP, [0, 0, 1], [27, 18, 20]), TOP, "no carry");
  // Drawn after a Move of (5, 0, 0), that Move edited to (12, 0, 0): carried by the difference, (7, 0, 0).
  nearPlane(frameNow(TOP, [0, 0, 1], [32, 15, 20], carried(plane([5, 0, 0], [1, 0, 0], [0, 0, 1]), plane([12, 0, 0], [1, 0, 0], [0, 0, 1]))), plane([7, 0, 20], [1, 0, 0], [0, 0, 1]), "edited Move");
  // Turned a quarter about z through the box's middle line (20, 15): the
  // world's origin is (−20, −15) from it, (a, b) → (−b, a) gives (15, −20),
  // so (35, −5); x turns to y. Check by a sketch point (a, b): drawn at
  // world (a, b, 20), turned to (35 − b, −5 + a, 20); the frame gives
  // origin + a x + b (n × x) = (35, −5, 20) + a (0, 1, 0) + b (−1, 0, 0). The same.
  nearPlane(frameNow(TOP, [0, 0, 1], [20, 15, 20], carried(undefined, bodyFrame(movedBy([{ turn: { pivot: [20, 15, 0], axis: [0, 0, 1], angle: QUARTER } }]))!)), plane([35, -5, 20], [0, 1, 0], [0, 0, 1]), "turned about its normal");
  // The face's plane has the last word: moved up 5 since drawn, but the box also grew to 40 tall, so the top is at z = 45.
  nearPlane(frameNow(TOP, [0, 0, 1], [20, 15, 45], carried(undefined, plane([0, 0, 5], [1, 0, 0], [0, 0, 1]))), plane([0, 0, 45], [1, 0, 0], [0, 0, 1]), "plane wins");
  // The bottom (drawn as XY's frame, side −1) turned half a turn about x:
  // it now looks up. Carried, the normal is (0, 0, −1) and x stays, so a
  // point (a, b) lands at (a, −b, 0), where the half turn puts (a, b, 0).
  // Without the carry the frame would keep +z and mirror the sketch.
  nearPlane(frameNow(plane([0, 0, 0], [1, 0, 0], [0, 0, 1]), [0, 0, 1], [20, -15, 0], carried(undefined, bodyFrame(movedBy([{ turn: { pivot: [0, 0, 0], axis: [1, 0, 0], angle: Math.PI } }]))!)), plane([0, 0, 0], [1, 0, 0], [0, 0, -1]), "bottom turned over");
});

test("a face picked gives the new sketch where the Moves had put its body, the world's frame when none had", () => {
  // The box's faces in make_box's order (face-pick.test.ts): the top is face 1. No mesh: the pick reads only normals and names.
  const view = { ...boxView(40, 30, 20), mesh: { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] }, face_normals: [[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]], face_centroids: [[20, 15, 0], [20, 15, 20], [20, 0, 10], [20, 30, 10], [0, 15, 10], [40, 15, 10]] } as BodyView;
  const top = 1;
  const at = plane([7, 3, 0], [1, 0, 0], [0, 0, 1]);
  const body = (frame?: Plane): ShownBody => ({ feature: "feature-1", body: "body:feature-1", place: 1, view, names: nameBody("feature-1", view, () => null), ...(frame ? { frame } : {}) });
  const moved = sketchSpot({ face: top, shift: false }, joinBodies([body(at)]));
  assert.ok(moved?.kind === "face", JSON.stringify(moved));
  assert.deepEqual(moved.drawn.body, at);
  const kept = addFaceSketch(partDocument("box", 40, 30, 20), moved.face, moved.drawn).doc.sketches.at(-1)!.face!;
  // SL #539: kept with the body's size, 1 when no Scale had sized it, so the file tells it from one written before the rule.
  assert.deepEqual(kept.body, { ...at, size: 1 });
  // A body a Scale had made 3 times its size: the size is kept as the frame said.
  const grown = sketchSpot({ face: top, shift: false }, joinBodies([body({ ...at, size: 3 } as Plane)]));
  assert.ok(grown?.kind === "face", JSON.stringify(grown));
  assert.deepEqual(addFaceSketch(partDocument("box", 40, 30, 20), grown.face, grown.drawn).doc.sketches.at(-1)!.face!.body, { ...at, size: 3 });
  // A size that is no size is refused (a broken caller, not a pick): 0, below 0, not a number.
  for (const size of [0, -2, Number.NaN]) assert.throws(() => addFaceSketch(partDocument("box", 40, 30, 20), moved.face, { ...moved.drawn, body: { ...at, size } as Plane }), /needs its body's size above 0/, String(size));
  // Never moved: the world's frame, so a Move put in before it later carries it.
  const still = sketchSpot({ face: top, shift: false }, joinBodies([body()]));
  assert.ok(still?.kind === "face", JSON.stringify(still));
  assert.deepEqual(still.drawn.body, plane([0, 0, 0], [1, 0, 0], [0, 0, 1]));
  assert.deepEqual(addFaceSketch(partDocument("box", 40, 30, 20), still.face, still.drawn).doc.sketches.at(-1)!.face!.body, { ...plane([0, 0, 0], [1, 0, 0], [0, 0, 1]), size: 1 });
  // A placement with no body (a file from before 35e2h, or a caller that doesn't know) keeps none.
  assert.equal(addFaceSketch(partDocument("box", 40, 30, 20), still.face, { plane: still.drawn.plane, side: 1 }).doc.sketches.at(-1)!.face!.body, undefined);
  // A body frame that can't be a frame is refused (a broken caller, not a pick).
  assert.throws(() => addFaceSketch(partDocument("box", 40, 30, 20), moved.face, { ...moved.drawn, body: plane([0, 0, 0], [0, 0, 1], [0, 0, 1]) }), /needs a frame for where its body was moved to/);
});

/** Mulberry32, seeded. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = Number(process.env.FISSION_SEED ?? "35");

/** A random Move's numbers: shifts to ±500 mm, angles to ±180°, a pivot to ±200 mm; each left 0 one time in three. */
function randomMove(rand: () => number): MoveValues {
  const pick = (k: number) => (rand() < 1 / 3 ? 0 : (rand() * 2 - 1) * k);
  return { ...NO_MOVE, x: pick(500), y: pick(500), z: pick(500), turnX: pick(180), turnY: pick(180), turnZ: pick(180), pivotX: pick(200), pivotY: pick(200), pivotZ: pick(200) };
}

test("seeded: 2,000 chains of Moves put the body's frame where the Move preview's arithmetic puts points (FISSION_SEED)", () => {
  const rand = seeded(SEED);
  for (let i = 0; i < 2000; i++) {
    const moves = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => randomMove(rand));
    const frame = bodyFrame(movedBy(moves.flatMap(moveMotions)));
    const map = carried(undefined, frame ?? undefined);
    const p: Vec3 = [(rand() * 2 - 1) * 300, (rand() * 2 - 1) * 300, (rand() * 2 - 1) * 300];
    // movedPoint (move-tool.ts) turns about X, Y then Z with its own cos and sin, then shifts: a separate path to the same place.
    const want = moves.reduce<readonly number[]>((q, v) => movedPoint(q, v), p);
    const d = moves.reduce<readonly number[]>((q, v) => movedPoint(q, v, true), [0.6, 0, 0.8]);
    const got = map ? map(p, false) : p;
    near(got, want, `seed ${SEED} chain ${i} point`, 1e-9 * 2000);
    near(map ? map([0.6, 0, 0.8], true) : [0.6, 0, 0.8], d, `seed ${SEED} chain ${i} direction`, 1e-12 * 50);
  }
});

test("seeded: 2,000 sketches on random faces carried by random edits land where the edit moves the face, and the same body frame changes nothing (FISSION_SEED)", () => {
  const rand = seeded(SEED + 1);
  let same = 0;
  for (let i = 0; i < 2000; i++) {
    const then = bodyFrame(movedBy(moveMotions(randomMove(rand)))) ?? undefined;
    const now = rand() < 0.1 ? then : (bodyFrame(movedBy(moveMotions(randomMove(rand)))) ?? undefined);
    // A drawn frame on a random plane: rule 8's origin is the plane's nearest point to the world's origin.
    const n = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const drawn = squared(plane([0, 0, 0], [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1], n));
    if (drawn === null) continue;
    const h = (rand() * 2 - 1) * 400;
    const d0 = plane(drawn.normal.map((x) => x * h), drawn.xAxis, drawn.normal);
    const carry = carried(then, now);
    if (carry === null) {
      // Not moved since drawn: exactly as before 35e2h, the face where it was.
      assert.deepEqual(frameNow(d0, d0.normal, d0.origin, carry), frameNow(d0, d0.normal, d0.origin), `seed ${SEED + 1} sketch ${i}`);
      same++;
      continue;
    }
    // The face is where the edit took it: its outward normal (here the drawn one) and a point carried rigidly.
    const want = plane(carry(d0.origin, false), carry(d0.xAxis, true), carry(d0.normal, true));
    const q = carry([d0.origin[0] + 13 * d0.xAxis[0], d0.origin[1] + 13 * d0.xAxis[1], d0.origin[2] + 13 * d0.xAxis[2]], false);
    nearPlane(frameNow(d0, want.normal, q, carry), want, `seed ${SEED + 1} sketch ${i}`, 1e-9 * 2000);
  }
  assert.ok(same > 100, `the unmoved branch was tried (${same})`);
});

// ---------------------------------------------------------------- SL #539: a Scale's change of size (the owner's rule, 2026-11-11)

test("hand-worked: a change of size since drawn carries the sketch's middle as the body's point there, its sizes kept (SL #539)", () => {
  // Box 40 × 30 × 20 scaled by 2 about its centre (20, 15, 10): its own origin went to (20, 15, 10) + 2 (−20, −15, −10) = (−20, −15, −10),
  // size 2. The factor edited to 0.5: (20, 15, 10) + 0.5 (−20, −15, −10) = (10, 7.5, 5), size 0.5. So k = 0.5 / 2 = 1/4.
  const drawn = { ...plane([-20, -15, -10], [1, 0, 0], [0, 0, 1]), size: 2 };
  const now = { ...plane([10, 7.5, 5], [1, 0, 0], [0, 0, 1]), size: 0.5 };
  const middle = [20, 15, 30];
  const c = carried(drawn, now, middle)!;
  // The middle (20, 15, 30) of the top drawn on is (0, 0, 20) from the centre; the body's point there goes 1/4 of that: (20, 15, 15).
  near(c(middle, false), [20, 15, 15], "the middle");
  // A point 3 mm along x from it keeps the 3 mm (sizes kept): (23, 15, 15), not 20 + 3/4.
  near(c([23, 15, 30], false), [23, 15, 15], "3 mm along x");
  // The sketch's origin (0, 0, 30) moves as the middle does: by (20, 15, 15) − (20, 15, 30) = (0, 0, −15), to (0, 0, 15).
  near(c([0, 0, 30], false), [0, 0, 15], "the origin");
  near(c([1, 0, 0], true), [1, 0, 0], "a direction is only turned");
  // The rule before SL #539, kept for a sketch whose `body` holds no size (drawn before) and for one with no points: each point shifted
  // by the origins' difference (10, 7.5, 5) − (−20, −15, −10) = (30, 22.5, 15), so the middle lands at (50, 37.5, 45).
  const { size: _, ...before } = drawn;
  near(carried(before, now, middle)!(middle, false), [50, 37.5, 45], "drawn before the rule");
  near(carried(drawn, now)!(middle, false), [50, 37.5, 45], "no points");
  // Scaled by 2 about the world's origin: the frame is the world's again (origin (0, 0, 0)), but the size isn't, so it is carried:
  // (10, 0, 0) goes to (20, 0, 0). The same size and frame carry nothing.
  const twice = { ...plane([0, 0, 0], [1, 0, 0], [0, 0, 1]), size: 2 };
  near(carried({ ...twice, size: 1 }, twice, [10, 0, 0])!([10, 0, 0], false), [20, 0, 0], "about the origin");
  assert.equal(carried(twice, { ...twice }, [10, 0, 0]), null, "not resized since");
  // A quarter turn about z through the origin as well, size 1 to 3: (10, 0, 0) is turned to (0, 10, 0) and made 3 times as far: (0, 30, 0);
  // a point 1 mm further along x from it keeps its 1 mm, turned: (0, 31, 0).
  const turned3 = { ...plane([0, 0, 0], [0, 1, 0], [0, 0, 1]), size: 3 };
  const t = carried({ ...plane([0, 0, 0], [1, 0, 0], [0, 0, 1]), size: 1 }, turned3, [10, 0, 0])!;
  near(t([10, 0, 0], false), [0, 30, 0], "turned and tripled");
  near(t([11, 0, 0], false), [0, 31, 0], "1 mm further, kept");
});

test("hand-worked: a sketch's middle is the middle of the box round its points, in the world on its frame (SL #539)", () => {
  assert.equal(sketchMiddle(TOP, []), undefined);
  // Points (0, 0), (10, 2) and (4, 8): the box is x 0..10, y 0..8, its middle (5, 4); on the top (origin (0, 0, 20), x along X) (5, 4, 20).
  near(sketchMiddle(TOP, [{ x: 0, y: 0 }, { x: 10, y: 2 }, { x: 4, y: 8 }])!, [5, 4, 20], "on the top");
  // On the front (XZ-like: x along X, normal −Y, so y = normal × x = (0, −1, 0) × (1, 0, 0) = (0, 0, 1), up): (5, 4) is (5, 0, 4).
  near(sketchMiddle(plane([0, 0, 0], [1, 0, 0], [0, -1, 0]), [{ x: 0, y: 0 }, { x: 10, y: 8 }])!, [5, 0, 4], "on the front");
});

test("the reader takes a face sketch's body size above 0 and refuses one that isn't, saying so (SL #539)", () => {
  const view = { ...boxView(40, 30, 20), mesh: { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] }, face_normals: [[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]], face_centroids: [[20, 15, 0], [20, 15, 20], [20, 0, 10], [20, 30, 10], [0, 15, 10], [40, 15, 10]] } as BodyView;
  const shown: ShownBody = { feature: "feature-1", body: "body:feature-1", place: 1, view, names: nameBody("feature-1", view, () => null), frame: { ...plane([0, 0, 0], [1, 0, 0], [0, 0, 1]), size: 2 } as Plane };
  const spot = sketchSpot({ face: 1, shift: false }, joinBodies([shown]));
  assert.ok(spot?.kind === "face", JSON.stringify(spot));
  const good = JSON.parse(JSON.stringify(addFaceSketch(partDocument("box", 40, 30, 20), spot.face, spot.drawn).doc));
  assert.equal(readDesignDocument(good).sketches.at(-1)!.face!.body!.size, 2);
  const id = good.sketches.at(-1).id;
  for (const size of [0, -1, "2", null]) {
    const broken = JSON.parse(JSON.stringify(good));
    broken.sketches.at(-1).face.body.size = size;
    assert.throws(() => readDesignDocument(broken), { message: `Design sketch ${id}'s body frame's size must be a number above 0, not ${String(size)}` }, String(size));
  }
  // None at all: a file from before SL #539, read as it was.
  const before = JSON.parse(JSON.stringify(good));
  delete before.sketches.at(-1).face.body.size;
  assert.equal(readDesignDocument(before).sketches.at(-1)!.face!.body!.size, undefined);
});

test("seeded: 2,000 random Moves with scales, edited: the sketch's middle lands where the body's point there goes, and its sizes are kept (SL #539, FISSION_SEED)", () => {
  const rand = seeded(SEED + 2);
  // Scales from 1/10 to 10 (as the slider's ends), one in five left at 1; everything else as randomMove.
  const sized = (): MoveValues => ({ ...randomMove(rand), scale: rand() < 0.2 ? 1 : Math.exp((rand() * 2 - 1) * Math.log(10)) });
  const world = plane([0, 0, 0], [1, 0, 0], [0, 0, 1]);
  for (let i = 0; i < 2000; i++) {
    const then = sized();
    const now = sized();
    // The body frame a sketch records when drawn (addFaceSketch): always with its size, 1 too.
    const f = bodyFrame(movedBy(moveMotions(then)));
    const drawn = { ...(f ?? world), size: f?.size ?? 1 };
    const later = bodyFrame(movedBy(moveMotions(now))) ?? undefined;
    // A point of the body (its own coordinates, to ±100 mm), where the Move drawn on put it, and where the edited one puts it: the move
    // preview's own arithmetic (move-tool.ts movedPoint), a separate path from the frames.
    const p = [0, 1, 2].map(() => (rand() * 2 - 1) * 100);
    const middle = movedPoint(p, then);
    const carry = carried(drawn, later, middle);
    const at = `seed ${SEED + 2} case ${i}`;
    const want = movedPoint(p, now);
    if (carry === null) {
      near(middle, want, `${at}: nothing carried, so nothing moved`, 1e-9 * 1000);
      continue;
    }
    near(carry(middle, false), want, `${at}: the middle`, 1e-9 * 1000);
    // A point 7 mm from the middle stays 7 mm from it (sizes kept), whatever the factors.
    const d = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const len = Math.hypot(...d);
    const q = middle.map((x, k) => x + (7 * d[k]) / len);
    const gap = carry(q, false).map((x, k) => x - carry(middle, false)[k]);
    assert.ok(Math.abs(Math.hypot(...gap) - 7) <= 1e-9 * 1000, `${at}: 7 mm became ${Math.hypot(...gap)}`);
  }
});

test("the middle a Scale carries a sketch by is of its own points: one pinned or made by a projection is left out, as settling moves it (SL #539)", () => {
  // Own: a (0, 0) and b (10, 0) of line l1; pinned: c (100, 100), end of l2; projected: d, e, the line l3 a projection made.
  // So the box is of a and b only: x 0..10, y 0, middle (5, 0); with c, d, e it would reach (100, 100) and move whenever a pin is followed.
  const sketch = {
    id: "sketch-2",
    points: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }, { id: "c", x: 100, y: 100 }, { id: "d", x: -50, y: 7 }, { id: "e", x: -40, y: 7 }],
    curves: [{ id: "l1", kind: "line", start: "a", end: "b" }, { id: "l2", kind: "line", start: "b", end: "c" }, { id: "l3", kind: "line", start: "d", end: "e" }],
    constraints: [],
    pins: [{ point: "c", kind: "endpoint", name: "v" }],
    projected: [{ id: "p1", feature: "feature-1", edge: "e1", made: "l3" }],
  } as unknown as Sketch;
  assert.deepEqual(ownPoints(sketch).map((p) => p.id), ["a", "b"]);
  near(sketchMiddle(TOP, ownPoints(sketch))!, [5, 0, 20], "middle of the own points on the top");
  // Nothing pinned or projected: every point.
  assert.deepEqual(ownPoints({ ...sketch, pins: undefined, projected: undefined } as unknown as Sketch).map((p) => p.id), ["a", "b", "c", "d", "e"]);
});

test("the middle a Scale carries a sketch by leaves out points a constraint or arc ties to a followed point, through any chain (SL #641 item 1)", () => {
  // Followed: c (pinned). Tied to c: f by Horizontal with c, g by a distance from f (a chain), and an arc's centre h and ends
  // i, j, i Coincident with g. Left: a and b, whose own Horizontal ties them only to each other, and k with a Fix of its own,
  // and l sized by a diameter only (it names no point). So the box is of a (0, 0), b (10, 4), k (2, 6) and l (6, 1): x 0..10,
  // y 0..6, middle (5, 3), on the top (5, 3, 20).
  const p = (id: string, x: number, y: number) => ({ id, x, y });
  const sketch = {
    id: "sketch-3",
    points: [p("a", 0, 0), p("b", 10, 4), p("c", 100, 100), p("f", 50, 100), p("g", 50, 60), p("h", 70, 70), p("i", 50, 60), p("j", 80, 70), p("k", 2, 6), p("l", 6, 1)],
    curves: [{ id: "arc1", kind: "arc", centre: "h", start: "i", end: "j" }, { id: "circle1", kind: "circle", centre: "l", radius: 2 }],
    constraints: [
      { id: "k1", kind: "horizontal", a: "f", b: "c" },
      { id: "k2", kind: "distance", a: "g", b: "f", value: 40 },
      { id: "k3", kind: "coincident", a: "i", b: "g" },
      { id: "k4", kind: "horizontal", a: "a", b: "b" },
      { id: "k5", kind: "fix", point: "k" },
      { id: "k6", kind: "diameter", circle: "circle1", value: 4 },
    ],
    pins: [{ point: "c", kind: "endpoint", name: "v" }],
  } as unknown as Sketch;
  assert.deepEqual(ownPoints(sketch).map((q) => q.id), ["a", "b", "k", "l"]);
  near(sketchMiddle(TOP, ownPoints(sketch))!, [5, 3, 20], "middle of the points settling can't move");
  // The chain broken at k2: g, and the arc through it, are the sketch's own again.
  const broken = { ...sketch, constraints: sketch.constraints.filter((c) => c.id !== "k2") } as Sketch;
  assert.deepEqual(ownPoints(broken).map((q) => q.id), ["a", "b", "g", "h", "i", "j", "k", "l"]);
  // Every point tied to the followed one: none left, so no middle (carried as a sketch drawn before the rule).
  const all = { ...sketch, constraints: [...sketch.constraints, { id: "k7", kind: "vertical", a: "a", b: "f" }, { id: "k8", kind: "vertical", a: "k", b: "l" }, { id: "k9", kind: "coincident", a: "k", b: "c" }] } as Sketch;
  assert.deepEqual(ownPoints(all).map((q) => q.id), []);
  assert.equal(sketchMiddle(TOP, ownPoints(all)), undefined);
});
