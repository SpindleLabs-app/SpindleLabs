// Step 35h2c-app2: the Shell tool's rules (shell-tool.ts). Every expected
// answer is worked out by hand: a box's six faces are all flat, a
// cylinder's side is round; the picks follow the clicks as written beside
// each; and on the real kernel the names the tool holds are the faces the
// rebuild opens, by volume: walls t thick inside a w × d × h box with its
// top open take away (w − 2t)(d − 2t)(h − t).

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyRefusal, DEFAULT_THICKNESS, facesWords, heldFaceNames, NO_PICKS, NOT_A_FACE, ONE_BODY, picksFrom, readThickness, ROUND_FACES, shellHintWords, togglePick } from "../src/shell-tool.ts";
import { insertShell } from "../src/shell.ts";
import { insertPreset, partDocument, SHELL_MAX, SHELL_MIN, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { boxView, cylinderView } from "./views.ts";

const kernel = nodeKernel();
const box = boxView(10, 10, 10);
const B1 = "body:feature-1";
const B2 = "body:feature-2";

test("hand-worked: a box (six flat faces) is taken, a cylinder (a round side) refused at once", () => {
  assert.equal(bodyRefusal(box), null);
  assert.equal(bodyRefusal(cylinderView(5, 10)), ROUND_FACES);
});

test("hand-worked: clicks open faces, close them again, keep the body, and refuse another body's face while one is open", () => {
  // The first click picks the body and opens face 5.
  let r = togglePick(NO_PICKS, B1, 5, box);
  assert.deepEqual(r, { picks: { body: B1, faces: [5] }, refused: null });
  // A second face is added after it, in the order clicked.
  r = togglePick(r.picks, B1, 2, box);
  assert.deepEqual(r, { picks: { body: B1, faces: [5, 2] }, refused: null });
  // Another body's face while faces are open: refused, picks unchanged.
  assert.deepEqual(togglePick(r.picks, B2, 0, box), { picks: { body: B1, faces: [5, 2] }, refused: ONE_BODY });
  // An open face clicked again closes; the last one closed leaves the body picked, sealed.
  r = togglePick(r.picks, B1, 5, box);
  assert.deepEqual(r, { picks: { body: B1, faces: [2] }, refused: null });
  r = togglePick(r.picks, B1, 2, box);
  assert.deepEqual(r, { picks: { body: B1, faces: [] }, refused: null });
  // With no face open, another body's face moves the shell there.
  assert.deepEqual(togglePick(r.picks, B2, 3, box), { picks: { body: B2, faces: [3] }, refused: null });
  // A round body is refused, a face number the body lacks too; the picks stay.
  assert.deepEqual(togglePick(r.picks, B2, 0, cylinderView(5, 10)), { picks: { body: B1, faces: [] }, refused: ROUND_FACES });
  for (const bad of [6, -1, 1.5]) assert.deepEqual(togglePick(r.picks, B1, bad, box), { picks: { body: B1, faces: [] }, refused: NOT_A_FACE }, `face ${bad}`);
});

test("picksFrom takes the selection as clicks: a body alone is sealed, faces once each, the first refusal kept", () => {
  const view = (b: string) => (b === "body:feature-9" ? null : b === B2 ? cylinderView(5, 10) : box);
  assert.deepEqual(picksFrom([{ body: B1 }], view), { picks: { body: B1, faces: [] }, refused: null });
  assert.deepEqual(picksFrom([{ body: B1, face: 4 }, { body: B1, face: 4 }, { body: B1, face: 1 }], view), { picks: { body: B1, faces: [4, 1] }, refused: null });
  // A body, then a face of it: the face opens.
  assert.deepEqual(picksFrom([{ body: B1 }, { body: B1, face: 0 }], view), { picks: { body: B1, faces: [0] }, refused: null });
  // The cylinder is left out with its words; a body not shown is skipped.
  assert.deepEqual(picksFrom([{ body: B2 }, { body: "body:feature-9", face: 0 }, { body: B1, face: 3 }], view), { picks: { body: B1, faces: [3] }, refused: ROUND_FACES });
  // A second body after the first: left out, one body at a time.
  assert.deepEqual(picksFrom([{ body: B1, face: 3 }, { body: "body:feature-3" }], view), { picks: { body: B1, faces: [3] }, refused: ONE_BODY });
});

test("hand-worked: the thickness typed, and its limits at 0.9× and 1.1× (1 µm and 1 km)", () => {
  assert.deepEqual(readThickness("2"), { thickness: 2 });
  assert.deepEqual(readThickness(" 0.5 "), { thickness: 0.5 });
  assert.equal(DEFAULT_THICKNESS, 1);
  // SHELL_MIN 0.001 mm: 1.1 × it holds, 0.9 × it is refused.
  assert.deepEqual(readThickness(String(SHELL_MIN * 1.1)), { thickness: SHELL_MIN * 1.1 });
  assert.ok("why" in readThickness(String(SHELL_MIN * 0.9)));
  // SHELL_MAX 1,000,000 mm: 0.9 × it holds, 1.1 × it is refused.
  assert.deepEqual(readThickness(String(SHELL_MAX * 0.9)), { thickness: SHELL_MAX * 0.9 });
  const far = readThickness(String(SHELL_MAX * 1.1));
  assert.ok("why" in far && /^The shell can't be made: its wall thickness 1100000 is not from 0\.001 to 1000000 mm\.$/.test(far.why), JSON.stringify(far));
  assert.deepEqual(readThickness(""), { why: "Type the wall thickness in mm." });
  for (const bad of ["abc", "0x10", "Infinity", "1,5"]) assert.deepEqual(readThickness(bad), { why: `"${bad}" is not a thickness: type the wall thickness in mm.` }, bad);
  assert.ok("why" in readThickness("0"));
  assert.ok("why" in readThickness("-1"));
});

test("the panel's and the hint's words", () => {
  assert.equal(facesWords(NO_PICKS, false), "Click the faces to leave open");
  assert.equal(facesWords(NO_PICKS, true), "Tap the faces to leave open");
  assert.equal(facesWords({ body: B1, faces: [] }, false), "No face open: sealed, hollow inside");
  assert.equal(facesWords({ body: B1, faces: [2] }, false), "1 face open");
  assert.equal(facesWords({ body: B1, faces: [2, 3, 4] }, true), "3 faces open");
  assert.equal(shellHintWords(0), "Shell needs a body: make one first with Insert or Extrude");
  assert.equal(shellHintWords(2), "Shell: click or tap the faces to leave open");
});

/** The volume of `body` after a Shell of its face facing +z with walls `t`, the face named by the tool; and the name. */
async function topOpenVolume(doc: DesignDocument, body: string, t: number): Promise<number> {
  const cache = new BodyCache(kernel);
  try {
    const before = await rebuildTimeline(doc, cache, kernel);
    const view = await cache.view(before.bodies[body].handle);
    const top = view.face_normals.findIndex((n) => n !== null && n !== undefined && n[2] > 0.999999);
    const [name] = await heldFaceNames(before.bodies, (b) => cache.view(b.handle), body, [top]);
    assert.ok(name !== null, "the top has a name");
    const { doc: shelled, id } = insertShell(doc, body, [name!], t);
    const after = await rebuildTimeline(shelled, cache, kernel);
    assert.equal(after.results[id].status, "built", JSON.stringify(after.results[id]));
    return (await cache.view(after.bodies[body].handle)).volume;
  } finally {
    await cache.clear();
  }
}

const near = (got: number, want: number) => assert.ok(Math.abs(got - want) <= 1e-9 * want, `${got}, expected ${want}`);

test("hand-worked on the real kernel: the face the tool names is the face the rebuild opens", async () => {
  // A 10 mm cube, top open, 1 mm walls: 1000 − 8 · 8 · 9 = 424 mm³.
  near(await topOpenVolume(partDocument("box", 10, 10, 10), B1, 1), 424);
  // The second of two bodies (a 20 × 10 × 6 box moved 50 along x), 2 mm walls: 1200 − 16 · 6 · 4 = 816; the first untouched.
  let two = partDocument("box", 30, 30, 30);
  const made = insertPreset(two, "box", 20, 10, 6);
  two = insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 50 }).doc;
  near(await topOpenVolume(two, `body:${made.id}`, 2), 816);
});

test("a face of a body the build does not hold, or a face it lacks, has no name", async () => {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(partDocument("box", 10, 10, 10), cache, kernel);
    assert.deepEqual(await heldFaceNames(build.bodies, (b) => cache.view(b.handle), "body:feature-9", [0]), [null]);
    assert.deepEqual(await heldFaceNames(build.bodies, (b) => cache.view(b.handle), B1, [6]), [null]);
  } finally {
    await cache.clear();
  }
});
