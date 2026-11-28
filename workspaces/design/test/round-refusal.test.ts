// SL #677 item 1 (final Combine hunt, 2026-11-12), brought up to curved Combine (kernel 0.33.88, 37df): Cut, Join
// and Intersect now take cylinders (a round hole is the first thing a beginner tries), so the app no longer refuses
// a round body itself. What the kernel still refuses with a round body is said in the app's own words, chosen from
// the bodies' own face types and the faces the refusal names (never from the kernel's sentence, which reads "face 1
// of the tool is curved (part of a sphere) ..."): a sphere on either side, a round face touching a flat one side on,
// two round faces meeting. A refusal between flat-sided bodies keeps its own words. On the real kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, refusedRound, roundWords } from "../src/rebuild.ts";
import { addSketch, drawCircle } from "../src/sketch.ts";

const kernel = nodeKernel();

/** Item `id`'s message ("" when built) and the volume of every body the design holds after it, by body id. */
async function outcome(doc: DesignDocument, id: string): Promise<{ said: string; volumes: Record<string, number> }> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const r = build.results[id];
    const volumes: Record<string, number> = {};
    for (const [body, b] of Object.entries(build.bodies)) volumes[body] = (await cache.view(b.handle)).volume;
    return { said: r.status === "failed" ? r.message : r.status === "built" ? "" : `(${r.status})`, volumes };
  } finally {
    await cache.close();
  }
}
/** Equal to a part in a billion: the kernel's volumes of planes and cylinders are exact up to rounding. */
function near(actual: number | undefined, expected: number, what: string): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) <= 1e-9 * expected, `${what}: ${actual} is not ${expected}`);
}
/** Box 1 40 × 30 × 20 from the origin and a ready-made cylinder of diameter 10 and height 30 moved to stand through it. */
function boxAndCylinder(): { doc: DesignDocument; box: string; cylinder: string } {
  const one = partDocument("box", 40, 30, 20);
  const made = insertPreset(one, "cylinder", 10, 10, 30);
  return { doc: insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 20, y: 15, z: -5 }).doc, box: `body:${one.timeline.features[0].id}`, cylinder: `body:${made.id}` };
}
/** Box 1 40 × 30 × 20 and a ready-made sphere of diameter 10 moved so its centre is the middle of the box's top. */
function boxAndSphere(): { doc: DesignDocument; box: string; sphere: string } {
  const one = partDocument("box", 40, 30, 20);
  const made = insertPreset(one, "sphere", 10, 10, 10);
  return { doc: insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 20, y: 15, z: 20 }).doc, box: `body:${one.timeline.features[0].id}`, sphere: `body:${made.id}` };
}

test("the words: what is refused, what works for now, and that it is coming", () => {
  assert.equal(roundWords("tool"), "a tool body has a sphere face. Cut, Join and Intersect work on flat and cylinder-shaped bodies for now; spheres are coming.");
  assert.equal(roundWords("target"), "the body it changes has a sphere face. Cut, Join and Intersect work on flat and cylinder-shaped bodies for now; spheres are coming.");
  assert.equal(roundWords("flat-side-on"), "a round face touches a flat face side on, or comes very close to it without crossing it. Move or resize one a little so they cross clearly or stay apart; this case is coming.");
  assert.equal(roundWords("round-pair"), "two round faces meet or come very close. Cut, Join and Intersect take round faces meeting flat ones for now; round faces meeting each other are coming.");
  assert.match(roundWords("round-meets"), /^a round face meets another face in a way not taken yet .*Combine one tool at a time/);
});

test("which words: from the inputs' face types and the faces named, never anything else", () => {
  const box = ["plane", "plane", "plane", "plane", "plane", "plane"];
  const rod = ["plane", "plane", "cylinder"];
  const ball = ["sphere", "sphere"];
  // A sphere anywhere decides first: on the target, else on a tool (any tool), whatever faces are named.
  assert.equal(refusedRound([ball, box], [{ body: 0, face: 0 }]), "target");
  assert.equal(refusedRound([ball, ball], []), "target");
  assert.equal(refusedRound([box, ball], [{ body: 1, face: 0 }]), "tool");
  assert.equal(refusedRound([box, rod, ball], []), "tool");
  // One tool: the two named faces' own types (face 5 of the box is a plane, face 3 of the rod its round wall).
  assert.equal(refusedRound([box, rod], [{ body: 0, face: 4 }, { body: 1, face: 2 }]), "flat-side-on");
  assert.equal(refusedRound([rod, box], [{ body: 0, face: 2 }, { body: 1, face: 0 }]), "flat-side-on");
  assert.equal(refusedRound([rod, rod], [{ body: 0, face: 2 }, { body: 1, face: 2 }]), "round-pair");
  // Two flat faces named, though a rod is there: not a round refusal, the kernel's words stay.
  assert.equal(refusedRound([box, rod], [{ body: 0, face: 0 }, { body: 1, face: 0 }]), null);
  // A face index past the body's faces (none such) is no round face either.
  assert.equal(refusedRound([box, rod], [{ body: 0, face: 0 }, { body: 1, face: 9 }]), null);
  // More than one tool: the kernel's "tool" is not one of ours, so it can't be told apart.
  assert.equal(refusedRound([box, rod, rod], [{ body: 0, face: 4 }, { body: 1, face: 2 }]), "round-meets");
  // No round input, one face named, or none: the kernel's own words.
  assert.equal(refusedRound([box, box], [{ body: 0, face: 4 }, { body: 1, face: 2 }]), null);
  assert.equal(refusedRound([box, rod], [{ body: 1, face: 2 }]), null);
  assert.equal(refusedRound([box, rod], []), null);
  assert.equal(refusedRound([], [{ body: 0, face: 0 }, { body: 1, face: 0 }]), null);
});

test("hand-worked: a Combine with a cylinder as its tool builds for each operation, with the volume worked by hand", async () => {
  // The rod r 5 stands through the box from z = -5 to 25, wholly inside it in x and y (15..25, 10..20 within 40 × 30).
  // Cut: 40·30·20 − π·5²·20 = 24,000 − 500π. Join: the box plus the rod's 5 mm sticking out below and above,
  // 24,000 + π·25·10 = 24,000 + 250π. Intersect: the rod's part inside the box, π·25·20 = 500π.
  const { doc, box, cylinder } = boxAndCylinder();
  const want: Record<CombineOperation, number> = { cut: 24000 - 500 * Math.PI, join: 24000 + 250 * Math.PI, intersect: 500 * Math.PI };
  for (const operation of ["cut", "join", "intersect"] as CombineOperation[]) {
    const c = insertCombine(doc, box, [cylinder], operation);
    const { said, volumes } = await outcome(c.doc, c.id);
    assert.equal(said, "", operation);
    assert.deepEqual(Object.keys(volumes), [box], `${operation}: the tool is used up`);
    near(volumes[box], want[operation], operation);
  }
});

test("hand-worked: a box cut from a cylinder leaves its ends, and two rods 5 mm apart are said as round faces meeting", async () => {
  // The rod is 30 high from z = -5 and the box takes z = 0..20 of it: the two ends left are π·25·5 each, 250π.
  const { doc, box, cylinder } = boxAndCylinder();
  const c = insertCombine(doc, cylinder, [box], "cut");
  const cut = await outcome(c.doc, c.id);
  assert.equal(cut.said, "");
  near(Object.values(cut.volumes).reduce((a, b) => a + b, 0), 250 * Math.PI, "both ends of the rod");
  assert.equal(Object.keys(cut.volumes).length, 2, "two pieces");
  // A second rod alongside, 5 mm along x: the round walls cross, which the kernel refuses for now.
  const more = insertPreset(doc, "cylinder", 10, 10, 30);
  const moved = insertMove(more.doc, [`body:${more.id}`], { ...NO_MOVE, x: 25, y: 15, z: -5 });
  const both = insertCombine(moved.doc, cylinder, [`body:${more.id}`], "join");
  assert.equal((await outcome(both.doc, both.id)).said, `Combine 1 can't be made: ${roundWords("round-pair")}`);
});

test("a Combine with a sphere on either side: refused in the app's words, the bodies as they were", async () => {
  const { doc, box, sphere } = boxAndSphere();
  for (const operation of ["cut", "join", "intersect"] as CombineOperation[]) {
    const c = insertCombine(doc, box, [sphere], operation);
    const { said, volumes } = await outcome(c.doc, c.id);
    assert.equal(said, `Combine 1 can't be made: ${roundWords("tool")}`, operation);
    near(volumes[box], 24000, `${operation}: the box as it was`);
    // A ball of diameter 10: 4/3·π·5³ = 500π/3.
    near(volumes[sphere], (500 * Math.PI) / 3, `${operation}: the ball as it was`);
  }
  const c = insertCombine(doc, sphere, [box], "cut");
  assert.equal((await outcome(c.doc, c.id)).said, `Combine 1 can't be made: ${roundWords("target")}`);
});

test("hand-worked: a circle on the ground extruded as a Cut into the box builds a blind hole", async () => {
  // A circle r 5 at (20, 15) cut 10 mm up from the ground: 24,000 − π·25·10 = 24,000 − 250π.
  const box = partDocument("box", 40, 30, 20);
  const s = addSketch(box);
  const e = extrudeSketch(drawCircle(s.doc, s.id, [20, 15], 5).doc, s.id, 10, false, undefined, { operation: "cut", bodies: [`body:${box.timeline.features[0].id}`] });
  const { said, volumes } = await outcome(e.doc, e.id);
  assert.equal(said, "");
  near(volumes[`body:${box.timeline.features[0].id}`], 24000 - 250 * Math.PI, "the box with its hole");
});

test("a hole touching the box's side wall side on: said as a round face touching a flat one, the box as it was", async () => {
  // The circle r 5 at (5, 15) touches the wall x = 0 along a line: the kernel refuses that contact for now.
  const box = partDocument("box", 40, 30, 20);
  const s = addSketch(box);
  const e = extrudeSketch(drawCircle(s.doc, s.id, [5, 15], 5).doc, s.id, 10, false, undefined, { operation: "cut", bodies: [`body:${box.timeline.features[0].id}`] });
  const { said, volumes } = await outcome(e.doc, e.id);
  assert.equal(said, `Extrude 1 can't be made: ${roundWords("flat-side-on")}`);
  near(volumes[`body:${box.timeline.features[0].id}`], 24000, "the box as it was");
});

test("a refusal between flat-sided boxes keeps its own words, with nothing about round faces", async () => {
  // Two 10 mm cubes meeting only along the edge x = 10, z = 10: the Join is refused for that, and neither is round.
  const one = partDocument("box", 10, 10, 10);
  const made = insertPreset(one, "box", 10, 10, 10);
  const moved = insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 10, z: 10 }).doc;
  const c = insertCombine(moved, `body:${one.timeline.features[0].id}`, [`body:${made.id}`], "join");
  const { said } = await outcome(c.doc, c.id);
  assert.match(said, /^Combine 1 can't be made: /);
  assert.doesNotMatch(said, /round|sphere/);
});
