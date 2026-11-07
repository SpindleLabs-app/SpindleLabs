// Measure's seeded journey (step 35e2l3): random pairs of boxes, built by the
// real rebuild on the real kernel, and random picks of their corners, edges,
// faces and whole bodies, clicked as the view reports clicks (a corner by its
// place among those offered, measure-view.ts sceneCorners). Every answer is
// checked against a plain model worked out apart from the kernel:
//
// A box w × d × h stands on the floor at the origin, [0, w] × [0, d] × [0, h]
// (presetFeature), moved by (x, y, z). Each of its faces is named by the
// kernel's role (left −x, right +x, front −y, back +y, bottom, top), and in the
// model that role is the box with one axis pinned: left is x = x0, etc. An
// edge is where its two faces meet, a corner where its three meet, so each
// pick is an axis-aligned box too (a point, a segment, a rectangle or the
// solid). The least distance between two axis-aligned boxes is
// √(gx² + gy² + gz²), each g the gap between the two intervals on that axis
// (0 when they overlap): the nearest points can be moved independently along
// each axis. The kernel's nearest points must also lie on what was picked.
//
// Nasty cases come from the draw: sizes down to 0.01 mm, boxes touching
// (the offsets are on a half-millimetre grid, as the sizes), boxes overlapping
// one another, a pick against its own body or itself.
// FISSION_SEED replays a run; a failure names the seed, the session and the click.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AnalysisOverlay, Measured, ViewportPick } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies, type Scene } from "../src/scene.ts";
import { measureView, sceneCorners } from "../src/measure-view.ts";

const kernel = nodeKernel();
const { Window } = await import("happy-dom");

const SEED = Number(process.env.FISSION_SEED ?? 20261107);
const SESSIONS = 40;
const CLICKS = 14;

/** mulberry32: the same seed gives the same boxes and clicks. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Interval = [number, number];
type ModelBox = [Interval, Interval, Interval];

/** The face roles of a box, as the axis and end they pin. */
const ROLE_PIN: Record<string, [number, 0 | 1]> = { left: [0, 0], right: [0, 1], front: [1, 0], back: [1, 1], bottom: [2, 0], top: [2, 1] };

function pin(box: ModelBox, role: string): ModelBox {
  const p = ROLE_PIN[role];
  assert.ok(p, `a box face has a role the model knows: ${role}`);
  const [axis, end] = p;
  return box.map((iv, k) => (k === axis ? [iv[end], iv[end]] : iv)) as ModelBox;
}
function meet(a: ModelBox, b: ModelBox): ModelBox {
  return a.map((iv, k) => [Math.max(iv[0], b[k][0]), Math.min(iv[1], b[k][1])]) as ModelBox;
}
/** The least distance between two axis-aligned boxes: the gaps on each axis, put together by Pythagoras. */
function gap(a: ModelBox, b: ModelBox): number {
  return Math.hypot(...a.map((iv, k) => Math.max(0, b[k][0] - iv[1], iv[0] - b[k][1])));
}
/** How far a point lies outside a box (0 inside or on it). */
const outside = (p: readonly number[], b: ModelBox) => gap(b, p.map((x) => [x, x]) as ModelBox);

/** A size: mostly 1–40 mm on a half-millimetre grid, sometimes tiny (0.01–0.5 mm). */
const size = (r: () => number) => (r() < 0.12 ? Math.round(1 + r() * 49) / 100 : Math.round(2 + r() * 78) / 2);
/** An offset on the half-millimetre grid, within ±50 mm: boxes apart, touching or overlapping. */
const offset = (r: () => number) => Math.round((r() * 2 - 1) * 100) / 2;

interface Built {
  scene: Scene;
  model: ModelBox[];
  cache: BodyCache;
  handle(b: number): ReturnType<Parameters<typeof measureView>[0]["handle"]>;
}

async function build(r: () => number): Promise<Built & { what: string }> {
  const [a, b] = [[size(r), size(r), size(r)], [size(r), size(r), size(r)]];
  const move = [offset(r), offset(r), offset(r)];
  let doc: DesignDocument = partDocument("box", a[0], a[1], a[2]);
  const placed = insertPreset(doc, "box", b[0], b[1], b[2]);
  doc = insertMove(placed.doc, [`body:${placed.id}`], { ...NO_MOVE, x: move[0], y: move[1], z: move[2] }).doc;
  const cache = new BodyCache(kernel);
  const built = await rebuildTimeline(doc, cache, kernel);
  const scene = joinBodies(await shownBodies(doc, built, cache), built);
  const model: ModelBox[] = [
    [[0, a[0]], [0, a[1]], [0, a[2]]],
    [[move[0], move[0] + b[0]], [move[1], move[1] + b[1]], [move[2], move[2] + b[2]]],
  ];
  const what = `boxes ${a.join("×")} and ${b.join("×")} moved (${move.join(", ")})`;
  return { scene, model, cache, what, handle: (i) => { const id = scene.bodies[i]?.body; return id === undefined ? null : (built.bodies[id]?.handle ?? null); } };
}

/** What a pick is in the model, and the click the view would report for it. */
interface Choice {
  click: ViewportPick;
  box: ModelBox;
  name: string;
}

function choose(r: () => number, s: Built): Choice {
  const body = r() < 0.5 ? 0 : 1;
  const view = s.scene.bodies[body].view;
  const box = s.model[body];
  const faceBox = (f: number) => pin(box, view.face_roles[f]!.role);
  const kind = Math.floor(r() * 4);
  if (kind === 0) {
    // A corner: the three faces its edges join meet in it.
    const v = Math.floor(r() * view.vertices);
    const faces = new Set(view.edge_vertices.flatMap((ev, e) => (ev.includes(v) ? view.edge_faces[e]! : [])));
    assert.equal(faces.size, 3, "a box's corner is on three faces");
    const all = sceneCorners(s.scene);
    const place = all.findIndex((c) => c.body === body && c.index === v);
    return { click: { face: null, edge: null, vertex: place, shift: false }, box: [...faces].map(faceBox).reduce(meet), name: `corner ${v} of body ${body}` };
  }
  if (kind === 1) {
    const e = Math.floor(r() * view.edges);
    const [f, g] = view.edge_faces[e]!;
    return { click: { face: null, edge: s.scene.edgeStart[body] + e, shift: false }, box: meet(faceBox(f), faceBox(g)), name: `edge ${e} of body ${body}` };
  }
  if (kind === 2) {
    const f = Math.floor(r() * view.faces);
    return { click: { face: s.scene.faceStart[body] + f, edge: null, shift: false }, box: faceBox(f), name: `face ${f} (${view.face_roles[f]!.role}) of body ${body}` };
  }
  return { click: { face: s.scene.faceStart[body], edge: null, shift: false, double: true }, box, name: `body ${body}` };
}

/** Each pair measured, by the kinds of its two picks ("corner-face"…), counted over the run. */
const measuredKinds = new Map<string, number>();
const kindOf = (c: Choice) => c.name.split(" ")[0];

function session(seed: number, n: number) {
  return async (): Promise<string | null> => {
    const r = random(seed ^ Math.imul(n + 1, 0x9e3779b1));
    const s = await build(r);
    try {
      // The model's boxes are where the kernel built them (the convention it rests on).
      s.model.forEach((m, b) => assert.deepEqual(s.scene.bodies[b].view.bounds, [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]]], `body ${b} stands where the model has it`));
      const window = new Window({ width: 1280, height: 800 });
      const doc = window.document as unknown as Document;
      const [slot, over] = [doc.createElement("div"), doc.createElement("div")];
      doc.body.append(slot, over);
      const view = measureView({
        slot,
        over,
        scene: () => s.scene,
        handle: s.handle,
        measure: (a, b) => kernel.call("body_measure", a, b),
        unit: () => "mm",
        showOverlay: (_o: AnalysisOverlay) => {},
        clearOverlay: () => {},
        changed: () => {},
        reveal: () => {},
        offerCorners: () => {},
      });
      view.open();
      let first: Choice | null = null;
      for (let i = 0; i < CLICKS; i++) {
        const c = choose(r, s);
        const where = `seed ${seed} session ${n} (${s.what}) click ${i}`;
        if (first !== null && first.name === c.name) continue; // the same thing again would let it go
        if (first === null) view.rebuilt(); // start afresh (the picks go; the scene is the same)
        view.pick(c.click);
        await view.settled;
        const m: Measured | null = view.measured;
        if (m === null) return `${where}: ${first ? `${first.name} to ` : ""}${c.name} was not measured`;
        if (first === null) {
          first = c;
          continue;
        }
        const g = m.distance;
        if (!g) return `${where}: no distance between ${first.name} and ${c.name}`;
        const want = gap(first.box, c.box);
        // The kernel's distance is exact up to rounding: 1e-9 relative, with a floor of 1e-9 mm.
        const slack = 1e-9 * Math.max(1, want);
        if (Math.abs(g.distance - want) > slack) return `${where}: ${first.name} to ${c.name} measured ${g.distance}, the model has ${want}`;
        if (Math.abs(Math.hypot(...g.to.map((x, k) => x - g.from[k])) - g.distance) > slack) return `${where}: the line's length is not the distance`;
        if (outside(g.from, first.box) > slack || outside(g.to, c.box) > slack) return `${where}: the nearest points ${g.from} → ${g.to} are not on ${first.name} and ${c.name}`;
        const pair = [kindOf(first), kindOf(c)].sort().join("-");
        measuredKinds.set(pair, (measuredKinds.get(pair) ?? 0) + 1);
        if (want === 0) measuredKinds.set("touching", (measuredKinds.get("touching") ?? 0) + 1);
        first = null;
      }
      return null;
    } finally {
      await s.cache.close();
    }
  };
}

test(`seeded journey: ${SESSIONS} sessions of random box pairs and ${CLICKS} clicks on corners, edges, faces and bodies match the plain box model (seed ${SEED})`, async () => {
  for (let n = 0; n < SESSIONS; n++) {
    const failure = await session(SEED, n)();
    assert.equal(failure, null, failure ?? "");
  }
  // The run covers every pair of kinds, and some picks that touch: a pass means something.
  const kinds = ["body", "corner", "edge", "face"];
  for (const a of kinds) for (const b of kinds) if (a <= b) assert.ok((measuredKinds.get(`${a}-${b}`) ?? 0) > 0, `no ${a}-${b} pair measured: ${JSON.stringify([...measuredKinds])}`);
  assert.ok((measuredKinds.get("touching") ?? 0) > 0, "no touching pair measured");
  console.log(`# measured ${JSON.stringify(Object.fromEntries(measuredKinds))}`);
});

test("the box model, by hand: gaps on each axis put together by Pythagoras", () => {
  // Unit cube and one moved (3, 4, 0) further: the gaps are 2 along x and 3 along y, so √(2² + 3²) = √13.
  const cube: ModelBox = [[0, 1], [0, 1], [0, 1]];
  assert.ok(Math.abs(gap(cube, [[3, 4], [4, 5], [0, 1]]) - Math.sqrt(13)) < 1e-15);
  // Overlapping on every axis: 0. Touching on a face: 0.
  assert.equal(gap(cube, [[0.5, 2], [0.5, 2], [0.5, 2]]), 0);
  assert.equal(gap(cube, [[1, 2], [0, 1], [0, 1]]), 0);
  // The top face pinned at z = 1, its right edge where right and top meet, its corner where right, back and top do.
  assert.deepEqual(pin(cube, "top"), [[0, 1], [0, 1], [1, 1]]);
  assert.deepEqual(meet(pin(cube, "right"), pin(cube, "top")), [[1, 1], [0, 1], [1, 1]]);
  assert.deepEqual([pin(cube, "right"), pin(cube, "back"), pin(cube, "top")].reduce(meet), [[1, 1], [1, 1], [1, 1]]);
  // The corner (1, 1, 1) to the point (2, 3, 1): √(1 + 4) = √5.
  assert.ok(Math.abs(outside([2, 3, 1], cube) - Math.sqrt(5)) < 1e-15);
});
