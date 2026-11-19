// The sketch's Undo fence against the undo limit (TypeScript mutants, issue #421: history.ts dropEntry's floor check had
// no test). When the oldest step is dropped to keep the history within its limit, the fence's floor moves only when the
// dropped step IS the floor; any other dropped step leaves the floor where it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../src/model/history.ts";

function make(limit: number) {
  let project = "S0";
  let t = 0;
  const h = createHistory({ limit, capture: () => project, restore: (s) => void (project = s), now: () => (t += 5000) });
  const step = (p: string) => {
    project = p;
    assert.equal(h.record(`to ${p}`), true);
  };
  return { h, step, get: () => project };
}

test("hand-worked: the oldest step dropped by the limit is not the fence's floor, so Undo still stops at the fence", () => {
  const { h, step, get } = make(5);
  step("S1");
  step("S2");
  h.fence(); // a sketch opened at S2: Undo may go back to S2 and no further
  step("S3");
  step("S4");
  step("S5");
  // Hand working: entries were S0..S5 (6 = limit + 1, none dropped); S6 makes 7, so S0, the oldest, is dropped.
  // S0 is not the floor (S2 is), so the floor stays S2: undo walks S6 -> S5 -> S4 -> S3 -> S2 and stops, 4 undos.
  step("S6");
  let undos = 0;
  while (h.undo() !== null) undos++;
  assert.equal(get(), "S2", "Undo went back past the sketch's start");
  assert.equal(undos, 4);
  assert.equal(h.canUndo(), false);
});

test("hand-worked: the fence's floor itself dropped by the limit moves to the oldest step kept", () => {
  const { h, step, get } = make(3);
  h.fence(); // fenced at S0, the oldest
  step("S1");
  step("S2");
  step("S3");
  // Hand working: S0..S3 is 4 = limit + 1; S4 makes 5, so S0, the floor, is dropped and the floor becomes S1, the oldest
  // kept. Undo walks S4 -> S3 -> S2 -> S1: 3 undos, then nothing older is left.
  step("S4");
  let undos = 0;
  while (h.undo() !== null) undos++;
  assert.equal(get(), "S1");
  assert.equal(undos, 3);
});
