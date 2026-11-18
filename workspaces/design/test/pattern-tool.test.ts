// Step 61c, the Pattern tool's workings (pattern-tool.ts) and Edit feature's
// change of a Pattern (pattern.ts `changedPattern`). The boxes read by hand,
// the start spacing from the bodies' box, the motions' maths worked out
// point by point, the preview's copies on the real kernel (a row of 3 cubes,
// x ranges by hand) and against the rebuild's own copies on seeded patterns
// (two code paths agreeing), OK's check of a Join and when an edited
// Pattern can preview. FISSION_SEED replays one seed.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, Motion } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changedPattern, editablePattern, insertPattern, patternProblem, patternRequest, type PatternValues } from "../src/pattern.ts";
import { partDocument, insertPreset } from "../src/document.ts";
import { insertMove } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import type { Scene } from "../src/scene.ts";
import { copiesMesh, editPreviewOff, FAILED_NO_PREVIEW, JOINED_NO_PREVIEW, LATER_CHANGES, motionPoint, readPatternBoxes, refusalWords, START_SPACING, startSpacing, typedOf, type PatternTyped } from "../src/pattern-tool.ts";
import { PATTERN_DEFAULTS } from "../src/pattern-panel.ts";

const kernel = nodeKernel();

const typed = (over: Partial<PatternTyped> = {}): PatternTyped => ({ ...PATTERN_DEFAULTS, ...over });
const close = (got: readonly number[], want: readonly number[], what = "") => got.forEach((g, k) => assert.ok(Math.abs(g - want[k]) <= 1e-12 * Math.max(1, Math.abs(want[k])), `${what} [${got}] expected [${want}]`));

test("hand-worked: the boxes read as a row, a grid and a turn; empty counts 0, an empty angle is a full turn, the leftover boxes of other kinds are not read", () => {
  // The panel's defaults: a row of 3 along X, 20 mm apart.
  assert.deepEqual(readPatternBoxes(typed()), { kind: "linear", direction: "X", spacing: 20, count: 3, join: false });
  // A grid adds the second direction's three boxes.
  assert.deepEqual(readPatternBoxes(typed({ kind: "grid", spacing: "-7.5", direction2: "Z", spacing2: "4", count2: "5", join: true })), { kind: "linear", direction: "X", spacing: -7.5, count: 3, direction2: "Z", spacing2: 4, count2: 5, join: true });
  // Round an axis: the centre, its count and the angle; an empty angle is 360 (a full turn), a typed one as typed.
  assert.deepEqual(readPatternBoxes(typed({ kind: "circular", axis: "Y", centre: ["1", "-2", "3.5"], count3: "8" })), { kind: "circular", axis: "Y", centre: [1, -2, 3.5], count: 8, angle: 360, join: false });
  assert.equal((readPatternBoxes(typed({ kind: "circular", angle: " -90 " })) as { angle: number }).angle, -90);
  // An empty box counts as 0 (the typed-box rule), which patternProblem refuses in words: no spacing.
  const empty = readPatternBoxes(typed({ spacing: "  " }));
  assert.equal((empty as { spacing: number }).spacing, 0);
  assert.equal(patternProblem(empty), "The spacing must be at least 0.001 mm (it can be negative to go the other way).");
  // Text that is no number is NaN, named the same way; a count of 2.5 is never rounded to 2 or 3.
  assert.equal(patternProblem(readPatternBoxes(typed({ spacing: "abc" }))), "Type the spacing in mm.");
  assert.equal(patternProblem(readPatternBoxes(typed({ count: "2.5" }))), "Type how many along the direction, a whole number from 1.");
  assert.equal(patternProblem(readPatternBoxes(typed({ kind: "circular", count3: "" }))), "A pattern needs at least 2, the body and one copy.");
  assert.equal(patternProblem(readPatternBoxes(typed({ kind: "circular", centre: ["0", "x", "0"] }))), "Type the centre in mm.");
});

test("the spacing's lower limit either side, as typed: 0.9 × 1 µm is refused, 1.1 × 1 µm is taken", () => {
  assert.match(patternProblem(readPatternBoxes(typed({ spacing: "0.0009" }))) ?? "", /at least 0\.001 mm/);
  assert.equal(patternProblem(readPatternBoxes(typed({ spacing: "0.0011" }))), null);
  assert.equal(patternProblem(readPatternBoxes(typed({ spacing: "-0.0011" }))), null, "negative goes the other way");
});

test("typedOf puts a Pattern's values back in the boxes, and reading them gives the same values", () => {
  const values: PatternValues[] = [
    { kind: "linear", direction: "Y", spacing: -12.5, count: 4, join: true },
    { kind: "linear", direction: "X", spacing: 3, count: 2, direction2: "Z", spacing2: 7, count2: 3, join: false },
    { kind: "circular", axis: "X", centre: [1, 2, 3], count: 5, angle: 360, join: false },
    { kind: "circular", axis: "Z", centre: [0, 0, -4], count: 3, angle: -120, join: true },
  ];
  for (const v of values) assert.deepEqual(readPatternBoxes(typedOf(v, PATTERN_DEFAULTS)), v);
  // A full turn shows as the empty angle box (its placeholder says 360).
  assert.equal(typedOf(values[2], PATTERN_DEFAULTS).angle, "");
});

test("hand-worked: a new row's spacing is the bodies' length along the direction plus 5 mm, rounded up to a whole mm", () => {
  // A 10 mm cube, x 0..10: 10 + 5 = 15.
  assert.equal(startSpacing([[[0, 0, 0], [10, 10, 10]]], "X"), 15);
  // Two bodies, x 0..10 and 20..32.4: the box round both is 32.4 long, + 5 = 37.4, up to 38. Along Z they are 10 high: 15.
  const two = [[[0, 0, 0], [10, 10, 10]], [[20, -3, 0], [32.4, 4, 10]]] as const;
  assert.equal(startSpacing(two, "X"), 38);
  assert.equal(startSpacing(two, "Y"), 18, "y −3..10 is 13 long, + 5");
  assert.equal(startSpacing(two, "Z"), 15);
  assert.equal(startSpacing([], "X"), START_SPACING);
});

test("hand-worked: a move shifts a point and leaves a normal; a turn of 90° about Z goes x towards y, through its pivot", () => {
  const move: Motion = { move: [15, 0, -2] };
  assert.deepEqual(motionPoint([1, 2, 3], move), [16, 2, 1]);
  assert.deepEqual(motionPoint([0, 0, 1], move, true), [0, 0, 1]);
  const turn = (pivot: [number, number, number], angle: number, axis: [number, number, number] = [0, 0, 1]): Motion => ({ turn: { pivot, axis, angle } });
  // (10, 0, 0) a quarter turn about Z through the origin: (0, 10, 0).
  close(motionPoint([10, 0, 0], turn([0, 0, 0], Math.PI / 2)), [0, 10, 0], "about the origin");
  // Through (5, 5, 0): (10, 0) is (5, −5) from it; a quarter turn makes that (5, 5), so (10, 10, 0).
  close(motionPoint([10, 0, 7], turn([5, 5, 0], Math.PI / 2)), [10, 10, 7], "about (5, 5)");
  // A normal along X is only turned, wherever the pivot: along Y.
  close(motionPoint([1, 0, 0], turn([5, 5, 0], Math.PI / 2), true), [0, 1, 0], "the normal");
  // About X, y goes towards z: (0, 3, 0) a half turn is (0, −3, 0); a quarter turn (0, 0, 3).
  close(motionPoint([0, 3, 0], turn([0, 0, 0], Math.PI, [1, 0, 0])), [0, -3, 0], "half turn about X");
  close(motionPoint([0, 3, 0], turn([0, 0, 0], Math.PI / 2, [1, 0, 0])), [0, 0, 3], "quarter turn about X");
  assert.throws(() => motionPoint([0, 0, 0], { scale: { about: [0, 0, 0], factor: 2 } }), /only moved or turned/);
});

/** The scene of `build`'s bodies by id, as far as copiesMesh reads it (each body's id and view). */
const sceneOf = (views: { body: string; view: BodyView }[]) => ({ bodies: views }) as unknown as Scene;
/** Each copy's x, y and z range in `mesh`, a copy being `points` points long, rounded to the nanometre. */
function copyBoxes(positions: readonly number[], points: number): number[][] {
  const out: number[][] = [];
  for (let at = 0; at < positions.length; at += 3 * points) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let n = at; n < at + 3 * points; n += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], positions[n + k]);
        hi[k] = Math.max(hi[k], positions[n + k]);
      }
    out.push([...lo, ...hi].map((x) => Math.round(x * 1e6) / 1e6 + 0));
  }
  return out;
}

test("hand-worked on the real kernel: the preview of a row of 3 cubes 15 mm apart draws two copies at x 15..25 and 30..40, as many triangles as the cube each", async () => {
  const cache = new BodyCache(kernel);
  const doc = partDocument("box", 10, 10, 10);
  const build = await rebuildTimeline(doc, cache, kernel);
  const view = await cache.view(build.bodies["body:feature-1"].handle);
  const motions = await kernel.call("pattern_motions", patternRequest({ kind: "linear", direction: "X", spacing: 15, count: 3, join: false }));
  // Counts include the cube: 3 instances are 2 copies, moved 15 and 30 along X.
  assert.deepEqual(motions, [{ move: [15, 0, 0] }, { move: [30, 0, 0] }]);
  const mesh = copiesMesh(sceneOf([{ body: "body:feature-1", view }]), ["body:feature-1"], motions)!;
  const points = view.mesh.positions.length / 3;
  assert.equal(mesh.positions.length, 2 * view.mesh.positions.length);
  assert.equal(mesh.indices.length, 2 * view.mesh.indices.length);
  // The cube x 0..10 moved 15 and 30 along X: 15..25 and 30..40; y and z as they were.
  assert.deepEqual(copyBoxes(mesh.positions, points), [[15, 0, 0, 25, 10, 10], [30, 0, 0, 40, 10, 10]]);
  // The second copy's triangles name its own points, numbered after the first copy's.
  assert.equal(Math.min(...mesh.indices.slice(view.mesh.indices.length)), points);
  assert.equal(Math.max(...mesh.indices), 2 * points - 1);
  // No body shown, no motion: nothing to draw.
  assert.equal(copiesMesh(sceneOf([{ body: "body:feature-1", view }]), ["body:other"], motions), null);
  assert.equal(copiesMesh(sceneOf([{ body: "body:feature-1", view }]), ["body:feature-1"], []), null);
  await cache.close();
});

/** A small random generator from a seed (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = process.env.FISSION_SEED ? [Number(process.env.FISSION_SEED)] : Array.from({ length: 12 }, (_, k) => 6100 + k);

test("seeded: the preview's copies lie where the rebuild builds them, for rows, grids and turns of a box (two code paths agreeing)", async () => {
  for (const seed of SEEDS) {
    const r = random(seed);
    const axis = () => (["X", "Y", "Z"] as const)[Math.floor(r() * 3)];
    const pick = Math.floor(r() * 3);
    const values: PatternValues =
      pick === 0
        ? { kind: "linear", direction: axis(), spacing: Math.round((r() - 0.5) * 80) || 3, count: 2 + Math.floor(r() * 4), join: false }
        : pick === 1
          ? (() => {
              const d = axis();
              const d2 = (["X", "Y", "Z"] as const).filter((a) => a !== d)[Math.floor(r() * 2)];
              return { kind: "linear", direction: d, spacing: 12 + Math.floor(r() * 20), count: 2 + Math.floor(r() * 2), direction2: d2, spacing2: -(12 + Math.floor(r() * 20)), count2: 2, join: false } as PatternValues;
            })()
          : { kind: "circular", axis: axis(), centre: [Math.round(r() * 40 - 20), Math.round(r() * 40 - 20), Math.round(r() * 40 - 20)], count: 2 + Math.floor(r() * 5), angle: r() < 0.5 ? 360 : Math.round(r() * 300 - 150) || 45, join: false };
    assert.equal(patternProblem(values), null, `seed ${seed}`);
    const [w, d, h] = [4 + Math.round(r() * 10), 4 + Math.round(r() * 10), 4 + Math.round(r() * 10)];
    const { doc, id } = insertPattern(partDocument("box", w, d, h), ["body:feature-1"], values);
    const cache = new BodyCache(kernel);
    const build = await rebuildTimeline(doc, cache, kernel);
    const res = build.results[id];
    assert.equal(res.status, "built", `seed ${seed}: ${res.status === "failed" ? res.message : ""}`);
    const view = await cache.view(build.bodies["body:feature-1"].handle);
    const motions = await kernel.call("pattern_motions", patternRequest(values));
    const mesh = copiesMesh(sceneOf([{ body: "body:feature-1", view }]), ["body:feature-1"], motions)!;
    const drawn = copyBoxes(mesh.positions, view.mesh.positions.length / 3);
    const ids = res.status === "built" ? res.bodies! : [];
    assert.equal(drawn.length, ids.length, `seed ${seed}: as many copies drawn as built`);
    for (const [k, b] of ids.entries()) {
      const v = await cache.view(build.bodies[b].handle);
      // The display mesh's box is the exact box for a box (its corners are mesh points), to the kernel's rounding.
      close(drawn[k], [...v.bounds[0], ...v.bounds[1]].map((x) => Math.round(x * 1e6) / 1e6 + 0), `seed ${seed} copy ${k + 1}`);
    }
    await cache.close();
  }
});

test("a kernel refusal is said in the pattern's own words, never the kernel's sentence", () => {
  assert.equal(refusalWords([{ input: "param", name: "angle" }]), "The kernel can't use the angle: change it and try again.");
  assert.equal(refusalWords([{ input: "param", name: "across" }]), "The kernel can't use the second direction: change it and try again.");
  assert.equal(refusalWords([{ input: "param", name: "nonsense" }, { input: "profile" }]), "The kernel can't make this pattern: change it and try again.");
  assert.equal(refusalWords([]), "The kernel can't make this pattern: change it and try again.");
});

test("on the real kernel: OK's check of a Join whose copies meet nothing is no refusal and asks nothing (Ben's F2, as Combine's Join); the copies stay bodies of their own", async () => {
  const { checkedItem } = await import("../src/cut-ask.ts");
  const doc = partDocument("box", 10, 10, 10);
  const far = insertPattern(doc, ["body:feature-1"], { kind: "linear", direction: "X", spacing: 15, count: 3, join: true });
  const got = await checkedItem(kernel, far.doc, far.id);
  assert.equal(got.refused, null);
  assert.deepEqual(got.misses, []);
  // 15 mm apart, the 10 mm cubes leave 5 mm gaps: the cube and its two copies, numbered Body 1, 2 and 3 by OK's check.
  assert.deepEqual(got.numbered?.bodies?.map((b) => b.number), [1, 2, 3]);
});

test("an edited Pattern previews from the bodies shown only while they are as it copies them: built, not joined, unchanged after it", async () => {
  const base = partDocument("box", 10, 10, 10);
  const plain = insertPattern(base, ["body:feature-1"], { kind: "linear", direction: "X", spacing: 15, count: 3, join: false });
  const built = { [plain.id]: { status: "built" } };
  assert.equal(editPreviewOff(plain.doc, plain.id, built), null);
  assert.equal(editPreviewOff(plain.doc, plain.id, { [plain.id]: { status: "failed" } }), FAILED_NO_PREVIEW);
  const joined = insertPattern(base, ["body:feature-1"], { kind: "linear", direction: "X", spacing: 5, count: 3, join: true });
  assert.equal(editPreviewOff(joined.doc, joined.id, { [joined.id]: { status: "built" } }), JOINED_NO_PREVIEW);
  // A Move of the cube after the Pattern: the view shows the cube moved, not as the Pattern copies it.
  const moved = insertMove(plain.doc, ["body:feature-1"], { x: 5, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 });
  assert.equal(editPreviewOff(moved.doc, plain.id, { ...built, [moved.id]: { status: "built" } }), LATER_CHANGES);
  // The same Move suppressed or failed changes nothing shown; a Move of another body neither.
  assert.equal(editPreviewOff(moved.doc, plain.id, { ...built, [moved.id]: { status: "suppressed" } }), null);
  const other = insertPreset(plain.doc, "box", 5, 5, 5);
  const movedOther = insertMove(other.doc, [`body:${other.id}`], { x: 5, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 });
  assert.equal(editPreviewOff(movedOther.doc, plain.id, { ...built, [other.id]: { status: "built" }, [movedOther.id]: { status: "built" } }), null);
});

test("Edit feature's change of a Pattern: same values record nothing; new ones keep its id, place, bodies and name and say the summary again; refused values change nothing", () => {
  const base = partDocument("box", 10, 10, 10);
  const { doc, id } = insertPattern(base, ["body:feature-1"], { kind: "linear", direction: "X", spacing: 15, count: 3, join: false });
  const before = doc.timeline.features.find((f) => f.id === id)!;
  assert.equal(before.intent.summary, "3 of Box 1 in a row along X, 15 mm apart");
  const edit = editablePattern(doc, id);
  assert.deepEqual(edit, { id, name: "Pattern 1", bodies: ["body:feature-1"], values: { kind: "linear", direction: "X", spacing: 15, count: 3, join: false } });
  assert.equal(changedPattern(doc, id, edit.values), doc, "unchanged: nothing to record");
  // A leftover second count with no second direction is no change either (the tool's leftovers are never saved).
  assert.equal(changedPattern(doc, id, { ...edit.values, count2: 9 } as PatternValues), doc);
  const next = changedPattern(doc, id, { kind: "circular", axis: "Z", centre: [0, 0, 0], count: 6, angle: 360, join: true });
  const at = next.timeline.features.findIndex((f) => f.id === id);
  assert.equal(at, doc.timeline.features.findIndex((f) => f.id === id), "same place");
  const after = next.timeline.features[at];
  assert.equal(after.provenance.self.label, "Pattern 1");
  assert.deepEqual(after.dependsOn, before.dependsOn);
  assert.deepEqual(after.intent.parameters, { bodies: ["body:feature-1"], kind: "circular", axis: "Z", centre: [0, 0, 0], count: 6, angle: 360, join: true });
  assert.equal(after.intent.summary, "6 of Box 1 round the Z axis, joined");
  assert.equal(next.nextId, doc.nextId, "no new id");
  assert.throws(() => changedPattern(doc, id, { ...edit.values, count: 1 } as PatternValues), /at least 2/);
  assert.throws(() => changedPattern(doc, "feature-1", edit.values), /not a Pattern/);
  assert.throws(() => editablePattern(doc, "feature-1"), /not a Pattern/);
});

