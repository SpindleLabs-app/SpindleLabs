// `noTurn` (timeline-model.ts, SL #404): a face sketch's turn since drawn that is none but for
// rounding gives the same solid as none, so `bodyKeys` gives it the same shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_TURN, noTurn } from "../src/timeline-model.ts";

test("noTurn, hand-worked: none, rounding, and the boundary at 0.9× and 1.1× of NO_TURN", () => {
  // No turn: x stays along (1, 0) and the origin stays at (0, 0).
  assert.ok(noTurn({ x: [1, 0], at: [0, 0] }));
  // SL #404's turn: two Moves' motions composed (180° about (-1, 19) then a shift) and taken apart again leave
  // 3.55e-15 mm, about 16 ulps of 20 mm: rounding.
  assert.ok(noTurn({ x: [1, 0], at: [3.552713678800501e-15, 0] }));
  // A half turn is a turn: cos 180° = -1, sin 180° = 0 (to rounding).
  assert.ok(!noTurn({ x: [Math.cos(Math.PI), Math.sin(Math.PI)], at: [0, 0] }));
  for (const k of [0, 1] as const) {
    const at = (d: number): [number, number] => (k === 0 ? [d, 0] : [0, d]);
    const x = (d: number): [number, number] => (k === 0 ? [1 - d, 0] : [1, d]);
    assert.ok(noTurn({ x: [1, 0], at: at(0.9 * NO_TURN) }), `a shift of 0.9 × NO_TURN along ${k} is none`);
    assert.ok(!noTurn({ x: [1, 0], at: at(1.1 * NO_TURN) }), `a shift of 1.1 × NO_TURN along ${k} is a shift`);
    assert.ok(!noTurn({ x: [1, 0], at: at(-1.1 * NO_TURN) }), `a shift of -1.1 × NO_TURN along ${k} is a shift`);
    assert.ok(noTurn({ x: x(0.9 * NO_TURN), at: [0, 0] }), `x off by 0.9 × NO_TURN in part ${k} is none`);
    assert.ok(!noTurn({ x: x(1.1 * NO_TURN), at: [0, 0] }), `x off by 1.1 × NO_TURN in part ${k} is a turn`);
  }
  // Far below the kernel's 10 nm (1e-5 mm), so no solid it calls the same is told apart by it.
  assert.ok(NO_TURN < 1e-5 / 1000);
});
