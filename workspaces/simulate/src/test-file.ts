// TestLab's test file (Ben, 19 Nov): one run saved as a single JSON file a
// person can send to be checked. It holds everything needed to run the same
// test again and compare: the design as it was saved (Design's own data, from
// which the same kernel rebuilds the same exact part), the part's exact
// boundary as a STEP file, every face's name, area and direction, the study
// (material, holds and loads on faces by stable reference and by name), the
// material's numbers as used, the stress test exactly as sent to the kernel,
// the kernel's whole answer and the card's summary. It explains its own
// fields and units (`about`), so it reads without this repository.
//
// `testFileOf` builds one from a Run, `testFileText` writes it, `readTestFile`
// reads one back, refusing in words anything that doesn't fit together.
// Re-running one on the real kernel: packages/testing `testlab-rerun.ts`
// (`npm run testlab-rerun -w @fission/testing -- <file>`).

import type { BodyFaces, Mechanical, Project, StressTest, StressTestResult } from "@fission/core";
import { projectToJson, readProject } from "@fission/core";
import { answerProblem, faceFacts } from "./run.ts";
import { readTestLab, type Study } from "./study.ts";

/** The file's kind, its first field. */
export const TEST_FILE_FORMAT = "spindlelabs-testlab-run";
/** This build's version of the file; a newer one is refused as such. */
export const TEST_FILE_VERSION = 1;
/** The largest test file read, in bytes (a fine mesh's answer is a few MB; this is far past any). */
export const MAX_TEST_FILE_BYTES = 256 * 1024 * 1024;
/** The workspaces whose data the file keeps: the design the part comes from and TestLab's own set-up. */
export const KEPT_WORKSPACES = ["design", "simulate"] as const;

/** One face of the tested part, as its owner named it and as the display mesh measures it. */
export interface TestFileFace {
  /** The kernel's face number on the part (the stress test's `held` and `faces` use these). */
  index: number;
  /** Its name in the design's words ("Top face"). */
  label: string;
  /** Its stable reference id, or null for a face with no name of its own. */
  ref: string | null;
  /** mm². */
  area: number;
  /** Unit outward normal. */
  normal: [number, number, number];
  flat: boolean;
}

/** Field by field, what the file holds and in which units (written into every file, so it reads on its own). */
export const ABOUT: Readonly<Record<string, string>> = {
  format: `Always "${TEST_FILE_FORMAT}".`,
  version: "This file layout's version.",
  savedAt: "When the file was saved (ISO 8601, UTC).",
  kernel: "The geometry kernel's version that built the part and ran the test.",
  project: "The SpindleLabs project as saved, with only its design and TestLab data: rebuilding project.workspaces.design gives the exact part.",
  studyId: "Which study in project.workspaces.simulate.studies was run.",
  material: "The material as used: id, name and its numbers in SI (Pa, kg/m³). TestLab uses the weaker way (across the layers) for a printed material.",
  "part.step": "The part's exact boundary as a STEP AP214 file (mm), or null with part.stepRefused saying why.",
  "part.faces": "Every face of the part: the kernel's face number, its name, its stable reference, area (mm²), outward normal and whether it is flat.",
  sent: "The stress test exactly as sent to the kernel: youngsModulus, strength in MPa; held and each load's faces by kernel face number; force in N (total over its faces) or pressure in MPa; size the mesh size in mm (absent: the kernel's own choice).",
  answer: "The kernel's whole answer: the part's surface before it bends (points mm, triangles, triangleFaces), each point's displacement (mm) and von Mises stress (MPa), the biggest of each and where, the safety factor (strength over the biggest stress), the applied loads and the holds' reaction (N), the mesh (size mm, nodes, ten-point tetrahedra) and the solver (method, iterations, relativeResidual).",
  summary: "The results card as text, as Copy summary gives it.",
};

/** A saved TestLab run. Every number in mm, N, MPa unless `about` says otherwise. */
export interface TestFile {
  format: typeof TEST_FILE_FORMAT;
  version: typeof TEST_FILE_VERSION;
  about: Record<string, string>;
  savedAt: string;
  kernel: { version: string };
  project: unknown;
  studyId: string;
  material: { id: string; name: string; mechanical: Mechanical };
  part: { step: string | null; stepRefused: string | null; faces: TestFileFace[] };
  sent: StressTest;
  answer: StressTestResult;
  summary: string;
}

/** Every face of a body as the file lists it, in face-number order. */
export function fileFaces(faces: BodyFaces): TestFileFace[] {
  const count = faces.labels.length;
  const out: TestFileFace[] = [];
  for (let i = 0; i < count; i++) {
    const f = faceFacts(faces.mesh, i);
    out.push({ index: i, label: faces.labels[i], ref: faces.faces[i]?.id ?? null, area: f.area, normal: f.normal, flat: f.flat });
  }
  return out;
}

/** The project as the file keeps it: saved as a file would be, with only the design and TestLab's data. */
export function keptProject(project: Project): unknown {
  const saved = JSON.parse(projectToJson(project)) as Project;
  const workspaces: Record<string, unknown> = {};
  for (const id of KEPT_WORKSPACES) if (saved.workspaces[id] !== undefined) workspaces[id] = saved.workspaces[id];
  return { ...saved, workspaces };
}

/** What a Run gathers for its file, before the kernel answers: everything but the answer and the summary. */
export interface RunRecord {
  kernel: { version: string };
  project: unknown;
  studyId: string;
  material: TestFile["material"];
  part: TestFile["part"];
  sent: StressTest;
}

/** A run's file from what Run gathered, the kernel's answer and the card's summary. */
export function testFileOf(record: RunRecord, answer: StressTestResult, summary: string, savedAt: Date): TestFile {
  return {
    format: TEST_FILE_FORMAT,
    version: TEST_FILE_VERSION,
    about: { ...ABOUT },
    savedAt: savedAt.toISOString(),
    kernel: { ...record.kernel },
    project: record.project,
    studyId: record.studyId,
    material: record.material,
    part: record.part,
    sent: record.sent,
    answer,
    summary,
  };
}

/** The file as text: JSON, two-space indents, refusing a number JSON can't hold rather than writing it as null. */
export function testFileText(file: TestFile): string {
  return (
    JSON.stringify(
      file,
      (key, v) => {
        if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`can't save the test file: ${key} is ${v}, not a number a file can hold`);
        return v;
      },
      2,
    ) + "\n"
  );
}

/** The file's name: the part's name made safe, then ".testlab.json" ("Body 1" → "body-1.testlab.json"). */
export function testFileName(body: string): string {
  const safe = body
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${safe || "part"}.testlab.json`;
}

/** A test file from a newer SpindleLabs than this one. */
export class NewerTestFileError extends Error {}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const numbers = (x: unknown, length?: number): x is number[] => Array.isArray(x) && x.every(isNumber) && (length === undefined || x.length === length);

/** Why `sent` is not a stress test as TestLab sends one, or null. */
function sentProblem(sent: unknown, faces: number): string | null {
  if (!isObject(sent)) return "sent is not a stress test";
  for (const k of ["youngsModulus", "poissonsRatio", "strength"] as const) if (!isNumber(sent[k]) || (sent[k] as number) <= 0) return `sent.${k} is not a number above 0`;
  if (sent.size !== undefined && !(isNumber(sent.size) && sent.size > 0)) return "sent.size is not a number above 0";
  const face = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < faces;
  if (!Array.isArray(sent.held) || !sent.held.every(face)) return "sent.held is not a list of the part's face numbers";
  if (!Array.isArray(sent.loads)) return "sent.loads is not a list";
  for (const [i, l] of sent.loads.entries()) {
    if (!isObject(l) || !Array.isArray(l.faces) || !l.faces.every(face)) return `sent.loads[${i}] has no list of the part's face numbers`;
    const force = numbers(l.force, 3);
    const pressure = isNumber(l.pressure);
    if (force === pressure) return `sent.loads[${i}] is not one force [x, y, z] or one pressure`;
  }
  return null;
}

/** Why `answer` is not a whole answer of the kernel's, or null: its fields, then every check the page makes before showing one. */
function answerShape(answer: unknown, strength: number): string | null {
  if (!isObject(answer)) return "answer is not the kernel's answer";
  for (const k of ["points", "triangles", "triangleFaces", "displacement", "vonMises"]) if (!numbers(answer[k])) return `answer.${k} is not a list of numbers`;
  for (const k of ["applied", "reaction", "maxDisplacementAt", "maxVonMisesAt"]) if (!numbers(answer[k], 3)) return `answer.${k} is not three numbers`;
  for (const k of ["maxDisplacement", "maxVonMises", "size", "nodes", "elements", "worstQuality", "iterations", "relativeResidual"]) if (!isNumber(answer[k])) return `answer.${k} is not a number`;
  if (answer.safetyFactor !== null && !isNumber(answer.safetyFactor)) return "answer.safetyFactor is not a number or null";
  if (typeof answer.method !== "string") return "answer.method is not words";
  return answerProblem(answer as unknown as StressTestResult, strength);
}

/**
 * A test file read back from its text, every part checked: the format and version, the project (its outer layout read
 * as a project is), the study it names in TestLab's data, the material, the part's faces, the test as sent and the
 * answer, which passes the same checks the page makes before showing one. Throws one message saying what is wrong; a
 * newer file as a `NewerTestFileError`.
 */
export function readTestFile(text: string): TestFile {
  if (text.length > MAX_TEST_FILE_BYTES) throw new Error(`not read: the file is over ${MAX_TEST_FILE_BYTES / (1024 * 1024)} MB`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`not a TestLab test file: it is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  const bad = (why: string) => new Error(`not a TestLab test file: ${why}`);
  if (!isObject(data) || data.format !== TEST_FILE_FORMAT) throw bad(`its format is not "${TEST_FILE_FORMAT}"`);
  if (!Number.isInteger(data.version) || (data.version as number) < 1) throw bad("its version is not a whole number from 1");
  if ((data.version as number) > TEST_FILE_VERSION) throw new NewerTestFileError(`this test file is version ${data.version}, from a newer SpindleLabs than this one (version ${TEST_FILE_VERSION})`);
  if (!isObject(data.about)) throw bad("it has no about");
  if (typeof data.savedAt !== "string" || Number.isNaN(Date.parse(data.savedAt))) throw bad("savedAt is not a time");
  if (!isObject(data.kernel) || typeof data.kernel.version !== "string") throw bad("kernel.version is not words");
  let project: Project;
  try {
    project = readProject(data.project);
  } catch (e) {
    throw bad(`its project doesn't read (${e instanceof Error ? e.message : String(e)})`);
  }
  for (const id of Object.keys(project.workspaces)) if (!(KEPT_WORKSPACES as readonly string[]).includes(id)) throw bad(`its project keeps the ${id} workspace's data, which a test file never holds`);
  if (typeof data.studyId !== "string") throw bad("studyId is not words");
  let study: Study | undefined;
  try {
    study = readTestLab(project.workspaces.simulate).studies.find((s) => s.id === data.studyId);
  } catch (e) {
    throw bad(`its TestLab data doesn't read (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!study) throw bad(`its project has no study ${JSON.stringify(data.studyId)}`);
  if (study.body === null) throw bad("its study has no body");
  const m = data.material;
  if (!isObject(m) || typeof m.id !== "string" || typeof m.name !== "string" || !isObject(m.mechanical)) throw bad("material is not a material with its numbers");
  if (m.id !== study.material) throw bad(`material ${m.id} is not the study's (${study.material})`);
  const part = data.part;
  if (!isObject(part) || !Array.isArray(part.faces) || part.faces.length === 0) throw bad("part.faces is not a list of the part's faces");
  if ((part.step === null) === (part.stepRefused === null) || (part.step !== null && typeof part.step !== "string") || (part.stepRefused !== null && typeof part.stepRefused !== "string")) throw bad("part has neither a STEP file nor why not");
  for (const [i, f] of part.faces.entries()) {
    if (!isObject(f) || f.index !== i || typeof f.label !== "string" || (f.ref !== null && typeof f.ref !== "string") || !isNumber(f.area) || !numbers(f.normal, 3) || typeof f.flat !== "boolean") throw bad(`part.faces[${i}] is not face ${i} with its name, area and normal`);
  }
  const sent = sentProblem(data.sent, part.faces.length);
  if (sent !== null) throw bad(sent);
  const answer = answerShape(data.answer, (data.sent as unknown as StressTest).strength);
  if (answer !== null) throw bad(`its answer doesn't check out: ${answer}`);
  if (typeof data.summary !== "string") throw bad("summary is not words");
  return data as unknown as TestFile;
}

/** Saves `file` through the browser as a download named for the part. */
export function downloadTestFile(doc: Document, file: TestFile, body: string): void {
  const win = doc.defaultView;
  if (!win) throw new Error("can't save here: no window");
  const url = win.URL.createObjectURL(new win.Blob([testFileText(file)], { type: "application/json" }));
  const a = doc.createElement("a");
  a.href = url;
  a.download = testFileName(body);
  a.rel = "noopener";
  doc.body.append(a);
  a.click();
  a.remove();
  // Let the browser start the download before the address goes.
  win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
}
