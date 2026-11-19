// TestLab's test file (test-file.ts): written and read back unchanged, its name, its faces measured by hand, and every
// rule the reader checks broken alone in a good file, each refused in its own words. The real kernel's side (a Run's
// file run again and compared): packages/testing journeys/testlab-file.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, materialLibrary, type BodyFaces, type StableId, type StressTestResult } from "@fission/core";
import { ABOUT, fileFaces, keptProject, NewerTestFileError, readTestFile, TEST_FILE_FORMAT, TEST_FILE_VERSION, testFileName, testFileOf, testFileText, type RunRecord, type TestFile } from "../src/test-file.ts";
import { addLoad, addStudy, emptyTestLab, setLoad, setMaterial, toggleHeld, togglePushed } from "../src/study.ts";

const ref = (id: string) => ({ kind: "face" as const, id: id as StableId });

/** The 100 × 10 bar's sound answer (run.test.ts): pulled 1,000 N along +X, 10 MPa everywhere, steel's 250 MPa: SF 25. */
function sound(): StressTestResult {
  return {
    points: [0, 0, 0, 100, 0, 0, 100, 10, 0],
    triangles: [0, 1, 2],
    triangleFaces: [1],
    displacement: [0, 0, 0, 0.005, 0, 0, 0.005, 0, 0],
    vonMises: [10, 10, 10],
    maxDisplacement: 0.005,
    maxDisplacementAt: [100, 0, 0],
    maxVonMises: 10,
    maxVonMisesAt: [0, 0, 0],
    safetyFactor: 25,
    applied: [1000, 0, 0],
    reaction: [-1000, 0, 0],
    size: 5,
    nodes: 3,
    elements: 1,
    worstQuality: 0.5,
    method: "direct",
    iterations: 1,
    relativeResidual: 1e-12,
  };
}

/** A good file: Body 1 in steel, its left end (face 0) held, 1,000 N along +X on its right end (face 1). */
function good(): TestFile {
  let { data, study } = addStudy(emptyTestLab(), { ref: { kind: "body", id: "body:feature-1" as StableId }, label: "Body 1" });
  data = toggleHeld(data, study.id, study.fixtures[0].id, { ref: ref("face:feature-1/left"), label: "Left face" });
  const added = addLoad(data, study.id);
  data = togglePushed(added.data, study.id, added.load.id, { ref: ref("face:feature-1/right"), label: "Right face" });
  const set = setLoad(data, study.id, added.load.id, { amount: 1000, unit: "N", direction: "+x" });
  assert.ok("data" in set);
  data = setMaterial(set.data, study.id, "steel-a36");
  const project = emptyProject("Bar");
  project.workspaces.design = { stands: "for Design's data, which a test file keeps as saved" };
  project.workspaces.simulate = data;
  project.workspaces.image = { big: "an image the test file must leave out" };
  const steel = materialLibrary().get("steel-a36")!;
  const record: RunRecord = {
    kernel: { version: "0.33.79" },
    project: keptProject(project),
    studyId: study.id,
    material: { id: steel.id, name: steel.name, mechanical: steel.mechanical! },
    part: {
      step: "ISO-10303-21;\nEND-ISO-10303-21;\n",
      stepRefused: null,
      faces: [
        { index: 0, label: "Left face", ref: "face:feature-1/left", area: 100, normal: [-1, 0, 0], flat: true },
        { index: 1, label: "Right face", ref: "face:feature-1/right", area: 100, normal: [1, 0, 0], flat: true },
      ],
    },
    sent: { youngsModulus: 200000, poissonsRatio: 0.26, strength: 250, held: [0], loads: [{ faces: [1], force: [1000, 0, 0] }] },
  };
  return testFileOf(record, sound(), "TestLab result: Holds (safety factor 25)", new Date(Date.UTC(2026, 10, 19, 3, 0, 0)));
}

/** `good()` changed by `change`, written, and read back: the reader's message, or null when it reads. */
function refusal(change: (f: Record<string, any>) => void): string | null {
  const f = JSON.parse(testFileText(good()));
  change(f);
  try {
    readTestFile(JSON.stringify(f));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

test("a file written and read back is the same, holds only the design and TestLab, and explains its own fields", () => {
  const file = good();
  const text = testFileText(file);
  assert.deepEqual(readTestFile(text), JSON.parse(text));
  assert.equal(file.format, TEST_FILE_FORMAT);
  assert.equal(file.version, TEST_FILE_VERSION);
  assert.equal(file.savedAt, "2026-11-19T03:00:00.000Z");
  assert.deepEqual(Object.keys((file.project as { workspaces: object }).workspaces).sort(), ["design", "simulate"]);
  assert.deepEqual(file.about, ABOUT);
  // Every top-level field but `about` itself is explained (part's two by their dotted names).
  for (const k of Object.keys(file)) if (k !== "about" && k !== "part") assert.ok(k in ABOUT, k);
  assert.ok("part.step" in ABOUT && "part.faces" in ABOUT);
  // A number a file can't hold is refused, never written as null.
  assert.throws(() => testFileText({ ...file, answer: { ...file.answer, maxVonMises: NaN } }), /can't save the test file: maxVonMises is NaN/);
});

test("the file's name: the part's name made safe", () => {
  assert.equal(testFileName("Body 1"), "body-1.testlab.json");
  assert.equal(testFileName("  Bracket (v2) / left  "), "bracket-v2-left.testlab.json");
  assert.equal(testFileName("!!!"), "part.testlab.json");
  assert.equal(testFileName("x".repeat(80)), `${"x".repeat(60)}.testlab.json`);
});

test("each face measured by hand from the display mesh", () => {
  // A 10 × 10 square on z = 0 as two triangles (face 0, wound so its normal is +z: area 100), and a 2 × 3 right
  // triangle on x = 0 (face 1, normal +x: area ½ · 2 · 3 = 3).
  const faces: BodyFaces = {
    mesh: { positions: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3], indices: [0, 1, 2, 0, 2, 3, 4, 5, 6], triangle_faces: [0, 0, 1], normals: [] } as unknown as BodyFaces["mesh"],
    faces: [ref("face:a"), null],
    labels: ["Bottom face", "Side face"],
    found: [],
    inputs: [],
  };
  assert.deepEqual(fileFaces(faces), [
    { index: 0, label: "Bottom face", ref: "face:a", area: 100, normal: [0, 0, 1], flat: true },
    { index: 1, label: "Side face", ref: null, area: 3, normal: [1, 0, 0], flat: true },
  ]);
});

test("the reader refuses each broken rule alone, in its own words", () => {
  assert.equal(refusal(() => {}), null);
  assert.throws(() => readTestFile("{"), /not a TestLab test file: it is not valid JSON/);
  assert.match(refusal((f) => (f.format = "spindlelabs-project"))!, /its format is not "spindlelabs-testlab-run"/);
  assert.match(refusal((f) => (f.version = 0))!, /its version is not a whole number from 1/);
  assert.throws(() => readTestFile(JSON.stringify({ ...JSON.parse(testFileText(good())), version: 2 })), (e) => e instanceof NewerTestFileError && /version 2, from a newer SpindleLabs/.test(e.message));
  assert.match(refusal((f) => delete f.about)!, /it has no about/);
  assert.match(refusal((f) => (f.savedAt = "yesterday"))!, /savedAt is not a time/);
  assert.match(refusal((f) => (f.kernel = {}))!, /kernel.version is not words/);
  assert.match(refusal((f) => (f.project = []))!, /its project doesn't read/);
  assert.match(refusal((f) => (f.project.workspaces.image = {}))!, /keeps the image workspace's data/);
  assert.match(refusal((f) => (f.studyId = "study-9"))!, /no study "study-9"/);
  assert.match(refusal((f) => (f.project.workspaces.simulate.version = 99))!, /its TestLab data doesn't read/);
  assert.match(refusal((f) => (f.project.workspaces.simulate.studies[0].body = null))!, /its study has no body/);
  assert.match(refusal((f) => delete f.material.mechanical)!, /material is not a material with its numbers/);
  assert.match(refusal((f) => (f.material.id = "pla"))!, /material pla is not the study's \(steel-a36\)/);
  assert.match(refusal((f) => (f.part.faces = []))!, /part.faces is not a list/);
  assert.match(refusal((f) => (f.part.step = null))!, /part has neither a STEP file nor why not/);
  assert.match(refusal((f) => (f.part.stepRefused = "and a reason too"))!, /part has neither a STEP file nor why not/);
  assert.equal(refusal((f) => ((f.part.step = null), (f.part.stepRefused = "the kernel wouldn't write it"))), null);
  assert.match(refusal((f) => (f.part.faces[1].index = 0))!, /part.faces\[1\] is not face 1/);
  assert.match(refusal((f) => (f.part.faces[0].normal = [0, 1]))!, /part.faces\[0\] is not face 0/);
  assert.match(refusal((f) => (f.sent.strength = 0))!, /sent.strength is not a number above 0/);
  assert.match(refusal((f) => (f.sent.size = -1))!, /sent.size is not a number above 0/);
  assert.match(refusal((f) => (f.sent.held = [2]))!, /sent.held is not a list of the part's face numbers/);
  assert.match(refusal((f) => (f.sent.loads[0].faces = [-1]))!, /sent.loads\[0\] has no list of the part's face numbers/);
  assert.match(refusal((f) => (f.sent.loads[0].pressure = 0.1))!, /sent.loads\[0\] is not one force \[x, y, z\] or one pressure/);
  assert.match(refusal((f) => delete f.answer.vonMises)!, /answer.vonMises is not a list of numbers/);
  assert.match(refusal((f) => (f.answer.applied = [1000, 0]))!, /answer.applied is not three numbers/);
  assert.match(refusal((f) => (f.answer.nodes = "3"))!, /answer.nodes is not a number/);
  assert.match(refusal((f) => (f.answer.method = 1))!, /answer.method is not words/);
  // The page's own checks: a safety factor not measured against the biggest stress (250 / 10 = 25, not 26).
  assert.match(refusal((f) => (f.answer.safetyFactor = 26))!, /its answer doesn't check out: .*safety factor isn't measured against its biggest stress/);
  assert.match(refusal((f) => (f.summary = 1))!, /summary is not words/);
});
