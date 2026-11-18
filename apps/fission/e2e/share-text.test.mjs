// The share export of a sharing link (src/share-text.ts): the project text goes through the open format's stripForShare()
// and comes out unchanged (a share export changes no byte of the history part, spec section 16); text that isn't a plain
// project is refused with words, never shared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { textForShare } from "../src/share-text.ts";

const SAVED = readFileSync(new URL("./saved.spindle", import.meta.url), "utf8");

test("a real saved project comes out byte for byte the same", async () => {
  assert.equal(await textForShare(SAVED), SAVED);
});

test("hand-worked: a small project with accents and a long line is kept exactly (UTF-8 in, same text out)", async () => {
  const text = '{"formatVersion":1,"name":"Wöhler bracket – 3 mm"}';
  assert.equal(await textForShare(text), text);
});

test("deliberate breaks: text that is not a plain project is refused in words, naming nothing shared", async () => {
  for (const bad of ["", "not json", '{"name":"no version"}', '{"formatVersion":1,"formatVersion":2}', "[]"]) {
    await assert.rejects(() => textForShare(bad), /can't be prepared for sharing.*Nothing was shared/, JSON.stringify(bad));
  }
});
