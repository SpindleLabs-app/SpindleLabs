// Pattern (step 61a): the values' checks in plain words with every limit
// at 0.9× and 1.1× (or one either side for whole numbers), the kernel's
// request worked by hand, the summaries, the copies' ids and the item put
// in at the marker with every refusal. The rebuild (copies built and joined
// on the real kernel) is step 61b's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { copyIds, CURVED_JOIN, insertPattern, instanceCount, KERNEL_INPUT_WORDS, MAX_INSTANCES, MAX_SPACING, MIN_SPACING, PATTERN_STEP, patternProblem, patternRequest, patternSummary, type PatternValues } from "../src/pattern.ts";

const row = (over: Partial<PatternValues & { kind: "linear" }> = {}): PatternValues => ({ kind: "linear", direction: "X", spacing: 10, count: 3, join: false, ...over }) as PatternValues;
const round = (over: Partial<PatternValues & { kind: "circular" }> = {}): PatternValues => ({ kind: "circular", axis: "Z", centre: [0, 0, 0], count: 6, angle: 360, join: false, ...over }) as PatternValues;

/** Box 1 (feature-1), Cylinder 1 (feature-2). */
const twoBodies = (): DesignDocument => insertPreset(partDocument("box", 40, 30, 20), "cylinder", 10, 10, 10).doc;

test("the kernel's request by hand", () => {
  // A row along X: the unit direction, spacing and count as typed.
  assert.deepEqual(patternRequest(row()), { linear: { along: [1, 0, 0], spacing: 10, count: 3 } });
  // A 3 × 2 grid along Y then Z, the second spacing negative (the other way).
  assert.deepEqual(patternRequest(row({ direction: "Y", direction2: "Z", spacing2: -4, count2: 2 })), { linear: { along: [0, 1, 0], spacing: 10, count: 3, across: { along: [0, 0, 1], spacing: -4, count: 2 } } });
  // A full turn leaves the angle out: the kernel spaces 6 evenly all round.
  assert.deepEqual(patternRequest(round({ centre: [1, 2, 3] })), { circular: { pivot: [1, 2, 3], axis: [0, 0, 1], count: 6 } });
  // 90° is π/2 radians; −90° is −π/2.
  assert.deepEqual(patternRequest(round({ axis: "X", count: 3, angle: 90 })), { circular: { pivot: [0, 0, 0], axis: [1, 0, 0], count: 3, angle: Math.PI / 2 } });
  assert.deepEqual(patternRequest(round({ count: 3, angle: -90 })), { circular: { pivot: [0, 0, 0], axis: [0, 0, 1], count: 3, angle: -Math.PI / 2 } });
  // A full turn the other way: the same places, round the axis turned over.
  assert.deepEqual(patternRequest(round({ angle: -360 })), { circular: { pivot: [0, 0, 0], axis: [-0, -0, -1], count: 6 } });
});

test("instances count the original: a row of 3 is the body and 2 copies; a 4 × 3 grid is 12", () => {
  assert.equal(instanceCount(row()), 3);
  assert.equal(instanceCount(row({ direction2: "Y", spacing2: 5, count2: 3, count: 4 })), 12);
  assert.equal(instanceCount(round()), 6);
});

test("every limit in plain words, either side of it", () => {
  const ok = (v: PatternValues) => assert.equal(patternProblem(v), null, JSON.stringify(v));
  // Spacings: 1 µm to 1 km either way.
  ok(row({ spacing: MIN_SPACING })), ok(row({ spacing: -MIN_SPACING })), ok(row({ spacing: MAX_SPACING }));
  assert.equal(patternProblem(row({ spacing: 0.9 * MIN_SPACING })), "The spacing must be at least 0.001 mm (it can be negative to go the other way).");
  assert.equal(patternProblem(row({ spacing: -0.9 * MIN_SPACING })), "The spacing must be at least 0.001 mm (it can be negative to go the other way).");
  assert.equal(patternProblem(row({ spacing: 1.1 * MAX_SPACING })), "The spacing can be at most 1,000,000 mm.");
  assert.equal(patternProblem(row({ spacing: Number.NaN })), "Type the spacing in mm.");
  assert.equal(patternProblem(row({ direction2: "Y", count2: 2, spacing2: 0.9 * MIN_SPACING })), "The second spacing must be at least 0.001 mm (it can be negative to go the other way).");
  ok(row({ direction2: "Y", count2: 2, spacing2: 1.1 * MIN_SPACING }));
  // Counts: whole, at least 1 along each direction, 2 to 256 in all.
  assert.equal(patternProblem(row({ count: 1 })), "A pattern needs at least 2, the body and one copy.");
  ok(row({ count: 2 }));
  assert.equal(patternProblem(row({ count: 0 })), "Type how many along the direction, a whole number from 1.");
  assert.equal(patternProblem(row({ count: 2.5 })), "Type how many along the direction, a whole number from 1.");
  ok(row({ count: 16, direction2: "Y", spacing2: 1, count2: 16 }));
  assert.equal(patternProblem(row({ count: 17, direction2: "Y", spacing2: 1, count2: 16 })), `A pattern makes at most ${MAX_INSTANCES}, the body included; this one would make 272.`);
  assert.equal(patternProblem(row({ direction2: "Y", spacing2: 1, count2: 0 })), "Type how many along the second direction, a whole number from 1.");
  assert.equal(patternProblem(row({ direction2: "X", spacing2: 1, count2: 2 })), "The second direction must be another axis, or the copies would land on each other.");
  ok(round({ count: MAX_INSTANCES })), ok(round({ count: 2 }));
  assert.equal(patternProblem(round({ count: MAX_INSTANCES + 1 })), `A pattern makes at most ${MAX_INSTANCES}, the body included; this one would make 257.`);
  assert.equal(patternProblem(round({ count: 1 })), "A pattern needs at least 2, the body and one copy.");
  // Angles: above 0, at most a full turn, either way.
  ok(round({ angle: 360 })), ok(round({ angle: -360 })), ok(round({ angle: 0.5 }));
  assert.equal(patternProblem(round({ angle: 360.5 })), "The angle can be at most 360°, a full turn.");
  assert.equal(patternProblem(round({ angle: 0 })), "Type the angle in degrees, above 0 (negative turns the other way).");
  assert.equal(patternProblem(round({ centre: [0, Number.POSITIVE_INFINITY, 0] })), "Type the centre in mm.");
  assert.equal(patternProblem(round({ axis: "W" as "X" })), "W is not X, Y or Z.");
});

test("summaries in words", () => {
  assert.equal(patternSummary(["Box 1"], row()), "3 of Box 1 in a row along X, 10 mm apart");
  assert.equal(patternSummary(["Box 1", "Cylinder 1"], row({ direction2: "Z", spacing2: 2.5, count2: 2, join: true })), "3 × 2 of Box 1 and Cylinder 1 in a grid along X and Z, 10 mm and 2.5 mm apart, joined");
  assert.equal(patternSummary(["Box 1"], round()), "6 of Box 1 round the Z axis");
  assert.equal(patternSummary(["Box 1", "Box 2", "Box 3"], round({ angle: 90, count: 3 })), "3 of Box 1, Box 2 and Box 3 over 90° round the Z axis");
  // The kernel's input names all have words, and the curved Join says what to do instead.
  assert.deepEqual(Object.keys(KERNEL_INPUT_WORDS).sort(), ["across", "along", "angle", "axis", "count", "count2", "pivot", "spacing", "spacing2"]);
  assert.match(CURVED_JOIN, /Turn Join off/);
});

test("copies are pieces of the Pattern, numbered from 1, each source's in turn", () => {
  assert.deepEqual(copyIds("feature-9", 2, 2), ["body:feature-9/piece:1", "body:feature-9/piece:2", "body:feature-9/piece:3", "body:feature-9/piece:4"]);
  assert.deepEqual(copyIds("feature-9", 1, 0), []);
});

test("insertPattern by hand, at the marker, and every refusal", () => {
  const d = twoBodies();
  const { doc, id } = insertPattern(d, ["body:feature-2", "body:feature-1"], row({ join: true }));
  assert.equal(id, "feature-3");
  const f = doc.timeline.features.find((x) => x.id === id)!;
  assert.deepEqual(f.intent, { type: "pattern", parameters: { bodies: ["body:feature-2", "body:feature-1"], kind: "linear", direction: "X", spacing: 10, count: 3, join: true }, summary: "3 of Cylinder 1 and Box 1 in a row along X, 10 mm apart, joined" });
  assert.deepEqual([f.dependsOn, f.provenance.self.label, doc.nextId], [["feature-2", "feature-1"], "Pattern 1", 4]);
  assert.equal(PATTERN_STEP, "Pattern bodies");
  // At the marker; a body after it is refused.
  const rolled: DesignDocument = { ...d, timeline: { ...d.timeline, marker: "feature-1" } };
  const r = insertPattern(rolled, ["body:feature-1"], round()).doc;
  assert.deepEqual([r.timeline.features.map((x) => x.id), r.timeline.marker], [["feature-1", "feature-3", "feature-2"], "feature-3"]);
  assert.throws(() => insertPattern(rolled, ["body:feature-2"], round()), { message: "Cylinder 1 comes after the rollback marker, so a Pattern put in at the marker can't use it" });
  assert.throws(() => insertPattern(d, [], round()), { message: "pick at least one body to pattern" });
  assert.throws(() => insertPattern(d, ["body:feature-1", "body:feature-1"], round()), { message: "body:feature-1 is picked twice" });
  assert.throws(() => insertPattern(d, ["body:feature-9"], round()), { message: "body:feature-9 is not a body in the design" });
  assert.throws(() => insertPattern(d, ["feature-1"], round()), { message: "feature-1 is not a body in the design" });
  assert.throws(() => insertPattern(d, ["body:feature-1/piece:1"], round()), { message: "body:feature-1/piece:1 is not a body in the design" });
  const moved = insertMove(d, ["body:feature-1"], { ...NO_MOVE, x: 5 }).doc;
  assert.throws(() => insertPattern(moved, ["body:feature-3"], round()), { message: "body:feature-3 is not a body in the design" }, "a Move has no body of its own");
  // Values refused change nothing, in the same words as the panel's.
  assert.throws(() => insertPattern(d, ["body:feature-1"], round({ count: 1 })), { message: "A pattern needs at least 2, the body and one copy." });
  // Names count Patterns: a second is Pattern 2.
  assert.equal(insertPattern(doc, ["body:feature-1"], round()).doc.timeline.features.at(-1)!.provenance.self.label, "Pattern 2");
});

// From the patterns bug hunt of 2026-11-12: values the check passed (or
// refused) differently from what the kernel is then asked for.
test("a row whose second direction is off counts as a row, leftover second count or not", () => {
  // 200 along X, the second direction off: the request is a row of 200 (no
  // `across`), so 200 instances, under 256 (the check said 200 × 2 = 400).
  const left = row({ count: 200, count2: 2 });
  assert.deepEqual(patternRequest(left), { linear: { along: [1, 0, 0], spacing: 10, count: 200 } });
  assert.equal(instanceCount(left), 200);
  assert.equal(patternProblem(left), null);
  // 1 along X with a leftover 3: a row of 1, which is no pattern (the check counted 1 × 3).
  assert.equal(patternProblem(row({ count: 1, count2: 3 })), "A pattern needs at least 2, the body and one copy.");
  assert.equal(instanceCount(row({ count: 3, count2: 2, spacing2: 5 })), 3);
});

test("angles the kernel can't tell from a full turn or from no turn are refused in words", () => {
  // The kernel's ANGULAR is 1e-9 rad = 1e-9 × 180/π ≈ 5.73e-8°. 359.99999999°
  // is 1e-8° = 1.75e-10 rad short of a full turn, inside it: refused.
  // 359.9999° is 1e-4° = 1.75e-6 rad short, well outside: fine.
  const close = "The angle is too close to a full turn to tell apart: type 360 for a full turn.";
  assert.equal(patternProblem(round({ angle: 359.99999999 })), close);
  assert.equal(patternProblem(round({ angle: -359.99999999 })), close);
  ok(round({ angle: 359.9999 }));
  // A step of θ/(n−1): 1e-8° over 2 is 1.75e-10 rad a step, under ANGULAR;
  // 1e-6° over 2 is 1.75e-8 rad, over it. At the edge: 0.9× and 1.1× of
  // ANGULAR in degrees, one step (count 2).
  const small = "The angle is too small for that many: each step must be more than about 0.00000006°.";
  const step = (1e-9 * 180) / Math.PI;
  assert.equal(patternProblem(round({ count: 2, angle: 1e-8 })), small);
  assert.equal(patternProblem(round({ count: 2, angle: 0.9 * step })), small);
  ok(round({ count: 2, angle: 1.1 * step }));
  ok(round({ count: 2, angle: 1e-6 }));
  // Over 255 steps the whole angle must be 255 times that.
  assert.equal(patternProblem(round({ count: 256, angle: 255 * 0.9 * step })), small);
  ok(round({ count: 256, angle: 255 * 1.1 * step }));
});

test("the centre is three numbers in model space (±100 km)", () => {
  ok(round({ centre: [0, 1e8, 0] })), ok(round({ centre: [-1e8, 0, 0] })), ok(round({ centre: [0, 0.9e8, 0] }));
  assert.equal(patternProblem(round({ centre: [0, 1.1e8, 0] })), "The centre must be within 100 km (100,000,000 mm) of the origin.");
  assert.equal(patternProblem(round({ centre: [0, 0] as unknown as [number, number, number] })), "Type the centre in mm.");
  assert.equal(patternProblem(round({ centre: [0, 0, 0, 0] as unknown as [number, number, number] })), "Type the centre in mm.");
});

const ok = (v: PatternValues) => assert.equal(patternProblem(v), null, JSON.stringify(v));
