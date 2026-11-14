// The ?friends switch (src/friends-switch.ts): on for the tab with ?friends, kept through the sign-in trip, forgotten
// with ?friends=off, and never on without being asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FRIENDS_TAB_KEY, friendsSwitch } from "../src/friends-switch.ts";

const tab = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
};

test("off unless asked; ?friends turns it on for the tab, kept after the address loses it, ?friends=off forgets it", () => {
  const t = tab();
  assert.equal(friendsSwitch("", t), false);
  assert.equal(friendsSwitch("?share", t), false, "another switch is not this one");
  assert.equal(friendsSwitch("?friends", t), true);
  assert.equal(t.m.get(FRIENDS_TAB_KEY), "1");
  assert.equal(friendsSwitch("?code=abc", t), true, "back from the sign-in page");
  assert.equal(friendsSwitch("?friends=off", t), false);
  assert.equal(friendsSwitch("", t), false);
});

test("storage blocked: on only while the address has it", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(friendsSwitch("?friends", broken), true);
  assert.equal(friendsSwitch("", broken), false);
  assert.equal(friendsSwitch("?friends=off", broken), false);
  assert.equal(friendsSwitch("?friends", undefined), true);
});
