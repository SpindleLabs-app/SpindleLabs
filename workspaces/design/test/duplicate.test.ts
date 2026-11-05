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
import { DUPLICATE_STEP, copiesOf, insertDuplicates } from "../src/duplicate.ts";
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

test("a copy is greyed with its suppressed source, fails when the source is deleted, and can't copy a Combine's result yet", async () => {
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
  // Box 1 joined with Box 2 (10 × 10 × 10, inside it), then copied: a Combine's result has no spec to name the copy's faces from.
  const boxes = insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10).doc;
  const joined = insertCombine(boxes, "body:feature-1", ["body:feature-2"], "join", false).doc;
  const j = await built(joined);
  assert.equal(j.build.results["feature-3"].status, "built");
  await j.close();
  const c = await built(insertDuplicates(joined, ["body:feature-1"]).doc);
  try {
    assert.deepEqual(c.build.results["feature-4"], { status: "failed", cause: "error", message: "Copy 1 can't copy a Combine's result yet: that comes with the next kernel release" });
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
