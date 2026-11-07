// What's new for the build (whats-new.mjs): the numbered list and version from changelog.py, or the committed
// WHATS_NEW.md and no version when they can't be worked out, never a made-up number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { whatsNew } from "../whats-new.mjs";

const LIST = "# What's new\n\n## 0.35.42 (2026-11-08)\n\n- New.\n";
const FILE = readFileSync(new URL("../../../WHATS_NEW.md", import.meta.url), "utf8");

test("hand-worked: with the history, the script's list and version", () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args[1]]);
    return args[1] === "public" ? LIST : "0.35.42\n";
  };
  assert.deepEqual(whatsNew(run), { text: LIST, version: "0.35.42" });
  assert.deepEqual(calls, [["python3", "public"], ["python3", "version"]]);
});

test("no history, no Python or a bad answer: the committed file and no version", () => {
  const shallow = () => {
    throw new Error("this clone is shallow");
  };
  assert.deepEqual(whatsNew(shallow), { text: FILE, version: null });
  // A version that isn't one, or a list that isn't the list, is not trusted either.
  assert.deepEqual(whatsNew((_, a) => (a[1] === "public" ? LIST : "not a version\n")), { text: FILE, version: null });
  assert.deepEqual(whatsNew((_, a) => (a[1] === "public" ? "Traceback…" : "0.35.42\n")), { text: FILE, version: null });
});

test("the live build (exact) refuses to fall back: it would ship without the newest changes", () => {
  const shallow = () => {
    const e = new Error("exit 1");
    e.stdout = "this clone is shallow, so the merge order can't be read";
    throw e;
  };
  assert.throws(() => whatsNew(shallow, undefined, true), /whole history.*this clone is shallow/);
  assert.throws(() => whatsNew((_, a) => (a[1] === "public" ? LIST : "x\n"), undefined, true), /no version/);
  assert.deepEqual(whatsNew((_, a) => (a[1] === "public" ? LIST : "0.35.42\n"), undefined, true), { text: LIST, version: "0.35.42" });
});

test("the real script on this checkout gives a list that starts like the file", () => {
  const got = whatsNew();
  assert.ok(got.text.startsWith("# What's new\n"), got.text.slice(0, 40));
  if (got.version !== null) {
    assert.match(got.version, /^\d+\.\d+\.\d+$/);
    // Everything committed is still there, in the same order: the script only adds lines.
    const lines = FILE.split("\n").filter((l) => l.startsWith("- "));
    let at = -1;
    for (const line of lines) {
      const next = got.text.indexOf(line, at + 1);
      assert.ok(next > at, `kept in order: ${line}`);
      at = next;
    }
  } else assert.equal(got.text, FILE);
});
