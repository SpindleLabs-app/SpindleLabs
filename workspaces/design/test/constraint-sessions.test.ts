// Seeded sketch sessions with constraints and drags on the real kernel's
// solver (step 47d4; the session and its checks: constraint-session.ts).
// FISSION_SEED picks the seed and FISSION_SESSION_STEPS the length (the
// nightly runs it long); the plants it must catch are in
// constraint-planted.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint } from "../src/constraints.ts";
import { dragTo, grabProblem } from "../src/point-drag.ts";
import { runConstraintSession } from "./constraint-session.ts";

const kernel = nodeKernel();

test("seeded sketch sessions with constraints, drags, deletes, undo and save keep every promise", async () => {
  const seed = BigInt(process.env.FISSION_SEED ?? 47_004);
  const steps = Number(process.env.FISSION_SESSION_STEPS ?? 400);
  const done: Record<string, number> = {};
  assert.equal(await runConstraintSession(kernel, { addConstraint, dragTo, grabProblem }, seed, steps, done), null);
  // Each kind of step happened often enough to count.
  for (const kind of ["line", "constrain", "drag", "delete", "undo", "reopen"]) assert.ok((done[kind] ?? 0) >= steps / 60, `only ${done[kind] ?? 0} ${kind} steps: ${JSON.stringify(done)}`);
});
