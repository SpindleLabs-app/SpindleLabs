// SL #759 item 1 (app-wide hunt 2026-11-14, T-4), in the app around Design on the real kernel: a sketch on a Join's
// merged top, drawn over the tool's part, follows that part through any later boolean of the body, as it does with
// none (merged-top-sketch.journey.ts, SL #707). The merged face's input faces were kept for one boolean only, so after
// a later Cut or Join the sketch was named and carried by the first box's part.
// (a) a second Join; (b) a hole cut elsewhere first (by a Combine or an Extrude Cut), then the pad drawn; (c) a pad
// drawn while an earlier hole is suppressed, then the hole switched on: the pad jumped 40 mm onto Box 1's part.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayMesh } from "@fission/core";
import { addSketch, BodyCache, builtPieceFaces, designWorkspace, drawRectangle, extrudeSketch, followedDoc, insertCombine, insertMove, insertPreset, NO_MOVE, numberPieces, partDocument, rebuildTimeline, suppressItem, type DesignDocument } from "@fission/design";
import { app, kernel } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
type Box3 = number[][];
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;

/** The bodies of `doc` opened afresh and rebuilt until settled, as the app does: id → [volume, bounds]. */
async function built(doc: DesignDocument): Promise<Map<string, { volume: number; bounds: Box3 }>> {
  let d = doc;
  const cache = new BodyCache(kernel);
  try {
    let build = await rebuildTimeline(d, cache, kernel);
    for (let i = 0; i < 4; i++) {
      const next = numberPieces(followedDoc(d, build), Object.keys(build.bodies), builtPieceFaces(build));
      if (next === d) break;
      d = next;
      build = await rebuildTimeline(d, cache, kernel);
    }
    const out = new Map<string, { volume: number; bounds: Box3 }>();
    for (const [id, b] of Object.entries(build.bodies)) {
      const v = await cache.view(b.handle);
      out.set(id, { volume: r6(v.volume), bounds: v.bounds.map((p: number[]) => p.map(r6)) });
    }
    return out;
  } finally {
    await cache.close();
  }
}

/** The pad's bounds, in the app now and in its design opened afresh (they must agree), and the rest's volume. */
async function pad(a: App, id: string): Promise<{ pad: Box3 | null; rest: number }> {
  const fresh = await built(a.doc());
  const got = fresh.get(`body:${id}`)?.bounds ?? null;
  const rest = [...fresh].filter(([b]) => b !== `body:${id}`).reduce((s, [, b]) => s + b.volume, 0);
  return { pad: got, rest };
}

function facesWhere(mesh: DisplayMesh, on: (p: number[]) => boolean): number[] {
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const ok = [0, 1, 2].every((j) => {
      const i = mesh.indices[3 * t + j];
      return on([mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]);
    });
    all.set(f, (all.get(f) ?? true) && ok);
  });
  return [...all].filter(([, ok]) => ok).map(([f]) => f);
}

async function editMove(a: App, id: string, v: Record<string, string>) {
  await a.doubleClick(id);
  for (const [axis, val] of Object.entries(v)) {
    const box = a.$(`#move-${axis}`) as HTMLInputElement;
    box.value = val;
    box.dispatchEvent(new a.window.Event("input") as unknown as Event);
  }
  await a.settle();
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
}

type Hole = "none" | "combine" | "extrude" | "join";
/**
 * Box 1 40 × 30 × 20 (x 0..40); Box 2 the same, Move 1 by x +40 (x 40..80); Combine 1 joins Box 2 to Box 1 (48,000, one
 * top at z 20, x 0..80). Then `later`: "combine", Box 3 10 × 10 × 30 moved (5, 5, −5) cut from Body 1 by Combine 2 (a hole
 * 10 × 10 × 20 = 2,000 through Box 1's part, 46,000); "extrude", a rectangle x 5..15, y 5..15 on XY extruded 20 as a Cut
 * of Body 1 (the same hole); "join", Box 3 40 × 30 × 20 moved x +80 joined to Body 1 by Combine 2 (72,000, the top x
 * 0..120); "none". `off`: that later item suppressed while the pad is drawn. Then Create sketch clicked on the top at
 * (60, 15), over Box 2's part: a pad x 55..65, y 10..20, extruded 5 (500, z 20..25).
 */
async function start(later: Hole, off = false, lift = 0) {
  let doc: DesignDocument = partDocument("box", 40, 30, 20);
  const box1 = doc.timeline.features[0].id;
  const b2 = insertPreset(doc, "box", 40, 30, 20);
  const m = insertMove(b2.doc, [`body:${b2.id}`], { ...NO_MOVE, x: 40 });
  doc = insertCombine(m.doc, `body:${box1}`, [`body:${b2.id}`], "join").doc;
  // `lift`: Move 2 lifts the joined body by it before the later boolean (a second Join's Box 3 lifted with it).
  if (lift !== 0) doc = insertMove(doc, [`body:${box1}`], { ...NO_MOVE, z: lift }).doc;
  if (later === "combine" || later === "join") {
    const b3 = later === "combine" ? insertPreset(doc, "box", 10, 10, 30) : insertPreset(doc, "box", 40, 30, 20);
    doc = insertMove(b3.doc, [`body:${b3.id}`], later === "combine" ? { ...NO_MOVE, x: 5, y: 5, z: -5 + lift } : { ...NO_MOVE, x: 80, z: lift }).doc;
    doc = insertCombine(doc, `body:${box1}`, [`body:${b3.id}`], later === "combine" ? "cut" : "join").doc;
  } else if (later === "extrude") {
    const s = addSketch(doc);
    doc = extrudeSketch(drawRectangle(s.doc, s.id, [5, 5], [15, 15]).doc, s.id, 20, false, undefined, { operation: "cut", bodies: [`body:${box1}`] }).doc;
  }
  const hole = doc.timeline.features.at(-1)!.id;
  if (off) doc = suppressItem(doc, hole, true);
  const a = await app(doc, designWorkspace);
  a.$("#create-sketch")!.click();
  await a.settle();
  const top = facesWhere(a.mesh()!, (p) => p[2] === 20 + lift);
  assert.equal(top.length, 1, "one top face");
  await a.pick({ face: top[0], point: [60, 15, 20 + lift] } as never);
  for (const [x, y] of [[55, 10], [65, 10], [65, 20], [55, 20], [55.3, 9.8]]) await a.click(x, y);
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = "5";
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  return { a, move: m.id, hole, pad: a.doc().timeline.features.at(-1)!.id };
}

const BODY: Record<Hole, number> = { none: 48000, combine: 46000, extrude: 46000, join: 72000 };

// Worked by hand: the pad is drawn on Box 2's part of the top, so it goes where Box 2 goes. Move 1 edited from (40, 0, 0)
// to (40, 0, 5) lifts Box 2 to z 5..25 and the pad onto its top, z 25..30; to (40, 10, 0) takes both 10 along y.
for (const later of ["none", "combine", "extrude", "join"] as const) {
  test(`SL #759 item 1 (${later === "none" ? "the control: no later boolean" : later === "join" ? "a second Join" : `a hole by ${later === "combine" ? "a Combine Cut" : "an Extrude Cut"}`}): a pad on the joined top over Box 2's part follows Box 2's Move`, async () => {
    const s = await start(later);
    const a = s.a;
    assert.deepEqual(await pad(a, s.pad), { pad: [[55, 10, 20], [65, 20, 25]], rest: BODY[later] }, "drawn where it was clicked");
    await editMove(a, s.move, { z: "5" });
    assert.deepEqual((await pad(a, s.pad)).pad, [[55, 10, 25], [65, 20, 30]], "Box 2 raised 5: the pad on its top");
    await editMove(a, s.move, { y: "10", z: "0" });
    assert.deepEqual((await pad(a, s.pad)).pad, [[55, 20, 20], [65, 30, 25]], "Box 2 along y 10: the pad with it");
    assert.ok(await a.close());
  });
}

// Worked by hand: the hole is at x 5..15, 40 mm from the pad, and the top it cuts stays one face at z 20, so nothing
// the pad stands on changes: switched on (46,000) or off again (48,000, and with the Combine off Box 3, 10 × 10 × 30 =
// 3,000, stands as its own body: 51,000), the pad stays at x 55..65.
for (const later of ["combine", "extrude"] as const) {
  test(`SL #759 item 1 (a hole by ${later === "combine" ? "a Combine Cut" : "an Extrude Cut"} switched on after the pad was drawn): the pad stays where it is`, async () => {
    const s = await start(later, true);
    const a = s.a;
    const home = [[55, 10, 20], [65, 20, 25]];
    const off = later === "combine" ? 51000 : 48000;
    assert.deepEqual(await pad(a, s.pad), { pad: home, rest: off }, "drawn with the hole off");
    assert.equal(await a.menu(s.hole, "unsuppress"), null);
    assert.deepEqual(await pad(a, s.pad), { pad: home, rest: 46000 }, "the hole on: the pad where it was");
    assert.equal(a.warning(), null);
    assert.equal(await a.menu(s.hole, "suppress"), null);
    assert.deepEqual(await pad(a, s.pad), { pad: home, rest: off }, "the hole off again");
    assert.equal(await a.menu(s.hole, "unsuppress"), null);
    // And it still follows Box 2 with the hole on: raised 5, the pad z 25..30.
    await editMove(a, s.move, { z: "5" });
    assert.deepEqual((await pad(a, s.pad)).pad, [[55, 10, 25], [65, 20, 30]]);
    assert.ok(await a.close());
  });
}

// Worked by hand: Move 2 lifts the joined body 10 (top z 30) before Combine 2 joins Box 3 (moved (80, 0, 10), so its top
// lies level with it); the click at (60, 15, 30) is over Box 2's part as the first Join saw it once Move 2's lift is taken
// off, so the pad (x 55..65, z 30..35) is Box 2's: Move 1 edited to (40, 0, 5) puts it on Box 2's top, z 35..40, and to
// (40, 10, 0) 10 along y. Named after Box 1's part, it would stay at z 30..35.
for (const later of ["join", "combine"] as const) {
  test(`SL #759 item 1 (the joined body moved, then ${later === "join" ? "a second Join" : "a hole by a Combine Cut"}): a pad clicked over Box 2's part follows Box 2's Move`, async () => {
    const s = await start(later, false, 10);
    const a = s.a;
    assert.deepEqual(await pad(a, s.pad), { pad: [[55, 10, 30], [65, 20, 35]], rest: BODY[later] }, "drawn where it was clicked");
    await editMove(a, s.move, { z: "5" });
    assert.deepEqual((await pad(a, s.pad)).pad, [[55, 10, 35], [65, 20, 40]], "Box 2 raised 5: the pad on its top");
    await editMove(a, s.move, { y: "10", z: "0" });
    assert.deepEqual((await pad(a, s.pad)).pad, [[55, 20, 30], [65, 30, 35]], "Box 2 along y 10: the pad with it");
    assert.ok(await a.close());
  });
}
