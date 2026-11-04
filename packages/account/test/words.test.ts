import { test } from "node:test";
import assert from "node:assert/strict";
import { FAILURE_WORDS } from "../src/words.ts";

test("every way a sign-in can fail has its own plain sentence", () => {
  const reasons = ["cancelled", "expired", "offline", "unavailable", "rejected", "malformed", "storage"];
  assert.deepEqual(Object.keys(FAILURE_WORDS).sort(), [...reasons].sort());
  const sentences = Object.values(FAILURE_WORDS);
  assert.equal(new Set(sentences).size, sentences.length);
  for (const s of sentences) assert.match(s, /^[A-Z].*\.$/);
  assert.match(FAILURE_WORDS.offline, /internet/);
  assert.match(FAILURE_WORDS.cancelled, /without an account/);
});
