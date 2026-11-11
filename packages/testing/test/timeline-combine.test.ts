// The timeline model's Combine (35f1d2, src/timeline-combine.ts): the
// oracle the random sessions trust for Combines, checked here by hand, with
// the working next to each assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOp, createModel, faceKey, rebuild, resolveFace, UnmodelledCombine, type ConcreteOp, type ModelBody, type ModelFault, type TimelineModel } from "../src/timeline-model.ts";
import { sketchMovedAlone } from "../src/timeline-session.ts";

const run = (m: TimelineModel, ...ops: ConcreteOp[]) => ops.map((op) => applyOp(m, op));
const faces = (b: ModelBody | undefined) => (b?.faces ?? []).map((f) => [faceKey(f.name), (f.also ?? []).map(faceKey), f.area]);

test("hand-worked: a Join of a 40 × 30 × 20 box and an 8 × 55 × 8 bar from the same corner, faces lying on each other merged", () => {
  const m = createModel();
  run(m, { op: "add-preset", kind: "box", sizes: [40, 30, 20] }, { op: "add-preset", kind: "box", sizes: [8, 55, 8] }, { op: "add-combine", target: "item-1", tool: "item-2", operation: "join", keep: false });
  const r = rebuild(m.doc);
  assert.deepEqual(r.results["item-3"], { status: "built" });
  // The bar is used up (rule 1: its body is gone), so item-2 shows none; item-1's body is the join.
  assert.equal((r.results["item-2"] as { body?: ModelBody }).body, undefined);
  const join = (r.results["item-1"] as { body?: ModelBody }).body;
  // Volume: the box 40·30·20 = 24000, and the bar's part outside it, y 30..55: 8·25·8 = 1600; 25600.
  assert.equal(join?.volume, 25600);
  // Rule 2 and 4, faces in the target's made order then the tool's: the bottoms (z = 0), fronts (y = 0) and lefts
  // (x = 0) lie on each other and merge, answering to both names, the target's first. Areas: bottom 40·30 + 8·25 =
  // 1400; front 40·20 = 800 (the bar's 8·8 lies inside it); box's back (y = 30) 40·20 − 8·8 = 736, where the bar goes
  // through; left 30·20 + 25·8 = 800; right 30·20 = 600; the bar's top beyond the box (z = 8, y 30..55) 8·25 = 200,
  // its end (y = 55) 8·8 = 64, its right (x = 8, y 30..55) 25·8 = 200. Nine faces.
  assert.deepEqual(faces(join), [
    ["item-1/bottom", ["item-2/bottom"], 1400],
    ["item-1/top", [], 1200],
    ["item-1/front", ["item-2/front"], 800],
    ["item-1/back", [], 736],
    ["item-1/left", ["item-2/left"], 800],
    ["item-1/right", [], 600],
    ["item-2/top", [], 200],
    ["item-2/back", [], 64],
    ["item-2/right", [], 200],
  ]);
  // A reference to the bar's top follows it onto the join (rule 2); one to its bottom finds the merged face (rule 4).
  assert.equal((resolveFace(r, { feature: "item-2", role: "top" }) as { area: number }).area, 200);
  assert.equal(faceKey((resolveFace(r, { feature: "item-2", role: "bottom" }) as { name: Parameters<typeof faceKey>[0] }).name), "item-1/bottom");
});

// The bar 100 × 20 × 10 (item-1) cut by a 10 × 40 × 20 box (item-2) moved to (30, −10, −5) (item-3), x 30..40 right
// through; a sketch drawn on the bar's whole top (item-4) before the Cut (item-6) is moved after it.
function cutBar(): TimelineModel {
  const m = createModel();
  run(
    m,
    { op: "add-preset", kind: "box", sizes: [100, 20, 10] },
    { op: "add-preset", kind: "box", sizes: [10, 40, 20] },
    { op: "add-move", bodies: ["item-2"], shift: [30, -10, -5], turnZ: 0, pivot: [0, 0] },
    { op: "add-face-sketch", shape: { kind: "circle", centre: [0, 0], radius: 3 }, face: { feature: "item-1", role: "top" } },
    { op: "add-combine", target: "item-1", tool: "item-2", operation: "cut", keep: false },
  );
  assert.deepEqual(run(m, { op: "reorder", item: "item-6", to: 3 }), [{ kind: "done", ids: [] }]);
  return m;
}

test("hand-worked: a Cut through a bar leaves two pieces, each split face tagged by the walls only its piece borders (rule 3)", () => {
  const r = rebuild(cutBar().doc);
  // Rule 1: a box's faces in made order are bottom, top, front, back, left, right; the first wholly in one piece is
  // the left (x = 0), so the near piece x 0..30 keeps the bar's id; the far one x 40..100 is the Cut's piece.
  const near = (r.results["item-1"] as { body?: ModelBody }).body;
  const pieces = (r.results["item-6"] as { pieces?: ModelBody[] }).pieces ?? [];
  assert.equal(pieces.length, 1);
  // Volumes 30·20·10 = 6000 and 60·20·10 = 12000. The near piece borders the bar's left and the cut's wall, the tool's
  // left (x = 30); the far one the bar's right and the tool's right (x = 40): those are the tags.
  assert.equal(near?.volume, 6000);
  assert.equal(pieces[0].volume, 12000);
  assert.deepEqual(faces(near), [
    ["item-1/bottom#item-1/left,item-2/left", [], 600],
    ["item-1/top#item-1/left,item-2/left", [], 600],
    ["item-1/front#item-1/left,item-2/left", [], 300],
    ["item-1/back#item-1/left,item-2/left", [], 300],
    ["item-1/left", [], 200],
    ["item-2/left", [], 200],
  ]);
  assert.deepEqual(
    faces(pieces[0]).map((f) => f[0]),
    ["item-1/bottom#item-1/right,item-2/right", "item-1/top#item-1/right,item-2/right", "item-1/front#item-1/right,item-2/right", "item-1/back#item-1/right,item-2/right", "item-1/right", "item-2/right"],
  );
});

test("hand-worked: a reference to the whole split face goes to the larger piece; the sketch drawn on it to the piece holding its origin", () => {
  const r = rebuild(cutBar().doc);
  // Untagged, with no point to go by (a selection): the larger top, 60·20 = 1200 mm², centred (70, 10, 10).
  const top = resolveFace(r, { feature: "item-1", role: "top" });
  assert.ok(top !== null && top !== "shared");
  assert.deepEqual([top.area, top.centroid], [1200, [70, 10, 10]]);
  // Tagged as the near piece: that one, 30·20 = 600 mm² centred (15, 10, 10).
  const tagged = resolveFace(r, { feature: "item-1", role: "top", tag: [{ feature: "item-1", role: "left" }, { feature: "item-2", role: "left" }] });
  assert.ok(tagged !== null && tagged !== "shared");
  assert.deepEqual([tagged.area, tagged.centroid], [600, [15, 10, 10]]);
  // The sketch was drawn at the top's height with its origin (0, 0, 10), a corner of the near piece: placed there,
  // at height 10, with the split warning (not held).
  assert.deepEqual(r.results["item-4"], { status: "built", lift: 10, plane: "plane-split" });
  // Planted bug ("combine-first-piece"): the first carrier, never the larger, is caught by the untagged reference.
  const first = resolveFace(r, { feature: "item-1", role: "top" }, new Set(["combine-first-piece"]));
  assert.ok(first !== null && first !== "shared");
  assert.equal(first.area, 600);
});

test("a Combine of a curved body is refused by the kernel's rule (error), changing no body; one of a flat body no block can model is unmodelled", () => {
  const m = createModel();
  run(m, { op: "add-preset", kind: "box", sizes: [40, 30, 20] }, { op: "add-preset", kind: "cylinder", sizes: [5, 30] }, { op: "add-combine", target: "item-1", tool: "item-2", operation: "cut", keep: false });
  const r = rebuild(m.doc);
  assert.equal(r.results["item-3"].status, "failed");
  assert.equal((r.results["item-3"] as { cause?: string }).cause, "error");
  // The box and the cylinder are as they were: the box's six faces, the cylinder still built with its body.
  assert.equal((r.results["item-1"] as { body?: ModelBody }).body?.faces.length, 6);
  assert.ok((r.results["item-2"] as { body?: ModelBody }).body !== undefined);
  // A triangle's extrude is flat but no block: the model can't say what Combine makes of it, and says so.
  const t = createModel();
  run(t, { op: "add-preset", kind: "box", sizes: [40, 30, 20] }, { op: "add-sketch", shape: { kind: "polygon", corners: [[0, 0], [10, 0], [0, 10]] } });
  run(t, { op: "add-extrude", sketch: "item-2", distance: 5 });
  run(t, { op: "add-combine", target: "item-1", tool: "item-6", operation: "join", keep: false });
  assert.throws(() => rebuild(t.doc), UnmodelledCombine);
});

test("hand-worked: a sketch on a face from a Combine's tool stays put when the target's Move changes; one on the target's face slides with it (35f1e2)", () => {
  // A 20 × 20 × 10 (item-1) moved +10 in x (item-2): x 10..30. B 20 × 10 × 30 (item-3) moved to (25, 5, −5) (item-4):
  // x 25..45, y 5..15, z −5..25, through A at x 25..30 with no faces on each other. Join, A the target (item-5). A
  // sketch on B's top (z = 25, item-6), drawn with B's motion (0°, (25, 5)), and one on A's top (z = 10, item-8: its
  // circle took curve-7), drawn with A's (0°, (10, 0)). The same edits on a model with the planted bug
  // "combine-face-moves-with-target" (the mistake Design and the model both made before 35f1e2: every face of a
  // Combine's result carried by the target's Moves).
  const right = createModel();
  const planted = createModel(["combine-face-moves-with-target"]);
  const both = (...ops: ConcreteOp[]) => [right, planted].forEach((m) => run(m, ...ops));
  both(
    { op: "add-preset", kind: "box", sizes: [20, 20, 10] },
    { op: "add-move", bodies: ["item-1"], shift: [10, 0, 0], turnZ: 0, pivot: [0, 0] },
    { op: "add-preset", kind: "box", sizes: [20, 10, 30] },
    { op: "add-move", bodies: ["item-3"], shift: [25, 5, -5], turnZ: 0, pivot: [0, 0] },
    { op: "add-combine", target: "item-1", tool: "item-3", operation: "join", keep: false },
    { op: "add-face-sketch", shape: { kind: "circle", centre: [0, 0], radius: 1 }, face: { feature: "item-3", role: "top" } },
    { op: "add-face-sketch", shape: { kind: "circle", centre: [0, 0], radius: 1 }, face: { feature: "item-1", role: "top" } },
  );
  const placed = (m: TimelineModel) => {
    const r = rebuild(m.doc, m.faults);
    return { b: r.results["item-6"], a: r.results["item-8"] };
  };
  const before = [rebuild(right.doc), rebuild(planted.doc, planted.faults)];
  // As drawn: each where it was drawn, carried by nothing yet (the planted bug too: it records A's motion for B's sketch).
  for (const m of [right, planted]) assert.deepEqual(placed(m), { b: { status: "built", lift: 25 }, a: { status: "built", lift: 10 } });
  // A now moved +20: B's top has not moved, so its sketch stays (no turn); A's top moved 10 further, and so does its
  // sketch: the motion since drawn turns by 0 and takes the world's origin to (20, 0) − (10, 0) = (10, 0).
  both({ op: "set-move", item: "item-2", shift: [20, 0, 0], turnZ: 0, pivot: [0, 0] });
  assert.deepEqual(placed(right), { b: { status: "built", lift: 25 }, a: { status: "built", lift: 10, turn: { x: [1, 0], at: [10, 0] } } });
  // With the planted bug, B's sketch slides those 10 mm too, along a face that did not move.
  assert.deepEqual(placed(planted).b, { status: "built", lift: 25, turn: { x: [1, 0], at: [10, 0] } });
  // The independent check (timeline-session.ts `sketchMovedAlone`) needs no model: B's top is where it was (area
  // 20 · 10 = 200, its four edges unmoved), so its sketch must be too. It passes the right rebuilds, comparing B's
  // sketch only (A's top moved), and catches the planted bug's.
  const sketches = [
    { id: "item-6", face: { feature: "item-3", role: "top" as const } },
    { id: "item-8", face: { feature: "item-1", role: "top" as const } },
  ];
  assert.equal(sketchMovedAlone(before[0], rebuild(right.doc), sketches), 1);
  assert.match(String(sketchMovedAlone(before[1], rebuild(planted.doc, planted.faults), sketches)), /^item-6 on item-3\/top: lift 25 turn null before, lift 25 turn \{"x":\[1,0\],"at":\[10,0\]\} now/);
});

test("hand-worked: a sketch drawn on a top that a Combine before it turned into a cavity's roof still faces up (rule 8; 35f1e2, seed 137)", () => {
  // Design's part is not here: the box 40 × 30 × 20 (item-1); a sketch on its top (item-2, z = 20, circle curve-3). A
  // box 2 × 47 × 29 (item-4: x 0..2, y 0..47, z 0..29) cut by the first box (item-5, the first box used up), the
  // sketch then moved after the Cut: what is left of item-4 has a roof at z = 20 over x 0..2, y 0..30 (where the first box was),
  // carrying the first box's top (rule 2) and looking down. The sketch moved after the Cut lies on that roof. Rule 8 keeps the sketch's normal on the side it was drawn
  // (up), so it lies at z = 20 facing up, not down; nothing carried it.
  const m = createModel();
  run(
    m,
    { op: "add-preset", kind: "box", sizes: [40, 30, 20] },
    { op: "add-face-sketch", shape: { kind: "circle", centre: [1, 10], radius: 1 }, face: { feature: "item-1", role: "top" } },
    { op: "add-preset", kind: "box", sizes: [2, 47, 29] },
    { op: "add-combine", target: "item-4", tool: "item-1", operation: "cut", keep: false },
  );
  assert.deepEqual(run(m, { op: "reorder", item: "item-2", to: 3 }), [{ kind: "done", ids: [] }]);
  const r = rebuild(m.doc);
  const roof = (r.results["item-4"] as { body?: ModelBody }).body?.faces.find((f) => faceKey(f.name) === "item-1/top");
  // The roof: 2 · 30 = 60 mm², at z = 20, looking down.
  assert.deepEqual([roof?.area, roof?.centroid[2], roof?.down], [60, 20, true]);
  assert.deepEqual(r.results["item-2"], { status: "built", lift: 20 });
});

test("hand-worked: a sketch on a face of a Combine result's copy finds that face by its whole name, curve and all (SL #430)", () => {
  // Ben's 40 × 30 × 20 box (item-1) joined with an 8 × 55 × 8 bar (item-2) from the same corner (item-3, the bar used
  // up), then a Duplicate of the join (item-4). The copy names each face by its role and the feature it came from
  // (built-body.ts `copiedFaceName`): the box's top as item-4/top:item-1 (z = 20, 40 · 30 = 1200 mm²) and the bar's top
  // beyond the box as item-4/top:item-2 (z = 8, 8 · 25 = 200 mm²). A sketch picked on each holds that whole name, so it
  // lies on its face, at z 20 and z 8, found (no plane warning). Before the fix the sketch kept only item-4/top, which
  // names neither face, and was drawn lost.
  const m = createModel();
  run(
    m,
    { op: "add-preset", kind: "box", sizes: [40, 30, 20] },
    { op: "add-preset", kind: "box", sizes: [8, 55, 8] },
    { op: "add-combine", target: "item-1", tool: "item-2", operation: "join", keep: false },
    { op: "add-duplicate", body: "item-1" },
  );
  const copy = (rebuild(m.doc).results["item-4"] as { body?: ModelBody }).body;
  const tops = (copy?.faces ?? []).filter((f) => f.name.role === "top").map((f) => [faceKey(f.name), f.area, f.centroid[2]]);
  assert.deepEqual(tops, [
    ["item-4/top:item-1", 1200, 20],
    ["item-4/top:item-2", 200, 8],
  ]);
  run(
    m,
    { op: "add-face-sketch", shape: { kind: "circle", centre: [10, 10], radius: 2 }, face: { feature: "item-4", role: "top", curve: "item-1" } },
    { op: "add-face-sketch", shape: { kind: "circle", centre: [4, 40], radius: 2 }, face: { feature: "item-4", role: "top", curve: "item-2" } },
  );
  const r = rebuild(m.doc);
  assert.deepEqual(r.results["item-5"], { status: "built", lift: 20 });
  assert.deepEqual(r.results["item-7"], { status: "built", lift: 8 });
});
