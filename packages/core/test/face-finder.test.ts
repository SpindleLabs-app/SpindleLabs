// The registry's face finder (representation.ts `registerFaceFinder`, `facesOf`): another workspace asks the owner of
// the geometry for a body's named faces and where the faces it holds are now. The owner's answer is checked before it is
// handed on: each way an answer can disagree with itself is refused, by a test that breaks a good answer in that one way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, emptyProject, type BodyFaces, type BodyReference, type FaceReference, type StableId } from "../src/index.ts";

const body: BodyReference = { kind: "body", id: "body:b" as StableId };
const face = (id: string): FaceReference => ({ kind: "face", id: id as StableId });

/** Two triangles on face 0, one on face 1; face 0 found, face 9 gone. */
const good = (): BodyFaces => ({
  mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 1, 3, 2, 0, 1, 3], triangle_faces: [0, 0, 1], edge_lines: [], edge_line_edges: [] },
  faces: [face("f0"), null],
  labels: ["Top face", "Face 2 (no name of its own)"],
  found: [{ status: "found", face: 0 }, { status: "gone", why: "the last edit took it off the body" }],
  inputs: ["feature-1"],
});

const withFinder = (answer: () => BodyFaces) => {
  const r = new RepresentationRegistry();
  r.registerFaceFinder("design", async () => answer());
  return r;
};

test("a good answer is handed on as it came", async () => {
  const got = await withFinder(good).facesOf("design", emptyProject(), body, [face("f0"), face("f9")]);
  assert.deepEqual(got, good());
});

test("a workspace with no face finder is refused in words, and a second finder for one workspace is refused", async () => {
  await assert.rejects(new RepresentationRegistry().facesOf("design", emptyProject(), body, []), /design doesn't say where its faces are/);
  const r = withFinder(good);
  assert.throws(() => r.registerFaceFinder("design", async () => good()), /already has a face finder/);
});

test("each way an answer disagrees with itself is refused, never handed on", async () => {
  const breaks: [string, (a: BodyFaces) => void, RegExp][] = [
    ["a triangle short of its face list", (a) => a.mesh.triangle_faces.pop(), /lists disagree in length/],
    ["a triangle on a face not listed", (a) => (a.mesh.triangle_faces[2] = 2), /a triangle on a face it did not list/],
    ["a triangle on face 0.5", (a) => (a.mesh.triangle_faces[0] = 0.5), /a triangle on a face it did not list/],
    ["a name missing", (a) => a.labels.pop(), /1 names for 2 faces/],
    ["an answer missing", (a) => a.found.pop(), /1 answers for 2 references/],
    ["a reference found on a face not listed", (a) => (a.found[0] = { status: "found", face: 2 }), /found on a face it did not list/],
    ["a reference found on face −1", (a) => (a.found[0] = { status: "found", face: -1 }), /found on a face it did not list/],
  ];
  for (const [what, bend, why] of breaks) {
    const a = good();
    bend(a);
    await assert.rejects(withFinder(() => a).facesOf("design", emptyProject(), body, [face("f0"), face("f9")]), why, what);
  }
});

test("a finder that throws is refused with its own words", async () => {
  const r = new RepresentationRegistry();
  r.registerFaceFinder("design", async () => {
    throw new Error("it is hidden in Design: show it there to pick its faces");
  });
  await assert.rejects(r.facesOf("design", emptyProject(), body, []), /it is hidden in Design/);
});
