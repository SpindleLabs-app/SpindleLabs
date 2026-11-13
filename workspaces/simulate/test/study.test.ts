// TestLab's data (study.ts): the edits, the words, and the reader. Hand-worked numbers have their working beside them; each
// rule the reader checks has a test that breaks a good file in exactly that way and expects its words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NewerFormatError, type StableId } from "@fission/core";
import {
  addLoad,
  addStudy,
  amountRefusal,
  chooseBody,
  setMaterial,
  emptyTestLab,
  G,
  loadWords,
  MAX_AMOUNT,
  newtons,
  readTestLab,
  readyProblems,
  removeLoad,
  setLoad,
  studyFaces,
  toggleHeld,
  togglePushed,
  type HeldFace,
  type TestLabData,
} from "../src/study.ts";

const body = (n: number) => ({ ref: { kind: "body" as const, id: `body:feature-${n}` as StableId }, label: `Body ${n}` });
const face = (name: string, label = name): HeldFace => ({ ref: { kind: "face", id: `face:feature-1/${name}` as StableId }, label });

/** Study 1 on Body 1: the bottom held, one 5 kg load on the top. */
function bracket(): TestLabData {
  let { data, study } = addStudy(emptyTestLab(), body(1));
  data = toggleHeld(data, study.id, study.fixtures[0].id, face("bottom", "Bottom face"));
  const added = addLoad(data, study.id);
  data = togglePushed(added.data, study.id, added.load.id, face("top", "Top face"));
  const r = setLoad(data, study.id, added.load.id, { amount: 5, unit: "kg" });
  assert.ok("data" in r);
  return setMaterial(r.data, study.id, "pla");
}

test("hand-worked: a mass hanging weighs mass × G; newtons stay as typed; a pressure has no one force", () => {
  // 5 kg × 9.80665 m/s² = 49.03325 N; 0.5 kg × 9.80665 = 4.903325 N.
  // (Doubles round the product, so it is compared to within one part in 10^14.)
  const near = (got: number | null, want: number) => assert.ok(got !== null && Math.abs(got - want) <= 1e-14 * want, `${got} is not ${want}`);
  near(newtons({ amount: 5, unit: "kg" }), 49.03325);
  near(newtons({ amount: 0.5, unit: "kg" }), 4.903325);
  assert.equal(newtons({ amount: 20, unit: "N" }), 20);
  assert.equal(newtons({ amount: 3, unit: "kPa" }), null);
  assert.equal(G, 9.80665);
});

test("the load's words: 5 kg hanging is 49.0 N down; 200 kg is 1,961 N; a pressure is square into its faces", () => {
  const s = bracket().studies[0];
  assert.equal(loadWords(s.loads[0]), "5 kg hanging (49.0 N) down on 1 face");
  // 200 × 9.80665 = 1961.33 N, said in whole newtons from 100 N.
  assert.equal(loadWords({ ...s.loads[0], amount: 200 }), "200 kg hanging (1,961 N) down on 1 face");
  assert.equal(loadWords({ ...s.loads[0], amount: 12.5, unit: "kPa", direction: "into", faces: [face("a"), face("b")] }), "12.5 kPa pressure, square into 2 faces");
});

test("ids come from the counter and are never reused; a second study takes the next free name", () => {
  let data = bracket();
  assert.deepEqual(data.studies[0].id, "study-1");
  assert.deepEqual(data.studies[0].fixtures[0].id, "fixture-2");
  assert.deepEqual(data.studies[0].loads[0].id, "load-3");
  data = removeLoad(data, "study-1", "load-3");
  data = addLoad(data, "study-1").data;
  assert.equal(data.studies[0].loads[0].id, "load-4"); // load-3 is never given again
  const two = addStudy(data, null);
  assert.equal(two.study.name, "Study 2");
  assert.equal(two.study.id, "study-5");
});

test("a face is held or pushed, never both: picking it for one takes it off the other; a second tap lets it go", () => {
  let data = bracket();
  data = toggleHeld(data, "study-1", "fixture-2", face("top", "Top face"));
  assert.deepEqual(data.studies[0].fixtures[0].faces.map((f) => f.label), ["Bottom face", "Top face"]);
  assert.deepEqual(data.studies[0].loads[0].faces, []);
  data = togglePushed(data, "study-1", "load-3", face("bottom", "Bottom face"));
  assert.deepEqual(data.studies[0].fixtures[0].faces.map((f) => f.label), ["Top face"]);
  data = togglePushed(data, "study-1", "load-3", face("bottom", "Bottom face"));
  assert.deepEqual(data.studies[0].loads[0].faces, []);
  assert.throws(() => toggleHeld(data, "study-1", "fixture-9", face("x")), /no hold fixture-9/);
});

test("another body empties the holds and loads (their faces were the old body's); the same body keeps them", () => {
  const data = bracket();
  assert.equal(chooseBody(data, "study-1", body(1)), data);
  const other = chooseBody(data, "study-1", body(2)).studies[0];
  assert.equal(other.body?.label, "Body 2");
  assert.deepEqual(other.fixtures.map((f) => f.faces), [[]]);
  assert.deepEqual(other.loads, []);
});

test("an amount: above 0 and at most 1,000,000, at 0.9× and 1.1× of the limit; a pressure only pushes square into its faces", () => {
  assert.equal(amountRefusal(0.9 * MAX_AMOUNT), null);
  assert.match(amountRefusal(1.1 * MAX_AMOUNT)!, /at most 1,000,000/);
  assert.equal(amountRefusal(MAX_AMOUNT), null);
  assert.match(amountRefusal(0)!, /more than 0/);
  assert.match(amountRefusal(-3)!, /more than 0/);
  assert.match(amountRefusal(NaN)!, /as a number/);
  assert.match(amountRefusal(Infinity)!, /as a number/);
  const data = bracket();
  const kpa = setLoad(data, "study-1", "load-3", { unit: "kPa" });
  assert.ok("data" in kpa);
  assert.equal(kpa.data.studies[0].loads[0].direction, "into"); // choosing kPa makes it square into the face
  assert.deepEqual(setLoad(kpa.data, "study-1", "load-3", { direction: "down" }), { refused: "A pressure always pushes square into its faces: choose N or kg to push another way." });
  assert.deepEqual(setLoad(data, "study-1", "load-3", { amount: 0 }), { refused: "A load must be more than 0: to push the other way, change its direction." });
});

test("what stops a study, first problem first; none when held and pushed", () => {
  assert.deepEqual(readyProblems(addStudy(emptyTestLab(), null).study, []), ["Pick a body to test."]);
  const bare = addStudy(emptyTestLab(), body(1)).study;
  assert.deepEqual(readyProblems(bare, []), ["Choose what the part is made of.", "Pick at least one face to hold in place: with nothing held the part would just fly away.", "Add a load: with nothing pushing, nothing bends."]);
  const s = bracket().studies[0];
  assert.deepEqual(readyProblems(s, []), []);
  assert.deepEqual(readyProblems(s, ["Load 1 lost its face Top face."]), ["Load 1 lost its face Top face."]);
  const empty = addLoad(bracket(), "study-1").data.studies[0];
  assert.deepEqual(readyProblems(empty, []), ["Load 2 is on no face yet: pick the faces it pushes."]);
});

test("the faces a study asks Design about: holds first, then loads, each once", () => {
  let data = bracket();
  const second = addLoad(data, "study-1");
  data = togglePushed(second.data, "study-1", second.load.id, face("top", "Top face"));
  assert.deepEqual(studyFaces(data.studies[0]).map((f) => f.label), ["Bottom face", "Top face"]);
});

test("the reader: nothing yet is an empty TestLab; a saved study reads back as written", () => {
  assert.deepEqual(readTestLab(undefined), emptyTestLab());
  const data = bracket();
  assert.deepEqual(readTestLab(JSON.parse(JSON.stringify(data))), data);
});

test("the reader refuses each broken rule in words, and data from a newer SpindleLabs as newer", () => {
  const good = () => JSON.parse(JSON.stringify(bracket()));
  assert.throws(() => readTestLab({ ...good(), version: 3 }), (e: unknown) => e instanceof NewerFormatError && /version 3, from a newer SpindleLabs/.test(e.message));
  const breaks: [string, (d: any) => void, RegExp][] = [
    ["not an object", (d) => Object.assign(d, { studies: 3 }), /studies are not a list/],
    ["version 0", (d) => (d.version = 0), /not one SpindleLabs ever wrote/],
    ["no counter", (d) => delete d.nextId, /id counter/],
    ["an id at the counter", (d) => (d.nextId = 3), /load-3 is not below the counter/],
    ["one id twice", (d) => (d.studies[0].loads[0].id = "fixture-2"), /fixture-2 is used twice/],
    ["a load's id on a hold", (d) => (d.studies[0].fixtures[0].id = "load-2"), /not a hold's/],
    ["a thermal study", (d) => (d.studies[0].kind = "thermal"), /thermal study/],
    ["no name", (d) => (d.studies[0].name = " "), /has no name/],
    ["a body that is a face", (d) => (d.studies[0].body.ref.kind = "face"), /not a body reference/],
    ["a face with no name", (d) => delete d.studies[0].loads[0].faces[0].label, /face 1 is not a face reference with a name/],
    ["a load in lbs", (d) => (d.studies[0].loads[0].unit = "lb"), /in lb, not N, kg or kPa/],
    ["a load pushing sideways", (d) => (d.studies[0].loads[0].direction = "sideways"), /pushes sideways/],
    ["a load of 0", (d) => (d.studies[0].loads[0].amount = 0), /more than 0/],
    ["a load as text", (d) => (d.studies[0].loads[0].amount = "5"), /as a number/],
    ["a pressure pushing down", (d) => Object.assign(d.studies[0].loads[0], { unit: "kPa", direction: "down" }), /only pushes square into its faces/],
    ["a mesh size of huge", (d) => (d.studies[0].mesh = "huge"), /mesh size huge/],
    ["made of wood", (d) => (d.studies[0].material = "wood"), /made of wood, which is not in this SpindleLabs's materials library/],
    ["a material as a number", (d) => (d.studies[0].material = 7), /material is not a material's name/],
    ["no material at all", (d) => delete d.studies[0].material, /material is not a material's name/],
  ];
  for (const [what, bend, why] of breaks) {
    const d = good();
    bend(d);
    assert.throws(() => readTestLab(d), why, what);
  }
});

test("a study's material: set by the library's id, one change; version 1 data (from before materials) reads as not chosen", () => {
  const data = bracket();
  assert.equal(data.version, 2);
  assert.equal(data.studies[0].material, "pla");
  const steel = setMaterial(data, "study-1", "steel-a36");
  assert.equal(steel.studies[0].material, "steel-a36");
  assert.equal(setMaterial(steel, "study-1", "steel-a36"), steel, "the same material again changes nothing");
  assert.throws(() => setMaterial(data, "study-1", "wood"), /no material wood/);
  assert.equal(addStudy(emptyTestLab(), body(1)).study.material, null);
  // A T1 file: version 1, no material key; it opens with the material not chosen, and is written back as version 2.
  const v1 = JSON.parse(JSON.stringify(data));
  v1.version = 1;
  delete v1.studies[0].material;
  const read = readTestLab(v1);
  assert.equal(read.version, 2);
  assert.equal(read.studies[0].material, null);
  assert.deepEqual(readyProblems(read.studies[0], []), ["Choose what the part is made of."]);
  // A version 1 file with a material key is read as version 1 says: the key is not one version 1 had, so it is not taken.
  v1.studies[0].material = "abs";
  assert.equal(readTestLab(v1).studies[0].material, null);
  // Version 2 with no material chosen yet reads back as written.
  const none = addStudy(emptyTestLab(), body(1)).data;
  assert.deepEqual(readTestLab(JSON.parse(JSON.stringify(none))), none);
});
