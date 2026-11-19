// Bodies joined for a test (join.ts), worked by hand on small made-up answers: which bodies a study tests now, the
// bodies' faces side by side for picking, and each picked face followed through a union's history onto the joined
// part (split, merged, swallowed, apart, held and pushed made one). The real kernel's union is in packages/testing
// `journeys/testlab-join.journey.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyFaces, BooleanResult, DisplayMesh, FaceFound, FaceReference, ListedObject, StableId } from "@fission/core";
import { apartWords, joinedFaces, joinGroup, joinWords, listWords, unionStudy, type JoinPart } from "../src/join.ts";
import { stressTestOf } from "../src/run.ts";
import { addLoad, addStudy, emptyTestLab, joinBodies, setMaterial, toggleHeld, togglePushed, type HeldFace, type Study } from "../src/study.ts";
import { materialLibrary } from "@fission/core";

const body = (n: number) => ({ ref: { kind: "body" as const, id: `body:feature-${n}` as StableId }, label: `Body ${n}` });
const listed = (...ns: number[]): ListedObject[] => ns.map((n) => ({ type: "design.feature", id: `feature-${n}`, label: `Body ${n}`, ref: body(n).ref }));
const ref = (name: string): FaceReference => ({ kind: "face", id: `face:${name}` as StableId });
const held = (name: string, label: string): HeldFace => ({ ref: ref(name), label });

/** A mesh of `n` faces, one triangle each, face k flat at z = k (so the triangles never share a point). */
function mesh(n: number): DisplayMesh {
  const positions: number[] = [];
  for (let k = 0; k < n; k++) positions.push(0, 0, k, 1, 0, k, 0, 1, k);
  return { positions, normals: positions.map(() => 0), indices: [...Array(3 * n).keys()], triangle_faces: [...Array(n).keys()], edge_lines: [], edge_line_edges: [] };
}

/** A body's faces as Design would give them: names, labels, and where each asked reference is. */
function faces(names: string[], labels: string[], found: FaceFound[], inputs: string[] = ["feature-1"]): BodyFaces {
  return { mesh: mesh(names.length), faces: names.map(ref), labels, found, inputs };
}

test("which bodies a study tests now: alone, chosen ones by their names now, all of them, a chosen one gone said in words", () => {
  const s = addStudy(emptyTestLab(), body(1)).study;
  assert.deepEqual(joinGroup(s, listed(1, 2)), { bodies: [body(1)], missing: [] });
  const two: Study = { ...s, joined: [body(3)] };
  // Body 3 is listed under a new name now ("Body 3" renumbered as "Body 7" would be): the name now is used.
  const renamed = listed(1, 3).map((o, i) => (i === 1 ? { ...o, label: "Body 7" } : o));
  assert.deepEqual(joinGroup(two, renamed).bodies.map((b) => b.label), ["Body 1", "Body 7"]);
  // Body 3 deleted: never tested without it, said in words.
  assert.deepEqual(joinGroup(two, listed(1, 2)), { bodies: [body(1)], missing: ["Body 3 is joined for this test but Design doesn't show it now (deleted, hidden or not built): change the join."] });
  // All: every body listed, its own first even when listed later; a body made later joins too.
  const all: Study = { ...s, joined: "all" };
  assert.deepEqual(joinGroup(all, listed(2, 1, 4)).bodies.map((b) => b.label), ["Body 1", "Body 2", "Body 4"]);
  // All with its own body gone: the others, never nothing.
  assert.deepEqual(joinGroup(all, listed(2, 4)).bodies.map((b) => b.label), ["Body 2", "Body 4"]);
  assert.equal(joinWords(joinGroup(all, listed(1, 2, 4)), true), "All bodies joined for this test: Body 1, Body 2 and Body 4. The design isn't changed.");
  assert.equal(joinWords(joinGroup(two, listed(1, 3)), false), "Joined for this test: Body 1 and Body 3. The design isn't changed.");
  assert.equal(listWords([]), "");
  assert.equal(listWords(["A"]), "A");
});

test("hand-worked: two bodies' faces side by side, numbered after each other, named with their body, each reference where its body found it", () => {
  // Body 1: faces End (0), Inner (1). Body 2: Inner (0), Top (1), Side (2). Asked: End, Top, a face no body has, Side
  // (which Body 2 says is two faces now).
  const one = faces(["one/end", "one/inner"], ["End face", "Inner face"], [{ status: "found", face: 0 }, { status: "gone", why: "it is on another body now" }, { status: "gone", why: "the last edit took it off the body" }, { status: "gone", why: "it is on another body now" }], ["feature-1"]);
  const two = faces(["two/inner", "two/top", "two/side"], ["Inner face", "Top face", "Side face"], [{ status: "gone", why: "it is on another body now" }, { status: "found", face: 1 }, { status: "gone", why: "it is on another body now" }, { status: "shared", count: 2 }], ["feature-2", "feature-3"]);
  const side = joinedFaces([{ label: "Body 1", faces: one }, { label: "Body 2", faces: two }]);
  // 2 + 3 faces; Body 2's points come after Body 1's 6 (2 triangles × 3), its faces after Body 1's 2.
  assert.deepEqual(side.offsets, [0, 2]);
  assert.deepEqual(side.owner, [0, 0, 1, 1, 1]);
  assert.deepEqual(side.faces.mesh.triangle_faces, [0, 1, 2, 3, 4]);
  assert.deepEqual(side.faces.mesh.indices.slice(6), [6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(side.faces.mesh.positions.length, 3 * 15);
  assert.deepEqual(side.faces.labels, ["End face of Body 1", "Inner face of Body 1", "Inner face of Body 2", "Top face of Body 2", "Side face of Body 2"]);
  // End on Body 1's face 0 → 0; Top on Body 2's face 1 → 2 + 1 = 3; the third gone with Body 1's own reason (not
  // "on another body"); Side shared as Body 2 said.
  assert.deepEqual(side.faces.found, [{ status: "found", face: 0 }, { status: "found", face: 3 }, { status: "gone", why: "the last edit took it off the body" }, { status: "shared", count: 2 }]);
  assert.deepEqual(side.faces.inputs, ["feature-1", "feature-2", "feature-3"]);
  // One body alone: its labels unchanged, as TestLab always showed them.
  assert.deepEqual(joinedFaces([{ label: "Body 1", faces: one }]).faces.labels, ["End face", "Inner face"]);
  // A face on neither of two bodies: on a body not joined.
  const away = joinedFaces([
    { label: "Body 1", faces: faces(["a"], ["A"], [{ status: "gone", why: "it is on another body now" }]) },
    { label: "Body 2", faces: faces(["b"], ["B"], [{ status: "gone", why: "it is on another body now" }]) },
  ]);
  assert.deepEqual(away.faces.found, [{ status: "gone", why: "it is on a body not joined for this test" }]);
});

/**
 * Body 1 (handle 11): End (0), Inner (1), Top (2). Body 2 (handle 12): Inner (0), Top (1), Tip (2).
 * Joined (the two bars end to end): Inner and Inner are swallowed; the two Tops lie level and become one face; and
 * Body 2's Tip comes out cut into two pieces (as a face the join split would). Joined faces:
 *   0 ← End of Body 1, 1 ← Top of Body 1 and Top of Body 2 (merged), 2 ← Tip piece, 3 ← Tip piece.
 */
const PARTS: JoinPart[] = [
  { label: "Body 1", handle: 11, faces: faces(["one/end", "one/inner", "one/top"], ["End face", "Inner face", "Top face"], []) },
  { label: "Body 2", handle: 12, faces: faces(["two/inner", "two/top", "two/tip"], ["Inner face", "Top face", "Tip face"], []) },
];
const UNION: BooleanResult = {
  bodies: [99],
  history: [
    {
      faces: [
        { body: 11, face: 0, whole: true, turned: false },
        { body: 11, face: 2, whole: true, turned: false },
        { body: 12, face: 2, whole: false, turned: false },
        { body: 12, face: 2, whole: false, turned: false },
      ],
      also: [[], [{ body: 12, face: 1, whole: true, turned: false }], [], []],
      edges: [],
    },
  ],
};

/** A study on the two bodies holding `hold` and pushing `push` (by name: "one/end"), with each part's answers for its faces. */
function studyOn(hold: string[], push: string[]): { study: Study; parts: JoinPart[] } {
  let { data, study } = addStudy(emptyTestLab(), body(1));
  data = joinBodies(data, study.id, [body(1), body(2)], false, new Set());
  for (const h of hold) data = toggleHeld(data, study.id, study.fixtures[0].id, held(h, h));
  const added = addLoad(data, study.id);
  data = added.data;
  for (const p of push) data = togglePushed(data, study.id, added.load.id, held(p, p));
  data = setMaterial(data, study.id, "steel-a36");
  const s = data.studies[0];
  // Each body answers every face the study holds, in order (holds then loads), as Design's finder does.
  const asked = [...s.fixtures[0].faces, ...s.loads[0].faces].map((f) => f.ref.id);
  const parts = PARTS.map((p) => ({
    ...p,
    faces: {
      ...p.faces,
      found: asked.map((id): FaceFound => {
        const i = p.faces.faces.findIndex((f) => f?.id === id);
        return i >= 0 ? { status: "found", face: i } : { status: "gone", why: "it is on another body now" };
      }),
    },
  }));
  return { study: s, parts };
}
const VIEW = { mesh: mesh(4), faces: 4 };

test("hand-worked: each picked face followed onto the joined part: whole, cut into pieces (every piece), merged (said), swallowed (lost)", () => {
  const { study, parts } = studyOn(["one/end"], ["two/tip"]);
  const on = unionStudy(study, parts, UNION, VIEW);
  assert.ok(!("refused" in on), JSON.stringify(on));
  // End → joined face 0; Tip → both pieces, 2 and 3.
  assert.deepEqual(on.pieces.get("face:one/end"), [0]);
  assert.deepEqual(on.pieces.get("face:two/tip"), [2, 3]);
  assert.deepEqual(on.lost, []);
  assert.deepEqual(on.notes, []);
  // The joined part's faces are named by their first input face and its body.
  assert.deepEqual(on.faces.labels, ["End face of Body 1", "Top face of Body 1", "Tip face of Body 2", "Tip face of Body 2"]);
  assert.deepEqual(on.faces.faces.map((f) => f?.id), ["face:one/end", "face:one/top", "face:two/tip", "face:two/tip"]);
  // The stress test holds face 0 and pushes 100 N... on both pieces of the tip, one force over the two.
  const test = stressTestOf(study, on, materialLibrary().get("steel-a36")!.mechanical!);
  assert.ok(!("refused" in test));
  assert.deepEqual(test.held, [0]);
  assert.deepEqual(test.loads.map((l) => l.faces), [[2, 3]]);

  // Body 1's Top held: once joined it is one face with Body 2's Top, which the hold then takes too: said.
  const top = studyOn(["one/top"], ["two/tip"]);
  const merged = unionStudy(top.study, top.parts, UNION, VIEW);
  assert.ok(!("refused" in merged));
  assert.deepEqual(merged.notes, ["Held here: joining makes Top face of Body 2 one face with a face it picked, so it holds that too."]);
  // Both Tops picked: nothing taken in that wasn't picked, so nothing said.
  const both = studyOn(["one/top", "two/top"], ["two/tip"]);
  const quiet = unionStudy(both.study, both.parts, UNION, VIEW);
  assert.ok(!("refused" in quiet));
  assert.deepEqual(quiet.notes, []);

  // Body 1's Inner held: it lies against Body 2, so nothing of it is left: lost in words, never moved to a guess.
  const inner = studyOn(["one/inner"], ["two/tip"]);
  const swallowed = unionStudy(inner.study, inner.parts, UNION, VIEW);
  assert.ok(!("refused" in swallowed));
  assert.deepEqual(swallowed.pieces.get("face:one/inner"), []);
  assert.deepEqual(swallowed.lost, ["Held here lost its face one/inner: it is where the bodies join, so none of it is left on the outside of the joined part. Pick a face again or take this one off."]);
});

test("refused in words: bodies apart, a held and a pushed face made one, a history that doesn't fit the view", () => {
  const { study, parts } = studyOn(["one/end"], ["two/tip"]);
  // The union gave two pieces: the bodies don't touch.
  const apart = unionStudy(study, parts, { bodies: [99, 100], history: [UNION.history[0], UNION.history[0]] }, VIEW);
  assert.deepEqual(apart, { refused: apartWords(["Body 1", "Body 2"], 2) });
  assert.equal(apartWords(["Body 1", "Body 2"], 2), "Body 1 and Body 2 don't all touch, so they can't be joined into one part (joining them gives 2 separate pieces). Move them in Design so they touch or overlap, or test them one at a time.");
  // Body 1's Top held and Body 2's Top pushed: one joined face, held and pushed at once.
  const clash = studyOn(["one/top"], ["two/top"]);
  assert.deepEqual(unionStudy(clash.study, clash.parts, UNION, VIEW), { refused: "once joined, Top face of Body 1 and Top face of Body 2 are one face, held and pushed by Load 1 at once: pick faces that stay apart." });
  // A history of 4 faces against a view of 5, or a triangle on a face past the history: never followed.
  const wrong = "the joined part's faces don't match its history, so no face can be followed onto it: please report this.";
  assert.deepEqual(unionStudy(study, parts, UNION, { mesh: mesh(5), faces: 5 }), { refused: wrong });
  assert.deepEqual(unionStudy(study, parts, UNION, { mesh: { ...mesh(4), triangle_faces: [0, 1, 2, 4] }, faces: 4 }), { refused: wrong });
});
