// Save-load bug hunt B (2026-11-11): project files the reader opened although no SpindleLabs could have saved them,
// each of which then went wrong quietly. Every case breaks a file the app writes in exactly one way and asserts the
// reader's words; the same files unbroken open (B1, nextBody's limit, is in body-numbers.test.ts).
// (2) Two preset extrudes sharing one profile, or one whose dependsOn names another item's profile: typing a size for one
//     changed the other. (4) Preset and profile sizes the panel never takes (0, negative, under 0.001 mm, over 1 km): the
//     kernel refused most later, but built a negative profile width as a mirrored body. Such a file still opens (Edit feature could save one), and
//     the item fails when it builds, naming the size; edits refuse them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { changePreset, insertPreset, partDocument, PRESET_SIZE_LIMITS, profileSizeRefused, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { MAX_TYPED, MIN_TYPED } from "../src/typed-entry.ts";
import { editFeature } from "../src/feature-edit.ts";

const kernel = nodeKernel();
const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];
const reopen = (d: DesignDocument) => projectFromJson(projectToJson({ ...emptyProject("Hunt B"), workspaces: { design: d } }), DESIGN).workspaces.design as DesignDocument;
const data = (d: DesignDocument) => JSON.parse(JSON.stringify(d));

/** Two L-brackets as the app makes them: feature-1 on profile-1, feature-2 on profile-3 (insertPreset takes ids 2 and 3). */
const twoBrackets = () => insertPreset(partDocument("l-bracket", 20, 10, 5), "l-bracket", 40, 30, 8).doc;

test("hunt B2: the app gives every preset extrude its own profile, depending on exactly that profile", () => {
  const d = twoBrackets();
  const [a, b] = d.timeline.features;
  assert.deepEqual([a.intent.parameters.profile, a.dependsOn], ["profile-1", ["profile-1"]]);
  assert.deepEqual([b.intent.parameters.profile, b.dependsOn], ["profile-3", ["profile-3"]]);
  // And after a shape change in place, a profile shape to a box and back: still one profile each.
  const boxed = changePreset(d, "feature-2", "box", 40, 30, 8);
  const back = changePreset(boxed, "feature-2", "star", 40, 30, 8);
  const f2 = back.timeline.features[1];
  assert.deepEqual(f2.dependsOn, [f2.intent.parameters.profile]);
  assert.notEqual(f2.intent.parameters.profile, "profile-1");
  assert.deepEqual(reopen(back), back);
});

test("hunt B2: a profile two preset extrudes use is refused, naming both", () => {
  // The hunt's file: feature-2 extrudes profile-1 too (profile-3 then left to no one).
  const shared = data(twoBrackets());
  shared.timeline.features[1].intent.parameters.profile = "profile-1";
  shared.timeline.features[1].dependsOn = ["profile-1"];
  assert.throws(() => readDesignDocument(shared), /^Error: Design profile profile-1 is used by both feature-1 and feature-2, but each preset extrudes a profile of its own$/);
});

test("hunt B2: a preset extrude whose dependsOn is not exactly its own profile is refused, naming what it depends on", () => {
  const cases: [(d: any) => void, RegExp][] = [
    // The hunt's second file: feature-2's own profile is right, its dependsOn names feature-1's.
    [(d) => (d.timeline.features[1].dependsOn = ["profile-1"]), /^Error: Design feature feature-2 extrudes profile profile-3 but depends on profile-1, not exactly on that profile$/],
    [(d) => (d.timeline.features[1].dependsOn = []), /^Error: Design feature feature-2 extrudes profile profile-3 but depends on nothing, not exactly on that profile$/],
    [(d) => (d.timeline.features[1].dependsOn = ["profile-3", "feature-1"]), /^Error: Design feature feature-2 extrudes profile profile-3 but depends on profile-3 and feature-1, not exactly on that profile$/],
    [(d) => (d.timeline.features[1].dependsOn = ["profile-3", "profile-3"]), /^Error: Design feature feature-2 extrudes profile profile-3 but depends on profile-3 and profile-3, not exactly on that profile$/],
  ];
  for (const [edit, message] of cases) {
    const d = data(twoBrackets());
    edit(d);
    assert.throws(() => readDesignDocument(d), message, String(edit));
  }
  // Unbroken, it opens.
  assert.doesNotThrow(() => readDesignDocument(data(twoBrackets())));
});

test("hunt B4: the reader's preset size limits are the panel's, the kernel's MIN_FEATURE and MAX_SIZE", () => {
  // typed-entry.ts MIN_TYPED and MAX_TYPED, from kernel.json (MIN_FEATURE = 1e-3 mm, MAX_SIZE = 1e6 mm).
  assert.deepEqual(PRESET_SIZE_LIMITS, { min: MIN_TYPED, max: MAX_TYPED });
  assert.deepEqual(PRESET_SIZE_LIMITS, { min: 0.001, max: 1_000_000 });
});

/**
 * One rebuild on a cache of its own on the real kernel: every item's result, the bodies it built, how many more bodies
 * the kernel held while built, and whether it held as many as before once the cache was cleared.
 */
async function build(doc: DesignDocument) {
  const before = await kernel.call("body_count");
  const cache = new BodyCache(kernel);
  const b = await rebuildTimeline(doc, cache, kernel);
  const held = (await kernel.call("body_count")) - before;
  await cache.clear();
  return { results: b.results, bodies: Object.keys(b.bodies), held, freed: (await kernel.call("body_count")) === before };
}

test("hunt B4: a file holding a profile size outside 0.001 to 1,000,000 mm still opens (Edit feature could save one before), and saves as it was", () => {
  // Before this fix Edit feature passed a typed -5 to the kernel, which built it mirrored, and the app saved it:
  // refusing such a file on open would lock its owner out of everything else in it.
  for (const v of [-5, 0, -0, 0.9 * PRESET_SIZE_LIMITS.min, 1.1 * PRESET_SIZE_LIMITS.max, 1e308]) {
    const d = data(partDocument("l-bracket", 20, 10, 5));
    d.profiles[0].width = v;
    const read = readDesignDocument(d);
    assert.equal(read.profiles[0].width, v, `width ${v}`);
    // Saved, opened and saved again it is the same text.
    const text = projectToJson({ ...emptyProject("Hunt B"), workspaces: { design: read } });
    assert.equal(projectToJson(projectFromJson(text, DESIGN)), text, `width ${v}`);
  }
});

test("hunt B4: an L-bracket of width -5 fails as that one item when it builds, in plain words naming the size and the limits, with no body built (never mirrored)", async () => {
  // Body 1 the bracket, Body 2 a box after it: only the bracket fails.
  const d = data(insertPreset(partDocument("l-bracket", 20, 10, 5), "box", 4, 4, 4).doc);
  d.profiles[0].width = -5;
  const doc = readDesignDocument(d);
  const b = await build(doc);
  assert.deepEqual(b.results["feature-1"], { status: "failed", cause: "error", message: "L-bracket 1's width -5 mm is outside 0.001 to 1000000 mm, the sizes a profile can have" });
  assert.equal(b.results["feature-2"].status, "built");
  // Only the box's body: none for the bracket (the kernel built -5 as a 127.5 mm³ mirrored body before).
  assert.deepEqual(b.bodies, ["body:feature-2"]);
  assert.equal(b.held, 1, "the kernel holds the box alone");
  assert.ok(b.freed, "every body freed after");
});

test("hunt B4: a profile's width and depth build from 0.001 to 1,000,000 mm; a tenth outside either end, zero or negative, the item fails naming the size", async () => {
  const { min, max } = PRESET_SIZE_LIMITS;
  // The limits' own check is profileSizeRefused, what the rebuild asks before it builds a preset, so it is judged there
  // for every profile shape and both sizes; the rebuild on the kernel is checked below.
  for (const kind of ["l-bracket", "plate", "slot", "star"] as const)
    for (const key of ["width", "depth"] as const) {
      const sized = (v: number) => {
        const d = data(partDocument(kind, 20, 10, 5));
        d.profiles[0][key] = v;
        const doc = readDesignDocument(d);
        return profileSizeRefused(doc, doc.timeline.features[0]);
      };
      const name = { "l-bracket": "L-bracket 1", plate: "Plate 1", slot: "Slot 1", star: "Star 1" }[kind];
      const refused = (v: number) => new RegExp(`^${name}'s ${key} ${String(v).replace(/[.+]/g, "\\$&")} mm is outside 0\\.001 to 1000000 mm, the sizes a profile can have$`);
      for (const v of [min, 1.1 * min, 0.9 * max, max]) assert.equal(sized(v), null, `${kind} ${key} ${v}`);
      for (const v of [0.9 * min, 1.1 * max, 0, -5, 1e308]) assert.match(sized(v) ?? "", refused(v), `${kind} ${key} ${v}`);
      // -0 is said as 0 (String(-0) is "0") and refused as 0 is.
      assert.match(sized(-0) ?? "", refused(0), `${kind} ${key} -0`);
    }
  // On the kernel: a plate 0.9 × 0.001 mm wide fails as the item, in our words before the kernel is asked; one
  // 0.9 × 1,000,000 mm wide by 10 deep builds (the limit lets the kernel judge it, and it takes it).
  const plate = (w: number) => {
    const d = data(partDocument("plate", 20, 10, 5));
    d.profiles[0].width = w;
    return readDesignDocument(d);
  };
  assert.deepEqual((await build(plate(0.9 * min))).results["feature-1"], { status: "failed", cause: "error", message: "Plate 1's width 0.0009000000000000001 mm is outside 0.001 to 1000000 mm, the sizes a profile can have" });
  const big = await build(plate(0.9 * max));
  assert.equal(big.results["feature-1"].status, "built", JSON.stringify(big.results["feature-1"]));
});

test("hunt B4: a box's, cylinder's or sphere's sizes and a preset's height stay the kernel's to judge (it refuses them in its words)", () => {
  // reader-every-feature.test.ts holds the rule for a box's -5; the same for 0 and 1e308, and for a plate's height.
  for (const v of [0, -5, 1e308]) {
    const box = data(partDocument("box", 40, 30, 20));
    box.timeline.features[0].intent.parameters.height = v;
    assert.doesNotThrow(() => readDesignDocument(box), `box height ${v}`);
    const plate = data(partDocument("plate", 40, 30, 20));
    plate.timeline.features[0].intent.parameters.distance = v;
    assert.doesNotThrow(() => readDesignDocument(plate), `plate height ${v}`);
  }
});

test("hunt B4: no edit makes a profile size that would fail its item: Edit feature and the panel's changes say why instead", () => {
  const bracket = partDocument("l-bracket", 20, 10, 5);
  // Edit feature passes a typed -5 on (readTyped takes signs, for an extrude's distance); the profile refuses it in words.
  assert.throws(() => editFeature(bracket, "feature-1", { width: -5 }), /^Error: The width must be from 0\.001 to 1000000 mm, not -5$/);
  assert.throws(() => editFeature(bracket, "feature-1", { depth: 0 }), /^Error: The depth must be from 0\.001 to 1000000 mm, not 0$/);
  assert.throws(() => changePreset(bracket, "feature-1", "slot", 40, 2e6, 20), /^Error: The depth must be from 0\.001 to 1000000 mm, not 2000000$/);
  assert.throws(() => insertPreset(bracket, "star", 0.0009, 5, 5), /^Error: The width must be from 0\.001 to 1000000 mm, not 0\.0009$/);
  // A box's sizes still go to the kernel (feature-edit.test.ts: its refusal names the height).
  assert.doesNotThrow(() => editFeature(partDocument("box", 40, 30, 20), "feature-1", { height: 2e6 }));
  // Sizes inside the limits still change it, and the result opens.
  const edited = editFeature(bracket, "feature-1", { width: 0.9 * MAX_TYPED });
  assert.equal(edited.profiles[0].width, 900_000);
  assert.deepEqual(reopen(edited), edited);
});
