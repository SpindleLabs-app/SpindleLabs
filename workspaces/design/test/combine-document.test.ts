// Step 35f1: a Combine as a timeline item in the file, checked by hand.
// Every expected answer below is worked out from the file beside it:
// which ids are bodies, which items made them, and what each refusal
// must name. Each check is broken on purpose once, with its own words.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Feature } from "@fission/core";
import { actsOnBodies, buildingItems, combineBodies, greyedBy, isCombineItem, makesBody, numberBodies, numberPieces, readDesignDocument } from "../src/document.ts";

const box = (id: string, label: string) => ({
  id,
  intent: { type: "box", parameters: { width: 10, depth: 10, height: 10 }, summary: "Box: 10 × 10 × 10 mm" },
  provenance: { self: { workspace: "design", id, label }, from: [] },
  dependsOn: [],
  suppressed: false,
});

const COMBINE = { target: "body:feature-1", tools: ["body:feature-2"], operation: "cut", keepTools: false };

/** Two boxes and a Combine cutting the second from the first (feature-3), its parameters and item fields overridden. */
const file = (params: Record<string, unknown> = {}, combine: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  version: 7,
  nextId: 4,
  profiles: [],
  sketches: [],
  timeline: {
    features: [
      box("feature-1", "Box 1"),
      box("feature-2", "Box 2"),
      {
        id: "feature-3",
        intent: { type: "combine", parameters: { ...COMBINE, ...params }, summary: "Combine: cut Box 2 from Box 1" },
        provenance: { self: { workspace: "design", id: "feature-3", label: "Combine 1" }, from: [] },
        dependsOn: ["feature-1", "feature-2"],
        suppressed: false,
        ...combine,
      },
    ],
  },
  bodies: [
    { id: "body:feature-1", number: 1 },
    { id: "body:feature-2", number: 2 },
  ],
  nextBody: 3,
  ...extra,
});

const combineOf = (d: ReturnType<typeof readDesignDocument>) => d.timeline.features[2];

test("hand-worked: a Combine reads, makes no body of its own, and depends on the items that made its bodies", () => {
  const d = readDesignDocument(file());
  const c = combineOf(d);
  assert.ok(isCombineItem(c) && actsOnBodies(c) && !makesBody(c));
  assert.deepEqual(combineBodies(c), { target: "body:feature-1", tools: ["body:feature-2"], operation: "cut", keepTools: false });
  // The two boxes are numbered 1 and 2; the Combine adds no body, so no number 3 and the counter stays.
  assert.deepEqual(d.bodies, [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }]);
  assert.equal(d.nextBody, 3);
  // Saved and opened again: the same.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(d))), d);
  // It builds when both boxes do; suppress Box 2 and it is greyed by it (Q3), as a Move of Box 2 would be.
  assert.ok(buildingItems(d).has(c));
  const off = { ...d, timeline: { ...d.timeline, features: d.timeline.features.map((f) => (f.id === "feature-2" ? { ...f, suppressed: true } : f)) } };
  assert.equal(greyedBy(off, combineOf(off)), "feature-2");
  assert.equal(buildingItems(off).has(combineOf(off)), false);
});

test("a Combine read from a file is checked: its parameters, bodies and dependencies, each refusal in its own words", () => {
  const refused = (f: ReturnType<typeof file>, message: string) => assert.throws(() => readDesignDocument(f), { message });
  refused(file({ scale: 2 }), 'Design combine feature-3 has a parameter "scale" a combine doesn\'t have');
  refused(file({ operation: "union" }), "Design combine feature-3's operation union is not join, cut or intersect");
  refused(file({ operation: undefined }), "Design combine feature-3's operation undefined is not join, cut or intersect");
  refused(file({ keepTools: "no" }), "Design combine feature-3's keepTools no is not true or false");
  refused(file({ tools: [] }), "Design combine feature-3 has no tool bodies");
  refused(file({ tools: "body:feature-2" }), "Design combine feature-3 has no tool bodies");
  // #507: a Combine's tools are capped as an extrude's bodies are (5,000 a file holds), the made-up ids refused before anything walks them.
  refused(file({ tools: Array.from({ length: 5_001 }, (_, i) => `body:feature-${i + 100}`) }), "Design combine feature-3 names 5001 tools, more than the 5000 this SpindleLabs opens");
  // The target among the tools, or a tool twice.
  refused(file({ tools: ["body:feature-2", "body:feature-1"] }), "Design combine feature-3's target body:feature-1 is also a tool");
  refused(file({ tools: ["body:feature-2", "body:feature-2"] }), "Design combine feature-3 picks body:feature-2 twice");
  // Not a body: an item's id (version 5's form), the Combine itself, a later item, a piece no bodies list numbers.
  refused(file({ target: "feature-1" }), "Design combine feature-3: its target feature-1 is not a body made before it in the timeline");
  refused(file({ tools: ["body:feature-3"] }), "Design combine feature-3: tool body:feature-3 is not a body made before it in the timeline");
  refused(file({ tools: [7] }), "Design combine feature-3: tool 7 is not a body made before it in the timeline");
  refused(file({ tools: ["body:feature-2/piece:1"] }), "Design combine feature-3: tool body:feature-2/piece:1 is not a body made before it in the timeline");
  // A body deleted since reads (the rebuild fails the Combine naming it), under the counter.
  assert.deepEqual(combineBodies(combineOf(readDesignDocument(file({ tools: ["body:feature-0"] }, { dependsOn: ["feature-1", "feature-0"] })))).tools, ["body:feature-0"]);
  // dependsOn: exactly the makers, the target's first, each once.
  const MISMATCH = "Design combine feature-3 must depend on exactly the items that made its target and tools, in their order (feature-1, feature-2)";
  refused(file({}, { dependsOn: ["feature-2", "feature-1"] }), MISMATCH);
  refused(file({}, { dependsOn: ["feature-1"] }), MISMATCH);
  refused(file({}, { dependsOn: ["feature-1", "feature-2", "feature-2"] }), MISMATCH);
});

test("hand-worked: a Combine's pieces are numbered when they first appear, kept while it is there, and dropped with it", () => {
  // A cut leaving Box 1 in two: its far piece keeps body:feature-1 (rule 1), the near one is body:feature-3/piece:1.
  const d = readDesignDocument(file());
  const once = numberPieces(d, ["body:feature-1", "body:feature-3/piece:1"]);
  // The piece is new: number 3, the counter 4; the target already had its number, so nothing else changes.
  assert.deepEqual(once.bodies, [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }, { id: "body:feature-3/piece:1", number: 3 }]);
  assert.equal(once.nextBody, 4);
  // Numbering again changes nothing; a piece of an item that is not a Combine, or of no item, is never numbered.
  assert.equal(numberPieces(once, ["body:feature-3/piece:1"]), once);
  assert.equal(numberPieces(once, ["body:feature-1/piece:1", "body:feature-9/piece:1"]).nextBody, 4);
  // Saved and opened again, the piece keeps its number; edits keep it too (numberBodies).
  const read = readDesignDocument(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(read.bodies, once.bodies);
  assert.equal(numberBodies(read), read);
  // The Combine deleted: its piece's number is dropped, never given again (the counter stays at 4).
  const gone = numberBodies({ ...read, timeline: { features: read.timeline.features.slice(0, 2) } });
  assert.deepEqual(gone.bodies, [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }]);
  assert.equal(gone.nextBody, 4);
});

test("a file's piece must be a Combine's: a piece of a box is refused, a piece of a deleted item is dropped", () => {
  const withPiece = (id: string) => file({}, {}, { bodies: [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }, { id, number: 3 }], nextBody: 4 });
  assert.deepEqual(readDesignDocument(withPiece("body:feature-3/piece:2")).bodies?.at(-1), { id: "body:feature-3/piece:2", number: 3 });
  assert.throws(() => readDesignDocument(withPiece("body:feature-1/piece:1")), { message: 'Design body body:feature-1/piece:1 is not "body:" and the id of an item that makes a body, or a piece of a Combine or of an extrude that joins, cuts or intersects' });
  // A piece whose item is gone: settled as a body whose item is gone, its number dropped.
  assert.equal(readDesignDocument(withPiece("body:feature-0/piece:1")).bodies?.length, 2);
  // A Move can move a piece the file numbers (35ec), so a later Combine can use one too.
  const later = withPiece("body:feature-3/piece:1");
  later.timeline.features.push({
    ...box("feature-5", "Box 3"),
  });
  const f = {
    id: "feature-6",
    intent: { type: "combine", parameters: { target: "body:feature-3/piece:1", tools: ["body:feature-5"], operation: "join", keepTools: true }, summary: "Combine" },
    provenance: { self: { workspace: "design", id: "feature-6", label: "Combine 2" }, from: [] },
    dependsOn: ["feature-3", "feature-5"],
    suppressed: false,
  };
  (later.timeline.features as Feature[]).push(f as unknown as Feature);
  later.nextId = 7;
  later.bodies.push({ id: "body:feature-5", number: 4 });
  later.nextBody = 5;
  assert.deepEqual(combineBodies(readDesignDocument(later).timeline.features[4]), { target: "body:feature-3/piece:1", tools: ["body:feature-5"], operation: "join", keepTools: true });
});

test("hand-worked: an edited Combine changes its operation, Keep tools and bodies in place, refusing a body made after it", async () => {
  const { changedCombine, insertCombine } = await import("../src/combine.ts");
  const { insertPreset, partDocument } = await import("../src/document.ts");
  // Box 1 (feature-1), Box 2 (feature-2), Combine 1 (feature-3: Join Box 2 to Box 1), then Box 3 (feature-4).
  let d = partDocument("box", 10, 10, 10);
  d = insertPreset(d, "box", 10, 10, 10).doc;
  const c = insertCombine(d, "body:feature-1", ["body:feature-2"], "join");
  const after = insertPreset(c.doc, "box", 5, 5, 5);
  d = after.doc;
  assert.equal(c.id, "feature-3");
  // The operation and Keep tools changed: the same id, name and place; the summary says the new words.
  const cut = changedCombine(d, "feature-3", "body:feature-1", ["body:feature-2"], "cut", true);
  const f = cut.timeline.features[2];
  assert.equal(f.id, "feature-3");
  assert.equal(f.provenance.self.label, "Combine 1");
  assert.deepEqual(combineBodies(f), { target: "body:feature-1", tools: ["body:feature-2"], operation: "cut", keepTools: true });
  assert.equal(f.intent.summary, "Cut Box 2 from Box 1, keeping the tools");
  assert.deepEqual(f.dependsOn, ["feature-1", "feature-2"]);
  assert.equal(cut.nextId, d.nextId);
  // It reads back as a file.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(cut))).timeline.features[2], f);
  // Target and tool swapped: the dependencies follow, the target's first.
  const swapped = changedCombine(d, "feature-3", "body:feature-2", ["body:feature-1"], "join", false).timeline.features[2];
  assert.deepEqual(swapped.dependsOn, ["feature-2", "feature-1"]);
  assert.equal(swapped.intent.summary, "Join Box 1 to Box 2");
  // Nothing changed: the same design back.
  assert.equal(changedCombine(d, "feature-3", "body:feature-1", ["body:feature-2"], "join", false), d);
  // Box 3 is made after the Combine, so the Combine can't use it.
  assert.throws(() => changedCombine(d, "feature-3", "body:feature-1", [after.id === "feature-4" ? "body:feature-4" : "?"], "join", false), { message: "Box 3 comes after Combine 1, so it can't use it" });
  // Not a Combine, a bad operation, the target among the tools.
  assert.throws(() => changedCombine(d, "feature-2", "body:feature-1", ["body:feature-2"], "join", false), { message: 'there is no Combine feature-2 in the design' });
  assert.throws(() => changedCombine(d, "feature-3", "body:feature-1", ["body:feature-2"], "union" as never, false), { message: 'union is not join, cut or intersect' });
  assert.throws(() => changedCombine(d, "feature-3", "body:feature-1", ["body:feature-1"], "join", false), { message: "body:feature-1 is the target, so it can't be a tool too" });
});

test("regression (35f1e sessions, seed 11): a Combine whose tool's item was deleted can still change its operation, its bodies kept as picked", async () => {
  const { changedCombine, insertCombine } = await import("../src/combine.ts");
  const { insertPreset, partDocument } = await import("../src/document.ts");
  const { deleteItem } = await import("../src/timeline-edits.ts");
  // Box 1, Box 2, Combine 1 (Join Box 2 to Box 1); then Box 2 is deleted, so Combine 1 fails saying so. Changing Join
  // to Cut changes only its operation and words; the bodies stay as picked (Box 2's name from its provenance), never
  // refused because one of them is gone.
  let d = partDocument("box", 10, 10, 10);
  d = insertPreset(d, "box", 10, 10, 10).doc;
  d = insertCombine(d, "body:feature-1", ["body:feature-2"], "join").doc;
  d = deleteItem(d, "feature-2");
  const f = changedCombine(d, "feature-3", "body:feature-1", ["body:feature-2"], "cut", false).timeline.features.find((x) => x.id === "feature-3")!;
  assert.deepEqual(combineBodies(f), { target: "body:feature-1", tools: ["body:feature-2"], operation: "cut", keepTools: false });
  assert.equal(f.intent.summary, "Cut Box 2 from Box 1");
  // Picking another body still needs it to be there.
  assert.throws(() => changedCombine(d, "feature-3", "body:feature-1", ["body:feature-9"], "cut", false), { message: "body:feature-9 is not a body in the design" });
});

test("regression (35f1e review): a Combine read with a broken body id changing only its operation is refused in words, never crashing", async () => {
  const { changedCombine } = await import("../src/combine.ts");
  const d = readDesignDocument(file());
  // The file's Combine as if its tool's id were broken (written by hand): its operation changed, the id is named.
  const broken = { ...d, timeline: { ...d.timeline, features: d.timeline.features.map((f) => (f.id === "feature-3" ? { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, tools: ["feature-2"] } } } : f)) } };
  assert.throws(() => changedCombine(broken, "feature-3", "body:feature-1", ["feature-2"], "join", false), { message: "feature-2 is not a body in the design" });
});
