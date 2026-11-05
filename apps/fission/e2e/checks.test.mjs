// checks.mjs: `npm run e2e` finds its browser checks by reading e2e/, so a
// check can never be left out of CI by a forgotten package.json line, and a
// helper module is never run as if it were a check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { allChecks, checkCommands, ELSEWHERE, FIRST, HELPERS, importsTypeScript } from "./checks.mjs";

const here = new URL("./", import.meta.url);
const sources = Object.fromEntries(
  readdirSync(here).filter((f) => f.endsWith(".mjs")).map((f) => [f, readFileSync(new URL(f, here), "utf8")]),
);
const fileOf = (command) => command.slice(command.lastIndexOf("/") + 1);

test("hand-worked: a folder of checks, tests, helpers and files run elsewhere", () => {
  // The folder holds zeta, smoke, alpha (which imports TypeScript), a test, a
  // helper (browser.mjs), the runner (shard.mjs), a seed file and a picture.
  // Kept: alpha, smoke, zeta. smoke goes first, then alpha before zeta by
  // name; alpha imports "./x.ts", so it runs with type stripping.
  const files = ["zeta.mjs", "smoke.mjs", "alpha.mjs", "zeta.test.mjs", "browser.mjs", "shard.mjs", "plate.spindle", "shot.png"];
  const source = { "alpha.mjs": 'import { solve } from "../../packages/core/src/x.ts";' };
  assert.deepEqual(checkCommands(files, (f) => source[f] ?? 'import { launch } from "./browser.mjs";'), [
    "node e2e/smoke.mjs",
    "node --experimental-strip-types --no-warnings e2e/alpha.mjs",
    "node e2e/zeta.mjs",
  ]);
  // A file added to the folder is a check from then on, with no list to edit.
  assert.deepEqual(checkCommands([...files, "new-check.mjs"], () => "").map(fileOf), ["smoke.mjs", "alpha.mjs", "new-check.mjs", "zeta.mjs"]);
});

test("a TypeScript import is told from a JavaScript one", () => {
  for (const yes of ['import { a } from "./a.ts";', "import {a} from '../b/c.ts'", 'const m = await import("./m.ts");', 'import "./side.ts";'])
    assert.equal(importsTypeScript(yes), true, yes);
  for (const no of ['import { a } from "./a.mjs";', 'import { a } from "./a.tsx.mjs";', "// a .ts file", 'const name = "./notes.ts.txt";', ""])
    assert.equal(importsTypeScript(no), false, no);
});

test("the checks found in e2e/ start with smoke, are sorted, exist, and leave out tests, helpers and the rest", () => {
  const all = allChecks();
  const names = all.map(fileOf);
  assert.ok(names.length >= 90, `only ${names.length} checks found`);
  assert.equal(names[0], FIRST);
  assert.deepEqual(names.slice(1), [...names.slice(1)].sort(), "the checks after smoke are not in name order");
  for (const n of names) assert.ok(existsSync(new URL(n, here)), n);
  for (const n of [...HELPERS, ...Object.keys(ELSEWHERE)]) assert.equal(names.includes(n), false, `${n} is run as a check`);
  assert.equal(names.some((n) => n.endsWith(".test.mjs")), false);
  // Named by hand, not read from the lists above: the 40-minute soak, the
  // plants (each breaks the app on purpose), scratch shots, the runner and
  // the launcher must never run in CI's e2e shares.
  for (const n of ["soak.mjs", "soak-plants.mjs", "monkey-plants.mjs", "_shots.mjs", "shard.mjs", "checks.mjs", "browser.mjs"])
    assert.equal(names.includes(n), false, `${n} is run as a check`);
  // The two checks known to import TypeScript keep their flags.
  for (const n of ["sketch-session.mjs", "journeys.mjs"])
    assert.ok(all.includes(`node --experimental-strip-types --no-warnings e2e/${n}`), n);
  assert.ok(all.includes("node e2e/smoke.mjs"));
});

test("every file left out still exists, and every helper is still imported by another file here", () => {
  for (const f of [...HELPERS, ...Object.keys(ELSEWHERE)]) assert.ok(f in sources, `${f} is listed but gone`);
  for (const h of HELPERS) {
    const users = Object.keys(sources).filter((f) => f !== h && sources[f].includes(`"./${h}"`));
    assert.ok(users.length > 0, `${h} is a helper no file imports: a check now, or deleted?`);
  }
});

test("a module other checks import is a helper, so it is not run as a check by mistake", () => {
  // offline.mjs is a check that offline-off.mjs also imports (it runs the same
  // pages with offline mode off), so it is the one check allowed here.
  const importedChecks = new Set(["offline.mjs"]);
  const checks = new Set(allChecks().map(fileOf));
  for (const [f, src] of Object.entries(sources)) {
    for (const m of src.matchAll(/from\s*["']\.\/([a-z0-9_-]+\.mjs)["']/g)) {
      if (checks.has(m[1]) && !importedChecks.has(m[1])) assert.fail(`${f} imports ${m[1]}, which is run as a check: add it to HELPERS`);
    }
  }
});
