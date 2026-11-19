// Runs a TestLab test file (Export test file, in TestLab's results card) again on this checkout's kernel and checks it:
//   npm run testlab-rerun -w @fission/testing -- <file.testlab.json> [--json]
// Prints each check as PASS or FAIL with what was found, then the file's summary; exits 1 when any check fails, 2 when
// the file doesn't read. --json prints the report (checks and the new answer's headline numbers) as JSON instead.
// What it checks: src/testlab-rerun.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nodeKernel } from "../src/node-kernel.ts";
import { reportText, rerunTestFile } from "../src/testlab-rerun.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const path = args.find((a) => !a.startsWith("--"));
if (!path) {
  console.error("usage: npm run testlab-rerun -w @fission/testing -- <file.testlab.json> [--json]");
  process.exit(2);
}
// npm runs the script from packages/testing; a relative path is taken from where the command was typed.
const file = resolve(process.env.INIT_CWD ?? process.cwd(), path);
let report;
try {
  report = await rerunTestFile(readFileSync(file, "utf8"), nodeKernel());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}
if (json) {
  const a = report.answer;
  console.log(JSON.stringify({ checks: report.checks, answer: a && { safetyFactor: a.safetyFactor, maxVonMises: a.maxVonMises, maxVonMisesAt: a.maxVonMisesAt, maxDisplacement: a.maxDisplacement, maxDisplacementAt: a.maxDisplacementAt, nodes: a.nodes, elements: a.elements, size: a.size } }, null, 2));
} else console.log(reportText(report));
process.exit(report.checks.every((c) => c.ok) ? 0 : 1);
