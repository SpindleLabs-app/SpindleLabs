// One run for `run.ts`, in a process of its own so the planted source is
// loaded fresh: Design's seeded timeline sessions on the real kernel
// (seeds 1 to 30 × 150 steps: from 35e2, with Moves drawn, the rarest catches come after the journey's 4 to 15), then
// every saved session in test/regressions/timeline-design/ (shrunk sessions from the nightly hunts, and ones saved for
// a plant the seeds reach too late, such as combine-face-moves-with-target at seed 140; after the seeds, so every plant
// the seeds catch is still caught where it was recorded), until one fails. Prints one line of JSON: the failing check,
// the seed (or saved file) and message,
// or `{"check":null}` when every session passed ("threw: …" when
// the plant made Design throw rather than fail a check). Needs the WASM build.

import { readdirSync, readFileSync } from "node:fs";
import { nodeKernel } from "../src/node-kernel.ts";
import { designSubject, edgeMatches } from "../src/timeline-design.ts";
import { failureOf, randomSession, type SessionOp } from "../src/timeline-session.ts";

const STEPS = 150;
const SAVED = new URL("../test/regressions/timeline-design/", import.meta.url);
const saved = readdirSync(SAVED)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({ label: f, steps: (JSON.parse(readFileSync(new URL(f, SAVED), "utf8")) as { steps: SessionOp[] }).steps }));
const sessions = [...Array.from({ length: 30 }, (_, i) => ({ label: String(i + 1), steps: randomSession(BigInt(i + 1), STEPS) })), ...saved];
let out: { check: string | null; seed?: string; message?: string } = { check: null };
for (const { label: seed, steps } of sessions) {
  const subject = designSubject(nodeKernel());
  try {
    const failure = await failureOf(() => subject, steps, edgeMatches);
    if (failure) {
      out = { check: failure.check, seed, message: failure.message.slice(0, 300) };
      break;
    }
  } catch (e) {
    // Not one of the session's checks: the plant broke Design outright. Recorded as such, never as caught by a check.
    out = { check: `threw: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`, seed };
    break;
  } finally {
    await subject.dispose().catch(() => undefined);
  }
}
console.log(JSON.stringify(out));
