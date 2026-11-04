// The press guard (press-guard.ts): presses closer than REPEAT_MS to the one before are one burst.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REPEAT_MS, repeatGuard } from "../src/press-guard.ts";

/** A clock the test sets. */
function clock() {
  const c = { t: 0, now: () => c.t };
  return c;
}

test("hand-worked: a double-click 120 ms apart is one press; a press 2 s later is taken", () => {
  const c = clock();
  const repeat = repeatGuard(c.now);
  c.t = 1000;
  assert.equal(repeat(), false, "the first press ever is meant");
  c.t = 1120;
  assert.equal(repeat(), true, "120 ms after it: under 500 ms, the same double-click");
  c.t = 3120;
  assert.equal(repeat(), false, "2,000 ms after the last press: meant");
});

test("boundary: 0.9 × REPEAT_MS after a press is a repeat, 1.1 × is meant", () => {
  const c = clock();
  const repeat = repeatGuard(c.now);
  repeat();
  c.t = 0.9 * REPEAT_MS;
  assert.equal(repeat(), true);
  c.t += 1.1 * REPEAT_MS;
  assert.equal(repeat(), false);
});

test("hand-worked: Enter held for 2 s (a repeat every 33 ms) is one press, since each repeat restarts the wait", () => {
  // 61 presses at 0, 33, … 1,980 ms: every gap is 33 ms < 500 ms, so only the first is meant. Were the wait counted from
  // the last press taken instead, presses at 528 ms (the first ≥ 500), 1,056 and 1,584 would be taken too: 4 saves.
  const c = clock();
  const repeat = repeatGuard(c.now);
  let taken = 0;
  for (c.t = 0; c.t <= 2000; c.t += 33) if (!repeat()) taken++;
  assert.equal(taken, 1);
});

test("ten presses 150 ms apart, then a pause of 600 ms: one press, then one more", () => {
  const c = clock();
  const repeat = repeatGuard(c.now);
  const answers: boolean[] = [];
  for (let i = 0; i < 10; i++, c.t += 150) answers.push(repeat());
  c.t += 450; // the last press was at 1,350 ms; now 1,950 ms, 600 ms later
  answers.push(repeat());
  assert.deepEqual(answers.map((r) => !r), [true, false, false, false, false, false, false, false, false, false, true]);
});

test("two guards don't share their presses: Save's double-click leaves Slice's first press meant", () => {
  const c = clock();
  const save = repeatGuard(c.now);
  const go = repeatGuard(c.now);
  save();
  c.t = 100;
  assert.equal(go(), false);
  assert.equal(save(), true);
});

test("reset lets the next press through at once: a choice changed after a slice asks for a new file", () => {
  const c = clock();
  const go = repeatGuard(c.now);
  go(); // Slice and download
  c.t = 200;
  assert.equal(go(), true, "a second press 200 ms later is the same one");
  go.reset(); // a choice changed at 250 ms
  c.t = 300;
  assert.equal(go(), false, "the press after a change is meant, 100 ms after the last press");
  c.t = 400;
  assert.equal(go(), true, "and the guard holds again after it");
});
