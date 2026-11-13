// SL #630: a corner where two curves meet turned over between two solves
// (point-drag.ts `cornerTurned`): a line and an arc joined smoothly that
// become a cusp (a slot's end turned inside out against its side, with the
// arc's own sweep unchanged), and, for a body edit, any corner (a sized
// rectangle mirrored past the corner it follows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { cornerTurned, MAX_SWEEP_STEP, SMOOTH_JOINT } from "../src/point-drag.ts";
import { addSketch, drawArc, drawLine } from "../src/sketch.ts";

type XY = readonly [number, number];
const sk = (d: DesignDocument, id: string): Sketch => d.sketches.find((s) => s.id === id)!;
const deg = (d: number): number => (d * Math.PI) / 180;

/** A half circle round (0, 0) from (0, −5) to (0, 5) (counter-clockwise, through (5, 0)), and a line from (0, 5) to `far`. */
function joint(): { s: Sketch; centre: string; start: string; end: string; far: string } {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const arc = drawArc(s0.doc, s0.id, [0, -5], [0, 5], [0, 0]);
  const a = sk(arc.doc, s0.id).curves.find((c) => c.id === arc.id) as { start: string; end: string; centre: string };
  const line = drawLine(arc.doc, s0.id, a.end, [-20, 5]);
  const l = sk(line.doc, s0.id).curves.find((c) => c.id === line.id) as { end: string };
  return { s: sk(line.doc, s0.id), centre: a.centre, start: a.start, end: a.end, far: l.end };
}
const places = (j: ReturnType<typeof joint>, far: XY): Map<string, XY> => new Map<string, XY>([[j.centre, [0, 0]], [j.start, [0, -5]], [j.end, [0, 5]], [j.far, far]]);

test("hand-worked: a slot's end against its side, smooth to a cusp, is turned over; a plain turn of the side is not", () => {
  const j = joint();
  // At the joint (0, 5) the arc leaves along its end's tangent, the radius (0, 5) turned a quarter right: (5, 0), so
  // it heads +x. The side to (−20, 5) leaves along (−20, 0), heading −x: opposite ways, an angle of 180°, smooth.
  // The side flipped to (20, 5) leaves heading +x, the same way as the arc: an angle of 0°, a change of 180° > 120°,
  // a cusp (the slot's end now bulges back over its side).
  assert.equal(cornerTurned(j.s, places(j, [-20, 5]), places(j, [20, 5]), true), j.end);
  assert.equal(cornerTurned(j.s, places(j, [-20, 5]), places(j, [20, 5]), false), j.end);
  // The side swung 30° about the joint, to (0, 5) + 20·(−cos 30°, sin 30°): the angle goes from 180° to 150°, a change
  // of 30°: an ordinary drag step, not turned over.
  const swung: XY = [-20 * Math.cos(deg(30)), 5 + 20 * Math.sin(deg(30))];
  assert.equal(cornerTurned(j.s, places(j, [-20, 5]), places(j, swung), true), null);
  assert.equal(MAX_SWEEP_STEP, (2 * Math.PI) / 3);
});

test("hand-worked: the flip limit's 0.9×/1.1× boundaries, and a wrap through ±180° counted the short way", () => {
  const j = joint();
  // The side leaving the joint at angle θ from +x: (0, 5) + 20·(cos θ, sin θ). The arc leaves along +x, so the corner
  // angle is −θ. From θ = 180° (smooth), a change of 0.9 × 120° = 108° is taken, 1.1 × 120° = 132° refused.
  const at = (t: number): XY => [20 * Math.cos(deg(t)), 5 + 20 * Math.sin(deg(t))];
  assert.equal(cornerTurned(j.s, places(j, at(180)), places(j, at(180 - 0.9 * 120)), true), null);
  assert.equal(cornerTurned(j.s, places(j, at(180)), places(j, at(180 - 1.1 * 120)), true), j.end);
  // 170° to 190°: the angle goes −170° to −190° = +170°, by atan2 a jump of 340°, but 20° the short way: not turned.
  assert.equal(cornerTurned(j.s, places(j, at(170)), places(j, at(190)), true), null);
});

test("hand-worked: in a drag only a joint smooth before counts, the smoothness limit's 0.9×/1.1× boundaries", () => {
  const j = joint();
  // Smooth means within SMOOTH_JOINT (30°) of opposite. The side leaving at θ = 180° − 0.9·30° = 153°: corner angle
  // −153°, 27° off straight, smooth; flipped to θ = −27° (the side reversed through the joint) the angle is +27°,
  // a change of 180°: turned. At θ = 180° − 1.1·30° = 147°, 33° off straight, a plain corner the drag carried across
  // (a change of 180° again): free in a drag, still turned over for a body edit.
  const at = (t: number): XY => [20 * Math.cos(deg(t)), 5 + 20 * Math.sin(deg(t))];
  assert.equal(SMOOTH_JOINT, Math.PI / 6);
  const smooth = 180 - 0.9 * 30;
  const plain = 180 - 1.1 * 30;
  assert.equal(cornerTurned(j.s, places(j, at(smooth)), places(j, at(smooth - 180)), true), j.end);
  assert.equal(cornerTurned(j.s, places(j, at(plain)), places(j, at(plain - 180)), true), null);
  assert.equal(cornerTurned(j.s, places(j, at(plain)), places(j, at(plain - 180)), false), j.end);
});

test("hand-worked: two lines' corner mirrored is free in a drag, turned over for a body edit", () => {
  // Lines (0, 0)–(10, 0) and (0, 0)–(0, 10): from the corner (0, 0) they leave along +x and +y, +90°. The second
  // mirrored to (0, −10): −90°, a change of 180°. No arc there, so a drag (Fusion: the user carried it) takes it.
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const one = drawLine(s0.doc, s0.id, [0, 0], [10, 0]);
  const c1 = sk(one.doc, s0.id).curves[0] as { start: string; end: string };
  const two = drawLine(one.doc, s0.id, c1.start, [0, 10]);
  const s = sk(two.doc, s0.id);
  const c2 = s.curves[1] as { end: string };
  const places = (y: number) => new Map<string, XY>([[c1.start, [0, 0]], [c1.end, [10, 0]], [c2.end, [0, y]]]);
  assert.equal(cornerTurned(s, places(10), places(-10), true), null);
  assert.equal(cornerTurned(s, places(10), places(-10), false), c1.start);
  assert.equal(cornerTurned(s, places(10), places(5), false), null);
});
