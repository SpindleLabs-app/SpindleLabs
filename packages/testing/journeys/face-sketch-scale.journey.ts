// A sketch on a face of a scaled body, then the Scale's factor edited (SL
// #539 item 2, the owner's rule of 2026-11-11): the sketch keeps its sizes
// (a 6 mm circle stays 6 mm, typed dimensions never change), but its
// position scales with the body: the middle of the box around its points
// goes where the point of the body under it goes, so a peg in the middle of
// the top stays in the middle and one near an edge stays near that edge.
// Before the fix only the sketch's origin (where the world's origin meets
// the face, carried as the body's own origin corner) followed the scale, so
// a peg in the middle of a box's top slid off the box. Driven through the
// real Design workspace on the real kernel (journeys/design-app.ts); each
// result read from a fresh open of the saved design.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson, type DisplayMesh } from "@fission/core";
import { BodyCache, bodyReference, designWorkspace, insertMove, moveMarker, NO_MOVE, partDocument, rebuildTimeline, type DesignDocument } from "@fission/design";
import { app, kernel } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const r3 = (x: number) => Math.round(x * 1e3) / 1e3 + 0;

/** Every body's bounds after a save and a fresh open of the design, rebuilt on a cache of its own. */
async function bounds(doc: DesignDocument): Promise<Record<string, number[][]>> {
  const opened = projectFromJson(projectToJson({ ...emptyProject("Scale"), workspaces: { design: doc } }), [designWorkspace]).workspaces.design as DesignDocument;
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(opened, cache, kernel);
    const out: Record<string, number[][]> = {};
    for (const [id, b] of Object.entries(build.bodies)) out[id] = ((await cache.view(b.handle)).bounds as unknown as number[][]).map((p) => p.map(r3));
    return out;
  } finally {
    await cache.close();
  }
}

const type = (a: App, sel: string, value: string) => {
  const el = a.$(sel) as HTMLInputElement;
  assert.ok(el, `no ${sel}`);
  el.value = value;
  el.dispatchEvent(new a.window.Event("input") as unknown as Event);
};
const click = async (a: App, sel: string) => {
  const el = a.$(sel) as HTMLElement;
  assert.ok(el, `no ${sel}`);
  el.click();
  await a.settle();
};

/** The one face of the mesh all of whose triangles pass `on`, by joined index. */
function faceWhere(mesh: DisplayMesh, on: (p: number[]) => boolean): number {
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const ok = [0, 1, 2].every((k) => {
      const i = mesh.indices[3 * t + k];
      return on([mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]);
    });
    all.set(f, (all.get(f) ?? true) && ok);
  });
  const found = [...all].filter(([, ok]) => ok).map(([f]) => f);
  assert.equal(found.length, 1, `one face, got ${found}`);
  return found[0];
}

/**
 * Box 1, 40 × 30 × 20 at 0..40, 0..30, 0..20, scaled by 2 about its centre
 * (20, 15, 10): −20..60, −15..45, −10..30. A circle of radius `r` at
 * (`x`, `y`) on its top (z = 30), extruded 5 up into a new body, the peg.
 */
async function pegOnScaledBox(x: number, y: number, r: number) {
  const a = await app(partDocument("box", 40, 30, 20));
  a.selection.set([bodyReference("body:feature-1")]);
  await click(a, "#modify-menu");
  await click(a, "#modify-menu-scale");
  type(a, "#move-scale", "2");
  await click(a, "#move-ok");
  await click(a, "#create-sketch");
  await a.pick({ face: faceWhere(a.mesh()!, (p) => p[2] === 30) });
  await a.key("sketch-circle");
  await a.click(x, y);
  await a.click(x + r, y);
  await a.finish();
  await click(a, "#create-menu");
  await click(a, a.$("#create-menu-extrude") ? "#create-menu-extrude" : "#extrude");
  type(a, "#extrude-distance", "5");
  await a.settle();
  await click(a, "#extrude-ok");
  const peg = `body:${a.doc().timeline.features.at(-1)!.id}`;
  const scale = a.doc().timeline.features[1].id;
  const edit = async (factor: string) => {
    await a.doubleClick(scale);
    type(a, "#move-scale", factor);
    await click(a, "#move-ok");
    const all = await bounds(a.doc());
    return { box: all["body:feature-1"], peg: all[peg] };
  };
  return { a, peg, edit };
}

test("a peg in the middle of a scaled box's top stays in the middle, its size kept, when the Scale's factor is edited (#539 item 2)", async () => {
  const { a, edit } = await pegOnScaledBox(20, 15, 3);
  try {
    // Scale 1 edited to 0.5: about (20, 15, 10) the box is 20 ± 10, 15 ± 7.5, 10 ± 5 = 10..30, 7.5..22.5, 5..15.
    // The peg's circle (the middle of its points' box is its centre, (20, 15) on the top) goes where the point of the body under it
    // goes: (20, 15, 30) is (0, 0, 20) from the centre, so 0.5 / 2 = 0.25 of that, (20, 15, 15): still the middle of the top (z = 15).
    // Its size is kept: radius 3, so x 17..23, y 12..18, and 5 up, z 15..20. (Before the fix: x 47..53, y 34.5..40.5, off the box.)
    const half = await edit("0.5");
    assert.deepEqual(half.box, [[10, 7.5, 5], [30, 22.5, 15]]);
    assert.deepEqual(half.peg, [[17, 12, 15], [23, 18, 20]], `peg at ${JSON.stringify(half.peg)}`);
    // Factor 3: the box is 20 ± 60, 15 ± 45, 10 ± 30 = −40..80, −30..60, −20..40; the centre (20, 15) of the top is still on the scale's
    // centre line, so the peg stays at x 17..23, y 12..18, now on z = 40: 40..45. (Before the fix: x −3..3, y −3..3.)
    const three = await edit("3");
    assert.deepEqual(three.box, [[-40, -30, -20], [80, 60, 40]]);
    assert.deepEqual(three.peg, [[17, 12, 40], [23, 18, 45]], `peg at ${JSON.stringify(three.peg)}`);
    // Back to 2: exactly where it was drawn.
    assert.deepEqual((await edit("2")).peg, [[17, 12, 30], [23, 18, 35]]);
  } finally {
    await a.close();
  }
});

test("a peg near an edge of a scaled box's top stays near that edge when the Scale's factor is edited (#539 item 2)", async () => {
  // Radius 2 at (50, 35) on the top (x −20..60, y −15..45, middle (20, 15)): 10 from the edge x = 60 and 10 from y = 45, so
  // (60 − 50) / (60 − 20) = 1/4 of the half-width in from the one and (45 − 35) / (45 − 15) = 1/3 of the half-depth in from the other.
  const { a, edit } = await pegOnScaledBox(50, 35, 2);
  try {
    // Factor 0.5 (0.25 of the size drawn on): the centre goes to (20, 15) + 0.25 (30, 20) = (27.5, 20), on the top 10..30, 7.5..22.5:
    // 2.5 from x = 30 (1/4 of the half-width 10) and 2.5 from y = 22.5 (1/3 of 7.5), the same fractions in from the same edges.
    // Its radius stays 2: x 25.5..29.5, y 18..22, z 15..20. (Before the fix: centre (57.5, 42.5), off the box.)
    assert.deepEqual((await edit("0.5")).peg, [[25.5, 18, 15], [29.5, 22, 20]]);
  } finally {
    await a.close();
  }
});

test("a Scale put in before a sketch already on the box's top carries the sketch's middle with the body, and a sketch from before the rule keeps the old one (#539 item 2)", async () => {
  // Box 1, 40 x 30 x 20 never scaled; a circle of radius 2 at (30, 20) on its top (z = 20), extruded 5: a peg x 28..32, y 18..22, z 20..25.
  const a = await app(partDocument("box", 40, 30, 20));
  try {
    await click(a, "#create-sketch");
    await a.pick({ face: faceWhere(a.mesh()!, (p) => p[2] === 20) });
    await a.key("sketch-circle");
    await a.click(30, 20);
    await a.click(32, 20);
    await a.finish();
    await click(a, "#create-menu");
    await click(a, a.$("#create-menu-extrude") ? "#create-menu-extrude" : "#extrude");
    type(a, "#extrude-distance", "5");
    await a.settle();
    await click(a, "#extrude-ok");
    const peg = `body:${a.doc().timeline.features.at(-1)!.id}`;
    assert.deepEqual((await bounds(a.doc()))[peg], [[28, 18, 20], [32, 22, 25]]);
    // The sketch recorded the body's size when drawn: 1, never scaled.
    const sketch = a.doc().sketches.find((s) => s.face !== undefined)!;
    assert.equal(sketch.face!.body!.size, 1);
    // A Scale by 2 about the box's centre (20, 15, 10) put in at the marker after Box 1: the box is −20..60, −15..45, −10..30.
    const scaled = moveMarker(insertMove(moveMarker(a.doc(), "feature-1"), ["body:feature-1"], { ...NO_MOVE, scale: 2, pivotX: 20, pivotY: 15, pivotZ: 10 }, "scale").doc, null);
    const now = await bounds(scaled);
    assert.deepEqual(now["body:feature-1"], [[-20, -15, -10], [60, 45, 30]]);
    // The circle's centre (30, 20, 20) is (10, 5, 10) from the scale's centre, so the body's point there goes to (20, 15, 10) + 2 (10, 5, 10)
    // = (40, 25, 30): on the new top (z = 30), as far in from the edges x = 60, y = 45 as a fraction of the half-sizes as before
    // ((40 − 30) / 20 = (60 − 40) / 40 = 1/2; (30 − 20) / 15 = (45 − 25) / 30 = 2/3). Radius kept: x 38..42, y 23..27, z 30..35.
    assert.deepEqual(now[peg], [[38, 23, 30], [42, 27, 35]]);
    // The same file as a SpindleLabs from before the rule wrote it (no size in the sketch's body frame): carried as then, its offset
    // from the body's own origin corner kept in mm. That corner (0, 0, 0) goes to (20, 15, 10) + 2 (−20, −15, −10) = (−20, −15, −10), and
    // the circle stays (30, 20) from it: centre (10, 5) on z = 30, x 8..12, y 3..7, z 30..35. Opening an old file moves nothing it had.
    const old = structuredClone(scaled);
    delete old.sketches.find((s) => s.face !== undefined)!.face!.body!.size;
    assert.deepEqual((await bounds(old))[peg], [[8, 3, 30], [12, 7, 35]]);
  } finally {
    await a.close();
  }
});
