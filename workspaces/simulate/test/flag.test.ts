// The ?testlab switch (flag.ts): read from the address, remembered for the tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TESTLAB_KEY, readTestLabFlag } from "../src/flag.ts";

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

test("?testlab turns it on and remembers it; ?testlab=off forgets it; no testlab keeps what the tab said", () => {
  const s = store();
  assert.equal(readTestLabFlag("", s), false);
  assert.equal(readTestLabFlag("?testlab", s), true);
  assert.equal(s.m.get(TESTLAB_KEY), "on");
  assert.equal(readTestLabFlag("", s), true);
  assert.equal(readTestLabFlag("?testlab=off", s), false);
  assert.equal(readTestLabFlag("", s), false);
});

test("after the #, forgiving slashes and capitals; the part before the # wins; other values are ignored", () => {
  assert.equal(readTestLabFlag("", store(), "#simulate?testlab"), true);
  assert.equal(readTestLabFlag("?Testlab/", store()), true);
  assert.equal(readTestLabFlag("?testlab=off", store(), "#simulate?testlab"), false);
  assert.equal(readTestLabFlag("?testlab=maybe", store()), false);
  assert.equal(readTestLabFlag("?testlabs", store()), false);
});

test("a store that throws counts as empty and the address alone decides", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  const bad = { getItem: blocked, setItem: blocked, removeItem: blocked };
  assert.equal(readTestLabFlag("?testlab", bad), true);
  assert.equal(readTestLabFlag("", bad), false);
});
