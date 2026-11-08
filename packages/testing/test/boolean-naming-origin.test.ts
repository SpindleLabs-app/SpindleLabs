// Rule 4 in the naming model (boxes named as box presets name their faces) (SL #430, #431, 2026-11-07): a result face's names rank by the input face it lies on
// (the target's before the tools'), and each name by its place in that face's list, as Design ranks them from the
// kernel's history. Before, the model ranked a name by the first input holding it anywhere, and by its earliest place
// in any input's list, so a body holding a copy of another's names lifted them over the face's own. Every expected
// list below is worked out from the blocks' corners beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rebuildBooleans, type BlockFeature, type BooleanRebuild, type CombineFeature, type Facing, type Rect } from "../src/boolean-naming-model.ts";

const block = (id: string, rect: Rect, z: [number, number], faces?: BlockFeature["faces"]): BlockFeature => ({ kind: "block", id, rect, z, operation: "new", ...(faces && { faces }) });
const combine = (id: string, target: string, tools: string[], operation: CombineFeature["operation"], keepTools = false): CombineFeature => ({ kind: "combine", id, target, tools, operation, keepTools });
const namesOn = (r: BooleanRebuild, body: string, facing: Facing, at: number) => r.bodies.find((b) => b.id === body)!.faces.find((f) => f.facing === facing && Math.abs(f.at - at) < 1e-9)!.names;
const ROLES: Record<Facing, string> = { "-x": "left", "+x": "right", "-y": "front", "+y": "back", "-z": "bottom", "+z": "top" };
/** A box's faces named as a box preset names them, made at `place`, with `swap` giving one facing another name. */
const boxFaces = (id: string, place: number, swap: Partial<Record<Facing, string>> = {}) =>
  Object.fromEntries((Object.keys(ROLES) as Facing[]).map((d, i) => [d, { name: swap[d] ?? `face:${id}/${ROLES[d]}`, made: [place, i] }])) as BlockFeature["faces"];

test("#431: a face lying on the tool's face alone shows the tool's names in its order, though the target holds one of them elsewhere", () => {
  // Box 1 is x 0–10 and Box 2 x 0–20 (both y 0–10, z 0–10); Combine 3 joins Box 1 into Box 2, keeping it. Their
  // bottoms lie on each other at z = 0, so the joined bottom is [Box 2's, Box 1's] (the target's first).
  // Box 4 (x 5–15, y 2–8, z −5 to 5) carries Box 1's bottom name on its x = 5 side (a body holding a copy of another's
  // face, as a kept tool moved does). Combine 5 intersects Box 4 with the joined body, keeping it: x 5–15, y 2–8, z 0–5.
  // Its bottom at z = 0 lies on the joined bottom only (Box 4's bottom is at z = −5): [Box 2's, Box 1's], Box 2's shown.
  // Its x = 5 side lies on Box 4's side alone: [Box 1's bottom name].
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 10, 10], [0, 10], boxFaces("feature-1", 0)),
    block("feature-2", [0, 0, 20, 10], [0, 10], boxFaces("feature-2", 1)),
    combine("feature-3", "body:feature-2", ["body:feature-1"], "join", true),
    block("feature-4", [5, 2, 15, 8], [-5, 5], boxFaces("feature-4", 3, { "-x": "face:feature-1/bottom" })),
    combine("feature-5", "body:feature-4", ["body:feature-2"], "intersect", true),
  ]);
  assert.deepEqual(r.failed, new Map());
  assert.deepEqual(namesOn(r, "body:feature-2", "-z", 0), ["face:feature-2/bottom", "face:feature-1/bottom"], "the join's bottom, before");
  assert.deepEqual(namesOn(r, "body:feature-4", "-z", 0), ["face:feature-2/bottom", "face:feature-1/bottom"]);
  assert.deepEqual(namesOn(r, "body:feature-4", "-x", 5), ["face:feature-1/bottom"]);
});

test("#430: faces lying on each other: the target's own first name stays first, though the tool's face holds an earlier-made one first", () => {
  // Box 1 is x 0–20, y 0–10; Box 2 x 0–10, y 0–8 (both z 0–10; Box 1 made first). Combine 3 intersects Box 2 with
  // Box 1, keeping Box 1: Box 2 as it was, its x = 0 side lying on both, so [Box 2's left, Box 1's left] (the
  // target's first). Combine 4 joins Box 1 into it: x 0–20, y 0–10. Its x = 0 side lies on the target's face
  // [Box 2's, Box 1's] for y 0–8 and on Box 1's [Box 1's] for all of y 0–10. The target's face comes first, each
  // name at its place in that face's list: [Box 2's, Box 1's], though Box 1's left is first on the tool's face (the
  // part past y = 8 only the tool reaches) and made earlier.
  const r = rebuildBooleans([
    block("feature-1", [0, 0, 20, 10], [0, 10], boxFaces("feature-1", 0)),
    block("feature-2", [0, 0, 10, 8], [0, 10], boxFaces("feature-2", 1)),
    combine("feature-3", "body:feature-2", ["body:feature-1"], "intersect", true),
    combine("feature-4", "body:feature-2", ["body:feature-1"], "join"),
  ]);
  assert.deepEqual(r.failed, new Map());
  assert.deepEqual(namesOn(r, "body:feature-2", "-x", 0), ["face:feature-2/left", "face:feature-1/left"]);
});

// Survivors 11-08 (#423): the two ties a name's place and body leave to made order.

test("a name on two of a tool's faces under one result face, first in each, ties another first name there: made order, not the body holding it elsewhere", () => {
  // Box 4 is a bridge x 10–30, z 0–5 (all y 0–10); Combine 4 joins posts Box 1 (x 10–15, its top named face:q, made at
  // 1) and Box 2 (x 25–30, its top named face:n, made at 2) onto it, both z 0–10: one body, two tops at z = 10 lying
  // apart. Box 5 (x 0–10, z 0–10) has its x = 0 side named face:n too. Combine 7 joins the bridge's body and a filler
  // (Box 6, x 15–25, z 5–10) into Box 5: one top x 0–30 at z = 10, 3000 in all (1000 + 1000 + 250 + 250 + 500).
  // Box 5's own top comes first (the target's, place 0). face:q and face:n each lie first in a top of the bridge's body
  // (the first tool, place 0): a tie, so made order, q (1) before n (2); the filler's top last. That Box 5 holds
  // face:n elsewhere (its side) does not lift it.
  const r = rebuildBooleans([
    block("feature-1", [10, 0, 15, 10], [0, 10], boxFaces("feature-1", 1, { "+z": "face:q" })),
    block("feature-2", [25, 0, 30, 10], [0, 10], boxFaces("feature-2", 2, { "+z": "face:n" })),
    block("feature-3", [10, 0, 30, 10], [0, 5], boxFaces("feature-3", 3)),
    combine("feature-4", "body:feature-3", ["body:feature-1", "body:feature-2"], "join"),
    block("feature-5", [0, 0, 10, 10], [0, 10], boxFaces("feature-5", 4, { "-x": "face:n" })),
    block("feature-6", [15, 0, 25, 10], [5, 10], boxFaces("feature-6", 5)),
    combine("feature-7", "body:feature-5", ["body:feature-3", "body:feature-6"], "join"),
  ]);
  assert.deepEqual(r.failed, new Map());
  assert.deepEqual(r.bodies.map((b) => `${b.id} ${b.volume}`), ["body:feature-5 3000"]);
  assert.deepEqual(namesOn(r, "body:feature-5", "+z", 10), ["face:feature-5/top", "face:q", "face:n", "face:feature-6/top"]);
});

test("a cut's wall: a name first on one tool face and second on another takes its first place, tying another first name: made order", () => {
  // The tool body: Box 5, a bar x 5–28, y −1–3 (all z −1–11), with posts joined on: Box 1 (x 5–10, y −1–5, its y = 5
  // side named face:x, made at 1) and Box 2 (x 20–25, y = 5 side face:y, made at 3) after Box 3 (x 25–28, y = 5 side
  // face:x, made at 2) joined into it, so Box 2's y = 5 side x 20–28 lists [face:y, face:x] (the target's first). Its
  // two y = 5 sides lie apart (x 5–10 and 20–28). Box 8, a bar x 0–30, y 0–10, z 0–10, is cut by it and by Box 7 (x
  // 10–20, y −1–5): a notch x 5–28, y 0–5, Box 7 reaching y = 5 between the posts, so the notch's
  // back wall is one face at y = 5, x 5–28; removed 690 (y 0–3) + 100 + 160 (posts, y 3–5) + 200 (Box 7, y 3–5),
  // 1850 left. The wall faces −y and lies on the tools' y = 5 sides turned (no input face faces −y there), so each name
  // ranks by the body holding it, then its place: face:x is first on Box 1's side and second on Box 2's, so place 0,
  // as face:y's: both the first tool's, a tie, so made order, x (made at 1, and at 2) before y (3); Box 7's side (the second tool) last.
  const r = rebuildBooleans([
    block("feature-1", [5, -1, 10, 5], [-1, 11], boxFaces("feature-1", 1, { "+y": "face:x" })),
    block("feature-2", [20, -1, 25, 5], [-1, 11], boxFaces("feature-2", 3, { "+y": "face:y" })),
    block("feature-3", [25, -1, 28, 5], [-1, 11], boxFaces("feature-3", 2, { "+y": "face:x" })),
    combine("feature-4", "body:feature-2", ["body:feature-3"], "join"),
    block("feature-5", [5, -1, 28, 3], [-1, 11], boxFaces("feature-5", 4)),
    combine("feature-6", "body:feature-5", ["body:feature-1", "body:feature-2"], "join"),
    block("feature-7", [10, -1, 20, 5], [-1, 11], boxFaces("feature-7", 5)),
    block("feature-8", [0, 0, 30, 10], [0, 10], boxFaces("feature-8", 6)),
    combine("feature-9", "body:feature-8", ["body:feature-5", "body:feature-7"], "cut"),
  ]);
  assert.deepEqual(r.failed, new Map());
  assert.deepEqual(r.bodies.map((b) => `${b.id} ${b.volume}`), ["body:feature-8 1850"]);
  assert.deepEqual(namesOn(r, "body:feature-8", "-y", 5), ["face:x", "face:y", "face:feature-7/back"]);
});
