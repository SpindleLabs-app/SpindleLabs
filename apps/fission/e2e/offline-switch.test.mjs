// The ?offline switch (src/offline-switch.ts): offline mode stays off for everyone, but `?offline` turns it on for this
// browser (remembered), `?offline=off` turns it off again, and no switch in the address keeps what was remembered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFLINE_KEY, offlineChosen } from "../src/offline-switch.ts";

const store = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k), items };
};

test("off by default: no switch, nothing remembered", () => {
  const s = store();
  assert.equal(offlineChosen("", s), false);
  assert.equal(offlineChosen("?test-hooks&combine", s), false);
  assert.equal(s.items.size, 0, "nothing written without the switch");
});

test("?offline turns it on and remembers it, so the next visit without the switch is still on", () => {
  const s = store();
  assert.equal(offlineChosen("?offline", s), true);
  assert.equal(s.items.get(OFFLINE_KEY), "on");
  assert.equal(offlineChosen("", s), true, "an installed app opens without the switch in its address");
  assert.equal(offlineChosen("?offline=on", store()), true);
  assert.equal(offlineChosen("?combine&offline", store()), true, "beside other switches");
});

test("?offline=off turns it off and forgets it", () => {
  const s = store();
  offlineChosen("?offline", s);
  assert.equal(offlineChosen("?offline=off", s), false);
  assert.equal(s.items.has(OFFLINE_KEY), false);
  assert.equal(offlineChosen("", s), false);
  assert.equal(offlineChosen("?offline=OFF", store()), false, "any case");
});

test("a remembered value other than on is off (a broken or old entry never turns it on)", () => {
  const s = store();
  s.items.set(OFFLINE_KEY, "yes");
  assert.equal(offlineChosen("", s), false);
});

test("storage blocked: the switch lasts as long as the address has it", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(offlineChosen("?offline", blocked), true);
  assert.equal(offlineChosen("", blocked), false);
  assert.equal(offlineChosen("?offline=off", blocked), false);
  assert.equal(offlineChosen("?offline", undefined), true);
});
