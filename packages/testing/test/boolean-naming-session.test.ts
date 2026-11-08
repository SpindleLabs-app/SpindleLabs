// Step 34a5: the naming model of joins, cuts and Combine
// (src/boolean-naming-model.ts) held against a second, independent count
// on unit cells (src/boolean-naming-cells.ts) through seeded sessions
// (src/boolean-naming-session.ts), and against itself moved, scaled and
// renamed. The unit-cell count is checked by hand first, so the two are
// not only agreeing with each other; then every planted fault must make a
// session disagree, so the sessions are shown to be able to fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOLEAN_FAULTS, ORDER_FAULTS, type BlockFeature, type BooleanFault, type BooleanFeature, type CombineFeature, type Rect } from "../src/boolean-naming-model.ts";
import { cellsCanCount, countOnCells, resolveEdgeOnCells, resolveOnCells } from "../src/boolean-naming-cells.ts";
import { firstDifference, invarianceDifference, moved, nameBack, randomBooleanSession, strangeIds, type BooleanSession } from "../src/boolean-naming-session.ts";

const block = (id: string, rect: Rect, z: [number, number], operation: BlockFeature["operation"] = "new", bodies?: string[]): BlockFeature => ({ kind: "block", id, rect, z, operation, bodies });

/** How many sessions every pull request runs, and how long each is. */
const SESSIONS = Number(process.env.BOOLEAN_SESSIONS ?? 40);
const STEPS = 10;

test("the unit-cell count by hand: a small bar cut by a slot (F1)", () => {
  // A 10 × 2 × 1 bar, cut through by a slot at x 3–4. Walking the bar's
  // faces in made order: start (z = 0) and end (z = 1) and line 1's side
  // (y = 0) run x 0–10, so the slot splits them; line 2's side (x = 10) is
  // the first wholly in one piece, the far one, x 4–10: 6 × 2 × 1 = 12
  // cells, lowest corner (4, 0, 0), keeps body:feature-1. The near piece,
  // x 0–3, 3 × 2 × 1 = 6, is the slot's piece 1.
  const r = countOnCells([block("feature-1", [0, 0, 10, 2], [0, 1]), block("feature-2", [3, -1, 4, 3], [-1, 2], "cut", ["body:feature-1"])]);
  assert.deepEqual(
    r.bodies.map((b) => `${b.id} ${b.volume} ${b.low.join(",")}`),
    ["body:feature-1 12 4,0,0", "body:feature-2/piece:1 6 0,0,0"],
  );
  // The far piece's wall at x = 4 faces −x and lies on the slot's line-2
  // side (x = 4 is the slot's x1): 2 (y) × 1 (z) = 2 squares.
  const wall = r.bodies[0].faces.find((f) => f.facing === "-x")!;
  assert.deepEqual([wall.names, wall.at, wall.area], [["face:feature-2/side:line-2"], 4, 2]);
  // The bar's top is now two faces carrying face:feature-1/end, so each is
  // tagged with what borders it and not the other: the far top (x 4–10)
  // with the bar's x = 10 side (line 2) and the slot's x = 4 wall (line 2);
  // both border line 1's and line 3's sides, which the near top borders too.
  const top = r.bodies[0].faces.find((f) => f.facing === "+z")!;
  assert.equal(top.full, "face:feature-1/end#face:feature-1/side:line-2,face:feature-2/side:line-2");
  assert.equal(top.area, 12);
  assert.equal(r.failed.size, 0);
});

test("the unit-cell count by hand: a box's faces and edges", () => {
  // A 3 × 2 × 1 box: six faces (bottom and top 3 × 2 = 6, front and back
  // 3 × 1 = 3, left and right 2 × 1 = 2) and twelve edges: four of
  // length 3 (along x), four of 2 (along y), four of 1 (along z). Each edge
  // meets its two faces once, so no edge needs its ends and none is shared;
  // the edge along x at y = 0, z = 0 is between the start cap and line 1's
  // side, its ends lines 2's and 4's sides.
  const r = countOnCells([block("feature-1", [0, 0, 3, 2], [0, 1])]);
  const b = r.bodies[0];
  assert.deepEqual(b.faces.map((f) => `${f.facing} ${f.area}`), ["-z 6", "+z 6", "-y 3", "+x 2", "+y 3", "-x 2"]);
  assert.deepEqual(b.edges.map((e) => e.length).sort(), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  assert.ok(b.edges.every((e) => e.name !== null && !e.name.includes(";ends:")));
  const e = b.edges.find((x) => x.name === "edge:face:feature-1/side:line-1+face:feature-1/start")!;
  assert.deepEqual([e.length, e.ends], [3, ["face:feature-1/side:line-2", "face:feature-1/side:line-4"]]);
});

test("the unit-cell count by hand: a reference to a split top goes to the piece holding its origin, warned", () => {
  // The bar and slot above: a sketch made on the whole top with its origin
  // at (8, 1, 1) is on the far piece (x 4–10); with its origin in the slot,
  // (3.5, 1, 1), no piece holds it, so the larger piece, the far one
  // (12 against 6), with a warning either way.
  const r = countOnCells([block("feature-1", [0, 0, 10, 2], [0, 1]), block("feature-2", [3, -1, 4, 3], [-1, 2], "cut", ["body:feature-1"])]);
  const far = { body: "body:feature-1", full: "face:feature-1/end#face:feature-1/side:line-2,face:feature-2/side:line-2" };
  assert.deepEqual(resolveOnCells(r, { name: "face:feature-1/end", origin: [8, 1, 1] }), { found: far, warned: true });
  assert.deepEqual(resolveOnCells(r, { name: "face:feature-1/end", origin: [3.5, 1, 1] }), { found: far, warned: true });
  // The near piece by its tag: the bar's x = 0 side (line 4) and the slot's x = 3 wall (line 4).
  assert.deepEqual(resolveOnCells(r, { name: "face:feature-1/end", tag: ["face:feature-1/side:line-4", "face:feature-2/side:line-4"] }).found, {
    body: "body:feature-2/piece:1",
    full: "face:feature-1/end#face:feature-1/side:line-4,face:feature-2/side:line-4",
  });
});

test("the unit-cell count refuses parts it cannot count", () => {
  const half = [block("feature-1", [0, 0, 2.5, 2], [0, 1])];
  assert.equal(cellsCanCount(half), false);
  assert.throws(() => countOnCells(half), /whole-millimetre/);
  assert.equal(cellsCanCount(moved(half, 2, [0, 0, 0])), true);
});

test(`${SESSIONS} seeded sessions of ${STEPS} features: the model and the unit-cell count agree at every step, and moving, scaling and renaming change nothing`, () => {
  let features = 0;
  let references = 0;
  let pieces = 0;
  let failed = 0;
  for (let seed = 0; seed < SESSIONS; seed++) {
    const s = randomBooleanSession(BigInt(seed), STEPS);
    assert.equal(firstDifference(s), null);
    assert.equal(invarianceDifference(s), null);
    features += s.features.length;
    references += s.references.length;
    const r = countOnCells(s.features);
    pieces += r.bodies.filter((b) => b.id.includes("/piece:")).length;
    failed += r.failed.size;
  }
  // The sessions do what they are for: references made and pieces numbered, and features refused.
  assert.equal(features, SESSIONS * STEPS);
  assert.ok(references > SESSIONS, `${references} references`);
  assert.ok(pieces > SESSIONS / 4, `${pieces} pieces`);
  assert.ok(failed > SESSIONS / 4, `${failed} refused`);
});

test("the sessions are the same for the same seed", () => {
  assert.deepEqual(randomBooleanSession(7n, STEPS), randomBooleanSession(7n, STEPS));
  assert.notDeepEqual(randomBooleanSession(7n, STEPS).features, randomBooleanSession(8n, STEPS).features);
});

/** The first seed whose session each planted fault makes disagree (found by searching seeds 0–39 once, kept so it replays); each is caught by at least 2 of the 40. */
const CAUGHT_AT: Record<BooleanFault, number> = {
  "keep-largest": 1,
  "keep-first-reached": 4,
  "number-by-volume": 12,
  "number-per-body": 23,
  "join-latest": 4,
  "tool-keeps-id": 0,
  "wall-target-name": 1,
  "merge-tool-first": 4,
  "merge-one-name": 4,
  "empty-allowed": 0,
  "pinch-allowed": 13,
  "tag-all-neighbours": 0,
  "split-silent": 4,
  "largest-first": 4,
  "guess-shared": 0,
  "edge-no-ends": 0,
  "made-by-id-text": 0,
  "grid-whole-mm": 0,
  "float-ties": 16,
};

test("every planted fault in the model makes a seeded session disagree with the unit-cell count", () => {
  assert.deepEqual(Object.keys(CAUGHT_AT).sort(), [...BOOLEAN_FAULTS, ...ORDER_FAULTS].sort());
  for (const fault of BOOLEAN_FAULTS) {
    const s = randomBooleanSession(BigInt(CAUGHT_AT[fault]), STEPS);
    assert.equal(firstDifference(s), null, `seed ${CAUGHT_AT[fault]} agrees without ${fault}`);
    assert.notEqual(firstDifference(s, [fault]), null, `${fault} is caught by seed ${CAUGHT_AT[fault]}`);
  }
});

test("an order taken from ids' text is caught by renaming, coordinates taken to whole millimetres by moving, and ties left to rounding by the inexact move", () => {
  const by: Record<string, RegExp> = { "made-by-id-text": /renamed/, "grid-whole-mm": /moved/, "float-ties": /scaled by 0\.1/ };
  assert.deepEqual(Object.keys(by), [...ORDER_FAULTS]);
  for (const fault of ORDER_FAULTS) {
    const s = randomBooleanSession(BigInt(CAUGHT_AT[fault]), STEPS);
    assert.equal(invarianceDifference(s), null);
    assert.match(invarianceDifference(s, [fault]) ?? "", by[fault]);
  }
});

test("names put back after renaming: ids renamed back and every list sorted by text sorted again", () => {
  // Worked by hand: ids "b" → "feature-1", "a" → "feature-2", so the tag
  // "face:a/x,face:b/y" becomes "face:feature-2/x,face:feature-1/y", sorted
  // again: feature-1's first. The edge's faces and ends are sorted the same way.
  const back = (id: string) => ({ a: "feature-2", b: "feature-1" })[id] ?? id;
  assert.equal(nameBack("face:b/end#face:a/x,face:b/y", back), "face:feature-1/end#face:feature-1/y,face:feature-2/x");
  assert.equal(nameBack("edge:face:a/end+face:b/start;ends:face:a/z,face:b/z", back), "edge:face:feature-1/start+face:feature-2/end;ends:face:feature-1/z,face:feature-2/z");
  assert.equal(nameBack("body:a/piece:2", back), "body:feature-2/piece:2");
  assert.equal(nameBack("face:b/side:a", back), "face:feature-1/side:feature-2");
  // The new ids run backwards in text order, and carry every separator a name uses.
  const ids = [...strangeIds([block("feature-1", [0, 0, 1, 1], [0, 1])]).values()];
  assert.deepEqual(ids.slice(0, 2), ["z0 /+#,;@:x", "y1 /+#,;@:x"]);
  assert.ok(ids.every((id, i) => i === 0 || id < ids[i - 1]));
});

test("the unit-cell count by hand: a tagged reference whose piece is gone is found on the one face left with its name, warned", () => {
  // A bar x 0–10, y 0–2, z 0–8 cut through by a slab z 2–4: the bottom piece (z 0–2) keeps body:feature-1, the top
  // (z 4–8) is body:feature-2/piece:1, its x = 0 side tagged with the bar's end cap and the slab's end. A block
  // x 0–10, y 0–3, z 5–7 has the top piece cut from it (tool not kept): only the bottom's x = 0 side (x 0, y 0–2,
  // z 0–2) still carries the bar's line 4, tagged with all four of its neighbours.
  const cut = [block("feature-1", [0, 0, 10, 2], [0, 8]), block("feature-2", [-1, -1, 11, 3], [2, 4], "cut", ["body:feature-1"])];
  const combine: CombineFeature = { kind: "combine", id: "feature-4", target: "body:feature-3", tools: ["body:feature-2/piece:1"], operation: "cut", keepTools: false };
  const r = countOnCells([...cut, block("feature-3", [0, 0, 10, 3], [5, 7]), combine]);
  const name = "face:feature-1/side:line-4";
  const left = { body: "body:feature-1", full: name };
  const topTag = ["face:feature-1/end", "face:feature-2/end"];
  // The top's tag and an origin (0, 1, 6) on the top: the bottom's side has neither, so found and warned.
  assert.deepEqual(resolveOnCells(r, { name, tag: topTag, origin: [0, 1, 6] }), { found: left, warned: true });
  // An origin (0, 1, 1) on the bottom's side, or the bottom's own tag, or no origin: found, not warned.
  assert.deepEqual(resolveOnCells(r, { name, tag: topTag, origin: [0, 1, 1] }), { found: left, warned: false });
  assert.deepEqual(resolveOnCells(r, { name, tag: ["face:feature-1/side:line-1", "face:feature-1/side:line-3", "face:feature-1/start", "face:feature-2/start"], origin: [0, 1, 6] }), { found: left, warned: false });
  assert.deepEqual(resolveOnCells(r, { name, tag: topTag }), { found: left, warned: false });
});

test("the unit-cell count by hand: an edge name with ends finds its own, or the only edge left between its faces, said", () => {
  // A bar x 0–30, y 0–10, z 0–10 with a notch cut from its bottom front, x 10–20, y 0–3, z 0–5: the bar's front
  // (y = 0) and bottom (z = 0) now meet twice, x 0–10 and x 20–30, each 10 long, told apart by their ends: the bar's
  // x = 0 side and the notch's x = 10 wall (its line 4), and the notch's x = 20 wall (its line 2) and the bar's x = 30
  // side.
  const pair = "edge:face:feature-1/side:line-1+face:feature-1/start";
  const near = `${pair};ends:face:feature-1/side:line-4,face:feature-2/side:line-4`;
  const notched = [block("feature-1", [0, 0, 30, 10], [0, 10]), block("feature-2", [10, -1, 20, 3], [-1, 5], "cut", ["body:feature-1"])];
  const before = countOnCells(notched);
  assert.deepEqual(resolveEdgeOnCells(before, near), { found: { body: "body:feature-1", full: near }, warned: false });
  // Ends neither has: lost (two edges, none its own); no ends at all: the two fit, ambiguous.
  assert.deepEqual(resolveEdgeOnCells(before, `${pair};ends:face:feature-1/end,face:feature-1/side:line-3`), { found: "lost", warned: false });
  assert.deepEqual(resolveEdgeOnCells(before, pair), { found: { ambiguous: 2 }, warned: false });
  // A block filling the notch joins: one front, one bottom, meeting once along x 0–30, named without ends. The
  // reference with the near edge's ends finds that one edge, said (its ends changed); without ends, it is the name.
  const after = countOnCells([...notched, block("feature-3", [10, 0, 20, 3], [0, 5], "join", ["body:feature-1"])]);
  assert.deepEqual(resolveEdgeOnCells(after, near), { found: { body: "body:feature-1", full: pair }, warned: true });
  assert.deepEqual(resolveEdgeOnCells(after, pair), { found: { body: "body:feature-1", full: pair }, warned: false });
});

/**
 * Sessions kept from failures, each the shortest timeline (and its references) found: the model and the unit-cell
 * count must agree at every step. The seed it was shrunk from and what went wrong are beside it.
 */
const KEPT: { from: string; features: BooleanFeature[]; references: BooleanSession["references"] }[] = [
  // Seed 277 (11-08, 2,000-seed search): an edge reference with ;ends: whose two faces now meet once, with other ends: model found it, the cell count said lost.
  {
    from: "seed 277",
    features: [{"kind": "block", "id": "feature-1", "rect": [2, 2, 4, 7], "z": [1, 4], "operation": "new", "lines": ["line-5", "line-4", "line-1", "line-2"]}, {"kind": "block", "id": "feature-3", "rect": [1, 5, 6, 8], "z": [1, 5], "operation": "join", "bodies": ["body:feature-1"], "lines": ["line-4", "line-6", "line-5", "line-2"]}, {"kind": "block", "id": "feature-4", "rect": [5, 4, 8, 8], "z": [4, 6], "operation": "join", "bodies": ["body:feature-1"], "lines": ["line-5", "line-1", "line-2", "line-3"]}, {"kind": "block", "id": "feature-5", "rect": [6, -1, 7, 9], "z": [-1, 7], "operation": "cut", "bodies": ["body:feature-1"], "lines": ["line-1", "line-2", "line-4", "line-5"]}, {"kind": "block", "id": "feature-7", "rect": [3, 3, 6, 7], "z": [1, 4], "operation": "join", "bodies": ["body:feature-1", "body:feature-5/piece:1"]}],
    references: [{"after": 2, "ref": {"kind": "edge", "name": "edge:face:feature-1/start+face:feature-3/side:line-4;ends:face:feature-1/side:line-4,face:feature-3/side:line-6"}}],
  },
  // Seed 400 (11-08, 2,000-seed search): a tagged face reference whose piece is gone, the one face left with neither its tag nor its origin: model warned, the cell count did not.
  {
    from: "seed 400",
    features: [{"kind": "block", "id": "feature-3", "rect": [0, 2, 3, 3], "z": [0, 6], "operation": "new"}, {"kind": "block", "id": "feature-4", "rect": [-1, -1, 9, 9], "z": [2, 3], "operation": "new"}, {"kind": "block", "id": "feature-5", "rect": [-1, -1, 9, 9], "z": [4, 5], "operation": "new"}, {"kind": "combine", "id": "feature-6", "target": "body:feature-3", "tools": ["body:feature-4", "body:feature-5"], "operation": "cut", "keepTools": true}, {"kind": "combine", "id": "feature-7", "target": "body:feature-5", "tools": ["body:feature-6/piece:2", "body:feature-3"], "operation": "cut", "keepTools": false}],
    references: [{"after": 3, "ref": {"kind": "face", "name": "face:feature-3/side:line-4", "origin": [0, 2, 1], "tag": ["face:feature-3/start", "face:feature-4/start"]}}],
  },
  // Seed 540 (11-08, 2,000-seed search): the same, minimised to two features.
  {
    from: "seed 540",
    features: [{"kind": "block", "id": "feature-1", "rect": [5, 4, 8, 7], "z": [3, 6], "operation": "new"}, {"kind": "block", "id": "feature-6", "rect": [-1, -1, 9, 9], "z": [4, 6], "operation": "cut", "bodies": ["body:feature-1"]}],
    references: [{"after": 1, "ref": {"kind": "face", "name": "face:feature-1/side:line-1", "origin": [7, 4, 6], "tag": ["face:feature-5/end", "face:feature-6/end"]}}],
  },
  // KEPT-MUTANTS
];

test("kept sessions: the model and the unit-cell count agree at every step", () => {
  for (const k of KEPT) assert.equal(firstDifference({ seed: 0n, features: k.features, references: k.references }), null, k.from);
});
