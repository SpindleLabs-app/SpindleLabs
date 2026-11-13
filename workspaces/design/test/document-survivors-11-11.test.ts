// Survivors of the Design reader on main, 2026-11-10 (issues #220 and
// #246 again, after Design data version 16): the version 15 upgrade
// (migrateDesignV15) renames an Extrude Join's piece 1 to the extrude's
// own body and piece k to piece k - 1, and must leave everything else as
// it was: other items' pieces, ids that are not text, entries that are not
// objects and lists that are not lists, all left for the checks to refuse
// in their own words. Each case says which change to the code it catches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateDesignV15, readDesignDocument } from "../src/document.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

/** Extrude 1 (feature-2), joining a sketch's square to Box 1: version 15 named its pieces body:feature-2/piece:k. */
const join = (id: unknown = "feature-2"): Raw => ({ id, intent: { type: "extrude", parameters: { sketch: "sketch-1", distance: 5, operation: "join", bodies: ["body:feature-1"] } } });
/** The same extrude cutting: its pieces keep their names in version 16. */
const cut: Raw = { id: "feature-3", intent: { type: "extrude", parameters: { sketch: "sketch-1", distance: 5, operation: "cut", bodies: ["body:feature-1"] } } };
/** A Combine joining (its operation is "join" too, but it is no extrude): its pieces keep their names. */
const combine: Raw = { id: "feature-4", intent: { type: "combine", parameters: { target: "body:feature-1", tools: ["body:feature-2/piece:1"], operation: "join", keepTools: false } } };
const up = (d: Raw) => migrateDesignV15(d) as Raw;

test("hand-worked: a Join's piece 1 is its own body and piece 2 is piece 1 everywhere a body is named; nothing else changes", () => {
  const d = {
    version: 15,
    timeline: { features: [join(), cut, { id: "feature-5", intent: { type: "move", parameters: { x: 1, bodies: ["body:feature-2/piece:2", "body:feature-3/piece:1"] } } }, { id: "feature-6", intent: { type: "duplicate", parameters: { body: "body:feature-2/piece:1" } } }, combine] },
    bodies: [{ id: "body:feature-2/piece:1", number: 2 }, { id: "body:feature-3/piece:1", number: 3 }],
    hidden: ["body:feature-2/piece:2", "folder-origin"],
  };
  const u = up(d);
  assert.equal(u.version, 16);
  // feature-2 is the only Join extrude, so only its pieces move down one: piece:1 is body:feature-2, piece:2 is piece:1.
  assert.deepEqual(u.timeline.features[2].intent.parameters.bodies, ["body:feature-2/piece:1", "body:feature-3/piece:1"]);
  assert.equal(u.timeline.features[3].intent.parameters.body, "body:feature-2");
  assert.deepEqual(u.timeline.features[4].intent.parameters, { ...combine.intent.parameters, tools: ["body:feature-2"] });
  assert.deepEqual(u.bodies, [{ id: "body:feature-2", number: 2 }, { id: "body:feature-3/piece:1", number: 3 }]);
  assert.deepEqual(u.hidden, ["body:feature-2/piece:1", "folder-origin"]);
});

test("a Cut's and a Combine's pieces keep their names (catches the Join test reduced to any extrude, or to any operation join)", () => {
  // The Combine joins and the extrude cuts; neither is an Extrude Join, so neither one's piece 1 is renamed.
  const d = { version: 15, timeline: { features: [cut, combine, { id: "feature-6", intent: { type: "duplicate", parameters: { body: "body:feature-4/piece:1" } } }] }, bodies: [{ id: "body:feature-3/piece:1", number: 2 }, { id: "body:feature-4/piece:1", number: 3 }] };
  const u = up(d);
  assert.deepEqual(u.bodies, d.bodies);
  assert.equal(u.timeline.features[2].intent.parameters.body, "body:feature-4/piece:1");
});

test("data with no timeline list is only given version 16 (catches the guard dropped, or its || made &&)", () => {
  // No timeline, a timeline that is not an object, and one whose features are not a list: nothing to rename.
  for (const timeline of [undefined, null, 5, { features: "feature-2" }]) {
    const d = { version: 15, ...(timeline === undefined ? {} : { timeline }), hidden: ["body:feature-2/piece:1"] };
    assert.deepEqual(up(d), { ...d, version: 16 }, JSON.stringify(timeline));
  }
});

test("features that are not an object, have no intent or no parameters are left as they are, a Join beside them still renamed", () => {
  // Each would throw (reading .intent of null, .type of undefined, .operation of undefined) if a guard were dropped.
  const odd = [null, 5, "feature-9", { id: "feature-7" }, { id: "feature-8", intent: 5 }, { id: "feature-9", intent: { type: "extrude" } }, { id: "feature-10", intent: { type: "move" } }];
  const u = up({ version: 15, timeline: { features: [...odd, join()] }, bodies: [{ id: "body:feature-2/piece:1", number: 2 }] });
  assert.deepEqual(u.timeline.features.slice(0, odd.length), odd);
  assert.deepEqual(u.bodies, [{ id: "body:feature-2", number: 2 }]);
});

test("a Join whose id is not text names no body, so a non-body id beside it is never taken for its own body", () => {
  // folder-origin has no item (bodyItem gives null); with a Join of id null, `item === null` is what keeps it out of
  // the renaming, which would refuse it as a Join's own body. Ids that are not text (7) are passed over the same way.
  // A list holding one id is no id either, though as text it reads "body:feature-2/piece:1".
  const u = up({ version: 15, timeline: { features: [join(null), join(7), join()] }, hidden: ["folder-origin", 7, ["body:feature-2/piece:1"]], bodies: [{ id: 7, number: 2 }] });
  assert.deepEqual(u.hidden, ["folder-origin", 7, ["body:feature-2/piece:1"]]);
  assert.deepEqual(u.bodies, [{ id: 7, number: 2 }]);
});

test("a parameter is renamed only where the item has it: no bodies, target, tools or body is added (catches each hasOwn made true)", () => {
  // A Move with no bodies, a Combine with neither target nor tools, a Copy with no body: each kept with exactly its keys.
  const bare = [{ id: "feature-5", intent: { type: "move", parameters: { x: 1 } } }, { id: "feature-6", intent: { type: "combine", parameters: { operation: "cut" } } }, { id: "feature-7", intent: { type: "duplicate", parameters: {} } }];
  const u = up({ version: 15, timeline: { features: [join(), ...bare] } });
  for (const [k, f] of bare.entries()) assert.deepStrictEqual(Object.keys(u.timeline.features[k + 1].intent.parameters), Object.keys(f.intent.parameters), f.id);
});

test("only a Copy's body is renamed: another item holding a body parameter keeps it (catches the duplicate test made true)", () => {
  // No other item has a body parameter, so the checks refuse this sketch's; the upgrade must not change it first.
  const sketch = { id: "sketch-1", intent: { type: "sketch", parameters: { plane: "XY", body: "body:feature-2/piece:1" } } };
  const u = up({ version: 15, timeline: { features: [join(), sketch] } });
  assert.equal(u.timeline.features[1].intent.parameters.body, "body:feature-2/piece:1");
});

test("lists that are not lists and bodies that are not objects or have no text id are left for the checks", () => {
  // A Move's bodies as text would throw on .map; a body entry of null would throw reading its id; 5 and { number: 2 }
  // must come back as they were, never given an id.
  const move = { id: "feature-5", intent: { type: "move", parameters: { x: 1, bodies: "body:feature-2/piece:1" } } };
  const u = up({ version: 15, timeline: { features: [join(), move] }, bodies: [5, null, { number: 2 }, { id: "body:feature-2/piece:2", number: 3 }], hidden: "body:feature-2/piece:1" });
  assert.equal(u.timeline.features[1].intent.parameters.bodies, "body:feature-2/piece:1");
  assert.deepStrictEqual(u.bodies, [5, null, { number: 2 }, { id: "body:feature-2/piece:1", number: 3 }]);
  assert.equal(u.hidden, "body:feature-2/piece:1");
});

test("no bodies or hidden list in the data adds none (catches either Array.isArray made true)", () => {
  const u = up({ version: 15, timeline: { features: [join()] } });
  assert.deepStrictEqual(Object.keys(u).sort(), ["timeline", "version"]);
});

test("the reader: shown planes that are not text are refused by name, as before the type test went (the change of 2026-11-11)", () => {
  // `includes` is false for 5 and for null, so the plane check alone refuses them, in the same words as "XY" (a plane named as sketches name it, not as the origin does).
  const d = { version: 22, nextId: 1, profiles: [], sketches: [], timeline: { features: [] }, bodies: [], nextBody: 1 };
  for (const [plane, words] of [[5, "5"], [null, "null"], ["XY", "XY"]] as const)
    assert.throws(() => readDesignDocument({ ...d, shownPlanes: [plane] }), { message: `Design data shows ${words}, which is not an origin plane` });
  assert.deepEqual(readDesignDocument({ ...d, shownPlanes: ["origin-xz"] }).shownPlanes, ["origin-xz"]);
});
