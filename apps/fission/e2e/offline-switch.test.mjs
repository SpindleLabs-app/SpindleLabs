// The ?offline switch (src/offline-switch.ts): offline mode stays off for everyone, and a browser keeps the app for
// offline use only once the person presses Keep in the app. The address only asks (security hunt 2026-11-13 G2: a
// stranger's link or pop-up switched it on for good), `?offline=off` only asks to stop, and no switch in the address
// keeps what was remembered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFLINE_KEY, forgetOffline, keepOffline, offlineSwitch } from "../src/offline-switch.ts";

const store = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k), items };
};
const kept = () => {
  const s = store();
  s.items.set(OFFLINE_KEY, "on");
  return s;
};

test("off by default: no switch, nothing remembered, nothing asked", () => {
  const s = store();
  assert.deepEqual(offlineSwitch("", s), { chosen: false, ask: null });
  assert.deepEqual(offlineSwitch("?test-hooks&combine", s), { chosen: false, ask: null });
  assert.equal(s.items.size, 0, "nothing written without the switch");
});

test("G2: ?offline alone only asks; nothing is remembered until Keep is pressed", () => {
  const s = store();
  assert.deepEqual(offlineSwitch("?offline", s), { chosen: false, ask: "keep" });
  assert.equal(s.items.size, 0, "a link (or another site's pop-up) writes nothing");
  assert.deepEqual(offlineSwitch("", s), { chosen: false, ask: null }, "so the next plain visit is still off");
  assert.deepEqual(offlineSwitch("?offline=on", store()), { chosen: false, ask: "keep" });
  assert.deepEqual(offlineSwitch("?combine&offline", store()), { chosen: false, ask: "keep" }, "beside other switches");
  assert.deepEqual(offlineSwitch("?offline=ON", store()), { chosen: false, ask: "keep" }, "any case");
});

test("Keep remembers it, so the next visit without the switch is on and ?offline asks nothing more", () => {
  const s = store();
  assert.equal(keepOffline(s), true);
  assert.equal(s.items.get(OFFLINE_KEY), "on");
  assert.deepEqual(offlineSwitch("", s), { chosen: true, ask: null }, "an installed app opens without the switch in its address");
  assert.deepEqual(offlineSwitch("?offline", s), { chosen: true, ask: null });
});

test("?offline=off only asks while it is on; Remove forgets it", () => {
  const s = kept();
  assert.deepEqual(offlineSwitch("?offline=off", s), { chosen: true, ask: "remove" });
  assert.equal(s.items.get(OFFLINE_KEY), "on", "a link never removes it either");
  assert.deepEqual(offlineSwitch("?offline=OFF", kept()), { chosen: true, ask: "remove" }, "any case");
  forgetOffline(s);
  assert.equal(s.items.has(OFFLINE_KEY), false);
  assert.deepEqual(offlineSwitch("", s), { chosen: false, ask: null });
  assert.deepEqual(offlineSwitch("?offline=off", store()), { chosen: false, ask: null }, "already off: nothing to ask");
});

test("a remembered value other than on is off (a broken or old entry never turns it on)", () => {
  const s = store();
  s.items.set(OFFLINE_KEY, "yes");
  assert.deepEqual(offlineSwitch("", s), { chosen: false, ask: null });
  assert.deepEqual(offlineSwitch("?offline", s), { chosen: false, ask: "keep" });
});

test("storage blocked: never on, ?offline still asks, and Keep says it could not keep it", () => {
  const boom = () => {
    throw new Error("blocked");
  };
  const blocked = { getItem: boom, setItem: boom, removeItem: boom };
  assert.deepEqual(offlineSwitch("", blocked), { chosen: false, ask: null });
  assert.deepEqual(offlineSwitch("?offline", blocked), { chosen: false, ask: "keep" });
  assert.deepEqual(offlineSwitch("?offline=off", blocked), { chosen: false, ask: null });
  assert.equal(keepOffline(blocked), false);
  assert.equal(keepOffline(undefined), false);
  forgetOffline(blocked); // never throws
  assert.deepEqual(offlineSwitch("?offline", undefined), { chosen: false, ask: "keep" });
});
