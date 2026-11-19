// A TestLab test file (workspaces/simulate test-file.ts) run again on the real kernel, headless, and checked against
// what it says: the design read back and rebuilt by Design's own lender, the part's exact boundary (STEP) and faces
// compared, the study turned into the kernel's test again by TestLab's own code and compared with the test the file
// says was sent, that test run again, and its answer compared number by number with the file's. Then the answer's own
// sums checked independently: the loads sent add up to the applied force, the holds' reaction balances it, and the
// safety factor is the strength over the biggest stress. Each check passes or fails in words (`RerunCheck`).
// The command line: scripts/testlab-rerun.ts. Node-only, like node-kernel.ts.

import { materialLibrary, projectFromJson, RepresentationRegistry, type KernelCalls, type StressTest, type StressTestResult } from "@fission/core";
import { designWorkspace, registerDesign } from "@fission/design";
import { answerProblem, BODIES_LISTER, fileFaces, GEOMETRY_OWNER, joinGroup, readTestFile, readTestLab, simulateWorkspace, stressTestOf, studyFaces, studyOn, withJoined, type StudyNow, type TestFile } from "@fission/simulate";
import type { LentBody } from "@fission/core";

/** One check of a re-run: its name, whether it passed, and what was found in words. */
export interface RerunCheck {
  name: string;
  ok: boolean;
  words: string;
}

/** A re-run's report: the file as read, every check in order, and the answer the kernel gave this time (null if not run). */
export interface RerunReport {
  file: TestFile;
  checks: RerunCheck[];
  answer: StressTestResult | null;
}

/**
 * How far two answers may differ and still be the same answer: relative to the largest of each list. The same build
 * on the same input gives the same numbers to the last bit (WebAssembly's floating point is deterministic); this
 * leaves room for nothing more than printing and reading the numbers back, which JSON does exactly.
 */
export const SAME_ANSWER = 1e-12;
/** How far the balance and safety factor sums may be off, relative: the page's own MAX_IMBALANCE is far looser. */
export const SUMS_AGREE = 1e-9;

/** The largest gap between two lists of numbers, relative to the largest size in `want` (or absolute when that is 0). */
export function largestGap(got: readonly number[], want: readonly number[]): number {
  if (got.length !== want.length) return Infinity;
  let scale = 0;
  for (const w of want) scale = Math.max(scale, Math.abs(w));
  let gap = 0;
  for (let i = 0; i < got.length; i++) gap = Math.max(gap, Math.abs(got[i] - want[i]));
  return scale === 0 ? gap : gap / scale;
}

/** Every number list and single number of two answers compared: the names of those further apart than `SAME_ANSWER`, with how far. */
export function answerGaps(got: StressTestResult, want: StressTestResult): string[] {
  const out: string[] = [];
  const lists = ["points", "triangles", "triangleFaces", "displacement", "vonMises", "maxDisplacementAt", "maxVonMisesAt", "applied", "reaction"] as const;
  for (const k of lists) {
    const g = largestGap(got[k], want[k]);
    if (!(g <= SAME_ANSWER)) out.push(got[k].length !== want[k].length ? `${k} has ${got[k].length} numbers, the file ${want[k].length}` : `${k} differs by up to ${g.toExponential(2)} of its largest`);
  }
  const ones = ["maxDisplacement", "maxVonMises", "size", "nodes", "elements", "worstQuality", "iterations", "relativeResidual"] as const;
  for (const k of ones) if (!(largestGap([got[k]], [want[k]]) <= SAME_ANSWER)) out.push(`${k} is ${got[k]}, the file ${want[k]}`);
  if ((got.safetyFactor === null) !== (want.safetyFactor === null) || (got.safetyFactor !== null && !(largestGap([got.safetyFactor], [want.safetyFactor!]) <= SAME_ANSWER))) out.push(`safetyFactor is ${got.safetyFactor}, the file ${want.safetyFactor}`);
  if (got.method !== want.method) out.push(`method is ${got.method}, the file ${want.method}`);
  return out;
}

/**
 * The answer's own sums, independent of the solver: the forces sent add up to `applied` (a pressure's total depends on
 * the mesh's faces, so a test with a pressure checks only the balance), the holds' `reaction` is equal and opposite,
 * and the safety factor is `strength` over the biggest stress.
 */
export function sumChecks(sent: StressTest, answer: StressTestResult): RerunCheck[] {
  const out: RerunCheck[] = [];
  const size = Math.max(...answer.applied.map(Math.abs), ...answer.reaction.map(Math.abs));
  const pressures = sent.loads.some((l) => "pressure" in l);
  if (!pressures) {
    const total = [0, 0, 0];
    for (const l of sent.loads) if ("force" in l) for (let k = 0; k < 3; k++) total[k] += l.force[k];
    const g = largestGap(answer.applied, total);
    out.push({ name: "loads add up", ok: g <= SUMS_AGREE, words: `the forces sent add up to [${total.map((x) => x.toPrecision(6)).join(", ")}] N; the kernel applied [${answer.applied.map((x) => x.toPrecision(6)).join(", ")}] N (off by ${g.toExponential(2)} of the largest)` });
  }
  const off = Math.max(...[0, 1, 2].map((k) => Math.abs(answer.applied[k] + answer.reaction[k])));
  const rel = size === 0 ? off : off / size;
  out.push({ name: "holds balance the loads", ok: rel <= SUMS_AGREE, words: `applied + reaction is off by ${off.toExponential(2)} N, ${rel.toExponential(2)} of the largest` });
  if (answer.safetyFactor === null) out.push({ name: "safety factor", ok: answer.maxVonMises === 0, words: answer.maxVonMises === 0 ? "nothing is stressed, so there is no safety factor" : `no safety factor, yet the biggest stress is ${answer.maxVonMises} MPa` });
  else {
    const want = sent.strength / answer.maxVonMises;
    const g = Math.abs(answer.safetyFactor - want) / want;
    out.push({ name: "safety factor", ok: g <= SUMS_AGREE, words: `${answer.safetyFactor} against strength ${sent.strength} MPa / biggest stress ${answer.maxVonMises} MPa = ${want} (off by ${g.toExponential(2)})` });
  }
  return out;
}

/** Deep equality of two JSON values, numbers exactly. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Reads test file `text` and runs it again on `kernel` (Node's: node-kernel.ts), every check in the report. Throws only
 * when the file doesn't read (`readTestFile`'s words); everything after is a check that passes or fails.
 */
export async function rerunTestFile(text: string, kernel: KernelCalls): Promise<RerunReport> {
  const file = readTestFile(text);
  const checks: RerunCheck[] = [];
  const check = (name: string, ok: boolean, words: string) => checks.push({ name, ok, words });
  const version = await kernel.call("kernel_version");
  check("same kernel", version === file.kernel.version, version === file.kernel.version ? `kernel ${version}, as the file` : `this kernel is ${version}, the file's ${file.kernel.version}: its answer may differ for that reason alone`);
  const project = projectFromJson(JSON.stringify(file.project), [designWorkspace, simulateWorkspace]);
  const study = readTestLab(project.workspaces.simulate).studies.find((s) => s.id === file.studyId)!;
  // The material: the numbers the file says were used, against the study's material in this build's library.
  const mechanical = file.material.mechanical;
  const now = study.material === null ? undefined : materialLibrary().get(study.material);
  check("same material", now !== undefined && sameJson(now.mechanical, mechanical), now === undefined ? `this build has no material ${study.material}` : sameJson(now.mechanical, mechanical) ? `${file.material.name}, the same numbers as this build's library` : `${file.material.name}'s numbers in this build's library differ from the file's; the file's are used`);
  const registry = new RepresentationRegistry();
  registerDesign(registry, kernel);
  let answer: StressTestResult | null = null;
  try {
    // A study joining bodies for the test (TestLab Join) is run on the bodies joined as the page joins them, so the
    // part, its faces and the test are the joined part's, as the file recorded them.
    const group = joinGroup(study, registry.objectsOf(BODIES_LISTER, project));
    if (group.missing.length > 0) throw new Error(group.missing.join(" "));
    const run = async (lent: LentBody, on: StudyNow) => {
      // The part: its exact boundary and its faces, as the file has them.
      let step: string | null = null;
      let stepRefused: string | null = null;
      try {
        step = await kernel.call("body_step", lent.handle);
      } catch (e) {
        stepRefused = e instanceof Error ? e.message : String(e);
      }
      check("same exact part (STEP)", step === file.part.step && stepRefused === file.part.stepRefused, step === file.part.step ? (step === null ? `no STEP either time: ${stepRefused}` : `the rebuilt part's STEP is the file's, ${step.length.toLocaleString("en")} characters`) : "the rebuilt part's STEP differs from the file's");
      const faces = fileFaces(lent.faces);
      check("same faces", sameJson(faces, file.part.faces), sameJson(faces, file.part.faces) ? `${faces.length} faces, each with the file's name, area and normal` : `the rebuilt part's faces differ from the file's (${faces.length} now, ${file.part.faces.length} in the file)`);
      // The set-up: the study turned into the kernel's test by TestLab's own code, against the test the file says was sent.
      const sent = stressTestOf(study, on, mechanical);
      check("same test sent", !("refused" in sent) && sameJson(sent, file.sent), "refused" in sent ? `TestLab refuses the study now: ${sent.refused}` : sameJson(sent, file.sent) ? `${file.sent.held.length} held faces and ${file.sent.loads.length} loads, as the file` : "the study turns into a different test from the one the file says was sent");
      // The test the file says was sent, run again.
      answer = await kernel.call("stress_test", lent.handle, file.sent);
    };
    const out =
      group.bodies.length > 1
        ? await withJoined(registry, kernel, project, study, group.bodies, run)
        : await registry.withBody(GEOMETRY_OWNER, project, study.body!.ref, studyFaces(study).map((f) => f.ref), (lent) => run(lent, studyOn(study, lent.faces)));
    if (out !== undefined && "refused" in out) throw new Error(out.refused);
  } catch (e) {
    check("rebuilt and run", false, `couldn't rebuild the part or run its test: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (answer !== null) {
    const got: StressTestResult = answer;
    const wrong = answerProblem(got, file.sent.strength);
    check("answer checks out", wrong === null, wrong ?? "the new answer passes every check the page makes before showing one");
    const gaps = answerGaps(got, file.answer);
    check("same answer", gaps.length === 0, gaps.length === 0 ? `every number within ${SAME_ANSWER} of the file's (biggest stress ${got.maxVonMises} MPa, bend ${got.maxDisplacement} mm, safety factor ${got.safetyFactor})` : gaps.join("; "));
  }
  for (const c of sumChecks(file.sent, file.answer)) check(`file's ${c.name}`, c.ok, c.words);
  return { file, checks, answer };
}

/** A report as lines of text: each check as PASS or FAIL with its words, then the file's summary. */
export function reportText(r: RerunReport): string {
  return [...r.checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.name}: ${c.words}`), "", r.file.summary].join("\n");
}
