// Bug hunt 2026-11-18 C-2: the reasons a part pair "couldn't be checked" (overlap.ts) reach the person through page.ts
// pairWords ("Couldn't check whether A and B overlap: <why>."), so they never name the kernel and never start a clause
// with an "it" that names nothing. The paths that give them are rare (a doubt in the kernel's regions), so the words are
// read from the source: every string handed on as a `why`, to `Unknown` or to `unknown(`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/overlap.ts", import.meta.url), "utf8");
/** The string literals in the person's reasons: after `why: `, `new Unknown(`, `unknown(` and in the ternary feeding one. */
function reasons(text: string): string[] {
  const out: string[] = [];
  const literal = /(?:why:\s*(?:[^"`?]*\?\?\s*)?|new Unknown\(|unknown\(|\?\s*|:\s*)(["`])((?:\\.|(?!\1).)*)\1/g;
  for (const line of text.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*\*)/.test(line)) continue; // comments are for us
    if (!/why|Unknown|unknown\(/.test(line) && !/^\s*[?:]\s*["`]/.test(line)) continue;
    for (const m of line.matchAll(literal)) if (m[2].includes(" ")) out.push(m[2]);
  }
  return out;
}

test("the reasons found are the ones the hunt read (the reader works)", () => {
  const all = reasons(source);
  assert.ok(all.length >= 6, `found ${all.length}: ${JSON.stringify(all)}`);
  assert.ok(all.some((w) => /region/.test(w)));
});

test("no reason a person reads names the kernel or starts a clause with an unexplained 'it'", () => {
  for (const w of reasons(source)) {
    assert.doesNotMatch(w, /\bkernel/i, w);
    assert.doesNotMatch(w, /\band it can't\b/, w);
  }
});
