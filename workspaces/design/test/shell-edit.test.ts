// Step 35h2c-app2: Edit feature on a Shell (shell.ts `changedShell`,
// `editableShell`), its timeline card and bar icon, the open-tool words, and
// the live preview before OK (shell-preview.ts), on the real kernel. Every
// volume is worked out by hand beside it: walls t thick inside the 10 mm
// cube with its top open keep 1000 − (10 − 2t)² (10 − t) mm³; sealed,
// 1000 − (10 − 2t)³.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changedShell, EDIT_FACES_NOTE, editableShell, insertShell } from "../src/shell.ts";
import { drawnShell, editPreviewInput, FAILED_NO_PREVIEW, LATER_CHANGES, previewShell, previewVolume, shellPickAt } from "../src/shell-preview.ts";
import { heldFaceNames } from "../src/shell-tool.ts";
import { partDocument, readDesignDocument, shellOf, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { openTool, openToolRefusal } from "../src/open-tool.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { joinBodies, shownBodies } from "../src/scene.ts";
import { cardFacts, ownBodies } from "../src/timeline-card.ts";
import { editOff, itemMenu, timelineBarItems } from "../src/timeline-bar.ts";
import { insertPreset } from "../src/document.ts";

const kernel = nodeKernel();
const BODY = "body:feature-1";
const near = (got: number, want: number, what = "") => assert.ok(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${what} ${got}, expected ${want}`);
const up = (n: readonly number[] | null | undefined) => n != null && n[2] > 0.999999;

/** The cube's top face: its kernel index and its held name. */
async function cubeTop(doc: DesignDocument): Promise<{ index: number; name: string }> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const view = await cache.view(build.bodies[BODY].handle);
    const index = view.face_normals.findIndex(up);
    const [name] = await heldFaceNames(build.bodies, (b) => cache.view(b.handle), BODY, [index]);
    return { index, name: name! };
  } finally {
    await cache.clear();
  }
}

test("hand-worked: Edit feature changes only the thickness; the same document when unchanged; refused in words", async () => {
  const cube = partDocument("box", 10, 10, 10);
  const top = await cubeTop(cube);
  const { doc, id } = insertShell(cube, BODY, [top.name], 1);
  assert.deepEqual(editableShell(doc, id), { id, name: "Shell 1", open: 1, thickness: 1 });
  assert.equal(changedShell(doc, id, 1), doc, "nothing changed, nothing recorded");
  const next = changedShell(doc, id, 2);
  const f = next.timeline.features.find((x) => x.id === id)!;
  assert.deepEqual(shellOf(f), { body: BODY, faces: [top.name], thickness: 2 });
  assert.equal(f.intent.summary, "Shell Box 1, 2 mm walls, 1 face open");
  // Saved and opened again as it is.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(next))), next);
  // Built: 1000 − 6 · 6 · 8 = 712 mm³.
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(next, cache, kernel);
    near((await cache.view(build.bodies[BODY].handle)).volume, 712, "2 mm walls");
  } finally {
    await cache.clear();
  }
  assert.throws(() => changedShell(doc, id, 0.0009), /The shell can't be made: its wall thickness 0\.0009 is not from 0\.001 to 1000000 mm/);
  assert.throws(() => changedShell(doc, "feature-1", 2), /feature-1 is not a Shell in the timeline/);
  assert.throws(() => editableShell(doc, "feature-1"), /feature-1 is not a Shell in the timeline/);
  assert.match(EDIT_FACES_NOTE, /open faces stay/);
});

test("the bar, the card and the open-tool words for a Shell", async () => {
  const { doc, id } = insertShell(partDocument("box", 10, 10, 10), BODY, [], 1.5);
  const f = doc.timeline.features.find((x) => x.id === id)!;
  assert.equal(editOff(f), null);
  assert.equal(itemMenu(doc, id)[0].off, null);
  const { items } = timelineBarItems(doc);
  assert.equal(items[1].icon, "shell");
  assert.deepEqual(cardFacts(doc, f, items[1], 1), { name: "Shell 1", number: 2, kind: "Shell", details: ["Box 1, 1.5 mm walls, sealed"], status: null });
  // Its own bodies: the one it hollows and any piece it made, never another.
  const scene = { bodies: [{ body: "body:feature-9", feature: "feature-9" }, { body: BODY, feature: "feature-1" }, { body: `body:${id}/piece:1`, feature: id }] } as unknown as Parameters<typeof ownBodies>[0];
  assert.deepEqual([...ownBodies(scene, f)], [1, 2]);
  const open = (editing: string | null) => openTool({ move: null, extrude: false, edit: null, combine: null, shell: { editing }, sketch: null }, () => "Shell 1");
  assert.equal(openToolRefusal(open(null), "Export STL"), "Shell is still open: press OK or Cancel first, then Export STL.");
  assert.equal(openToolRefusal(open(id), "Export STL"), "Edit Shell 1 is still open: press OK or Cancel first, then Export STL.");
});

test("hand-worked on the real kernel: the preview's volume, freed after; a refusal is the kernel's words", async () => {
  const cube = partDocument("box", 10, 10, 10);
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(cube, cache, kernel);
    const handle = build.bodies[BODY].handle;
    const top = (await cache.view(handle)).face_normals.findIndex(up);
    const start = await kernel.call("body_count");
    // Top open, 1 mm: 1000 − 8 · 8 · 9 = 424; sealed 1 mm: 1000 − 8³ = 488.
    near(previewVolume(await previewShell(kernel, handle, [top], 1)), 424, "top open");
    near(previewVolume(await previewShell(kernel, handle, [], 1)), 488, "sealed");
    assert.equal(await kernel.call("body_count"), start, "the preview's bodies were freed");
    // Walls of 5 mm meet in the middle of a 10 mm cube: refused, nothing kept.
    await assert.rejects(previewShell(kernel, handle, [top], 5));
    assert.equal(await kernel.call("body_count"), start);
  } finally {
    await cache.clear();
  }
});

test("hand-worked: a click on the preview reads back to the body's face it was kept from, an inside wall opens nothing, other bodies keep their faces", async () => {
  // Box 1 (the 10 mm cube) and Box 2 (a 10 mm cube moved 30 along x, made after): Box 1 previewed top open.
  let doc = partDocument("box", 10, 10, 10);
  const made = insertPreset(doc, "box", 10, 10, 10);
  doc = insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 30 }).doc;
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const scene = joinBodies(await shownBodies(doc, build, cache));
    assert.deepEqual(scene.bodies.map((b) => b.body), [BODY, `body:${made.id}`]);
    const handle = build.bodies[BODY].handle;
    const view = await cache.view(handle);
    const top = view.face_normals.findIndex(up);
    const preview = await previewShell(kernel, handle, [top], 1);
    const d = drawnShell(scene, [BODY], preview);
    // The hollow box: its 6 outside faces (the top left as a rim round the opening, the 8 × 8 mm hole cut from it)
    // and 5 inside walls (4 sides and the floor), then Box 2's 6 faces.
    assert.equal(d.scene.bodies.length, 2);
    assert.equal(d.scene.bodies[0].view.faces, 11);
    assert.equal(d.scene.faceStart[1], 11);
    // Each drawn face of the hollow box: an outside face is the cube's own face with the same outward normal; an inside wall opens nothing.
    let outside = 0;
    let inside = 0;
    let rim = 0;
    for (let f = 0; f < 11; f++) {
      const got = shellPickAt(scene, d, preview, BODY, f);
      if (got === "inside") inside++;
      else {
        assert.ok(got !== null && got.body === 0, `face ${f}`);
        if (got.face === top) rim++; // a click on the rim takes the top out of the open faces again
        assert.deepEqual(view.face_normals[got.face], d.scene.bodies[0].view.face_normals[f], `face ${f} faces as the cube's face ${got.face}`);
        outside++;
      }
    }
    assert.deepEqual([outside, inside, rim], [6, 5, 1]);
    // Box 2's faces keep their own numbers, on scene body 1.
    for (let f = 0; f < 6; f++) assert.deepEqual(shellPickAt(scene, d, preview, BODY, 11 + f), { body: 1, face: f });
    assert.equal(shellPickAt(scene, d, preview, BODY, 17), null, "past every body");
    assert.equal(shellPickAt(scene, d, preview, BODY, -1), null);
    // A scene showing none of the bodies replaced draws as it is.
    assert.equal(drawnShell(scene, ["body:feature-9"], preview).scene, scene);
  } finally {
    await cache.clear();
  }
});

test("an edited Shell's preview input: its held body and open faces while every body it made is as made; else why not", () => {
  const built = { status: "built", holds: [7], shelled: { open: [5], bodies: [11, 12] } };
  assert.deepEqual(editPreviewInput(built, [11, 12]), { handle: 7, open: [5] });
  assert.deepEqual(editPreviewInput(built, [11, 13]), { why: LATER_CHANGES });
  assert.deepEqual(editPreviewInput(built, [11, undefined]), { why: LATER_CHANGES });
  assert.deepEqual(editPreviewInput(built, []), { why: LATER_CHANGES });
  assert.deepEqual(editPreviewInput({ status: "failed" }, [11]), { why: FAILED_NO_PREVIEW });
  assert.equal(editPreviewInput({ status: "greyed" }, [11]), null);
  assert.equal(editPreviewInput(undefined, [11]), null);
});
