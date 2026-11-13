// Duplicate body (step 35e2): the document change (`insertDuplicates`) and
// every refusal, the reader's checks on a file holding one (each broken in
// exactly one way, with its words), and the copy built by the real rebuild
// on the real kernel, worked by hand from the boxes' corners: where the copy
// is, that it follows its source's sizes but not a Move after it, its own
// number and face names, and each way it can't be made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { bodyNumbers, buildingItems, greyedBy, insertPreset, partDocument, partFeature, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { DUPLICATE_STEP, copiedText, copiesOf, insertDuplicates, pastedBodies } from "../src/duplicate.ts";
import { editFeature } from "../src/feature-edit.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { deleteItem, suppressItem } from "../src/timeline-edits.ts";
import { featureNames } from "../src/naming.ts";

const kernel = nodeKernel();
const item = (d: DesignDocument, id: string) => d.timeline.features.find((f) => f.id === id)!;

/** Box 1 (feature-1, 40 × 30 × 20 from the origin), Cylinder 1 (feature-2). */
const twoBodies = (): DesignDocument => insertPreset(partDocument("box", 40, 30, 20), "cylinder", 10, 10, 10).doc;

test("insertDuplicates by hand: one item per body, named Copy n, each depending on the item that made its body", () => {
  const d = twoBodies();
  const { doc, ids } = insertDuplicates(d, ["body:feature-2", "body:feature-1"]);
  // nextId was 3: the copies take feature-3 and feature-4, in the order picked.
  assert.deepEqual(ids, ["feature-3", "feature-4"]);
  assert.equal(doc.nextId, 5);
  assert.deepEqual(copiesOf(ids), ["body:feature-3", "body:feature-4"]);
  const [a, b] = ids.map((id) => item(doc, id));
  assert.deepEqual([a.intent, a.dependsOn, a.provenance.self.label], [{ type: "duplicate", parameters: { body: "body:feature-2" }, summary: "Copy of Cylinder 1" }, ["feature-2"], "Copy 1"]);
  assert.deepEqual([b.intent.summary, b.dependsOn, b.provenance.self.label], ["Copy of Box 1", ["feature-1"], "Copy 2"]);
  assert.deepEqual(doc.timeline.features.map((f) => f.id), ["feature-1", "feature-2", "feature-3", "feature-4"]);
  assert.equal(DUPLICATE_STEP, "Duplicate bodies");
  // A copy is a body of its own, numbered after the two there were.
  assert.deepEqual([...bodyNumbers(doc)], [["body:feature-1", 1], ["body:feature-2", 2], ["body:feature-3", 3], ["body:feature-4", 4]]);
  // The part the panel edits stays the last shape of its own, never a copy.
  assert.equal(partFeature(doc)!.id, "feature-2");
  // What it reads back as: the very same document.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(doc))), doc);
});

test("insertDuplicates puts the copies in at the rollback marker, and refuses anything that isn't a body before it", () => {
  const d = twoBodies();
  const rolled: DesignDocument = { ...d, timeline: { ...d.timeline, marker: "feature-1" } };
  const { doc } = insertDuplicates(rolled, ["body:feature-1"]);
  assert.deepEqual(doc.timeline.features.map((f) => f.id), ["feature-1", "feature-3", "feature-2"]);
  assert.equal(doc.timeline.marker, "feature-3");
  assert.throws(() => insertDuplicates(rolled, ["body:feature-2"]), { message: "Cylinder 1 comes after the rollback marker, so a copy put in at the marker can't be made of it" });
  assert.throws(() => insertDuplicates(d, []), { message: "pick at least one body to duplicate" });
  assert.throws(() => insertDuplicates(d, ["body:feature-1", "body:feature-1"]), { message: "body:feature-1 is picked twice" });
  assert.throws(() => insertDuplicates(d, ["feature-1"]), { message: "feature-1 is not a body id" });
  assert.throws(() => insertDuplicates(d, ["body:feature-9"]), { message: "body:feature-9 is not a body in the design" });
  const moved = insertMove(d, ["body:feature-1"], { ...NO_MOVE, x: 5 }).doc;
  assert.throws(() => insertDuplicates(moved, ["body:feature-3"]), { message: "body:feature-3 is not a body in the design" }, "a Move has no body of its own");
  assert.throws(() => insertDuplicates(d, ["body:feature-1/piece:1"]), { message: "body:feature-1/piece:1 is not a body in the design" });
});

test("the reader takes a Duplicate as written and refuses one broken in each way, saying how", () => {
  const good = JSON.parse(JSON.stringify(insertDuplicates(twoBodies(), ["body:feature-1"]).doc));
  assert.equal(item(readDesignDocument(good), "feature-3").intent.type, "duplicate");
  const broken = (change: (dup: { intent: { parameters: Record<string, unknown> }; dependsOn: unknown[] }) => void) => {
    const d = JSON.parse(JSON.stringify(good));
    change(d.timeline.features[2]);
    return d;
  };
  assert.throws(() => readDesignDocument(broken((f) => (f.intent.parameters.width = 3))), { message: 'Design duplicate feature-3 has a parameter "width" a duplicate doesn\'t have' });
  assert.throws(() => readDesignDocument(broken((f) => (f.intent.parameters.body = "body:feature-3"))), { message: "Design duplicate feature-3 copies body:feature-3, which is not a body made before it in the timeline" });
  assert.throws(() => readDesignDocument(broken((f) => (f.intent.parameters.body = 7))), { message: "Design duplicate feature-3 copies 7, which is not a body made before it in the timeline" });
  assert.throws(() => readDesignDocument(broken((f) => delete f.intent.parameters.body)), { message: "Design duplicate feature-3 copies undefined, which is not a body made before it in the timeline" });
  assert.throws(() => readDesignDocument(broken((f) => (f.dependsOn = ["feature-2"]))), { message: "Design duplicate feature-3 must depend on exactly the item that made the body it copies (feature-1)" });
  assert.throws(() => readDesignDocument(broken((f) => (f.dependsOn = ["feature-1", "feature-2"]))), { message: "Design duplicate feature-3 must depend on exactly the item that made the body it copies (feature-1)" });
  // Design data version 11 brought the Duplicate: a file saying version 10 with one is refused, naming both; version 10
  // without one reads as 11, unchanged.
  assert.equal(readDesignDocument(good).version, 22);
  assert.throws(() => readDesignDocument({ ...good, version: 10 }), { message: "Design data says version 10 but has a Duplicate, which version 11 brought" });
  const plain = JSON.parse(JSON.stringify(twoBodies()));
  assert.deepEqual(readDesignDocument({ ...plain, version: 10 }), readDesignDocument(plain));
  // A body deleted since may stay, as a Move's may: the rebuild fails the copy, naming it.
  const gone = JSON.parse(JSON.stringify(deleteItem(insertDuplicates(twoBodies(), ["body:feature-1"]).doc, "feature-1")));
  assert.equal(item(readDesignDocument(gone), "feature-3").intent.parameters.body, "body:feature-1");
});

async function built(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const view = async (body: string) => cache.view(build.bodies[body].handle);
  return { build, view, close: () => cache.close() };
}

test("hand-worked on the real kernel: the copy is where its body is at the Duplicate, follows its sizes, and not a Move after it", async () => {
  // Box 1 is 40 × 30 × 20 from the origin, so x 0..40, y 0..30, z 0..20; Move 1 shifts it 10 along X: x 10..50.
  const moved = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], { ...NO_MOVE, x: 10 }).doc;
  const copied = insertDuplicates(moved, ["body:feature-1"]).doc; // Copy 1 is feature-3
  // Move 2 shifts Box 1 another 100 along X after the copy: Box 1 at x 110..150, the copy left at x 10..50.
  const after = insertMove(copied, ["body:feature-1"], { ...NO_MOVE, x: 100 }).doc;
  const a = await built(after);
  try {
    assert.equal(a.build.results["feature-3"].status, "built");
    assert.deepEqual((await a.view("body:feature-3")).bounds, [[10, 0, 0], [50, 30, 20]]);
    assert.deepEqual((await a.view("body:feature-1")).bounds, [[110, 0, 0], [150, 30, 20]]);
    // Its volume is the box's: 40 · 30 · 20 = 24,000 mm³.
    assert.ok(Math.abs((await a.view("body:feature-3")).volume - 24_000) < 1e-6);
  } finally {
    await a.close();
  }
  // Box 1 made 60 wide: the copy follows, x 10..70 (60 from where Move 1 put it).
  const wider = await built(editFeature(after, "feature-1", { width: 60, depth: 30, height: 20 }));
  try {
    assert.deepEqual((await wider.view("body:feature-3")).bounds, [[10, 0, 0], [70, 30, 20]]);
  } finally {
    await wider.close();
  }
});

test("the copy's faces are named by the Duplicate, so a pick on the copy never finds the source's face", async () => {
  const doc = insertDuplicates(partDocument("box", 40, 30, 20), ["body:feature-1"]).doc;
  const b = await built(doc);
  try {
    const copy = b.build.bodies["body:feature-2"];
    assert.equal(copy.feature, "feature-2");
    const names = featureNames(copy.feature, { spec: copy.spec!, curves: copy.curves }, await b.view("body:feature-2"));
    const source = b.build.bodies["body:feature-1"];
    const sourceNames = featureNames(source.feature, { spec: source.spec!, curves: source.curves }, await b.view("body:feature-1"));
    // The same box, so the same parts in the same order, under its own feature.
    assert.equal(names.feature, "feature-2");
    assert.equal(sourceNames.feature, "feature-1");
    assert.deepEqual(names.faces, sourceNames.faces);
    assert.ok(names.faces.includes("top"));
  } finally {
    await b.close();
  }
});

test("a copy is greyed with its suppressed source, fails when the source is deleted, and copies a Combine's result (35f1f2c)", async () => {
  const doc = insertDuplicates(twoBodies(), ["body:feature-1"]).doc; // Copy 1: feature-3
  const off = suppressItem(doc, "feature-1", true);
  assert.equal(greyedBy(off, item(off, "feature-3")), "feature-1");
  assert.equal(buildingItems(off).has(item(off, "feature-3")), false);
  const g = await built(off);
  try {
    assert.deepEqual(g.build.results["feature-3"], { status: "greyed", by: "feature-1" });
    assert.equal(g.build.bodies["body:feature-3"], undefined);
  } finally {
    await g.close();
  }
  const gone = await built(deleteItem(doc, "feature-1"));
  try {
    assert.deepEqual(gone.build.results["feature-3"], { status: "failed", cause: "deleted-input", input: "feature-1", message: "Box 1 was deleted, so Copy 1 has nothing to copy" });
  } finally {
    await gone.close();
  }
  // Box 1 joined with Box 2 (10 × 10 × 10, inside it), then copied: before 35f1f2c refused ("can't copy a Combine's result
  // yet"); now the copy is the joined body, Box 1's 40 × 30 × 20 = 24,000 mm³ at x/y/z 0..40, 0..30, 0..20 (Box 2 adds nothing).
  const boxes = insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10).doc;
  const joined = insertCombine(boxes, "body:feature-1", ["body:feature-2"], "join", false).doc;
  const j = await built(joined);
  assert.equal(j.build.results["feature-3"].status, "built");
  await j.close();
  const c = await built(insertDuplicates(joined, ["body:feature-1"]).doc);
  try {
    assert.deepEqual(c.build.results["feature-4"], { status: "built", bodies: ["body:feature-4"] });
    const v = await c.view("body:feature-4");
    assert.equal(Math.round(v.volume * 1e6) / 1e6, 24000);
    assert.deepEqual(v.bounds.map((p) => p.map((x) => Math.round(x * 1e9) / 1e9 + 0)), [[0, 0, 0], [40, 30, 20]]);
  } finally {
    await c.close();
  }
  // The Combine used Cylinder 1 up: a copy of it is told so.
  const c2 = await built(insertDuplicates(joined, ["body:feature-2"]).doc);
  try {
    assert.deepEqual(c2.build.results["feature-4"], { status: "failed", cause: "failed-input", input: "feature-2", message: "Copy 1 can't copy Box 2: an earlier Combine used it up or left no such piece" });
  } finally {
    await c2.close();
  }
});

test("Copy and Paste of bodies by hand: the text names the design and each body with its item's kind and name, and pastes back only those same bodies", () => {
  const d = twoBodies(); // Box 1 (feature-1) and Cylinder 1 (feature-2)
  // Written out by hand: the words, the token, a colon, then for each body its id, "=", and its item's kind and name
  // with the space between them written %20, one space between bodies.
  const text = copiedText("k3x9", ["body:feature-2", "body:feature-1"], d);
  assert.equal(text, "SpindleLabs bodies k3x9: body:feature-2=cylinder%20Cylinder%201 body:feature-1=box%20Box%201");
  assert.deepEqual(pastedBodies(text, "k3x9", d), ["body:feature-2", "body:feature-1"]);
  // Another design's bodies (opened since, or another tab): not pasted here, since its ids would name other bodies.
  assert.equal(pastedBodies(text, "k3x8", d), null);
  assert.equal(pastedBodies(text, "k3x", d), null, "a token that only starts the same");
  // The same design after an Undo and another Insert (Undo hunt 2026-11-12, #623): feature-2 is a sphere now, so the
  // cylinder copied is gone and nothing is pasted, not even the box that is still there (the paste is all or none).
  const sphere = insertPreset(partDocument("box", 40, 30, 20), "sphere", 10, 10, 10).doc;
  assert.equal(sphere.timeline.features[1].id, "feature-2");
  assert.equal(pastedBodies(text, "k3x9", sphere), null);
  assert.deepEqual(pastedBodies(copiedText("k3x9", ["body:feature-1"], d), "k3x9", sphere), ["body:feature-1"], "the box is the same box in both");
  // The item gone altogether: nothing.
  assert.equal(pastedBodies(text, "k3x9", partDocument("box", 40, 30, 20)), null);
  // The body's sizes changed since the copy: still the same item, pasted as it is now.
  assert.deepEqual(pastedBodies(text, "k3x9", editFeature(d, "feature-2", { width: 25, height: 10 })), ["body:feature-2", "body:feature-1"]);
  // Anything else on the clipboard: not bodies, so the paste goes on as usual. The id alone (what was written before) too.
  for (const other of ["", "hello", "SpindleLabs bodies k3x9:", "SpindleLabs bodies k3x9: ", "SpindleLabs bodies k3x9: feature-1", "SpindleLabs bodies k3x9: body:feature-1", "SpindleLabs bodies k3x9: body:feature-1=box%20Box%201  body:feature-2=cylinder%20Cylinder%201", " SpindleLabs bodies k3x9: body:feature-1=box%20Box%201", "SpindleLabs bodies k3x9: body:feature-1=box%20Box%201\n"]) {
    assert.equal(pastedBodies(other, "k3x9", d), null, JSON.stringify(other));
  }
  assert.throws(() => copiedText("K 1", ["body:feature-1"], d), { message: "K 1 is not a design token" });
  assert.throws(() => copiedText("", ["body:feature-1"], d), { message: " is not a design token" });
  // What pastes is put in as Duplicate puts it in: one copy per body named. A body the design never had is not pasted.
  assert.deepEqual(insertDuplicates(d, pastedBodies(copiedText("a1", ["body:feature-1"], d), "a1", d)!).ids, ["feature-3"]);
  assert.equal(pastedBodies(copiedText("a1", ["body:feature-7"], d), "a1", d), null);
});
