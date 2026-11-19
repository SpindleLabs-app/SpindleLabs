// SL #759 item 3 (app-wide hunt 2026-11-14, hunter R, R-6), in the Design app on the real kernel: a sketch on a Join's
// merged top over the tool's part, with a Scale of the joined body. (a) A Scale put in before the sketch carries the
// sketch's middle with the body's point under it, as on any face (SL #539's rule): the input face's frame on the merged
// face is a point of the body, scaled about the Scale's centre (built-body.ts `originFrameNow` by `bodyMap`). (b) With the
// Scale already there, a click on the scaled top names the part under it (face-pick.ts `clickedName` takes the size off
// too), so the sketch follows that part's Move. Red on main cd89748: tests 2 and 4. Controls: tests 1 and 3.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayMesh } from "@fission/core";
import { BodyCache, builtPieceFaces, designWorkspace, followedDoc, insertCombine, insertMove, insertPreset, moveMarker, NO_MOVE, numberPieces, partDocument, rebuildTimeline, type DesignDocument } from "@fission/design";
import { app, kernel } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
type Box3 = number[][];
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;

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
    assert.ok(box, `Move's ${axis} box`);
    box.value = val;
    box.dispatchEvent(new a.window.Event("input") as unknown as Event);
  }
  await a.settle();
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
}

/**
 * Box 1 40 × 30 × 20 and Box 2 the same moved 20 along x (Move 1), joined (or not: `combine` false scales Box 2 alone),
 * then the body scaled × `f` about the world origin: with the Join one body x 0..60f, its top one face at z 20f.
 * Create sketch with a click on the top over Box 2's part only (x 50f), a 10 × 10 rectangle round (50f, 15f), extruded 5.
 */
async function blockOnScaledTop(f: number, combine: boolean) {
  let doc = partDocument("box", 40, 30, 20);
  let b2: string;
  ({ doc, id: b2 } = insertPreset(doc, "box", 40, 30, 20));
  const m = insertMove(doc, [`body:${b2}`], { ...NO_MOVE, x: 20 });
  doc = combine ? insertCombine(m.doc, "body:feature-1", [`body:${b2}`], "join").doc : m.doc;
  const scaled = insertMove(doc, [combine ? "body:feature-1" : `body:${b2}`], { ...NO_MOVE, scale: f, pivotX: 0, pivotY: 0, pivotZ: 0 }, "scale");
  const a = await app(scaled.doc, designWorkspace);
  a.$("#create-sketch")!.click();
  await a.settle();
  const [cx, cy, top] = [50 * f, 15 * f, 20 * f];
  const faces = facesWhere(a.mesh()!, (p) => Math.abs(p[2] - top) < 1e-9 && (combine || p[0] >= 20 * f - 1e-9));
  assert.ok(faces.length >= 1, "the top face is drawn");
  await a.pick({ face: faces[0], point: [cx, cy, top] } as never);
  assert.ok(a.sketching(), "a sketch opened on the top");
  for (const [x, y] of [[cx - 5, cy - 5], [cx + 5, cy - 5], [cx + 5, cy + 5], [cx - 5, cy + 5], [cx - 4.7, cy - 5.2]]) await a.click(x, y);
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = "5";
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  return { a, move: m.id, scale: scaled.id };
}

// Worked by hand, f = 2. Box 2 lies x 20..60 before the Scale, x 40..120 after it (× 2 about the origin); the top is at
// z 40. The block is drawn round (100, 30) on Box 2's part: x 95..105, y 25..35, z 40..45 (a sketch keeps its own sizes).
// Move 1 edited from x 20 to x 30 takes Box 2 by 10 before the Scale, so by 2 × 10 = 20 after it: Box 2's part is then
// x 60..140, and the block drawn on it goes with it by 20: x 115..125, y 25..35, z 40..45.
for (const combine of [false, true]) {
  test(`${combine ? "on a Join's merged top over Box 2's part" : "control, no Join: on Box 2's own top"}, the body scaled x 2: the block follows Box 2's Move edited from x 20 to x 30 (by 2 x 10 = 20)`, async () => {
    const { a, move } = await blockOnScaledTop(2, combine);
    assert.deepEqual(await block(a.doc()), [[95, 25, 40], [105, 35, 45]], "drawn where it was clicked");
    await editMove(a, move, { x: "30" });
    const got = await block(a.doc());
    assert.deepEqual(got, [[115, 25, 40], [125, 35, 45]]);
    await a.close();
  });
}

/**
 * As merged-top-sketch.journey.ts's blockOnJoinedTop, no Scale yet: Box 1 and Box 2 (moved 20 along x) joined, top at
 * z 20, x 0..60; a 10 × 10 block drawn round (cx, 15) on the top, extruded 5. Returns the Combine's id too.
 */
async function blockOnJoinedTop(cx: number) {
  let doc = partDocument("box", 40, 30, 20);
  let b2: string;
  ({ doc, id: b2 } = insertPreset(doc, "box", 40, 30, 20));
  const m = insertMove(doc, [`body:${b2}`], { ...NO_MOVE, x: 20 });
  const c = insertCombine(m.doc, "body:feature-1", [`body:${b2}`], "join");
  const a = await app(c.doc, designWorkspace);
  a.$("#create-sketch")!.click();
  await a.settle();
  const top = facesWhere(a.mesh()!, (p) => p[2] === 20);
  await a.pick({ face: top[0], point: [cx, 15, 20] } as never);
  for (const [x, y] of [[cx - 5, 10], [cx + 5, 10], [cx + 5, 20], [cx - 5, 20], [cx - 4.7, 9.8]]) await a.click(x, y);
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = "5";
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  return { a, combine: c.id };
}

// Worked by hand (the rule of SL #539, face-sketch-scale.journey.ts: a Scale put in before a sketch carries the sketch's
// middle with the body's point under it, its own sizes kept). A Scale by 2 about the world origin put in after the Join:
// the body is x 0..120, y 0..60, top z 40. The block's middle (cx, 15, 20) goes to (2cx, 30, 40): the block is
// x 2cx-5..2cx+5, y 25..35, z 40..45. Over Box 1's part (cx 10, the merged top's first input): 15..25. Over Box 2's part
// (cx 50): 95..105.
for (const [cx, whose] of [[10, "Box 1's part (control)"], [50, "Box 2's part"]] as const) {
  test(`a block on a Join's merged top over ${whose}: a Scale by 2 put in after the Join carries it with the body's point under it`, async () => {
    const { a, combine } = await blockOnJoinedTop(cx);
    assert.deepEqual(await block(a.doc()), [[cx - 5, 10, 20], [cx + 5, 20, 25]], "drawn where it was clicked");
    const scaled = moveMarker(insertMove(moveMarker(a.doc(), combine), ["body:feature-1"], { ...NO_MOVE, scale: 2, pivotX: 0, pivotY: 0, pivotZ: 0 }, "scale").doc, null);
    const all = await built(scaled);
    const got = [...all.values()].find((b) => Math.abs(b.volume - 500) < 1e-6)?.bounds ?? null;
    assert.deepEqual(got, [[2 * cx - 5, 25, 40], [2 * cx + 5, 35, 45]]);
    await a.close();
  });
}
