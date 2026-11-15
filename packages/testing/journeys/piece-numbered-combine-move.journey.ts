// App-wide hunt 2026-11-14, T, finding T-2, form D: a NEW Combine Cut made in the Combine panel with the marker rolled back to before a
// Move that lifts the bar; the cut goes right through the bar. Marker forward again: by SL #583 item 2's rule both
// ends are lifted (the Move holds the whole body).
import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertMove, insertPreset, movedBodies, NO_MOVE, partDocument, setCombineShown } from "@fission/design";
import { app, close } from "./design-app.ts";
import { failedItems, liveAgainstFile, meshBounds, undoRedoSame, type App } from "./piece-numbered-lib.ts";

setCombineShown(true);
function faceWhere(a: App, on: (p: number[]) => boolean): number {
  const mesh = a.mesh()!;
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const corners = [0, 1, 2].map((k) => {
      const i = mesh.indices[3 * t + k];
      return [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
    });
    all.set(f, (all.get(f) ?? true) && corners.every(on));
  });
  const found = [...all].filter(([, ok]) => ok).map(([f]) => f);
  assert.ok(found.length > 0, "a face there");
  return found[0];
}

test("D: a new Combine Cut through the bar, made with the marker before the Move that lifts it: both ends stay lifted", async () => {
  // Bar 100 × 40 × 10; Box 2 10 × 60 × 30 moved (45, −10, −10): x 45..55, right across the bar; Move 2 lifts the bar 50.
  let doc = partDocument("box", 100, 40, 10);
  const bar = doc.timeline.features[0].id;
  const b2 = insertPreset(doc, "box", 10, 60, 30);
  const m1 = insertMove(b2.doc, [`body:${b2.id}`], { ...NO_MOVE, x: 45, y: -10, z: -10 });
  const m2 = insertMove(m1.doc, [`body:${bar}`], { ...NO_MOVE, z: 50 });
  const a = await app(m2.doc, designWorkspace);
  assert.ok(close(a.volume(), 40000 + 18000), `at first ${a.volume()}`);
  // The marker to Move 1 (the bar on the ground, z 0..10; Box 2 through it).
  assert.equal(await a.menu(m1.id, "marker"), null);
  a.$("#modify-menu")!.click();
  await a.settle();
  a.$("#modify-menu-combine")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a, (p) => p[0] === 0) }); // the bar's end at x 0
  await a.pick({ face: faceWhere(a, (p) => p[2] === 20) }); // Box 2's top at z 20
  const select = a.$("#combine-operation") as unknown as HTMLSelectElement;
  select.value = "cut";
  select.dispatchEvent(new a.window.Event("change") as never);
  await a.settle();
  (a.$("#combine-ok") as HTMLButtonElement).click();
  await a.settle();
  const ask = a.$("#cut-ask-go") as HTMLButtonElement | null;
  if (ask && ask.closest("dialog")?.hasAttribute("open")) {
    ask.click();
    await a.settle();
  }
  // The marker to the end: two ends 45 × 40 × 10 = 18,000 each, both at z 50..60.
  assert.equal(await a.menu(m2.id, "marker"), null);
  const holds = JSON.stringify(movedBodies(a.doc().timeline.features.find((f) => f.id === m2.id)!));
  const got = JSON.stringify(meshBounds(a.mesh()));
  const vol = a.volume();
  const bad = [...(await liveAgainstFile(a, "marker at the end")), ...(await undoRedoSame(a, "marker at the end"))];
  assert.ok(await a.close());
  assert.deepEqual(bad, []);
  assert.ok(close(vol, 36000), `two ends of 18,000: ${vol}`);
  assert.equal(got, JSON.stringify([[0, 0, 50], [100, 40, 60]]), `both ends lifted to z 50..60 (Move 2 holds ${holds})`);
});
