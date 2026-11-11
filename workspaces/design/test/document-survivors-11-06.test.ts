// Survivors of the Design reader on main, 2026-11-06 (issue #220 again):
// a Combine's bodies and name, version 7 data that holds what only version
// 8 brought, a sketch's dimension and constraint limits, and constraints on
// points a projection made. Each test names the change to the code it
// catches; the mutants no file can tell apart are explained, with the
// reason, in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DIMENSION_LIMITS, MAX_SKETCH_CONSTRAINTS, partDocument, readDesignDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch, drawCircle, drawLine, projectEdges } from "../src/sketch.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const clone = (x: unknown): Raw => JSON.parse(JSON.stringify(x));
const refused = (d: unknown, message: string | RegExp) => assert.throws(() => readDesignDocument(d), message instanceof RegExp ? message : { message });
/** Refused in words, never by a crash reading a field of null (a TypeError). */
const refusedInWords = (d: unknown) =>
  assert.throws(
    () => readDesignDocument(d),
    (e: unknown) => e instanceof Error && !(e instanceof TypeError),
  );

// ---------- a Combine ----------

const box = (id: string, label: string) => ({
  id,
  intent: { type: "box", parameters: { width: 10, depth: 10, height: 10 }, summary: "Box: 10 × 10 × 10 mm" },
  provenance: { self: { workspace: "design", id, label }, from: [] },
  dependsOn: [],
  suppressed: false,
});
const combine = (id: string, label: string, params: Raw, dependsOn: string[]) => ({
  id,
  intent: { type: "combine", parameters: { operation: "cut", keepTools: false, ...params }, summary: "Combine" },
  provenance: { self: { workspace: "design", id, label }, from: [] },
  dependsOn,
  suppressed: false,
});
/** Box 1, Box 2, a Combine (feature-3) cutting Box 2 from Box 1, then Box 3 (feature-4), as version 7 wrote it. */
const file = (params: Raw = {}, dependsOn = ["feature-1", "feature-2"], extra: Raw = {}): Raw => ({
  version: 7,
  nextId: 5,
  profiles: [],
  sketches: [],
  timeline: {
    features: [box("feature-1", "Box 1"), box("feature-2", "Box 2"), combine("feature-3", "Combine 1", { target: "body:feature-1", tools: ["body:feature-2"], ...params }, dependsOn), box("feature-4", "Box 3")],
  },
  bodies: [
    { id: "body:feature-1", number: 1 },
    { id: "body:feature-2", number: 2 },
    { id: "body:feature-4", number: 3 },
  ],
  nextBody: 4,
  ...extra,
});

test("a Combine can't use a body made after it in the timeline", () => {
  // Kills `there.at > byId.get(f.id)!.at` => false: Box 3 (feature-4) is a body, but it comes after the Combine (feature-3).
  assert.doesNotThrow(() => readDesignDocument(file()), "the file itself opens");
  refused(file({ tools: ["body:feature-4"] }, ["feature-1", "feature-4"]), "Design combine feature-3: tool body:feature-4 is not a body made before it in the timeline");
});

test("a Combine's dependsOn must match every maker, not only the first", () => {
  // Kills `makers.some(…)` => `makers.every(…)`: the first matches (feature-1) and the second doesn't (feature-4 for feature-2),
  // so "some differ" is true and "all differ" is false.
  refused(file({}, ["feature-1", "feature-4"]), "Design combine feature-3 must depend on exactly the items that made its target and tools, in their order (feature-1, feature-2)");
});

test("a Combine's piece is a body only when the bodies list numbers that very piece", () => {
  // Kills `isRecord(b) && b.id === id` => true, `||`, and `b.id === id` => true / `!==` (isBodyOf's piece check).
  // Combine 2 (feature-5) cuts Box 3 from piece 1 of Combine 1. The bodies list numbers piece 1 only, so piece 2 is no body.
  const two = (piece: string) => {
    const d = file();
    d.nextId = 6;
    d.timeline.features.push(combine("feature-5", "Combine 2", { target: piece, tools: ["body:feature-4"] }, ["feature-3", "feature-4"]));
    d.bodies.push({ id: "body:feature-3/piece:1", number: 4 });
    d.nextBody = 5;
    return d;
  };
  assert.doesNotThrow(() => readDesignDocument(two("body:feature-3/piece:1")), "piece 1 is listed, so it is a body");
  refused(two("body:feature-3/piece:2"), "Design combine feature-5: its target body:feature-3/piece:2 is not a body made before it in the timeline");
});

test("a bodies list entry is a body id with nothing after the item's id", () => {
  // Kills /^body:([^:/]+)$/ => /^body:([^:/]+)/: without the end anchor "body:feature-1/x" would read as Box 1's body.
  const d = file();
  d.bodies.push({ id: "body:feature-1/x", number: 9 });
  d.nextBody = 10;
  refused(d, 'Design body body:feature-1/x is not "body:" and the id of an item that makes a body, or a piece of a Combine or of an extrude that joins, cuts or intersects');
});

test("a Combine with no name is given the next free Combine name", () => {
  // Kills isCombineItem(f) => false and "Combine" => "" in withRuledNames' kinds: an unnamed Combine is "Combine 1",
  // never "Item 1" (what an unknown kind would get) or " 1".
  const d = file();
  d.timeline.features[2].provenance.self.label = "";
  assert.equal(readDesignDocument(d).timeline.features[2].provenance.self.label, "Combine 1");
});

// ---------- version 7 data ----------

/** A box and Sketch 1 (sketch-2) with one line (points 3 and 4), saved as version 7 left it: no bodies list yet. */
function v7(): { raw: Raw; sketch: Raw } {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const raw = clone(drawLine(s.doc, s.id, [0, 0], [4, 2]).doc);
  raw.version = 7;
  delete raw.bodies;
  delete raw.nextBody;
  raw.nextId = 100;
  return { raw, sketch: raw.sketches[0] };
}
const V8_ONLY = "Design data says version 7 but has construction curves or dimensions, which version 8 brought";

test("version 7 data without a bodies list opens, its bodies numbered as they were shown", () => {
  // Kills `v3.version === 7` => false / `!==` in which versions may leave out the bodies' numbers.
  const d = readDesignDocument(v7().raw);
  assert.equal(d.version, 24); // read as the current version (24 from face sketches recording their side; 17 from constraints on followed points; 16 from Extrude Joins' own bodies; 15 from Combine results' edge names; 14 from circles' fits; 13 from Combine pieces' faces; 12 from Scale and Mirror; 11 from Duplicate; 10 from Extrude's Operation row)
  // One box (feature-1), the only body: number 1, and the next body gets 2.
  assert.deepEqual(d.bodies, [{ id: "body:feature-1", number: 1 }]);
  assert.equal(d.nextBody, 2);
});

test("version 7 data holding a distance or diameter dimension is refused; its other constraints are read", () => {
  // Kills the dimension check in hasVersion8Fields: each of `c.kind === "distance"` / `"diameter"` => false or `!==`,
  // "distance" / "diameter" => "", `||` => `&&`, the whole test => true / false, and its arrow functions => undefined.
  for (const kind of ["distance", "diameter"]) {
    const { raw, sketch } = v7();
    sketch.constraints = [{ id: "constraint-90", kind, a: "point-3", b: "point-4", circle: "circle-9", value: 5 }];
    refused(raw, V8_ONLY);
  }
  const { raw, sketch } = v7();
  sketch.constraints = [{ id: "constraint-90", kind: "horizontal", a: "point-3", b: "point-4" }];
  assert.equal((readDesignDocument(raw).sketches[0].constraints[0] as { kind: string }).kind, "horizontal");
});

test("version 7 data with a construction curve in a kept shape is refused", () => {
  // Kills `(k) => curves(k.curves)` => `() => undefined`.
  const { raw } = v7();
  raw.kept = { "sketch-2": { points: [], curves: [{ id: "line-90", kind: "line", start: "point-3", end: "point-4", construction: true }] } };
  refused(raw, V8_ONLY);
});

test("version 7 data with a null where a sketch, a kept shape or a constraint goes is refused in words, never a crash", () => {
  // Kills `d.sketches.filter(isRecord)` => `d.sketches`, `Object.values(d.kept).filter(isRecord)` => without the filter,
  // and `isRecord(c) && …` => `isRecord(c) || …` (each would read a field of null).
  const a = v7();
  a.raw.sketches.push(null);
  refusedInWords(a.raw);
  const b = v7();
  b.raw.kept = { "sketch-2": null };
  refusedInWords(b.raw);
  const c = v7();
  c.sketch.constraints = [null];
  refused(c.raw, "Design sketch sketch-2: constraint 1 has no id");
});

// ---------- a sketch's dimensions and constraints ----------

/** A box and Sketch 1 (sketch-2) with one line from (0, 0) to (4, 2): points 3 and 4. */
function oneLine() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  return { doc: drawLine(s.doc, s.id, [0, 0], [4, 2]).doc, id: s.id };
}
const withConstraints = (doc: DesignDocument, list: unknown[]): Raw => {
  const raw = clone(doc);
  raw.sketches[0].constraints = list;
  raw.nextId = 20_000;
  return raw;
};

test(`a distance of exactly ${DIMENSION_LIMITS.max} mm is read; just above is refused`, () => {
  // Kills `v > DIMENSION_LIMITS.max` => `>=`. The limit is "from 0.001 to 200000000 mm", both ends allowed.
  const { doc } = oneLine();
  const at = (value: number) => withConstraints(doc, [{ id: "constraint-100", kind: "distance", a: "point-3", b: "point-4", value }]);
  assert.doesNotThrow(() => readDesignDocument(at(DIMENSION_LIMITS.max)));
  refused(at(DIMENSION_LIMITS.max * 1.1), /dimension constraint-100 needs a value from 0.001 to 200000000 mm/);
});

test("too many constraints names the sketch in the refusal", () => {
  // Kills `${at} has` => `` (the message would start " 8001 constraints").
  const { doc } = oneLine();
  const many = Array.from({ length: MAX_SKETCH_CONSTRAINTS + 1 }, (_, k) => ({ id: `constraint-${100 + k}`, kind: "fix", point: "point-3" }));
  refused(withConstraints(doc, many), `Design sketch sketch-2 has ${MAX_SKETCH_CONSTRAINTS + 1} constraints, more than the ${MAX_SKETCH_CONSTRAINTS} this SpindleLabs opens`);
});

// ---------- constraints on what a projection made ----------

const sketchOf = (doc: DesignDocument): Sketch => doc.sketches[0];
const lastPoint = (doc: DesignDocument) => sketchOf(doc).points.at(-1)!.id;
/** The file with one fix constraint on `point`, ids moved above the counter. */
const fixed = (doc: DesignDocument, point: string): Raw => withConstraints(doc, [{ id: "constraint-100", kind: "fix", point }]);
const FOLLOWS = (point: string) => `Design sketch sketch-2: constraint constraint-100 names only points that follow a body's edge (${point}), so the body holds them and the constraint could only fight it`;

test("a constraint can't hold any point a projection made: a projected point, a line's ends, a circle's centre, an arc's ends and centre", () => {
  // Kills, in the follows list: `c === undefined` => false (a projected point has no curve: reading c.kind would crash),
  // `[p.made]` => [], `c.kind === "line"` => true / false / `!==` and "line" => "", `[c.centre]` => [],
  // `c.kind === "circle"` => true / `!==`, and `[c.start, c.end, c.centre]` => [].
  const s = addSketch(partDocument("box", 40, 30, 20));
  const base = drawLine(s.doc, s.id, [100, 100], [104, 102]).doc; // points 3 and 4 follow nothing
  const point = projectEdges(base, s.id, [{ feature: "feature-1", edge: "front+left", shape: { kind: "point", at: [0, 0] } }]).doc;
  const line = projectEdges(base, s.id, [{ feature: "feature-1", edge: "front+top", shape: { kind: "line", a: [0, 10], b: [10, 10] } }]).doc;
  const circle = projectEdges(base, s.id, [{ feature: "feature-1", edge: "e1", shape: { kind: "circle", centre: [20, 20], radius: 5 } }]).doc;
  const arc = projectEdges(base, s.id, [{ feature: "feature-1", edge: "e1", shape: { kind: "arc", start: [10, 0], end: [0, 10], centre: [0, 0] } }]).doc;
  const curve = (doc: DesignDocument) => sketchOf(doc).curves.at(-1)! as Record<string, string>;
  const cases: [DesignDocument, string[]][] = [
    [point, [lastPoint(point)]],
    [line, [curve(line).start, curve(line).end]],
    [circle, [curve(circle).centre]],
    [arc, [curve(arc).start, curve(arc).end, curve(arc).centre]],
  ];
  for (const [doc, made] of cases) {
    assert.doesNotThrow(() => readDesignDocument(fixed(doc, "point-3")), "a point no projection made can be fixed");
    for (const p of made) refused(fixed(doc, p), FOLLOWS(p));
  }
});

test("a diameter can't size a projected circle, only a drawn one", () => {
  // Kills `c.kind === "diameter" && …` => false, `c.kind === "diameter"` => `!==` and "diameter" => "",
  // `p.made === c.circle` => true / false / `!==`, its arrow => undefined, and the message => "".
  const s = addSketch(partDocument("box", 40, 30, 20));
  const drawn = drawCircle(s.doc, s.id, [100, 100], 4);
  const both = projectEdges(drawn.doc, s.id, [{ feature: "feature-1", edge: "e1", shape: { kind: "circle", centre: [20, 20], radius: 5 } }]).doc;
  const projected = (sketchOf(both).curves.at(-1) as { id: string }).id;
  const diameter = (circle: string, value: number) => withConstraints(both, [{ id: "constraint-100", kind: "diameter", circle, value }]);
  assert.equal(readDesignDocument(diameter(drawn.id, 8)).sketches[0].constraints.length, 1, "the drawn circle (radius 4) takes a diameter of 8");
  refused(diameter(projected, 10), `Design sketch sketch-2: dimension constraint-100 sizes ${projected}, which is projected from a body, so the body says its size`);
  // Survivor 11-08 (`some` => `every`): with a second projection beside it, a line, the projected circle is still refused.
  const more = projectEdges(both, s.id, [{ feature: "feature-1", edge: "front+top", shape: { kind: "line", a: [0, 10], b: [10, 10] } }]).doc;
  refused(withConstraints(more, [{ id: "constraint-100", kind: "diameter", circle: projected, value: 10 }]), `Design sketch sketch-2: dimension constraint-100 sizes ${projected}, which is projected from a body, so the body says its size`);
});
