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
