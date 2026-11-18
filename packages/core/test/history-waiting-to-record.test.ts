// SL #708 item 1 (flat stress hunt 2026-11-13): held work that has recorded nothing yet (an OK the kernel still
// checks) is told apart from a settle held after its step was recorded, so the shell asks before the page goes only
// when leaving would lose what was asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../src/model/history.ts";

const tick = () => new Promise((r) => setImmediate(r));

test("an OK held unrecorded is waiting to record until it settles either way; a settle held after its step is not", async () => {
  const h = createHistory({ capture: () => "s", restore: () => {} });
  assert.equal(h.waitingToRecord(), false, "nothing held");
  let settleDone!: () => void;
  void h.hold(new Promise<void>((r) => (settleDone = r)));
  assert.equal(h.busy(), true);
  assert.equal(h.waitingToRecord(), false, "a settle: its step is recorded already");
  let okDone!: () => void;
  let okRefused!: (e: Error) => void;
  void h.hold(new Promise<void>((r) => (okDone = r)), true);
  const refused = h.hold(new Promise<void>((_, j) => (okRefused = j)), true);
  refused.catch(() => {});
  assert.equal(h.waitingToRecord(), true, "two OKs still checked");
  okDone();
  await tick();
  assert.equal(h.waitingToRecord(), true, "one OK still checked");
  okRefused(new Error("refused"));
  await tick();
  assert.equal(h.waitingToRecord(), false, "a refused OK holds nothing either");
  assert.equal(h.busy(), true, "the settle still held");
  settleDone();
  await tick();
  assert.equal(h.busy(), false);
});

test("onBusy is told when an unrecorded hold starts and ends, so the shell can ask or stop asking", async () => {
  const h = createHistory({ capture: () => "s", restore: () => {} });
  const seen: boolean[] = [];
  h.onBusy(() => seen.push(h.waitingToRecord()));
  let done!: () => void;
  void h.hold(new Promise<void>((r) => (done = r)), true);
  done();
  await tick();
  assert.deepEqual(seen, [true, false]);
});
