// Measure (step 35e2l2, measure-tool.ts): what the panel says and draws for
// the kernel's answer, worked out by hand; the picking rules against a plain
// model over seeded sessions; and bugs planted in measure-tool.ts, each of
// which a test here must catch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Measured } from "@fission/core";
import * as tool from "../src/measure-tool.ts";

type Tool = typeof tool;
const face = (body: number, index: number): tool.MeasureTarget => ({ body, kind: "face", index });
const edge = (body: number, index: number): tool.MeasureTarget => ({ body, kind: "edge", index });
const body = (b: number): tool.MeasureTarget => ({ body: b, kind: "body" });

/** Two 10 mm cubes, the second 15 mm along x: the near faces x = 10 and x = 25 face each other. */
const CUBES: Measured = {
  first: { kind: "plane", area: 100, direction: [1, 0, 0] },
  second: { kind: "plane", area: 100, direction: [-1, 0, 0] },
  distance: { distance: 15, from: [10, 5, 5], to: [25, 5, 5] },
  angle: 180,
};

test("hand-worked: two facing cube faces 15 mm apart, in mm and in inches", () => {
  // Distance 15 mm, all of it along x (25 − 10), none along y or z. The outward normals point opposite ways: 180°.
  // Each face is 10 × 10 = 100 mm².
  assert.deepEqual(tool.measureRows(CUBES, "mm"), [
    { id: "distance", label: "Distance", value: "15 mm" },
    { id: "dx", label: "Along X", value: "15 mm" },
    { id: "dy", label: "Along Y", value: "0 mm" },
    { id: "dz", label: "Along Z", value: "0 mm" },
    { id: "angle", label: "Angle", value: "180°" },
    { id: "first-area", label: "First area", value: "100 mm²" },
    { id: "second-area", label: "Second area", value: "100 mm²" },
  ]);
  // In inches: 15 / 25.4 = 0.590551… → "0.591 in"; 100 mm² / 25.4² = 100 / 645.16 = 0.155000… → "0.155 in²".
  const inches = tool.measureRows(CUBES, "in");
  assert.equal(inches.find((r) => r.id === "distance")!.value, "0.591 in");
  assert.equal(inches.find((r) => r.id === "first-area")!.value, "0.155 in²");
  assert.equal(inches.find((r) => r.id === "angle")!.value, "180°", "an angle has no unit to change");
});

test("hand-worked: the along-axis rows go first pick to second, signs kept", () => {
  // From (3, 4, 12) to (0, 0, 0): along x 0 − 3 = −3, along y 0 − 4 = −4, along z −12; the distance √(9 + 16 + 144) = 13.
  const m: Measured = { first: { kind: "vertex", point: [3, 4, 12] }, second: { kind: "vertex", point: [0, 0, 0] }, distance: { distance: 13, from: [3, 4, 12], to: [0, 0, 0] } };
  const rows = tool.measureRows(m, "mm");
  assert.deepEqual(rows.slice(0, 4).map((r) => r.value), ["13 mm", "-3 mm", "-4 mm", "-12 mm"]);
  // A corner's own fact is its position, each coordinate in the unit.
  assert.deepEqual(rows.slice(4), [
    { id: "first-point", label: "First position", value: "3, 4, 12 mm" },
    { id: "second-point", label: "Second position", value: "0, 0, 0 mm" },
  ]);
});

test("hand-worked: one pick shows its own facts only; a circle edge its radius and diameter, an arc its sweep", () => {
  // A circle edge of radius 5 round (0, 0, 10): length 2π·5 = 31.4159… → "31.416 mm", diameter 10.
  const circle: Measured = { first: { kind: "circle", length: 10 * Math.PI, radius: 5, centre: [0, 0, 10], direction: [0, 0, 1] } };
  assert.deepEqual(tool.measureRows(circle, "mm"), [
    { id: "first-length", label: "Length", value: "31.416 mm" },
    { id: "first-radius", label: "Radius", value: "5 mm" },
    { id: "first-diameter", label: "Diameter", value: "10 mm" },
    { id: "first-centre", label: "Centre", value: "0, 0, 10 mm" },
  ]);
  // A quarter arc of radius 2: length 2π·2/4 = π = 3.14159… → "3.142 mm", sweep 90°.
  const arc: Measured = { first: { kind: "arc", length: Math.PI, radius: 2, sweep: 90, centre: [1, 1, 0] } };
  assert.deepEqual(tool.measureRows(arc, "mm").map((r) => [r.id, r.value]), [
    ["first-length", "3.142 mm"],
    ["first-radius", "2 mm"],
    ["first-diameter", "4 mm"],
    ["first-sweep", "90°"],
    ["first-centre", "1, 1, 0 mm"],
  ]);
  // A round face's centre is a point on its axis, not a place on the face: left out. Radius 3, area 2π·3·10 = 188.495… mm².
  const cyl: Measured = { first: { kind: "cylinder", radius: 3, area: 60 * Math.PI, centre: [0, 0, 0], direction: [0, 0, 1] } };
  assert.deepEqual(tool.measureRows(cyl, "mm").map((r) => r.id), ["first-radius", "first-diameter", "first-area"]);
  assert.equal(tool.measureRows(cyl, "mm")[2].value, "188.496 mm²");
  // A whole body: its area and volume. A 10 mm cube: 600 mm², 1000 mm³; in inches 1000 / 25.4³ = 1000 / 16387.064 = 0.0610237… → "0.061 in³".
  const cube: Measured = { first: { kind: "body", area: 600, volume: 1000 } };
  assert.deepEqual(tool.measureRows(cube, "mm").map((r) => r.value), ["600 mm²", "1000 mm³"]);
  assert.deepEqual(tool.measureRows(cube, "in").map((r) => r.value), ["0.93 in²", "0.061 in³"]);
});

test("hand-worked: centre to centre comes after the angle, and two parallel holes read 0°", () => {
  // Two holes of radius 2 with axes along z through (0, 0) and (6, 8): centre to centre √(36 + 64) = 10, the gap 10 − 2 − 2 = 6.
  const m: Measured = {
    first: { kind: "cylinder", radius: 2, area: 100, centre: [0, 0, 0], direction: [0, 0, 1] },
    second: { kind: "cylinder", radius: 2, area: 100, centre: [6, 8, 0], direction: [0, 0, 1] },
    distance: { distance: 6, from: [1.2, 1.6, 0], to: [4.8, 6.4, 0] },
    centres: { distance: 10, from: [0, 0, 0], to: [6, 8, 0] },
    angle: 0,
  };
  assert.deepEqual(tool.measureRows(m, "mm").slice(0, 6).map((r) => `${r.label} ${r.value}`), ["Distance 6 mm", "Along X 3.6 mm", "Along Y 4.8 mm", "Along Z 0 mm", "Angle 0°", "Centre to centre 10 mm"]);
});

test("the numbers in words: decimals, small areas and nothing that isn't a number", () => {
  assert.equal(tool.degrees(33.6900675), "33.69°"); // atan(2/3) = 33.690…°
  assert.equal(tool.degrees(-0.001), "0°");
  assert.equal(tool.degrees(Number.NaN), "—");
  assert.equal(tool.amount(1000), "1000");
  assert.equal(tool.amount(0.000155), "0.000155"); // 3 significant digits below 1, so a tiny area isn't "0"
  assert.equal(tool.amount(0.0001554), "0.000155");
  assert.equal(tool.amount(1.23456), "1.235");
  assert.equal(tool.amount(-0.0000001), "-0.0000001");
  assert.equal(tool.amount(Number.POSITIVE_INFINITY), "—");
  // A 0.1 mm square face: 0.01 mm² = 0.01 / 645.16 in² = 0.0000155 in².
  assert.equal(tool.area(0.01, "in"), "0.0000155 in²");
});

test("hand-worked: the line drawn and its legend; none with one pick", () => {
  assert.deepEqual(tool.measureOverlay(CUBES, "mm"), {
    id: tool.MEASURE_OVERLAY,
    label: "Distance 15 mm",
    detail: "The shortest distance between the two things measured.",
    marks: [],
    places: [{ severity: "info", from: [10, 5, 5], to: [25, 5, 5] }, { severity: "info", point: [10, 5, 5] }, { severity: "info", point: [25, 5, 5] }],
  });
  assert.equal(tool.measureOverlay(CUBES, "in")!.label, "Distance 0.591 in");
  assert.equal(tool.measureOverlay({ first: CUBES.first }, "mm"), null);
  assert.equal(tool.measureOverlay(null, "mm"), null);
});

test("pick words: a part's kind and its body; a whole body by its name", () => {
  assert.equal(tool.pickWords({ kind: "plane" }, "Body 2"), "Flat face of Body 2");
  assert.equal(tool.pickWords({ kind: "circle" }, "Body 1"), "Circle edge of Body 1");
  assert.equal(tool.pickWords({ kind: "body" }, "Body 3"), "Body 3");
  assert.equal(new Set(Object.values(tool.KIND_WORDS)).size, Object.keys(tool.KIND_WORDS).length, "every kind has its own words");
});

test("hand-worked: the picks fill first then second, a third starts again, a picked thing clicked again goes", () => {
  let p = tool.NO_PICKS;
  assert.equal(tool.measureHint(p), "Click a face, edge or corner to measure. Double-click picks a whole body.");
  p = tool.picked(p, face(0, 3));
  assert.deepEqual(p, { first: face(0, 3), second: null });
  assert.equal(tool.measureHint(p), "Click a second thing to measure the distance and angle between them.");
  p = tool.picked(p, edge(1, 2));
  assert.deepEqual(p, { first: face(0, 3), second: edge(1, 2) });
  assert.equal(tool.measureHint(p), "Click another thing to start a new measurement.");
  // A face and an edge of the same number on the same body are not the same thing.
  p = tool.picked(p, edge(0, 3));
  assert.deepEqual(p, { first: edge(0, 3), second: null });
  p = tool.picked(p, body(0));
  // The first clicked again: it goes, the second (none here) moving up; then the body clicked again goes too.
  assert.deepEqual(tool.picked(p, edge(0, 3)), { first: body(0), second: null });
  assert.deepEqual(tool.picked(p, body(0)), { first: edge(0, 3), second: null });
  assert.deepEqual(tool.picked(tool.picked(p, edge(0, 3)), body(0)), tool.NO_PICKS);
  // Body 0 whole and body 1 whole are different things.
  assert.deepEqual(tool.picked({ first: body(0), second: null }, body(1)), { first: body(0), second: body(1) });
});

// ---- Seeded: the picking rules against a plain model. ----

/** A small seeded generator (mulberry32): the same seed gives the same clicks. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The rules as a list: a thing in the list clicked again leaves it; otherwise it is added, or starts a new list once two are there. */
function model(list: readonly string[], key: string): string[] {
  if (list.includes(key)) return list.filter((k) => k !== key);
  return list.length < 2 ? [...list, key] : [key];
}
const keyOf = (t: tool.MeasureTarget) => (t.kind === "body" ? `${t.body}:body` : `${t.body}:${t.kind}:${t.index}`);

/** One session of `clicks` random clicks on a few things (so repeats are common); the first disagreement, or null. */
function session(m: Tool, seed: number, clicks: number): string | null {
  const r = random(seed);
  const kinds = ["face", "edge", "vertex", "body"] as const;
  let p = m.NO_PICKS;
  let list: string[] = [];
  for (let i = 0; i < clicks; i++) {
    const kind = kinds[Math.floor(r() * kinds.length)];
    const b = Math.floor(r() * 2);
    const t: tool.MeasureTarget = kind === "body" ? { body: b, kind } : { body: b, kind, index: Math.floor(r() * 3) };
    p = m.picked(p, t);
    list = model(list, keyOf(t));
    const got = [p.first, p.second].filter((x) => x !== null).map((x) => keyOf(x!));
    if (p.first === null && p.second !== null) return `seed ${seed} click ${i}: picks: a second with no first`;
    if (got.join(" ") !== list.join(" ")) return `seed ${seed} click ${i}: picks: ${got.join(" ")} where the model has ${list.join(" ")}`;
    const hint = m.measureHint(p);
    const want = list.length === 0 ? "Click a face" : list.length === 1 ? "Click a second" : "Click another";
    if (!hint.startsWith(want)) return `seed ${seed} click ${i}: hint: "${hint}" with ${list.length} picked`;
  }
  return null;
}

const SEEDS = 200;
test(`seeded: ${SEEDS} sessions of 60 clicks pick as the plain model does`, () => {
  const base = Number(process.env.FISSION_SEED ?? 3522);
  for (let seed = base; seed < base + SEEDS; seed++) assert.equal(session(tool, seed, 60), null, `FISSION_SEED=${seed} replays it`);
});

// ---- Bugs planted in measure-tool.ts, each caught here. ----

const SOURCE = new URL("../src/measure-tool.ts", import.meta.url);
const CORE = new URL("../../../packages/core/src/index.ts", import.meta.url).href;

interface Plant {
  name: string;
  find: string;
  replace: string;
  /** Which check must catch it: the seeded sessions' check name, or "rows" for the hand-worked rows. */
  caught: string;
}

const PLANTS: Plant[] = [
  { name: "second-clicked-again-stays", find: "if (same(p.second, t)) return { first: p.first, second: null };", replace: "", caught: "picks" },
  { name: "first-clicked-again-keeps-second", find: "if (same(p.first, t)) return { first: p.second, second: null };", replace: "if (same(p.first, t)) return { first: null, second: p.second };", caught: "picks" },
  { name: "third-click-replaces-second", find: "  return { first: t, second: null };\n}", replace: "  return { first: p.first, second: t };\n}", caught: "picks" },
  { name: "face-and-edge-alike", find: "a.body === b.body && a.kind === b.kind &&", replace: "a.body === b.body &&", caught: "picks" },
  { name: "hint-stuck-on-second", find: "if (p.second === null) return \"Click a second", replace: "if (p.first !== null) return \"Click a second", caught: "hint" },
  { name: "along-second-to-first", find: "g.to[i] - g.from[i]", replace: "g.from[i] - g.to[i]", caught: "rows" },
  { name: "diameter-is-radius", find: "formatLength(2 * f.radius, unit)", replace: "formatLength(f.radius, unit)", caught: "rows" },
  { name: "area-in-mm-always", find: "`${amount(areaIn(mm2, unit))} ${unit}²`", replace: "`${amount(mm2)} ${unit}²`", caught: "rows" },
  { name: "second-facts-dropped", find: "if (m.second) rows.push(...factRows(m.second, unit, \"second\", true));", replace: "", caught: "rows" },
  { name: "cylinder-centre-shown", find: "if (f.centre && f.kind !== \"cylinder\")", replace: "if (f.centre)", caught: "rows" },
];

/** measure-tool.ts with `plant` made, loaded from a temporary copy that imports the real core. */
async function planted(plant: Plant, dir: string): Promise<Tool> {
  const text = readFileSync(SOURCE, "utf8");
  const at = text.indexOf(plant.find);
  assert.ok(at >= 0 && text.indexOf(plant.find, at + 1) < 0, `${plant.name}: the text to replace must be in measure-tool.ts exactly once: ${plant.find}`);
  const copy = (text.slice(0, at) + plant.replace + text.slice(at + plant.find.length)).replace(/from "@fission\/core"/g, `from "${CORE}"`);
  const file = join(dir, `measure-tool-${plant.name}.ts`);
  writeFileSync(file, copy);
  return import(pathToFileURL(file).href);
}

/** The hand-worked rows above, as one check: the first wrong row, or null. */
function rowsCheck(m: Tool): string | null {
  const two: Measured = { ...CUBES, second: { kind: "circle", length: 10 * Math.PI, radius: 5, centre: [0, 0, 10] } };
  const want = (rows: tool.MeasureRow[], id: string, value: string) => (rows.find((r) => r.id === id)?.value === value ? null : `rows: ${id} is ${rows.find((r) => r.id === id)?.value} not ${value}`);
  const rows = m.measureRows(two, "mm");
  const cyl = m.measureRows({ first: { kind: "cylinder", radius: 3, area: 645.16, centre: [0, 0, 0] } }, "in");
  return want(rows, "dx", "15 mm") ?? want(rows, "second-diameter", "10 mm") ?? want(cyl, "first-area", "1 in²") ?? (cyl.some((r) => r.id === "first-centre") ? "rows: a round face's centre shown" : null);
}

test("each bug planted in measure-tool.ts is caught, by the check recorded for it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "measure-planted-"));
  try {
    const clean = await planted({ name: "none", find: "export const MEASURE_OVERLAY", replace: "export const MEASURE_OVERLAY", caught: "" }, dir);
    assert.equal(session(clean, 1, 200), null, "the unplanted copy passes the sessions");
    assert.equal(rowsCheck(clean), null, "the unplanted copy passes the rows");
    for (const plant of PLANTS) {
      const m = await planted(plant, dir);
      let caught = rowsCheck(m);
      for (let seed = 1; seed <= 5 && caught === null; seed++) caught = session(m, seed, 200);
      assert.ok(caught !== null, `${plant.name} was not caught`);
      assert.match(caught, new RegExp(`(^|: )${plant.caught}:`), `${plant.name} was caught by another check than "${plant.caught}": ${caught}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
