// The Bodies rows and the exported STL after an Extrude Join are the
// bodies really built (SL #538 item 2), on the real kernel: in the running
// Design workspace (happy-dom) a Move edited through its panel takes the
// second cube out of the Join's reach, and both bodies keep a row; a design
// whose first-picked cube is no longer the earliest made shows the joined
// body's own row, and a click on it selects that body. Then the Export STL
// verb itself, on the list the workspace hands it: the file's volume, read
// back from its triangles, against the bodies drawn, worked by hand. Until
// the list followed the rebuild, the second cube had no row and was left
// out of a file that still said "Checked solid", and the reordered design
// could not be exported at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry, emptyProject, RepresentationRegistry, type WorkspaceContext } from "@fission/core";
import { addSketch, BodyCache, builtPieceFaces, designWorkspace, DOWNLOAD_STL, drawRectangle, extrudeSketch, insertMove, insertPreset, numberPieces, partDocument, rebuildTimeline, registerDesignActions, reorderItem, shownBodyRefs, type DesignDocument } from "@fission/design";
import { failedIds } from "../../../workspaces/design/src/browser.ts";
import { app, close, kernel } from "./design-app.ts";

const NO = { x: 0, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 };

/** Cubes of 10: Box 1 at the origin, Box 2 moved to x = `bx` (Move 1); the rectangle x 6..14, y 2..6 extruded 20 up, Operation Join, Box 1 then Box 2. */
function joined(bx: number) {
  const doc = partDocument("box", 10, 10, 10);
  const box1 = doc.timeline.features[0].id;
  const box2 = insertPreset(doc, "box", 10, 10, 10);
  const move = insertMove(box2.doc, [`body:${box2.id}`], { ...NO, x: bx });
  const s = addSketch(move.doc);
  const e = extrudeSketch(drawRectangle(s.doc, s.id, [6, 2], [14, 6]).doc, s.id, 20, false, undefined, { operation: "join", bodies: [`body:${box1}`, `body:${box2.id}`] });
  return { doc: e.doc, box1, move: move.id };
}

/** `doc` with Box 1 dragged to after Move 1, so Box 2 is made first. */
function box2First(doc: DesignDocument, box1: string): DesignDocument {
  const r = reorderItem(doc, box1, 2);
  assert.ok("doc" in r, JSON.stringify(r));
  return r.doc;
}

type App = Awaited<ReturnType<typeof app>>;
const rows = (a: App) => [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].map((r) => r.dataset.node ?? "").filter((n) => /^body-\d+$/.test(n));

test("hand-worked, in the app: Move 1 edited so the Join no longer reaches Box 2: both bodies drawn have a Bodies row", async () => {
  const j = joined(10);
  const a = await app(j.doc);
  // Touching: one body, 1,000 + 1,000 + the bar above the cubes, 8 × 4 × 10 = 320: 2,320, Body 1.
  assert.ok(close(a.volume(), 2320), `joined, the view holds ${a.volume()} mm³`);
  assert.deepEqual(rows(a), ["body-1"]);
  await a.doubleClick(j.move);
  const x = a.$("#move-x") as HTMLInputElement;
  x.value = "50";
  x.dispatchEvent(new a.window.Event("input") as unknown as Event);
  await a.settle();
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  // Box 2 at x 50..60: Box 1 with the bar is 1,000 + 160 beside it (x 10..14) + 320 above = 1,480, Box 2 1,000: 2,480.
  assert.ok(close(a.volume(), 2480), `after the edit the view holds ${a.volume()} mm³`);
  assert.deepEqual(rows(a), ["body-1", "body-2"], "a row for each body drawn");
  // Box 2's row selects Box 2: the panel says Body 2 and its 1,000 mm³.
  const row = [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].find((r) => r.dataset.node === "body-2")!;
  row.click();
  await a.settle();
  assert.equal(a.$("#body-heading")!.textContent, "Body 2");
  assert.match(a.$("#volume")!.textContent ?? "", /^1[,  ]?000(\D|$)/);
  // Undo: Box 2 back at x 10..20 and joined in: one body, one row.
  await a.undo();
  assert.ok(close(a.volume(), 2320), `after Undo the view holds ${a.volume()} mm³`);
  assert.deepEqual(rows(a), ["body-1"]);
});

test("hand-worked, in the app: Box 2 made first, the Join still listing Box 1 first: the one row is the joined body's, and selects it", async () => {
  const j = joined(10);
  const a = await app(box2First(j.doc, j.box1));
  // The same one body of 2,320; it keeps the earliest made cube's id, now Box 2's, whose number is 2.
  assert.ok(close(a.volume(), 2320), `the view holds ${a.volume()} mm³`);
  assert.deepEqual(rows(a), ["body-2"]);
  const row = [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].find((r) => r.dataset.node === "body-2")!;
  row.click();
  await a.settle();
  assert.equal(a.$("#body-heading")!.textContent, "Body 2");
  assert.match(a.$("#volume")!.textContent ?? "", /^2[,  ]?320(\D|$)/);
});

/** The volume inside a binary STL's triangles: Σ a · (b × c) / 6. */
function stlVolume(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let six = 0;
  for (let t = 0; t < v.getUint32(80, true); t++) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => v.getFloat32(84 + 50 * t + 12 + 4 * k, true));
    six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return six / 6;
}

/** Export STL for the whole design as the workspace runs it: the bodies shown (`shownBodyRefs` on what the rebuild said) through the registered verb; the file's volume and the volume built. */
async function exported(doc0: DesignDocument) {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc0, cache, kernel);
  const doc = numberPieces(doc0, Object.keys(build.bodies), builtPieceFaces(build));
  const said = failedIds(doc, build.results, new Set(Object.keys(build.bodies)));
  let builtVolume = 0;
  for (const b of Object.values(build.bodies)) builtVolume += (await cache.view(b.handle)).volume;
  await cache.close();
  const saved: Uint8Array[] = [];
  const actions = new ActionRegistry();
  registerDesignActions(actions, (bytes) => void saved.push(bytes), async () => {});
  const representations = new RepresentationRegistry();
  designWorkspace.registerRepresentations!(representations, kernel);
  const project = emptyProject("join");
  project.workspaces.design = doc;
  // Design's own run hands the verb what the last rebuild said (actions.ts `DesignRun.failed`), as workspace.ts does.
  const ctx = { project, kernel, representations, viewport: { setOverlay() {}, clearOverlay() {} }, failed: said } as unknown as WorkspaceContext;
  const targets = shownBodyRefs(doc, said);
  const outcome = await actions.get(DOWNLOAD_STL)!.run(targets, ctx);
  assert.equal(saved.length, 1, `one file saved: ${JSON.stringify(outcome)}`);
  return { builtVolume, bodies: targets.length, stl: stlVolume(saved[0]) };
}

test("hand-worked: Export STL holds every body built: both after the Join stops reaching Box 2, the joined one when Box 2 is made first", async () => {
  // Box 2 at x 50..60, out of reach: 1,480 + 1,000 = 2,480 mm³ in two bodies (the file's corners are 32-bit, so to half a mm³).
  const apart = await exported(joined(50).doc);
  assert.ok(close(apart.builtVolume, 2480), `${apart.builtVolume}`);
  assert.equal(apart.bodies, 2);
  assert.ok(Math.abs(apart.stl - 2480) < 0.5, `the STL holds ${apart.stl} mm³, the design 2,480`);
  // Touching, Box 2 made first: the one joined body, 2,320 mm³.
  const j = joined(10);
  const swapped = await exported(box2First(j.doc, j.box1));
  assert.ok(close(swapped.builtVolume, 2320), `${swapped.builtVolume}`);
  assert.equal(swapped.bodies, 1);
  assert.ok(Math.abs(swapped.stl - 2320) < 0.5, `the STL holds ${swapped.stl} mm³, the design 2,320`);
  // The control, unchanged by the fix: touching, Box 1 made first: 2,320 in one body.
  const control = await exported(j.doc);
  assert.equal(control.bodies, 1);
  assert.ok(Math.abs(control.stl - 2320) < 0.5, `the STL holds ${control.stl} mm³, the design 2,320`);
});
