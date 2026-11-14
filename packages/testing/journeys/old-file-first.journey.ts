// SL #759 item 2 (app-wide hunt 2026-11-14, S-2), in the app around Design on the real kernel: a file saved before
// Design data version 22 has every face sketch marked `first` by the upgrade (document.ts `migrateDesignV21`), carried
// by the first input of the face it is on. On a face that is no merged face the mark changes nothing, so the first
// rebuild takes it off; then a later edit that merges the face carries the sketch by the part it was drawn on, as a
// sketch drawn today. A sketch drawn on a merged face's other part before version 22 keeps the mark, and is carried as
// it was (#730's rule).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson, type DisplayMesh } from "@fission/core";
import { BodyCache, builtPieceFaces, designWorkspace, followedDoc, insertCombine, insertMove, insertPreset, NO_MOVE, numberPieces, partDocument, rebuildTimeline, type DesignDocument } from "@fission/design";
import { app, kernel } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
const file = (d: DesignDocument) => projectToJson({ ...emptyProject("Old file"), workspaces: { design: d } });
const reopen = (text: string) => projectFromJson(text, [designWorkspace]).workspaces.design as DesignDocument;

/** `doc` opened afresh and rebuilt until settled, as the app does: the settled design and the 10 × 10 × 5 block's bounds. */
async function built(doc: DesignDocument): Promise<{ doc: DesignDocument; block: number[][] | null }> {
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
    for (const b of Object.values(build.bodies)) {
      const v = await cache.view(b.handle);
      if (Math.abs(v.volume - 500) < 1e-6) return { doc: d, block: v.bounds.map((p: number[]) => p.map(r6)) };
    }
    return { doc: d, block: null };
  } finally {
    await cache.close();
  }
}

function faceWhere(mesh: DisplayMesh, on: (p: number[]) => boolean): number {
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const ok = [0, 1, 2].every((j) => {
      const i = mesh.indices[3 * t + j];
      return on([mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]);
    });
    all.set(f, (all.get(f) ?? true) && ok);
  });
  return [...all].find(([, ok]) => ok)![0];
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

/**
 * Box 1 40 × 30 × 20; Box 2 the same moved (20, 0, `z`); Combine 1 joins them. Create sketch clicked at (50, 15) on the
 * top over Box 2's part (z 20 + `z`), a rectangle x 45..55, y 10..20, extruded 5: a block of 500 mm³. Saved, the file
 * written as `version` (version 21 data holds the same sketch; `body`, when given, what version 21 recorded instead).
 */
async function drawnAndOpened(z: number, version: 21 | 22, body?: object) {
  let doc = partDocument("box", 40, 30, 20);
  let b2: string;
  ({ doc, id: b2 } = insertPreset(doc, "box", 40, 30, 20));
  const m = insertMove(doc, [`body:${b2}`], { ...NO_MOVE, x: 20, z });
  doc = insertCombine(m.doc, "body:feature-1", [`body:${b2}`], "join").doc;
  const a = await app(doc, designWorkspace);
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a.mesh()!, (p) => p[2] === 20 + z && (z === 0 || p[0] >= 20)), point: [50, 15, 20 + z] } as never);
  for (const [x, y] of [[45, 10], [55, 10], [55, 20], [45, 20], [45.3, 9.8]]) await a.click(x, y);
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = "5";
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const saved = JSON.parse(file(a.doc()));
  assert.ok(await a.close());
  assert.equal(saved.workspaces.design.version, 22);
  saved.workspaces.design.version = version;
  const sketch = saved.workspaces.design.sketches.find((s: { face?: object }) => s.face);
  if (body !== undefined) sketch.face.body = body;
  return { opened: reopen(JSON.stringify(saved)), move: m.id };
}

const firstOf = (d: DesignDocument) => d.sketches.find((s) => s.face)?.face?.first;

// Worked by hand: Box 2 at (20, 0, 5) leaves two tops, Box 1's at z 20 and Box 2's at z 25, so nothing is merged and the
// block stands on Box 2's own top, x 45..55, z 25..30. Box 2's Move edited to z 0 brings it down 5, the tops level and
// merged: the block goes with Box 2, x 45..55, z 20..25. Carried by Box 1 (the merged face's first input, which has not
// moved) it went by Box 2's frame's (20, 0, 5) taken off, to x 25..35, z 20..25.
for (const version of [22, 21] as const) {
  test(`SL #759 item 2${version === 22 ? " (the control: drawn today)" : ""}: a block on Box 2's own top from a version ${version} file goes with Box 2 when the tops merge`, async () => {
    const { opened, move } = await drawnAndOpened(5, version);
    assert.equal(firstOf(opened), version === 21 ? true : undefined, "the upgrade marks it");
    const once = await built(opened);
    assert.deepEqual(once.block, [[45, 10, 25], [55, 20, 30]], "opens where it was");
    assert.equal(firstOf(once.doc), undefined, "on a face that is no merged face the mark changes nothing, so it is taken off");
    const a = await app(opened, designWorkspace);
    await editMove(a, move, { z: "0" });
    const after = await built(a.doc());
    assert.deepEqual(after.block, [[45, 10, 20], [55, 20, 25]]);
    assert.equal(after.doc, a.doc(), "the design on screen is settled: the file builds the same");
    assert.ok(await a.close());
  });
}

// Worked by hand: Box 2 at (20, 0, 0), its top merged with Box 1's (x 0..60, z 20). Before version 22 a sketch there
// recorded the merged face's first input's frame, Box 1's (the world's), though named after Box 2's top; the mark makes
// it carried by Box 1, as it was drawn with, so it opens where it was and keeps the mark: here it changes something.
test("SL #759 item 2: a version 21 block drawn on Box 2's part of a merged top keeps its mark, and opens where it was", async () => {
  const { opened } = await drawnAndOpened(0, 21, { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] });
  assert.equal(firstOf(opened), true);
  const once = await built(opened);
  assert.deepEqual(once.block, [[45, 10, 20], [55, 20, 25]]);
  assert.equal(firstOf(once.doc), true, "kept: on that face it changes where the sketch goes");
});
