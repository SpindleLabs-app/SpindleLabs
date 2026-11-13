// SL #707 (flat stress hunt 2026-11-13, A1-3 and A1-1), in the app around Design on the real kernel.
// 1. A sketch on a Join's merged top, drawn over the tool's part, follows the tool's Move when that Move is edited:
//    it was carried by the target's place (the merged face's first input), so it jumped sideways by the tool's offset.
// 2. A sketch drawn on a whole face that a later edit splits goes with the piece under its own drawing, not the piece
//    under the world origin seen onto the face.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayMesh } from "@fission/core";
import { addFaceSketch, BodyCache, builtPieceFaces, designWorkspace, drawRectangle, extrudeSketch, followedDoc, insertCombine, insertMove, insertPreset, joinBodies, NO_MOVE, numberPieces, partDocument, rebuildTimeline, shownBodies, sketchSpot, type DesignDocument } from "@fission/design";
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
/** The bounds of the one 10 × 10 × 5 block (500 mm³). */
const block = async (doc: DesignDocument) => [...(await built(doc)).values()].find((b) => Math.abs(b.volume - 500) < 1e-6)?.bounds ?? null;

/** The faces of the drawn mesh whose every corner passes `on`. */
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

async function editDepth(a: App, id: string, value: string) {
  assert.equal(await a.menu(id, "edit"), null);
  const box = a.$("#edit-depth") as HTMLInputElement;
  box.value = value;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
  (a.$("#feature-edit-ok") as HTMLButtonElement).click();
  await a.settle();
}

/**
 * Box 1 40 × 30 × 20 and Box 2 the same moved 20 along x, joined: one body, its top one face at z 20 (x 0..60).
 * Create sketch with a click on the top over Box 2's part (x 50), a rectangle x 45..55, y 10..20, extruded 5.
 */
async function blockOnJoinedTop(combine = true) {
  let doc = partDocument("box", 40, 30, 20);
  let b2: string;
  ({ doc, id: b2 } = insertPreset(doc, "box", 40, 30, 20));
  const m = insertMove(doc, [`body:${b2}`], { ...NO_MOVE, x: 20 });
  doc = combine ? insertCombine(m.doc, "body:feature-1", [`body:${b2}`], "join").doc : m.doc;
  const a = await app(doc, designWorkspace);
  a.$("#create-sketch")!.click();
  await a.settle();
  const top = facesWhere(a.mesh()!, (p) => p[2] === 20 && (combine || p[0] >= 20));
  await a.pick({ face: top[0], point: [50, 15, 20] } as never);
  for (const [x, y] of [[45, 10], [55, 10], [55, 20], [45, 20], [45.3, 9.8]]) await a.click(x, y);
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = "5";
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  return { a, move: m.id };
}

// Worked by hand: the block is drawn on Box 2's part of the top, so it goes where Box 2 goes. Box 2's Move edited from
// (20, 0, 0) to (x, 0, z) takes Box 2 by (x − 20, 0, z), and the block from x 45..55, z 20..25 by the same.
for (const [x, z] of [[20, 10], [50, 10], [30, 0], [30, 5]] as const) {
  test(`SL #707 item 1: a block on a Join's merged top over Box 2's part follows Box 2's Move edited to x ${x}, z ${z}`, async () => {
    const { a, move } = await blockOnJoinedTop();
    assert.deepEqual(await block(a.doc()), [[45, 10, 20], [55, 20, 25]], "drawn where it was clicked");
    await editMove(a, move, { x: String(x), z: String(z) });
    const want = [[45 + x - 20, 10, 20 + z], [55 + x - 20, 20, 25 + z]];
    assert.deepEqual(await block(a.doc()), want);
    assert.ok(await a.close());
  });
}

test("SL #707 item 1, the control: without the Combine the block follows Box 2 the same way", async () => {
  const { a, move } = await blockOnJoinedTop(false);
  await editMove(a, move, { x: "20", z: "10" });
  assert.deepEqual(await block(a.doc()), [[45, 10, 30], [55, 20, 35]]);
  assert.ok(await a.close());
});

/** The app's Create-sketch spot on the top face (normal +z, at z 10) of body `bodyId` in `doc`. */
async function topSpot(doc: DesignDocument, bodyId: string) {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const shown = await shownBodies(doc, build, cache);
    const scene = joinBodies(shown, build);
    const b = shown.findIndex((x) => x.body === bodyId);
    const body = shown[b];
    const f = body.view.face_normals.findIndex((n, i) => n !== null && n[2] === 1 && Math.abs(body.view.face_centroids[i][2] - 10) < 1e-9);
    const spot = sketchSpot({ face: scene.faceStart[b] + f, shift: false } as never, scene);
    if (spot?.kind !== "face") throw new Error(`face refused: ${JSON.stringify(spot)}`);
    return spot;
  } finally {
    await cache.close();
  }
}

for (const [x0, z] of [[80, 60], [10, 10]] as const) {
  test(`SL #707 item 2: a block drawn at x ${x0} on a whole top that a later edit splits goes with the piece under it`, async () => {
    // Bar 100 × 20 × 10; slot 10 × 35 × 20 at (45, −10, −5) cut from it: two bars, x 0..45 and x 55..100. Move 2
    // lifts the far one (the piece) by 50. The slot 25 deep is a notch: one bar, its top whole. The block drawn there
    // at x0..x0+10 is on the far end (x0 80) or the near end (x0 10). The slot 35 deep again splits the top: worked by
    // hand, the far end's block goes up 50 with the far piece (z 60..65), the near end's stays on the bar (z 10..15).
    let doc = partDocument("box", 100, 20, 10);
    let slot: string;
    ({ doc, id: slot } = insertPreset(doc, "box", 10, 35, 20));
    doc = insertMove(doc, [`body:${slot}`], { ...NO_MOVE, x: 45, y: -10, z: -5 }).doc;
    doc = insertCombine(doc, "body:feature-1", [`body:${slot}`], "cut").doc;
    const cache = new BodyCache(kernel);
    const first = await rebuildTimeline(doc, cache, kernel);
    doc = numberPieces(doc, Object.keys(first.bodies), builtPieceFaces(first));
    await cache.close();
    doc = insertMove(doc, ["body:feature-4/piece:1"], { ...NO_MOVE, z: 50 }).doc;
    const a = await app(doc, designWorkspace);
    await editDepth(a, slot, "25");
    const spot = await topSpot(a.doc(), "body:feature-1");
    const sk = addFaceSketch(a.doc(), spot.face, spot.drawn);
    a.changeDesign(extrudeSketch(drawRectangle(sk.doc, sk.id, [x0, 5], [x0 + 10, 15]).doc, sk.id, 5).doc);
    await a.settle();
    assert.deepEqual(await block(a.doc()), [[x0, 5, 10], [x0 + 10, 15, 15]], "drawn on the whole top");
    await editDepth(a, slot, "35");
    assert.deepEqual(await block(a.doc()), [[x0, 5, z], [x0 + 10, 15, z + 5]]);
    assert.ok(await a.close());
  });
}
