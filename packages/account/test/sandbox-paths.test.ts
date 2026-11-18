// Mutation testing runs this package's tests from a copy in
// packages/account/.stryker-tmp/sandbox-*/, so a fixed "../../../" path to a
// file outside the package (the migrations, the Supabase functions, the app)
// points inside the copy, the file isn't there, and the whole nightly
// account mutation run stops before it starts (SpindleLabs #199, 2026-11-11:
// names.test.ts read a migration and my-designs-app.test.ts imported the app
// that way). Such files are found with repoFile() instead; a "../../../" path
// is fine only in a type (`typeof import(...)`), which never runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/** The lines of `text` that reach outside the package by a fixed path at run time, as "line: text". */
export function fixedPathsOut(text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // a comment never runs
    const runtime = line.replace(/typeof import\(\s*["'][^"']*["']\s*\)/g, "");
    if (/["'](\.\.\/){3,}/.test(runtime)) out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

test("no test of this package reaches outside it by a fixed ../../../ path at run time", () => {
  const dir = new URL("./", import.meta.url);
  const bad: string[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".ts") && n !== "sandbox-paths.test.ts").sort()) {
    for (const hit of fixedPathsOut(readFileSync(new URL(name, dir), "utf8"))) bad.push(`${name}:${hit}`);
  }
  assert.deepEqual(bad, [], "use repoFile() from ./repo-file.ts for these");
});

test("the check finds each way a fixed path breaks the copy, and lets types and repoFile() through", () => {
  // The two lines that stopped the 2026-11-11 run, as they were.
  assert.equal(fixedPathsOut(`  const sql = readFileSync(new URL("../../../supabase/migrations/x.sql", import.meta.url), "utf8");`).length, 1);
  assert.equal(fixedPathsOut(`const app = await import("../../../apps/fission/src/my-designs.ts");`).length, 1);
  // Deeper still, and with single quotes.
  assert.equal(fixedPathsOut(`import x from '../../../../y.ts';`).length, 1);
  // A type-only fixed path never runs; repoFile() and in-package paths are fine.
  assert.deepEqual(fixedPathsOut(`const m = (await import(repoFile("supabase/functions/billing/index.ts").href)) as typeof import("../../../supabase/functions/billing/index.ts");`), []);
  assert.deepEqual(fixedPathsOut(`// than by a fixed "../../../": mutation testing runs these tests from a copy`), []);
  assert.deepEqual(fixedPathsOut(`import { designsApi } from "../src/designs.ts";`), []);
  assert.deepEqual(fixedPathsOut(`import { x } from "../../core/src/y.ts";`), []);
});
