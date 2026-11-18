// Seeded sessions for sketches on a Chamfer's face (Ben, 2026-11-16), on the
// real kernel against a plain model of where that face is.
//
// Each seed makes a box W × D × H at the origin, chamfers one of its twelve
// edges by d (equal), then maybe moves it, copies it and moves the copy, or
// joins a slab onto its top. The model: the edge runs along axis a where the
// faces with outward normals n1 and n2 meet, through P; the chamfer's face has
// outward normal (n1 + n2)/√2 and holds X exactly when (X − P − shift)·(n1 + n2)
// + d = 0 (it is cut back d along each face). Every face the view lights for
// Create sketch must be taken by addFaceSketch (what the view offers, the tool
// takes), and a sketch on each chamfer face must be placed by the rebuild on
// the model's plane, facing out, with no warning.
//
// FISSION_SEED replays one seed; CHAMFER_SKETCH_SEEDS sets how many run (12).

import { test } from "node:test";
import assert from "node:assert/strict";
import { seeded, type SeededRandom } from "../../../packages/testing/src/index.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertChamfer } from "../src/chamfer.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { insertCombine } from "../src/combine.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies } from "../src/scene.ts";
import { sketchSpot, sketchableFaces } from "../src/face-pick.ts";
import { addFaceSketch } from "../src/sketch.ts";
import { designNames } from "../src/boolean-names.ts";
import { namedBody } from "../src/built-body.ts";
import { heldEdgeNames } from "../src/design-edges.ts";

const kernel = nodeKernel();
type V3 = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const int = (r: SeededRandom, lo: number, hi: number) => lo + Math.floor(r.next() * (hi - lo + 1));

async function sceneOf(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, cache, scene: joinBodies(await shownBodies(doc, build, cache), build) };
}

interface Session {
  doc: DesignDocument;
  /** Each chamfer face the model expects: its outward normal and a function giving a point's distance from it. */
  faces: { normal: V3; off: (x: readonly number[]) => number }[];
  words: string;
}

async function session(seed: number): Promise<Session> {
  const r = seeded(BigInt(seed));
  const size: V3 = [int(r, 6, 40), int(r, 6, 40), int(r, 6, 40)];
  const a = int(r, 0, 2);
  const [b, c] = [0, 1, 2].filter((k) => k !== a);
  const [sb, sc] = [int(r, 0, 1), int(r, 0, 1)];
  const n1: V3 = [0, 0, 0];
  const n2: V3 = [0, 0, 0];
  n1[b] = sb === 1 ? 1 : -1;
  n2[c] = sc === 1 ? 1 : -1;
  const P: V3 = [0, 0, 0];
  P[b] = sb * size[b];
  P[c] = sc * size[c];
  const d = int(r, 5, 19) / 10;
  const doc0 = partDocument("box", size[0], size[1], size[2]);
  const onEdge = (p: readonly number[]) => Math.abs(p[b] - P[b]) < 1e-9 && Math.abs(p[c] - P[c]) < 1e-9;
  const edge = await edgeWhere(doc0, "body:feature-1", onEdge);
  let doc = insertChamfer(doc0, "body:feature-1", [edge], { equal: d }).doc;
  const n: V3 = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]];
  const normal = n.map((x) => x * Math.SQRT1_2) as V3;
  const plane = (shift: readonly number[]) => (x: readonly number[]) => (dot([x[0] - P[0] - shift[0], x[1] - P[1] - shift[1], x[2] - P[2] - shift[2]], n) + d) * Math.SQRT1_2;
  const kind = int(r, 0, 3);
  const shift: V3 = [int(r, -20, 20), int(r, -20, 20), int(r, -20, 20)];
  let words = `box ${size.join(" × ")}, edge along ${"xyz"[a]} at ${P.join(",")}, chamfer ${d}`;
  const faces = [{ normal, off: plane([0, 0, 0]) }];
  if (kind === 1) {
    doc = insertMove(doc, ["body:feature-1"], { ...NO_MOVE, x: shift[0], y: shift[1], z: shift[2] }).doc;
    faces[0].off = plane(shift);
    words += `, moved ${shift.join(",")}`;
  } else if (kind === 2) {
    const copy = insertDuplicates(doc, ["body:feature-1"]);
    const away: V3 = [size[0] + 5 + Math.abs(shift[0]), shift[1], shift[2]];
    // Never in the original's face's plane (seed 4592: both faces then answer to one model plane, so "lit once" can't tell them apart).
    if (dot(away, n) === 0) away[b] += 1;
    doc = insertMove(copy.doc, [`body:${copy.ids[0]}`], { ...NO_MOVE, x: away[0], y: away[1], z: away[2] }).doc;
    faces.push({ normal, off: plane(away) });
    words += `, copied and the copy moved ${away.join(",")}`;
  } else if (kind === 3) {
    const slab = insertPreset(doc, "box", size[0] - 4, size[1] - 4, 5);
    const up = insertMove(slab.doc, [`body:${slab.id}`], { ...NO_MOVE, x: 2, y: 2, z: size[2] }).doc;
    doc = insertCombine(up, "body:feature-1", [`body:${slab.id}`], "join", false).doc;
    words += ", a slab joined on top";
  }
  return { doc, faces, words };
}

/** The held name of the one straight edge of `body` whose ends both satisfy `on`. */
async function edgeWhere(doc: DesignDocument, body: string, on: (p: readonly number[]) => boolean): Promise<string> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const ids = Object.keys(build.bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
  const at = ids.indexOf(body);
  const view = list[at].view;
  const edges = view.edge_vertices.flatMap(([p, q], e) => (on(view.vertex_points[p]) && on(view.vertex_points[q]) ? [e] : []));
  await cache.close();
  assert.equal(edges.length, 1, "one edge there");
  return heldEdgeNames(designNames(list), at)[edges[0]]!;
}

async function check(seed: number): Promise<void> {
  const s = await session(seed);
  const { scene, cache } = await sceneOf(s.doc);
  await cache.close();
  // What the view lights, Create sketch takes: never a refusal for a face it offered.
  const lit = sketchableFaces(scene);
  for (const face of lit) {
    const spot = sketchSpot({ face, shift: false }, scene);
    assert.ok(spot?.kind === "face", `${s.words}: face ${face} lit but ${JSON.stringify(spot)}`);
    assert.doesNotThrow(() => addFaceSketch(s.doc, spot.face, spot.drawn), `${s.words}: ${spot.face.plane}`);
  }
  // Each chamfer face the model expects: lit, and a sketch on it placed on the model's plane facing out.
  for (const want of s.faces) {
    const hits = lit.filter((face) => {
      const at = scene.bodies.findIndex((_, k) => face >= scene.faceStart[k] && face < scene.faceStart[k] + scene.bodies[k].view.faces);
      const v = scene.bodies[at].view;
      const i = face - scene.faceStart[at];
      return v.face_normals[i] !== null && Math.abs(dot(v.face_normals[i]!, want.normal) - 1) < 1e-9 && Math.abs(want.off(v.face_centroids[i])) < 1e-6;
    });
    assert.equal(hits.length, 1, `${s.words}: the chamfer's face lit once`);
    const spot = sketchSpot({ face: hits[0], shift: false }, scene);
    assert.ok(spot?.kind === "face");
    // The Chamfer's own face is "chamfer:1"; a Copy's is renamed by the Copy, keeping the Chamfer it came from ("chamfer:feature-2~1").
    assert.match(spot.face.plane, /\/chamfer:(feature-\d+~)?1$/, `${s.words}: ${spot.face.plane}`);
    const made = addFaceSketch(s.doc, spot.face, spot.drawn);
    const after = await sceneOf(made.doc);
    await after.cache.close();
    const res = after.build.results[made.id];
    assert.ok(res.status === "built" && res.plane === undefined, `${s.words}: ${JSON.stringify(res)}`);
    // Rule 8's frame keeps its normal one of a face's two ways; the side says which is out of the body.
    const { plane: { origin, normal }, side } = res.placement!;
    assert.ok(Math.abs(side * dot(normal, want.normal) - 1) < 1e-12, `${s.words}: normal ${normal}, side ${side}`);
    assert.ok(Math.abs(want.off(origin)) < 1e-9 * 100, `${s.words}: origin ${origin} is ${want.off(origin)} mm off the face`);
  }
}

test("seeded: every face lit for Create sketch on a chamfered body is taken, and a sketch on the chamfer's face lands on it", async () => {
  const one = process.env.FISSION_SEED;
  const seeds = one !== undefined ? [Number(one)] : Array.from({ length: Number(process.env.CHAMFER_SKETCH_SEEDS ?? 12) }, (_, k) => 4401 + k);
  for (const seed of seeds) {
    try {
      await check(seed);
    } catch (e) {
      assert.fail(`seed ${seed} (FISSION_SEED=${seed} replays it): ${(e as Error).message}`);
    }
  }
});
