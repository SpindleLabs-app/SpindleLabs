// shard.mjs: the split of `npm run e2e` across CI's parallel jobs must run
// every browser check exactly once, so a check can never drop out of CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileOf, refusal, shares, UNKNOWN } from "./shard.mjs";
import { allChecks } from "./checks.mjs";

test("a share refuses to run with ONLY set (it would skip whole files' checks and pass)", () => {
  assert.equal(refusal({}), null);
  assert.equal(refusal({ ONLY: "" }), null);
  assert.match(refusal({ ONLY: "phone" }), /ONLY is set \("phone"\)/);
  // The real script: red before it runs anything.
  const r = spawnSync(process.execPath, [new URL("./shard.mjs", import.meta.url).pathname, "1", "1"], {
    env: { ...process.env, ONLY: "phone" },
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ONLY is set/);
  assert.doesNotMatch(r.stdout, /e2e share/);
});

test("shares are dealt longest first onto the lightest share, worked by hand", () => {
  const cmds = ["node e2e/a.mjs", "node e2e/b.mjs", "node e2e/c.mjs", "node e2e/d.mjs"];
  // Costs a 10, b 6, c 5, d 4, dealt in that order: a onto share 1 (10, 0),
  // b onto the empty share 2 (10, 6), c onto share 2 (10, 11), d onto share 1
  // (14, 11). Each share keeps the package.json order.
  assert.deepEqual(shares(cmds, 2, { "a.mjs": 10, "b.mjs": 6, "c.mjs": 5, "d.mjs": 4 }), [
    ["node e2e/a.mjs", "node e2e/d.mjs"],
    ["node e2e/b.mjs", "node e2e/c.mjs"],
  ]);
  // Unlisted checks all cost UNKNOWN, so ties go to the earlier share: x, y, z
  // into two shares is x onto 1, y onto 2, z onto 1 (both at UNKNOWN, first wins).
  assert.deepEqual(shares(["node e2e/x.mjs", "node e2e/y.mjs", "node e2e/z.mjs"], 2, {}), [
    ["node e2e/x.mjs", "node e2e/z.mjs"],
    ["node e2e/y.mjs"],
  ]);
  assert.equal(UNKNOWN > 0, true);
});

test("every browser check lands in exactly one share, for 1 to 8 shares", () => {
  const all = allChecks();
  assert.ok(all.length >= 20, `only ${all.length} checks found in e2e/`);
  for (const p of all) assert.ok(existsSync(new URL(fileOf(p), import.meta.url)), `${p} names no file`);
  assert.equal(new Set(all).size, all.length, "a check is found twice");
  for (let n = 1; n <= 8; n++) {
    const split = shares(all, n);
    assert.equal(split.length, n);
    assert.deepEqual(split.flat().sort(), [...all].sort(), `${n} shares lose or repeat a check`);
    for (const s of split) assert.deepEqual(s, all.filter((c) => s.includes(c)), "a share changed the order");
    if (n <= 4) for (const s of split) assert.ok(s.length > 0, `an empty share at ${n}`);
  }
  assert.deepEqual(shares(all, 1)[0], all);
});

test("npm run e2e runs all of the checks through this runner, in one share", () => {
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
  assert.equal(scripts.e2e, "node e2e/shard.mjs 1 1");
  for (const n of [0, -1, 1.5, NaN]) assert.throws(() => shares(["node e2e/a.mjs"], n), /shard count/);
});
