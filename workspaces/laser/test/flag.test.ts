// The ?laser switch (flag.ts): read from the address, remembered for the tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LASER_KEY, readLaserFlag } from "../src/flag.ts";

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

test("?laser turns it on and remembers it; ?laser=off forgets it; no laser keeps what the tab said", () => {
  const s = store();
  assert.equal(readLaserFlag("", s), false);
  assert.equal(readLaserFlag("?laser", s), true);
  assert.equal(s.m.get(LASER_KEY), "on");
  assert.equal(readLaserFlag("", s), true);
  assert.equal(readLaserFlag("?laser=off", s), false);
  assert.equal(readLaserFlag("", s), false);
});

test("after the #, forgiving slashes and capitals; the part before the # wins; other values are ignored", () => {
  assert.equal(readLaserFlag("", store(), "#laser?laser"), true);
  assert.equal(readLaserFlag("?Laser/", store()), true);
  assert.equal(readLaserFlag("?laser=off", store(), "#laser?laser"), false);
  assert.equal(readLaserFlag("?laser=maybe", store()), false);
  assert.equal(readLaserFlag("?lasers", store()), false);
});

test("a store that throws counts as empty and the address alone decides", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  const bad = { getItem: blocked, setItem: blocked, removeItem: blocked };
  assert.equal(readLaserFlag("?laser", bad), true);
  assert.equal(readLaserFlag("", bad), false);
});
