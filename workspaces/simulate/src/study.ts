// TestLab's data (step T1): the studies the project keeps, choices only,
// never results and never Design's geometry. A study points at a Design
// body and at its faces by their stable names (core references), so a
// design edit flows straight through: every time TestLab shows, the names
// are looked up again on the body as it is now (faces.ts), and a name the
// edit took away is said in words on the load or hold that kept it, never
// dropped. Every edit here is a pure function returning new data, recorded
// by the page as one undo step.

import { NewerFormatError, type BodyReference, type FaceReference, type StableId } from "@fission/core";

/** Standard gravity, m/s²: a mass of m kg hanging weighs m × G newtons (the defined value, CGPM 1901). */
export const G = 9.80665;

/** Which way a force pushes: square into the face it is on, or along a world axis ("down" is −Z, the way gravity pulls in Design). */
export type Direction = "into" | "down" | "up" | "+x" | "-x" | "+y" | "-y";

export const DIRECTIONS: readonly Direction[] = ["down", "into", "up", "+x", "-x", "+y", "-y"];

export const DIRECTION_WORDS: Readonly<Record<Direction, string>> = {
  into: "square into the face",
  down: "down",
  up: "up",
  "+x": "along +X",
  "-x": "along −X",
  "+y": "along +Y",
  "-y": "along −Y",
};

/** How a load's amount is typed: newtons, kilograms hanging (turned into newtons by G), or a pressure in kilopascals (always square into the face). */
export type LoadUnit = "N" | "kg" | "kPa";

export const UNITS: readonly LoadUnit[] = ["N", "kg", "kPa"];

export const UNIT_WORDS: Readonly<Record<LoadUnit, string>> = { N: "N", kg: "kg hanging", kPa: "kPa pressure" };

/** A face kept by its stable name, with the words it was called when picked, so a lost one can still be named. */
export interface HeldFace {
  ref: FaceReference;
  label: string;
}

/** Faces held fixed in place. */
export interface Fixture {
  id: string;
  faces: HeldFace[];
}

/** A push on faces: an amount in its unit and a direction (a pressure is always square into the faces). */
export interface Load {
  id: string;
  faces: HeldFace[];
  amount: number;
  unit: LoadUnit;
  direction: Direction;
}

/** How fine the mesh is asked to be when the solver comes (T4); kept now so a study is complete. */
export type MeshSize = "coarse" | "normal" | "fine";

export const MESH_SIZES: readonly MeshSize[] = ["coarse", "normal", "fine"];

/** One static stress study on one Design body. */
export interface Study {
  id: string;
  name: string;
  kind: "static";
  /** The body by its stable reference and the name Design showed it by when picked ("Body 1"); null until one is picked. */
  body: { ref: BodyReference; label: string } | null;
  fixtures: Fixture[];
  loads: Load[];
  mesh: MeshSize;
}

/** What the project keeps for TestLab (project.workspaces.simulate). */
export interface TestLabData {
  version: 1;
  studies: Study[];
  /** The next number for an id (study-n, fixture-n, load-n), never reused. */
  nextId: number;
}

export const TESTLAB_VERSION = 1;

/** The biggest amount a box takes: 1,000,000 N (about 100 tonnes hanging), 1,000,000 kg or 1,000,000 kPa (1 GPa). */
export const MAX_AMOUNT = 1_000_000;

export const emptyTestLab = (): TestLabData => ({ version: 1, studies: [], nextId: 1 });

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isRef = (x: unknown, kind: "face" | "body"): boolean => isObject(x) && x.kind === kind && typeof x.id === "string" && x.id !== "";

function readFaces(x: unknown, where: string): HeldFace[] {
  if (!Array.isArray(x)) throw new Error(`${where}: its faces are not a list`);
  return x.map((f, i) => {
    if (!isObject(f) || !isRef(f.ref, "face") || typeof f.label !== "string") throw new Error(`${where}: face ${i + 1} is not a face reference with a name`);
    const ref = f.ref as Record<string, unknown>;
    return { ref: { kind: "face", id: ref.id as StableId }, label: f.label };
  });
}

/**
 * The project's TestLab data, checked: nothing there yet is an empty
 * TestLab; data from a newer SpindleLabs, or that breaks a rule (a load
 * with no usable amount, a pressure not square into its faces, two items
 * with one id), is refused in words, never opened half-read.
 */
export function readTestLab(data: unknown): TestLabData {
  if (data === undefined || data === null) return emptyTestLab();
  if (!isObject(data)) throw new Error("TestLab's data is not an object");
  if (typeof data.version !== "number" || !Number.isInteger(data.version)) throw new Error("TestLab's data has no version");
  if (data.version > TESTLAB_VERSION) throw new NewerFormatError(`TestLab's data is version ${data.version}, from a newer SpindleLabs; this one reads up to version ${TESTLAB_VERSION}`);
  if (data.version < 1) throw new Error(`TestLab's data version ${data.version} is not one SpindleLabs ever wrote`);
  if (typeof data.nextId !== "number" || !Number.isInteger(data.nextId) || data.nextId < 1) throw new Error("TestLab's id counter is not a whole number from 1");
  if (!Array.isArray(data.studies)) throw new Error("TestLab's studies are not a list");
  const ids = new Set<string>();
  const own = (id: unknown, where: string): string => {
    if (typeof id !== "string" || !/^(study|fixture|load)-\d+$/.test(id)) throw new Error(`${where} has no usable id`);
    if (ids.has(id)) throw new Error(`${where}: the id ${id} is used twice`);
    if (Number(id.split("-")[1]) >= (data.nextId as number)) throw new Error(`${where}: the id ${id} is not below the counter`);
    ids.add(id);
    return id;
  };
  const studies = data.studies.map((s, i): Study => {
    const where = `TestLab's study ${i + 1}`;
    if (!isObject(s)) throw new Error(`${where} is not an object`);
    const id = own(s.id, where);
    if (!id.startsWith("study-")) throw new Error(`${where}'s id ${id} is not a study's`);
    if (typeof s.name !== "string" || s.name.trim() === "") throw new Error(`${where} has no name`);
    if (s.kind !== "static") throw new Error(`${where} is a ${String(s.kind)} study, which this SpindleLabs can't read`);
    let body: Study["body"] = null;
    if (s.body !== null) {
      if (!isObject(s.body) || !isRef(s.body.ref, "body") || typeof s.body.label !== "string") throw new Error(`${where}'s body is not a body reference with a name`);
      body = { ref: { kind: "body", id: (s.body.ref as Record<string, unknown>).id as StableId }, label: s.body.label };
    }
    if (!Array.isArray(s.fixtures) || !Array.isArray(s.loads)) throw new Error(`${where}'s holds or loads are not a list`);
    const fixtures = s.fixtures.map((f, k): Fixture => {
      const at = `${where}, hold ${k + 1}`;
      if (!isObject(f)) throw new Error(`${at} is not an object`);
      const fid = own(f.id, at);
      if (!fid.startsWith("fixture-")) throw new Error(`${at}'s id ${fid} is not a hold's`);
      return { id: fid, faces: readFaces(f.faces, at) };
    });
    const loads = s.loads.map((l, k): Load => {
      const at = `${where}, load ${k + 1}`;
      if (!isObject(l)) throw new Error(`${at} is not an object`);
      const lid = own(l.id, at);
      if (!lid.startsWith("load-")) throw new Error(`${at}'s id ${lid} is not a load's`);
      if (!UNITS.includes(l.unit as LoadUnit)) throw new Error(`${at} is in ${String(l.unit)}, not N, kg or kPa`);
      if (!DIRECTIONS.includes(l.direction as Direction)) throw new Error(`${at} pushes ${String(l.direction)}, not a direction TestLab knows`);
      const why = amountRefusal(l.amount as number);
      if (typeof l.amount !== "number" || why !== null) throw new Error(`${at}: ${why ?? "its amount is not a number"}`);
      if (l.unit === "kPa" && l.direction !== "into") throw new Error(`${at} is a pressure, which only pushes square into its faces`);
      return { id: lid, faces: readFaces(l.faces, at), amount: l.amount, unit: l.unit as LoadUnit, direction: l.direction as Direction };
    });
    if (!MESH_SIZES.includes(s.mesh as MeshSize)) throw new Error(`${where}'s mesh size ${String(s.mesh)} is not coarse, normal or fine`);
    return { id, name: s.name, kind: "static", body, fixtures, loads, mesh: s.mesh as MeshSize };
  });
  return { version: 1, studies, nextId: data.nextId };
}

/** Why an amount can't be a load's, in words; null when it can. Above 0 and at most MAX_AMOUNT; 0 pushes nothing. */
export function amountRefusal(amount: number): string | null {
  if (!Number.isFinite(amount)) return "Type the load as a number.";
  if (amount <= 0) return "A load must be more than 0: to push the other way, change its direction.";
  if (amount > MAX_AMOUNT) return `A load can be at most ${MAX_AMOUNT.toLocaleString("en")} in its unit.`;
  return null;
}

/** A load's force in newtons: N as typed, kg × G; a pressure has no single force (it depends on the area), so null. */
export function newtons(load: Pick<Load, "amount" | "unit">): number | null {
  if (load.unit === "N") return load.amount;
  if (load.unit === "kg") return load.amount * G;
  return null;
}

/** A number of newtons in words: whole newtons from 100 N, else three significant figures ("49.0 N", "1,200 N"). */
export function newtonWords(n: number): string {
  return Math.abs(n) >= 100 ? `${Math.round(n).toLocaleString("en")} N` : `${n.toPrecision(3)} N`;
}

/** What a load does, in words: "5 kg hanging (49.0 N) down on 1 face". */
export function loadWords(load: Load): string {
  const faces = load.faces.length === 1 ? "1 face" : `${load.faces.length} faces`;
  const amount = load.amount.toLocaleString("en", { maximumFractionDigits: 6 });
  if (load.unit === "kPa") return `${amount} kPa pressure, square into ${faces}`;
  const n = newtons(load)!;
  const force = load.unit === "kg" ? `${amount} kg hanging (${newtonWords(n)})` : `${amount} N`;
  return `${force} ${DIRECTION_WORDS[load.direction]} on ${faces}`;
}

const take = (data: TestLabData, kind: "study" | "fixture" | "load"): [string, TestLabData] => [`${kind}-${data.nextId}`, { ...data, nextId: data.nextId + 1 }];

const withStudy = (data: TestLabData, study: Study): TestLabData => ({ ...data, studies: data.studies.map((s) => (s.id === study.id ? study : s)) });

/** A new study of `body` (or of none yet), named "Study n" by the next free number, with one empty hold and no loads. */
export function addStudy(data: TestLabData, body: Study["body"]): { data: TestLabData; study: Study } {
  const [id, a] = take(data, "study");
  const [fid, b] = take(a, "fixture");
  const names = new Set(data.studies.map((s) => s.name.toLowerCase()));
  let n = data.studies.length + 1;
  while (names.has(`study ${n}`)) n++;
  const study: Study = { id, name: `Study ${n}`, kind: "static", body, fixtures: [{ id: fid, faces: [] }], loads: [], mesh: "normal" };
  return { data: { ...b, studies: [...data.studies, study] }, study };
}

/** The study on another body: its holds and loads are emptied, since their faces were the old body's. */
export function chooseBody(data: TestLabData, studyId: string, body: { ref: BodyReference; label: string }): TestLabData {
  const s = studyOf(data, studyId);
  if (s.body?.ref.id === body.ref.id) return s.body.label === body.label ? data : withStudy(data, { ...s, body });
  return withStudy(data, { ...s, body, fixtures: s.fixtures.map((f) => ({ ...f, faces: [] })), loads: [] });
}

/** The study with this id; throws for one that isn't there (a page bug, never the user's). */
export function studyOf(data: TestLabData, studyId: string): Study {
  const s = data.studies.find((x) => x.id === studyId);
  if (!s) throw new Error(`there is no study ${studyId}`);
  return s;
}

/** Adds the face to the faces, or takes it out when it is there (the same stable name): a tap on a picked face un-picks it. */
function toggled(faces: readonly HeldFace[], face: HeldFace): HeldFace[] {
  return faces.some((f) => f.ref.id === face.ref.id) ? faces.filter((f) => f.ref.id !== face.ref.id) : [...faces, face];
}

/** The face held, or let go when it already is; a face held is taken off every load (a face is either held or pushed, never both). */
export function toggleHeld(data: TestLabData, studyId: string, fixtureId: string, face: HeldFace): TestLabData {
  const s = studyOf(data, studyId);
  const fixtures = s.fixtures.map((f) => (f.id === fixtureId ? { ...f, faces: toggled(f.faces, face) } : f));
  if (!s.fixtures.some((f) => f.id === fixtureId)) throw new Error(`there is no hold ${fixtureId}`);
  const holding = fixtures.some((f) => f.faces.some((x) => x.ref.id === face.ref.id));
  const loads = holding ? s.loads.map((l) => ({ ...l, faces: l.faces.filter((x) => x.ref.id !== face.ref.id) })) : s.loads;
  return withStudy(data, { ...s, fixtures, loads });
}

/** The face pushed by the load, or no longer when it already is; a face pushed is let go by every hold. */
export function togglePushed(data: TestLabData, studyId: string, loadId: string, face: HeldFace): TestLabData {
  const s = studyOf(data, studyId);
  if (!s.loads.some((l) => l.id === loadId)) throw new Error(`there is no load ${loadId}`);
  const loads = s.loads.map((l) => (l.id === loadId ? { ...l, faces: toggled(l.faces, face) } : l));
  const pushing = loads.some((l) => l.faces.some((x) => x.ref.id === face.ref.id));
  const fixtures = pushing ? s.fixtures.map((f) => ({ ...f, faces: f.faces.filter((x) => x.ref.id !== face.ref.id) })) : s.fixtures;
  return withStudy(data, { ...s, fixtures, loads });
}

/** A new load on no faces yet: 10 N down, the starting values a person changes. */
export function addLoad(data: TestLabData, studyId: string): { data: TestLabData; load: Load } {
  const s = studyOf(data, studyId);
  const [id, next] = take(data, "load");
  const load: Load = { id, faces: [], amount: 10, unit: "N", direction: "down" };
  return { data: withStudy(next, { ...s, loads: [...s.loads, load] }), load };
}

/** Takes a load out. */
export function removeLoad(data: TestLabData, studyId: string, loadId: string): TestLabData {
  const s = studyOf(data, studyId);
  return withStudy(data, { ...s, loads: s.loads.filter((l) => l.id !== loadId) });
}

/**
 * A load's amount, unit and direction, checked: refused in words for an
 * amount out of range, and a pressure always pushes square into its faces
 * (choosing kPa sets "into"; another direction for a pressure is refused).
 */
export function setLoad(data: TestLabData, studyId: string, loadId: string, change: Partial<Pick<Load, "amount" | "unit" | "direction">>): { data: TestLabData } | { refused: string } {
  const s = studyOf(data, studyId);
  const old = s.loads.find((l) => l.id === loadId);
  if (!old) throw new Error(`there is no load ${loadId}`);
  const next: Load = { ...old, ...change };
  if (change.unit === "kPa" && change.direction === undefined) next.direction = "into";
  const why = amountRefusal(next.amount);
  if (why !== null) return { refused: why };
  if (next.unit === "kPa" && next.direction !== "into") return { refused: "A pressure always pushes square into its faces: choose N or kg to push another way." };
  return { data: withStudy(data, { ...s, loads: s.loads.map((l) => (l.id === loadId ? next : l)) }) };
}

/** Every face reference the study holds, holds first then loads, each once, in that order: what faces.ts asks Design to find. */
export function studyFaces(study: Study): HeldFace[] {
  const seen = new Set<string>();
  const out: HeldFace[] = [];
  for (const f of [...study.fixtures.flatMap((x) => x.faces), ...study.loads.flatMap((x) => x.faces)]) {
    if (seen.has(f.ref.id)) continue;
    seen.add(f.ref.id);
    out.push(f);
  }
  return out;
}

/**
 * What stops the study from being solved, in words, first problem first;
 * empty when it is ready. Lost or shared faces come from faces.ts.
 */
export function readyProblems(study: Study, lost: readonly string[]): string[] {
  const out: string[] = [];
  if (study.body === null) return ["Pick a body to test."];
  if (lost.length > 0) out.push(...lost);
  if (!study.fixtures.some((f) => f.faces.length > 0)) out.push("Pick at least one face to hold in place: with nothing held the part would just fly away.");
  if (study.loads.length === 0) out.push("Add a load: with nothing pushing, nothing bends.");
  for (const [i, l] of study.loads.entries()) if (l.faces.length === 0) out.push(`Load ${i + 1} is on no face yet: pick the faces it pushes.`);
  return out;
}
