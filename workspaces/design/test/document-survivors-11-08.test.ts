// Survivors of the Design reader on main, 2026-11-08 (issue #220 again,
// after Duplicate, Mirror/Scale and Combine piece identity changed it): a
// Scale's and a Mirror's refusals, a Copy's fresh name, what versions 10
// and 12 brought, a region's curve limit, and version 8, 10, 11 and 12
// data written without bodies' numbers. Each test names the change to the
// code it catches; the mutants no file can tell apart are explained, with
// the reason, in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DESIGN_LIMITS, insertPreset, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertCombine } from "../src/combine.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const json = (d: DesignDocument): Raw => JSON.parse(JSON.stringify(d));
const refused = (d: unknown, message: string) => assert.throws(() => readDesignDocument(d), { message });
/** Box 1 (feature-1, 40 × 30 × 20) and Box 2 (feature-2, 10 × 10 × 10). */
const twoBoxes = () => insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10).doc;
/** The two boxes and a Move of Box 1 (feature-3, 5 mm along x). */
const moved = () => json(insertMove(twoBoxes(), ["body:feature-1"], { ...NO_MOVE, x: 5 }).doc);
/** The two boxes and a Copy of Box 1 (feature-3). */
const copied = () => json(insertDuplicates(twoBoxes(), ["body:feature-1"]).doc);
/** Box 1, then a 10 × 10 rectangle sketched on XY and extruded 5 mm (a plain extrude, no operation): its index and id. */
function extrudedBox(): { d: Raw; at: number; id: string } {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const r = drawRectangle(s.doc, s.id, [0, 0], [10, 10]);
  const { doc, id } = extrudeSketch(r.doc, s.id, 5, false);
  const d = json(doc);
  return { d, at: d.timeline.features.findIndex((f: Raw) => f.id === id), id };
}

test("a Scale or a Mirror that is not text is named as what it is, never written out as JSON", () => {
  // Kills `typeof p[MOVE_SCALE] === "string"` => true and `typeof p.mirror === "string"` => true: an object would
  // then be quoted as {}, where the words say "an object" (shown).
  const m = moved();
  m.timeline.features[2].intent.parameters.scale = {};
  refused(m, "Design move feature-3: scale an object is not a number above 0 other than 1");
  const c = copied();
  c.timeline.features[2].intent.parameters.mirror = {};
  refused(c, "Design duplicate feature-3 mirrors across an object, which is not an origin plane (XY, XZ or YZ)");
});

test("a Copy whose name is empty gets a fresh one, Copy 1", () => {
  // Kills `isDuplicateItem(f)` => false (it would be named as an item of no kind, "Item 1") and "Copy" => "" (" 1").
  const c = copied();
  assert.equal(c.timeline.features[2].provenance.self.label, "Copy 1", "as made");
  c.timeline.features[2].provenance.self.label = "";
  assert.equal(readDesignDocument(c).timeline.features[2].provenance.self.label, "Copy 1");
});

test("version 9 data with an extrude holding an operation, or its bodies, either one alone, is refused as version 10's", () => {
  // Kills `hasOwn(operation) || hasOwn(bodies)` => `&&`, and "operation" => "" and "bodies" => "": each field alone
  // is something only version 10 brought.
  for (const [key, value] of [["operation", "join"], ["bodies", []]] as const) {
    const { d, at } = extrudedBox();
    d.version = 9;
    d.timeline.features[at].intent.parameters[key] = value;
    refused(d, "Design data says version 9 but has an extrude that joins, cuts or intersects, which version 10 brought");
  }
});

test("an item that is no extrude of a sketch, holding bodies alone, is refused as holding an operation", () => {
  // Kills "bodies" => "" in the check that only an extrude of a sketch has an operation or its bodies.
  const d = json(partDocument("box", 40, 30, 20));
  d.timeline.features[0].intent.parameters.bodies = [];
  refused(d, "Design feature feature-1 has an operation, which only an extrude of a sketch has");
});

test("version 11 data with a Move holding a mirror is refused by the Move's own check: a Mirror is a Duplicate's", () => {
  // Kills `f.intent.type === "duplicate"` => true in what version 12 brought: the Move's mirror would read as a Mirror.
  const m = moved();
  m.version = 11;
  m.timeline.features[2].intent.parameters.mirror = "XY";
  refused(m, 'Design move feature-3 has a number "mirror" a move doesn\'t have');
});

test("a region naming more curves than a sketch may hold is refused, counting them", () => {
  // Kills `${where} names` => `` and "curves" => "" in the region's limit: 20,001 curves, one over the 20,000.
  assert.equal(DESIGN_LIMITS.sketch, 20_000);
  const { d, at, id } = extrudedBox();
  d.timeline.features[at].intent.parameters.region = { outer: Array.from({ length: 20_001 }, () => ({ curve: "line-1", reversed: false })), centroid: [0, 0] };
  refused(d, `Design feature ${id}'s region names 20001 curves, more than the 20000 this SpindleLabs opens`);
});

test("version 5 to 15 data written without bodies' numbers gets the ones it shows: Box 1's body is number 1", () => {
  // Kills `v3.version === N` => false and => `!==` for N = 8, 10, 11, 12, 13 and 14 (each would then read as numbered, and
  // be refused for having no bodies list).
  for (let v = 5; v <= 15; v++) {
    const d = json(partDocument("box", 40, 30, 20));
    delete d.bodies;
    delete d.nextBody;
    d.version = v;
    const r = readDesignDocument(d);
    assert.deepEqual([r.version, r.bodies, r.nextBody], [15, [{ id: "body:feature-1", number: 1 }], 2], `version ${v}`);
  }
});

test("a Copy's body given as a list holding a body id is refused, never read as that id", () => {
  // Kills `typeof id === "string"` => true in checkDuplicate: bodyItem would read ["body:feature-1"] as its text,
  // "body:feature-1", and the list would pass for Box 1's body.
  const c = copied();
  c.timeline.features[2].intent.parameters.body = ["body:feature-1"];
  refused(c, "Design duplicate feature-3 copies a list, which is not a body made before it in the timeline");
});

test("a Move's, a Combine's or a Join's body given as a list holding a body id is refused, never read as that id", () => {
  // Kills `typeof id === "string"` => true in checkMove, checkCombine and checkOperation, as for a Copy above.
  const m = moved();
  m.timeline.features[2].intent.parameters.bodies = [["body:feature-1"]];
  refused(m, "Design move feature-3 moves a list, which is not a body made before it in the timeline");
  const c = json(insertCombine(twoBoxes(), "body:feature-1", ["body:feature-2"], "cut", false).doc);
  const tool = structuredClone(c);
  tool.timeline.features[2].intent.parameters.tools = [["body:feature-2"]];
  refused(tool, "Design combine feature-3: tool a list is not a body made before it in the timeline");
  const target = structuredClone(c);
  target.timeline.features[2].intent.parameters.target = ["body:feature-1"];
  refused(target, "Design combine feature-3: its target a list is not a body made before it in the timeline");
  // Box 1, then a 10 × 10 rectangle extruded 5 mm and joined to Box 1's body.
  const s = addSketch(partDocument("box", 40, 30, 20));
  const r = drawRectangle(s.doc, s.id, [0, 0], [10, 10]);
  const { doc, id } = extrudeSketch(r.doc, s.id, 5, false, undefined, { operation: "join", bodies: ["body:feature-1"] });
  const j = json(doc);
  assert.doesNotThrow(() => readDesignDocument(j), "the join itself opens");
  j.timeline.features.find((f: Raw) => f.id === id).intent.parameters.bodies = [["body:feature-1"]];
  refused(j, `Design extrude ${id}: a list is not a body made before it in the timeline`);
});
