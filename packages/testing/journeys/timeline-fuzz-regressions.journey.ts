// The nightly timeline fuzzing's failures (fuzz/timeline.ts, .github/workflows/fuzz.yml),
// each kept as its shrunk steps in test/regressions/timeline-fuzz/<seed>.json, replayed
// forever on Design's timeline on the real kernel against the model (runSession), exactly
// as the fuzzing ran them. test/timeline-session.test.ts replays test/regressions/timeline/
// on the model alone; these need Design, since each was a disagreement between the two.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { runSession, TimelineFailure, type SessionOp } from "../src/timeline-session.ts";
import { designSubject, edgeMatches } from "../src/timeline-design.ts";
import { kernel } from "./design-app.ts";

const SAVED = new URL("../test/regressions/timeline-fuzz/", import.meta.url);

test("saved timeline fuzzing failures replay on Design on the real kernel", { skip: !existsSync(SAVED) && "none saved yet" }, async () => {
  const files = readdirSync(SAVED).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0, "no saved failures");
  for (const file of files) {
    const saved: { seed: string; check: string; steps: SessionOp[] } = JSON.parse(readFileSync(new URL(file, SAVED), "utf8"));
    const subject = designSubject(kernel, []);
    try {
      await runSession(subject, saved.steps, edgeMatches);
    } catch (e) {
      if (e instanceof TimelineFailure) assert.fail(`${file} (once "${saved.check}"): ${e.message}`);
      throw e;
    } finally {
      await subject.dispose();
    }
  }
});
