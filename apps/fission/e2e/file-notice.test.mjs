// The yellow notice under the top bar (#file-status) used to stay until Dismiss, even after a whole new part was
// designed (Ben, 2026-11-15, after a refused STL). A notice that only reports something that went wrong right then
// (a file refused, an undo that failed) now goes away by itself: on the next change to the project, on a new project,
// or after NOTICE_SECONDS. A notice that carries a warning the person must read (unsaved work, a project that didn't
// open) stays until dismissed. Each case is worked out from that rule. The browser check is e2e/file-notice.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileNotice, NOTICE_SECONDS } from "../src/file-notice.ts";

function rig() {
  let text = "";
  const timers = new Map();
  let next = 1;
  const clock = { set: (f, ms) => (timers.set(next, { f, ms }), next++), clear: (id) => void timers.delete(id) };
  const n = fileNotice({ show: (t) => (text = t), read: () => text }, clock);
  return { n, read: () => text, timers, fire: () => { for (const [id, t] of [...timers]) { timers.delete(id); t.f(); } } };
}

test("a passing notice goes away at the next change to the project", () => {
  const { n, read } = rig();
  n.passing("Couldn't open “part.stl”: STL meshes can't be opened yet.");
  assert.match(read(), /part\.stl/);
  n.changed();
  assert.equal(read(), "");
});

test("a passing notice also goes away by itself after the time is up, and the time is 20 seconds", () => {
  assert.equal(NOTICE_SECONDS, 20);
  const { n, read, timers, fire } = rig();
  n.passing("Couldn't undo");
  assert.deepEqual([...timers.values()].map((t) => t.ms), [20_000]);
  fire();
  assert.equal(read(), "");
  void n;
});

test("a notice that must be read stays through changes and time", () => {
  const { n, read, timers, fire } = rig();
  n.sticky("The last project didn't finish opening on your last visit.");
  assert.equal(timers.size, 0);
  n.changed();
  fire();
  assert.match(read(), /didn't finish opening/);
});

test("a passing notice never takes away a different notice that replaced it", () => {
  const { n, read, fire } = rig();
  n.passing("Couldn't open “a.stl”");
  n.sticky("Projects can't be kept in this browser");
  n.changed();
  fire();
  assert.match(read(), /can't be kept/); // the sticky one was shown after; it stays
});

test("a second passing notice restarts the time, and the first one's timer cannot clear it early", () => {
  const { n, read, timers } = rig();
  n.passing("first");
  n.passing("second");
  assert.equal(timers.size, 1); // the first timer was cancelled
  assert.equal(read(), "second");
});

test("a passing notice with the same words as a later sticky one: changed() takes only what it showed as passing", () => {
  const { n, read } = rig();
  n.passing("same words");
  n.sticky("same words");
  n.changed();
  assert.equal(read(), "same words");
});

test("changed() with nothing showing does nothing, and an empty passing notice just clears", () => {
  const { n, read } = rig();
  n.changed();
  assert.equal(read(), "");
  n.passing("");
  assert.equal(read(), "");
});
