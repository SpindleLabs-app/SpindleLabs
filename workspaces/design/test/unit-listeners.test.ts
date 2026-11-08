// @ts-nocheck
// #197: the panels that follow the chosen unit (followUnit) share one page listener. Before, each panel added a
// listener of its own, taken off only at the next unit change, so a long session without one piled them up: the
// nightly soak (seed 1) counted 807 listeners by cycle 15, 920 at 20 and 1816 at 60, about 13 more a cycle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { followUnit } from "../src/properties.ts";

const { Window } = await import("happy-dom");

/** A fresh page whose unitchange listeners are counted as they are added and taken off. */
function page() {
  const doc = new Window().document as unknown as Document;
  let listening = 0;
  const add = doc.addEventListener.bind(doc);
  const remove = doc.removeEventListener.bind(doc);
  doc.addEventListener = (type, fn, o) => {
    if (type === "unitchange") listening++;
    add(type, fn, o);
  };
  doc.removeEventListener = (type, fn, o) => {
    if (type === "unitchange") listening--;
    remove(type, fn, o);
  };
  const Ev = (doc.defaultView as unknown as { Event: typeof Event }).Event;
  return { doc, listening: () => listening, change: () => doc.dispatchEvent(new Ev("unitchange")) };
}

test("a thousand panels following the unit add one listener to the page, not a thousand", () => {
  const p = page();
  const kept = [];
  for (let i = 0; i < 1000; i++) {
    const onUnit = () => true;
    kept.push(onUnit); // held, as a panel holds its own
    followUnit(p.doc, onUnit);
  }
  assert.equal(p.listening(), 1);
  // Another page has a listener of its own.
  const q = page();
  followUnit(q.doc, () => true);
  assert.equal(q.listening(), 1);
});

test("a unit change calls each follower until it says it is no longer wanted, then never again", () => {
  const p = page();
  const calls = { a: 0, b: 0, c: 0 };
  let bWanted = true;
  const a = () => (calls.a++, true);
  const b = () => (calls.b++, bWanted);
  const c = () => (calls.c++, true);
  for (const f of [a, b, c]) followUnit(p.doc, f);
  p.change();
  assert.deepEqual(calls, { a: 1, b: 1, c: 1 });
  bWanted = false; // b's panel was filled again: it answers false once more and is dropped
  p.change();
  p.change();
  assert.deepEqual(calls, { a: 3, b: 2, c: 3 });
  // A follower added after a change is called from the next one on.
  const d = () => true;
  let dCalls = 0;
  followUnit(p.doc, () => (dCalls++, d()));
  p.change();
  assert.equal(dCalls, 1);
  assert.equal(p.listening(), 1);
});
