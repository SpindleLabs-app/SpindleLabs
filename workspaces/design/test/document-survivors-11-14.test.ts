// Survivors of the Design reader on main, 2026-11-13 (issues #220 and #246
// again, nightly run on b8c7f4f): the version 2 preset names
// (version3Named), version 4 face sketches given the world's frame
// (withDrawnBodies), the version 16 check for constraints on followed
// points (hasVersion17Fields), the version 19 kept-shape upgrade
// (migrateDesignV19), a face sketch's body size, a preset's dependsOn
// words, an extrude's other profiles (checkMore), its dependsOn order,
// kept keys starting with a slash and the followed-points refusal's list.
// Each test names the change to the code it catches; the mutants no file
// can tell apart are explained in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateDesignV19, migrateDesignV2, partDocument, readDesignDocument, withDrawnBodies, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { MORE_PROFILES_LIMIT } from "../src/extrude-profiles.ts";
import { drawnFrame, facePlane, worldFrame } from "../src/face-sketch.ts";
import { addFaceSketch, addSketch, drawLine, drawRectangle, projectEdges } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const clone = (x: unknown): Raw => JSON.parse(JSON.stringify(x));
const refused = (d: unknown, message: string) => assert.throws(() => readDesignDocument(d), { message });
/** Refused, but not by the version 17 check: the data's own fault is said by the checks after it. */
const refusedNotAsVersion17 = (d: unknown) =>
  assert.throws(
    () => readDesignDocument(d),
    (e: unknown) => e instanceof Error && !(e instanceof TypeError) && !/version 17 brought/.test(e.message),
  );

// ---------- version 2 preset names (version3Named, via migrateDesignV2) ----------

/** A version 2 item: its type, parameters and label; id feature-3, so oldPresetName gives "Feature 3 (<type>)". */
const v2Item = (type: unknown, parameters: Raw, provenance: unknown, id = "feature-3"): Raw => ({ id, intent: { type, parameters }, ...(provenance === undefined ? {} : { provenance }), dependsOn: [], suppressed: false });
const label = (l: unknown) => ({ self: { workspace: "design", id: "feature-3", label: l }, from: [] });
/** The item's label after the version 2 upgrade (only one item, so it is the last solid and stays unsuppressed). */
const upgraded = (f: Raw): unknown => (migrateDesignV2({ version: 2, timeline: { features: [f] } }) as Raw).timeline.features[0];

test("hand-worked: a version 2 box labelled \"Feature 12 (box)\" is read as \"Feature 3 (box)\", its own id's number", () => {
  // Kills the regex's `\d` => `\D`: "Feature 12 (box)" needs \d* to take the 2. oldPresetName is `Feature ${idNumber(id)} (${type})`,
  // and idNumber("feature-3") is 3, so the label becomes "Feature 3 (box)".
  const f = v2Item("box", { width: 10, depth: 10, height: 10 }, label("Feature 12 (box)"));
  assert.equal((upgraded(f) as Raw).provenance.self.label, "Feature 3 (box)");
});

test("version 2 names not of the exact form \"Feature <n> (<its type>)\" are left as they are", () => {
  const box = { width: 10, depth: 10, height: 10 };
  const kept = (f: Raw, why: string) => assert.deepEqual(upgraded(f), f, why);
  // The regex's ^ dropped: "My Feature 1 (box)" would match and be renamed "Feature 3 (box)".
  kept(v2Item("box", box, label("My Feature 1 (box)")), "text before");
  // The regex's $ dropped: "Feature 1 (box)!" would match with (box) and be renamed.
  kept(v2Item("box", box, label("Feature 1 (box)!")), "text after");
  // A sketch is never a preset: with `f.intent.type === "sketch"` => false (or "sketch" => "") "Feature 1 (sketch)" would be renamed.
  kept(v2Item("sketch", { plane: "XY" }, label("Feature 1 (sketch)")), "a sketch");
  // An extrude of a sketch is no preset either: with `Object.hasOwn(parameters, "sketch")`'s "sketch" => "" it would be renamed.
  kept(v2Item("extrude", { sketch: "sketch-1", distance: 5 }, label("Feature 1 (extrude)")), "an extrude of a sketch");
  // A label that is not text but reads as one (an array's toString): `typeof label !== "string"` => false would rename it.
  kept(v2Item("box", box, label(["Feature 1 (box)"])), "a label that is a list");
});

test("version 2 items with no provenance, or no self in it, are left for the checks, never a crash", () => {
  // Kills, on the provenance guard: the whole => false, `!isRecord(provenance) || !isRecord(provenance.self)` => false, and both
  // || made && (each then reads .self or .label of undefined, a TypeError).
  const box = { width: 10, depth: 10, height: 10 };
  for (const provenance of [undefined, {}, { self: 5 }]) {
    const f = v2Item("box", box, provenance);
    assert.deepEqual(upgraded(f), f, JSON.stringify(provenance));
  }
});

// ---------- version 4 face sketches (withDrawnBodies) ----------

const item = (id: string, type: string, parameters: Raw): Raw => ({ id, intent: { type, parameters } });
const content = (id: string, face?: Raw): Raw => ({ id, points: [], curves: [], constraints: [], ...(face ? { face } : {}) });
const FACE = { frame: { origin: [0, 0, 20], xAxis: [1, 0, 0], normal: [0, 0, 1] }, side: 1 };
const MOVED = { origin: [5, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] };

test("hand-worked: only the face sketches before the first Move get the world's frame; the rest are left as they are", () => {
  const d = {
    version: 5,
    timeline: {
      features: [
        item("feature-1", "box", {}),
        item("sketch-2", "sketch", { plane: "face:feature-1/top" }), // a face sketch before the Move: gets body = world
        item("sketch-3", "sketch", { plane: "XY" }), // an origin sketch: no face, left
        item("sketch-4", "sketch", { plane: "face:feature-1/top" }), // a face sketch with body already: left (`"body"` => "" overwrote it)
        item("feature-5", "extrude", { plane: "face:feature-1/top" }), // not a sketch, though it names a face plane: left
        item("feature-6", "move", {}),
        item("sketch-7", "sketch", { plane: "face:feature-1/top" }), // after the Move: left
      ],
    },
    sketches: [content("sketch-2", FACE), content("sketch-3"), content("sketch-4", { ...FACE, body: MOVED }), content("feature-5", FACE), content("sketch-7", FACE)],
  };
  const out = withDrawnBodies(clone(d)) as Raw;
  // sketch-2 is the only face sketch before feature-6 (the Move) with no body: it gets worldFrame(), origin 0, x along X, normal +Z.
  assert.deepEqual(out.sketches[0], { ...content("sketch-2", FACE), face: { ...FACE, body: { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] } } });
  assert.deepEqual(worldFrame(), { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] });
  // Everything else as it was. Catches the drawn test (`type === "sketch" && …` => true, either && made ||, `type === "sketch"`
  // => true: feature-5 would be drawn), the content test (=> true: sketch-3 gets a face; any of its && made || or dropped:
  // sketch-3's missing face is read, a TypeError, or sketch-7, after the Move, gets one) and "body" => "" (sketch-4 overwritten).
  assert.deepEqual(out.sketches.slice(1), d.sketches.slice(1));
});

test("data with no face sketch before a Move is handed back as it is, the very same object", () => {
  // Kills `drawn.size === 0` => false, which hands back a copy with the same sketches.
  const d = { version: 5, timeline: { features: [item("feature-1", "move", {}), item("sketch-2", "sketch", { plane: "face:feature-1/top" })] }, sketches: [content("sketch-2", FACE)] };
  assert.equal(withDrawnBodies(d), d);
  const none = { version: 5, timeline: { features: [item("sketch-2", "sketch", { plane: "XY" })] }, sketches: [content("sketch-2")] };
  assert.equal(withDrawnBodies(none), none);
});

// ---------- a face sketch's body size ----------

test("a face sketch's body size of Infinity is refused: it must be a finite number above 0", () => {
  // Kills `typeof size === "number" && Number.isFinite(size)` => ||: Infinity is a number above 0, but not finite.
  const t = addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  const d = clone(t.doc);
  d.sketches[0].face.body = { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1], size: 2 };
  assert.equal(readDesignDocument(clone(d)).sketches[0].face!.body!.size, 2, "the control: size 2 is read");
  d.sketches[0].face.body.size = Infinity;
  refused(d, `Design sketch ${t.id}'s body frame's size must be a number above 0, not Infinity`);
});

// ---------- version 16: constraints on followed points (hasVersion17Fields) ----------

/** Box 1 and a sketch with a free line (points 3 and 4) and a projected point of Box 1's corner, as version 16 data. */
function v16(): { raw: Raw; made: string } {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const base = drawLine(s.doc, s.id, [100, 100], [104, 102]).doc;
  const doc = projectEdges(base, s.id, [{ feature: "feature-1", edge: "front+left", shape: { kind: "point", at: [0, 0] } }]).doc;
  const raw = clone(doc);
  raw.version = 16;
  raw.nextId = 20_000;
  return { raw, made: doc.sketches[0].points.at(-1)!.id };
}
const fix = (point?: string) => ({ id: "constraint-100", kind: "fix", ...(point === undefined ? {} : { point }) });

test("version 16 data fixing a projected point is refused as holding what version 17 brought; a free point is read", () => {
  // Kills `c.kind === "fix"` => false and "fix" => "" (a fix then reads a and b), `[c.point]` => [], `s.pins !== undefined` =>
  // true and => `===` (no pins list then returns early) and `!Array.isArray(s.projected)` => `Array.isArray(...)` (a list then
  // returns early): each lets this file through.
  const { raw, made } = v16();
  assert.equal(raw.sketches[0].pins, undefined, "no pins: the projection alone makes the point follow");
  raw.sketches[0].constraints = [fix(made)];
  refused(raw, `Design data says version 16 but has a constraint on a point that follows a body, which version 17 brought`);
  const free = v16().raw;
  free.sketches[0].constraints = [fix("point-3")];
  assert.equal(readDesignDocument(free).sketches[0].constraints.length, 1);
});

test("version 16 data whose sketch lists are not lists is refused by the checks, not as version 17 data", () => {
  // Each sketch below fixes a point its other list makes follow, so if the guard let it through the version 17 check would
  // refuse it first. Kills the guard => false, `return false` => true, each of its || made && and each part => false.
  const withSketch = (change: (s: Raw) => void) => {
    const { raw } = v16();
    change(raw.sketches[0]);
    return raw;
  };
  // curves not a list; a pin makes point-3 follow.
  refusedNotAsVersion17(withSketch((s) => { s.curves = "x"; s.pins = [{ point: "point-3" }]; s.constraints = [fix("point-3")]; }));
  // constraints not a list.
  refusedNotAsVersion17(withSketch((s) => { s.constraints = { 0: fix("point-3") }; s.pins = [{ point: "point-3" }]; }));
  // pins not a list; the projection makes its point follow.
  refusedNotAsVersion17(withSketch((s) => { s.pins = "x"; s.constraints = [fix(s.projected[0].made)]; }));
  // projected not a list; a pin makes point-3 follow.
  refusedNotAsVersion17(withSketch((s) => { s.projected = "x"; s.pins = [{ point: "point-3" }]; s.constraints = [fix("point-3")]; }));
});

test("version 16 data with a pin naming no point and a fix naming none is refused by the checks, not as version 17 data", () => {
  // Kills `typeof p === "string"` => true: the pin's missing point and the fix's missing point are both undefined.
  const { raw } = v16();
  raw.sketches[0].pins = [{}];
  raw.sketches[0].constraints = [fix()];
  refusedNotAsVersion17(raw);
});

// ---------- version 19 kept shapes (migrateDesignV19) ----------

const K = { points: [], curves: [] };
const extrude = (id: unknown, parameters: Raw, type = "extrude"): Raw => ({ id, intent: { type, parameters } });

test("hand-worked: each profile after the first takes a copy of the shape version 19 kept for it; nothing else changes", () => {
  // feature-5 extrudes sketch-1, then sketch-1 again (its region another one) and sketch-2: version 19 kept the first under
  // "feature-5" and sketch-2's under "feature-5/sketch-2"; version 20 keys them by place in `more`, from 1.
  const d = { version: 19, timeline: { features: [extrude("feature-5", { sketch: "sketch-1", more: [{ sketch: "sketch-1" }, { sketch: "sketch-2" }, { sketch: "sketch-3" }] })] }, kept: { "feature-5": K, "feature-5/sketch-2": { ...K, tag: 2 } } };
  // more[0] reads "feature-5" (its sketch is the first's), more[1] reads "feature-5/sketch-2", which goes; more[2] read nothing:
  // no key at all for it (kills `!Object.hasOwn(old, was)` => false, which would file undefined under feature-5/profile:3).
  assert.deepEqual(migrateDesignV19(clone(d)), { version: 20, timeline: d.timeline, kept: { "feature-5": K, "feature-5/profile:1": K, "feature-5/profile:2": { ...K, tag: 2 } } });
});

test("version 19 data with kept shapes but no timeline is only given version 20", () => {
  // Kills the features guard => true and its && made || (each reads .features of undefined).
  assert.deepEqual(migrateDesignV19({ version: 19, kept: { "feature-5": K } }), { version: 20, kept: { "feature-5": K } });
});

test("items not an extrude of a sketch with other profiles keep their shapes' keys as they are", () => {
  const old = { "feature-5": K, "7": K, "feature-8": K, "feature-8/sketch-1": K, "feature-9/5": K, "feature-6": K };
  const features = [
    null, // read as null.intent by the guard with any || made && or a part dropped: a TypeError
    5,
    extrude(7, { sketch: "sketch-1", more: [{ sketch: "sketch-1" }] }), // an id that is not text (`typeof f.id !== "string"` => false)
    extrude("feature-8", { sketch: "sketch-1", more: [{ sketch: "sketch-1" }] }, "move"), // not an extrude (`type !== "extrude"` => false)
    extrude("feature-6", { sketch: "sketch-1", distance: 5 }), // no more (`… || !Array.isArray(more)` => false or &&: more.entries() of undefined)
    extrude("feature-8", { profile: "profile-1", more: [{ sketch: "sketch-1" }] }), // no first sketch (`typeof first !== "string"` => false)
    extrude("feature-9", { sketch: "sketch-1", more: [null, { sketch: 5 }] }), // a profile that is null, one whose sketch is a number
  ];
  const d = { version: 19, timeline: { features }, kept: old };
  // Nothing is renamed or copied: each mutant above files a copy under a "/profile:" key or crashes.
  assert.deepEqual(migrateDesignV19(clone(d)), { version: 20, timeline: { features }, kept: old });
});

// ---------- a preset's dependsOn words ----------

test("a preset depending on three items says all three, the last after \"and\"", () => {
  // Kills slice(0, -1) => slice(0, +1), at(-1) => at(+1) and ", " => "". Plate 1 is feature-1 extruding profile-1; with three
  // ids x, y, z the words are "x, y and z" (`shown` writes text as it is).
  const d = clone(partDocument("plate", 40, 30, 20));
  const box = d.timeline.features[0];
  const profile = box.intent.parameters.profile;
  box.dependsOn = [profile, "profile-8", "profile-9"];
  refused(d, `Design feature ${box.id} extrudes profile ${profile} but depends on ${profile}, profile-8 and profile-9, not exactly on that profile`);
});

// ---------- an extrude's other profiles (checkMore) ----------

/** Sketches 1..n, each a 10 mm square, then Extrude 1 of sketch 1 with `more` as given (dependsOn every sketch in order). */
function several(n: number): { doc: DesignDocument; sketches: string[] } {
  let doc = freshDesign();
  const sketches: string[] = [];
  for (let k = 0; k < n; k++) {
    const s = addSketch(doc);
    doc = drawRectangle(s.doc, s.id, [20 * k, 0], [20 * k + 10, 10]).doc;
    sketches.push(s.id);
  }
  return { doc, sketches };
}
const lastExtrude = (d: Raw): Raw => d.timeline.features.at(-1);
const moreWords = (d: Raw) => `Design feature ${lastExtrude(d).id}'s more profiles`;

test(`an extrude with ${MORE_PROFILES_LIMIT} other profiles is read; one with ${MORE_PROFILES_LIMIT + 1} is refused`, () => {
  // Kills `more.length > MORE_PROFILES_LIMIT` => false and => `>=`.
  const { doc, sketches } = several(MORE_PROFILES_LIMIT + 2);
  const at = (n: number) => clone(extrudeSketch(doc, sketches[0], 5, false, undefined, null, sketches.slice(1, n + 1).map((sketch) => ({ sketch }))).doc);
  assert.equal(readDesignDocument(at(MORE_PROFILES_LIMIT)).timeline.features.at(-1)!.intent.parameters.more.length, MORE_PROFILES_LIMIT);
  const over = at(MORE_PROFILES_LIMIT);
  lastExtrude(over).intent.parameters.more.push({ sketch: sketches[MORE_PROFILES_LIMIT + 1] });
  lastExtrude(over).dependsOn.push(sketches[MORE_PROFILES_LIMIT + 1]);
  refused(over, `${moreWords(over)} are not a list of 1 to ${MORE_PROFILES_LIMIT} profiles`);
});

test("an extrude with other profiles and an operation is refused in its own words", () => {
  // Kills `Object.hasOwn(parameters, "operation")` => false, "operation" => "" and the message => "".
  // Box 1 first, then two sketches, then an Extrude Join of sketch 1 into Box 1.
  let d: DesignDocument = partDocument("box", 40, 30, 20);
  const ids: string[] = [];
  for (let k = 0; k < 2; k++) {
    const s = addSketch(d);
    d = drawRectangle(s.doc, s.id, [20 * k, 0], [20 * k + 10, 10]).doc;
    ids.push(s.id);
  }
  const joined = clone(extrudeSketch(d, ids[0], 5, false, undefined, { operation: "join", bodies: ["body:feature-1"] }).doc);
  assert.doesNotThrow(() => readDesignDocument(clone(joined)), "the control: the Join alone is read");
  lastExtrude(joined).intent.parameters.more = [{ sketch: ids[1] }];
  lastExtrude(joined).dependsOn.push(ids[1]);
  refused(joined, `${moreWords(joined)} come with an operation, which takes one profile`);
});

test("other profiles that are not { sketch } are refused saying what they hold", () => {
  // Kills, on `!isRecord(p) || typeof p.sketch !== "string"`: => false, || made && (both crash on null), `typeof p.sketch !==
  // "string"` => false (a number is then refused as not a sketch before it) and the message => "".
  const { doc, sketches } = several(2);
  const made = clone(extrudeSketch(doc, sketches[0], 5, false, undefined, null, [{ sketch: sketches[1] }]).doc);
  const holding = (p: unknown) => {
    const d = clone(made);
    lastExtrude(d).intent.parameters.more = [p];
    return d;
  };
  refused(holding(null), `${moreWords(made)} hold null, not a sketch and its region`);
  refused(holding({ sketch: 5 }), `${moreWords(made)} hold an object, not a sketch and its region`);
});

test("other profiles of a later sketch, or of an item that is no sketch, are refused", () => {
  // Kills the place test => false, `there !== undefined` => false, `there.at > i || …` => false and its || made &&, `there.at >
  // i` => false, and the message => "".
  const { doc, sketches } = several(2);
  const first = extrudeSketch(doc, sketches[0], 5);
  const late = addSketch(first.doc);
  const after = clone(drawRectangle(late.doc, late.id, [100, 0], [110, 10]).doc);
  // Extrude 1 (at place 2) naming sketch `late` (place 3, after it), dependsOn listing it so only this check can refuse it.
  const ext = after.timeline.features[2];
  ext.intent.parameters.more = [{ sketch: late.id }];
  ext.dependsOn = [sketches[0], late.id];
  refused(after, `Design feature ${ext.id}'s more profiles hold ${late.id}, which is not a sketch before it in the timeline`);
  // Box 1 (feature-1) before the extrude is no sketch.
  let d: DesignDocument = partDocument("box", 40, 30, 20);
  const s = addSketch(d);
  d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  const e = clone(extrudeSketch(d, s.id, 5).doc);
  const extr = lastExtrude(e);
  extr.intent.parameters.more = [{ sketch: "feature-1" }];
  extr.dependsOn = [s.id, "feature-1"];
  refused(e, `Design feature ${extr.id}'s more profiles hold feature-1, which is not a sketch before it in the timeline`);
});

test("the same other profile twice is refused even when it is not the first profile", () => {
  // Kills `seen.some(…)` => `seen.every(…)`: the second sketch-2 matches the first sketch-2 but not sketch 1 itself.
  const { doc, sketches } = several(2);
  const d = clone(extrudeSketch(doc, sketches[0], 5, false, undefined, null, [{ sketch: sketches[1] }]).doc);
  lastExtrude(d).intent.parameters.more = [{ sketch: sketches[1] }, { sketch: sketches[1] }];
  lastExtrude(d).dependsOn = [sketches[0], sketches[1], sketches[1]];
  refused(d, `${moreWords(d)} hold a profile of ${sketches[1]} twice`);
});

// ---------- an extrude's dependsOn ----------

test("an extrude of three sketches depending on them out of order is refused, naming them with \"and\"", () => {
  // Kills `extruded.some((s, k) => …)` => every, its arrow => undefined, `f.dependsOn[k] !== s` => false (the first matches,
  // the other two are swapped) and " and " => "".
  const { doc, sketches } = several(3);
  const d = clone(extrudeSketch(doc, sketches[0], 5, false, undefined, null, [{ sketch: sketches[1] }, { sketch: sketches[2] }]).doc);
  assert.doesNotThrow(() => readDesignDocument(clone(d)), "the control: in order it is read");
  lastExtrude(d).dependsOn = [sketches[0], sketches[2], sketches[1]];
  refused(d, `Design feature ${lastExtrude(d).id} extrudes ${sketches[0]} and ${sketches[1]} and ${sketches[2]} but does not depend on exactly them, in that order`);
});

test("an Extrude Join not depending on its sketch is refused, though a Join's dependsOn is not counted", () => {
  // Kills `!Array.isArray(dependsOn) || !dependsOn.includes(sketch)` => false and its || made &&: with an operation, only the
  // sketch's being there is checked.
  let d: DesignDocument = partDocument("box", 40, 30, 20);
  const s = addSketch(d);
  d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  const j = clone(extrudeSketch(d, s.id, 5, false, undefined, { operation: "join", bodies: ["body:feature-1"] }).doc);
  const f = lastExtrude(j);
  assert.ok(f.dependsOn.includes(s.id), JSON.stringify(f.dependsOn));
  f.dependsOn = f.dependsOn.filter((x: string) => x !== s.id);
  refused(j, `Design feature ${f.id} extrudes ${s.id} but does not depend on it`);
});

// ---------- kept keys ----------

test("a kept shape under a key starting with a slash is refused in the words for a profile's key", () => {
  // Kills `slash < 0` => `<=` in the message: the slash is at 0, so the key is "<extrude>/<profile>" in form, with no extrude.
  const { doc, sketches } = several(1);
  const d = clone(extrudeSketch(doc, sketches[0], 5).doc);
  d.kept = { "/profile:1": { points: [], curves: [] } };
  refused(d, `Design data keeps a shape for /profile:1, which is not an extrude of a sketch in the timeline and the place of another of its profiles`);
});

// ---------- the followed-points refusal ----------

test("a constraint on both ends of a projected line lists both, comma-separated", () => {
  // Kills `constraintPoints(c).join(", ")` => join("").
  const s = addSketch(partDocument("box", 40, 30, 20));
  const doc = projectEdges(s.doc, s.id, [{ feature: "feature-1", edge: "front+top", shape: { kind: "line", a: [0, 10], b: [10, 10] } }]).doc;
  const line = doc.sketches[0].curves.at(-1) as { start: string; end: string };
  const d = clone(doc);
  d.sketches[0].constraints = [{ id: "constraint-100", kind: "coincident", a: line.start, b: line.end }];
  d.nextId = 20_000;
  refused(d, `Design sketch ${s.id}: constraint constraint-100 names only points that follow a body's edge (${line.start}, ${line.end}), so the body holds them and the constraint could only fight it`);
});
