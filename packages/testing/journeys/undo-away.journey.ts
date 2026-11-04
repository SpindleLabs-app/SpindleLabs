// Undo bug hunt (2026-11-01): Undo made while Design is not on screen leaves Design's
// "put away by a restore" flag set, so the next mount, on a file opened
// afterwards, is taken for that restore's.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MountedWorkspace, WorkspacePlugin } from "@fission/core";
import { addFaceSketch, addSketch, designWorkspace, drawRectangle, extrudeSketch, facePlane, partDocument, type DesignDocument } from "@fission/design";
import { app } from "./design-app.ts";

test("a file opened after an Undo made in another workspace opens out of any sketch, framed", async () => {
  let away = false;
  // Design, or nothing while "another workspace is shown": the shell's pool forgets Design on Undo and mounts only the shown one.
  const plugin: WorkspacePlugin = {
    ...designWorkspace,
    mount: (ctx) => (away ? ({ unmount() {} } as MountedWorkspace) : designWorkspace.mount(ctx)),
  };
  const a = await app(partDocument("box", 40, 30, 20), plugin);
  // Sketch 1 on XY, drawn into (an undo step), and left open.
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane: "XY" });
  await a.key("sketch-line");
  await a.click(0, 0);
  await a.click(10, 0);
  await a.key("escape");
  assert.ok(a.sketching(), "in the sketch");
  const sketchId = a.doc().sketches[0].id;
  // Another workspace shown, then Undo there: the shell unmounts Design (forgetAll) while restoring, and mounts the other.
  away = true;
  assert.ok(a.history.undo());
  await a.settle();
  // A file opened (another person's, whose first sketch has the same id, as ids come from a counter), Design shown again.
  const made = addSketch(partDocument("cylinder", 10, 10, 50));
  assert.equal(made.id, sketchId, "the opened file's sketch has the same id");
  a.changeDesign(made.doc);
  away = false;
  const fitsBefore = a.window.document.querySelector<HTMLElement>("[data-fits]")?.dataset.fits;
  await a.remount();
  assert.equal(a.sketching(), false, "the opened file is shown out of any sketch, as any opened file is");
  console.log("fits", fitsBefore, a.window.document.querySelector<HTMLElement>("[data-fits]")?.dataset.fits);
  await a.close();
});

async function openAfter(undoAway: boolean) {
  let away = false;
  const plugin: WorkspacePlugin = { ...designWorkspace, mount: (ctx) => (away ? ({ unmount() {} } as MountedWorkspace) : designWorkspace.mount(ctx)) };
  const a = await app(partDocument("box", 40, 30, 20), plugin);
  const width = a.$("#width") as HTMLInputElement;
  width.value = "50";
  width.dispatchEvent(new a.window.Event("input") as unknown as Event);
  await a.settle();
  away = true;
  if (undoAway) a.history.undo();
  else await a.remount(); // shown elsewhere, put away by the shell (no undo)
  await a.settle();
  a.changeDesign(partDocument("cylinder", 10, 10, 50));
  away = false;
  const el = a.window.document.querySelector<HTMLElement>("[data-fits]") ?? null;
  const before = Number(el?.dataset.fits ?? 0);
  await a.remount();
  const after = Number(a.window.document.querySelector<HTMLElement>("[data-fits]")?.dataset.fits ?? 0);
  await a.close();
  return after - before;
}
test("a file opened after an Undo made in another workspace is framed, as one opened after no undo is", async () => {
  const plain = await openAfter(false);
  const afterUndo = await openAfter(true);
  assert.equal(plain, 1, "framed once without the undo");
  assert.equal(afterUndo, plain, "framed the same after an Undo made elsewhere");
});

// App hunt 2026-11-04 (A, zombie bar): Undo pressed while an edit to a design with a sketch on a face was still being
// settled by the kernel. The put-away Design's show() carried on once the kernel answered and redrew the timeline bar and
// browser with its own dead wiring: the bar's clicks then recorded steps the live Design never drew.
/** Box 1 (feature-1, 40 × 30 × 20); Sketch 1 on its top face (z = 20): a 10 × 10 square at (5, 5); Extrude 1 of it by 5. */
function boxWithFaceSketch(): DesignDocument {
  const fs = addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, { plane: { origin: [0, 0, 20], xAxis: [1, 0, 0], normal: [0, 0, 1] }, side: 1 });
  const r = drawRectangle(fs.doc, fs.id, [5, 5], [15, 15]);
  return extrudeSketch(r.doc, fs.id, 5).doc;
}
const turnsNow = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

for (const [slow, wait] of [[true, 1], [false, 0], [false, 1], [false, 2], [false, 4]] as const) {
  test(`regression (app hunt 2026-11-04): Undo while a marker move is settled (${slow ? "slow kernel" : `real speed, Undo ${wait} turns later`}): the bar still drives the live Design`, async () => {
    const a = await app(boxWithFaceSketch());
    // 40·30·20 = 24000 for the box, 10·10·5 = 500 for the extrude on its top.
    assert.ok(Math.abs(a.volume() - 24500) < 1e-6, `start ${a.volume()}`);
    if (slow) a.hold();
    // The marker moved to Box 1 from its menu (rolls back the sketch and its extrude), then Ctrl+Z at once.
    a.$('[data-item="feature-1"]')!.dispatchEvent(new a.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 780 }) as unknown as Event);
    (a.$("#row-menu-marker") as HTMLButtonElement).click();
    await turnsNow(wait);
    assert.equal(a.history.undo(), "Move the rollback marker");
    if (slow) await a.release();
    await a.settle();
    assert.ok(Math.abs(a.volume() - 24500) < 1e-6, `after Undo ${a.volume()}`);
    const failed = [...a.window.document.querySelectorAll<HTMLElement>(".timeline-bar-item[data-failed]")].map((li) => li.dataset.item);
    assert.deepEqual(failed, [], "no item is shown failed: everything builds");
    // Now the playback button Back: the marker goes before Extrude 1, so the view must lose its 500 mm³.
    (a.$('[data-button="back"]') as HTMLButtonElement).click();
    await a.settle();
    assert.equal(a.doc().timeline.marker, a.doc().timeline.features[1].id, "the marker was recorded after Sketch 1");
    assert.ok(Math.abs(a.volume() - 24000) < 1e-6, `the view still shows ${a.volume()} mm³ with Extrude 1 rolled back (24000 expected)`);
    assert.ok(await a.close());
  });
}
