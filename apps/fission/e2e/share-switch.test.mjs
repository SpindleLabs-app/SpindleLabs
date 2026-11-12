// The ?share switch (src/share-switch.ts): sharing links stay off unless the address has `?share` (or this tab had it,
// for the trip to the sign-in page and back); `?share=<id>` names a link only when it is a real link id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHARE_TAB_KEY, shareSwitch } from "../src/share-switch.ts";

const ID = "10000000-0000-4000-8000-00000000abcd";
const tab = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), items };
};

test("off with no switch, in a tab that never had it", () => {
  assert.deepEqual(shareSwitch("", tab()), { on: false, id: null });
  assert.deepEqual(shareSwitch("?combine&s=" + ID, tab()), { on: false, id: null }, "another name for the id is not the switch");
});

test("?share turns it on and is remembered for the tab; the link is named only by ?share=<id>", () => {
  const t = tab();
  assert.deepEqual(shareSwitch("?share", t), { on: true, id: null });
  assert.equal(t.items.get(SHARE_TAB_KEY), "1");
  assert.deepEqual(shareSwitch("", t), { on: true, id: null }, "back from the sign-in page, the address has lost it");
  assert.deepEqual(shareSwitch(`?share=${ID}`, tab()), { on: true, id: ID });
  assert.deepEqual(shareSwitch("?share=", tab()), { on: true, id: null }, "the cleaned address keeps the switch, drops the link");
});

test("a value that is not a link id names no link (so nothing is asked of the service)", () => {
  for (const bad of ["1", "../x", ID.toUpperCase(), ID.slice(1), `${ID}0`, "10000000-0000-4000-8000-00000000abcg"]) assert.equal(shareSwitch(`?share=${bad}`, tab()).id, null, bad);
});

test("storage that refuses changes nothing but the memory", () => {
  const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
  assert.deepEqual(shareSwitch("?share", broken), { on: true, id: null });
  assert.deepEqual(shareSwitch("", broken), { on: false, id: null });
});
