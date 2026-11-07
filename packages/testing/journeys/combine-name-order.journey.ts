// Journey: Design's timeline on the real kernel against the timeline model, replaying the sessions the nightly
// edit-past-features hunt saved (2026-11-07, SL #430 and #431). Both failed on the model's name order for a Combine of
// a body with one that already holds a copy of its faces' names (a kept tool joined in, then used again); no shape
// was wrong. Each replays step for step and must pass every check. The rule itself is hand-worked in
// test/boolean-naming-origin.test.ts. Also SL #360's seed 11: a refused Combine of a body with its own Duplicate must hold the second kernel body it
// made, so the next rebuild builds nothing new (rebuild.ts combineRun).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { nodeKernel } from "../src/node-kernel.ts";
import { runSession, type SessionOp } from "../src/timeline-session.ts";
import { designSubject, edgeMatches } from "../src/timeline-design.ts";

const SAVED = new URL("../test/regressions/timeline-design/", import.meta.url);

test("saved Design sessions (SL #430, #431) replay against the model and pass", async () => {
  const kernel = nodeKernel();
  const files = readdirSync(SAVED).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 2, "both saved sessions are there");
  for (const file of files) {
    const saved: { seed: string; steps: SessionOp[] } = JSON.parse(readFileSync(new URL(file, SAVED), "utf8"));
    const subject = designSubject(kernel, []);
    try {
      await assert.doesNotReject(() => runSession(subject, saved.steps, edgeMatches), file);
    } finally {
      await subject.dispose();
    }
  }
});
