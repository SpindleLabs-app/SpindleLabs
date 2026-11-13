// The old-file corpus (daily bug hunt 3d): 17 projects saved by older
// versions of the app, each made by running that version's own code (its document
// functions, or its Design app through its design-app.ts on its own WASM
// kernel; old-files/make/ has the scripts and the commit each ran at), kept
// as they were saved. Each must open through today's reader, upgraded to
// Design's version 3, and build on the real kernel what it built then (or
// fail for the same reason), with every volume and cap centroid worked out
// by hand below. Then each is saved and opened again (the same document,
// the same text on a second save), opened in the Design app (its drawn
// volume and warning), and edited with today's tools (a new id repeats
// none of the file's). Run with `npm run journeys` after the app build.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { projectFromJson, projectToJson } from "@fission/core";
import { BodyCache, bodyReference, builtBody, designWorkspace, insertPreset, moveMarker, rebuildTimeline, readDesignDocument, type DesignDocument } from "@fission/design";
import { app, chooseShape, kernel } from "./design-app.ts";

const DIR = new URL("../old-files/", import.meta.url);
const PI = Math.PI;

/** What one item builds: a body's exact volume (mm³) and, for an extrude, its start and end caps' centroids; or why it doesn't. */
type Want =
  | { volume: number; caps?: [number[], number[]]; warning?: string }
  | { status: "rolled-back" | "suppressed" }
  | { failed: string }
  | "sketch";

interface OldFile {
  /** The SpindleLabs that saved it: the commit and its step. */
  savedBy: string;
  /** Design's data version as saved. */
  version: 1 | 2 | 3;
  /** Each timeline item after the upgrade, in order: id, type, suppressed. */
  items: [string, string, boolean][];
  /** Each item's name after the upgrade, in order: a ready-made shape's short name, "Box 1" (U0e1), as a design made today names it. */
  names: string[];
  nextId: number;
  marker?: string;
  /** What each item builds on today's kernel. */
  build: Record<string, Want>;
  /** The Design app's warning when the file is opened (null for none). */
  warning: string | null;
}

/**
 * The corpus, with the working. Volumes: a prism is its outline's area ×
 * its distance; a cylinder πr²h; a sphere 4/3 πr³. A cap's centroid is
 * its outline's centroid on the cap's plane.
 */
const CORPUS: Record<string, OldFile> = {
  // Version 1 (steps 19 to 21a): one ready-made part, ids without a counter; the counter starts above "feature-1" and "profile-1", at 2.
  "v1-plate.panosolid.json": {
    savedBy: "63113192, step 19d",
    version: 1,
    items: [["feature-1", "extrude", false]],
    names: ["Plate 1"],
    nextId: 2,
    // Plate 60 × 40 × 5 with two holes of radius 0.15 · min(60, 40) = 6: 5 · (60 · 40 − 2 · 36π) = 12000 − 360π.
    // Symmetric about its middle (30, 20): the holes sit at x = 15 and 45, both on y = 20.
    build: { "feature-1": { volume: 12000 - 360 * PI, caps: [[30, 20, 0], [30, 20, 5]] } },
    warning: null,
  },
  "v1-slot.panosolid.json": {
    savedBy: "63113192, step 19d",
    version: 1,
    items: [["feature-1", "extrude", false]],
    names: ["Slot 1"],
    nextId: 2,
    // Slot 50 × 20: a 30 × 20 rectangle and two half circles of radius 10, so 600 + 100π; × 10 = 6000 + 1000π. Middle (25, 10).
    build: { "feature-1": { volume: 6000 + 1000 * PI, caps: [[25, 10, 0], [25, 10, 10]] } },
    warning: null,
  },
  "v1-star.panosolid.json": {
    savedBy: "63113192, step 19d",
    version: 1,
    items: [["feature-1", "extrude", false]],
    names: ["Star 1"],
    nextId: 2,
    // Star in 40 × 40: R = 20, inner corners at 0.4R = 8, ten triangles from the middle, each ½ · 20 · 8 · sin 36°:
    // area 800 sin 36°, × 10 = 8000 sin 36°. Symmetric under a fifth of a turn about (20, 20), so its centroid is there.
    build: { "feature-1": { volume: 8000 * Math.sin(PI / 5), caps: [[20, 20, 0], [20, 20, 10]] } },
    warning: null,
  },
  "v1-sphere.panosolid.json": {
    savedBy: "63113192, step 19d",
    version: 1,
    items: [["feature-1", "sphere", false]],
    names: ["Sphere 1"],
    nextId: 2,
    // ⌀30: 4/3 · π · 15³ = 4500π.
    build: { "feature-1": { volume: 4500 * PI } },
    warning: null,
  },
  // Version 2 (steps 21b to 24c): sketches and a counter; one part, the last solid (an extrude replaced the part before it).
  "v2-wedge-xz.panosolid.json": {
    savedBy: "5f7a1d32, step 21d",
    version: 2,
    items: [["sketch-2", "sketch", false], ["feature-11", "extrude", false]],
    names: ["Sketch 1", "Extrude 1"],
    nextId: 12,
    // A right triangle (0,0), (30,0), (0,40) on XZ (a stray line drawn and deleted, a corner dragged from x = 25), extruded 10 then
    // edited to 12: ½ · 30 · 40 · 12 = 7200. Its centroid (10, 40/3) in the sketch is X = 10, Z = 40/3 in the world;
    // XZ's normal is X × Z = −Y, so the end cap is at y = −12.
    build: { "sketch-2": "sketch", "feature-11": { volume: 7200, caps: [[10, 0, 40 / 3], [10, -12, 40 / 3]] } },
    warning: null,
  },
  "v2-plate-hole.panosolid.json": {
    savedBy: "9de34d8a, step 22b",
    version: 2,
    items: [["sketch-2", "sketch", false], ["feature-13", "extrude", false]],
    names: ["Sketch 1", "Extrude 1"],
    nextId: 14,
    // A 60 × 40 rectangle with a circle inside: two loops, which a sketch can't make one outline of yet. That SpindleLabs refused it
    // in the same words (checked at 9de34d8a on its own kernel), so the file opens and the extrude fails, naming why.
    build: { "sketch-2": "sketch", "feature-13": { failed: "open-outline" } },
    warning: null,
  },
  "v2-two-sketches.panosolid.json": {
    savedBy: "9de34d8a, step 22b",
    version: 2,
    items: [["sketch-2", "sketch", false], ["sketch-14", "sketch", false], ["feature-17", "extrude", false]],
    names: ["Sketch 1", "Sketch 2", "Extrude 1"],
    nextId: 18,
    // The second sketch's circle r 5 round (0, 50) on YZ (sketch x = Y, y = Z, normal Y × Z = +X), extruded 20: 25π · 20 = 500π,
    // caps round (0, 0, 50) and (20, 0, 50). That SpindleLabs only extruded XY sketches; today's builds this one.
    build: { "sketch-2": "sketch", "sketch-14": "sketch", "feature-17": { volume: 500 * PI, caps: [[0, 0, 50], [20, 0, 50]] } },
    warning: null,
  },
  "v2-arc-slot.panosolid.json": {
    savedBy: "087917ce, step 23a",
    version: 2,
    items: [["sketch-2", "sketch", false], ["feature-13", "extrude", false]],
    names: ["Sketch 1", "Extrude 1"],
    nextId: 14,
    // Lines (0,0)–(30,0) and (30,20)–(0,20), half circles counter-clockwise round (30, 10) and (0, 10), bulging out to x = 40 and −10:
    // 30 · 20 + π · 10² = 600 + 100π; × 5 = 3000 + 500π. Symmetric about (15, 10).
    build: { "sketch-2": "sketch", "feature-13": { volume: 3000 + 500 * PI, caps: [[15, 10, 0], [15, 10, 5]] } },
    warning: null,
  },
  "v2-sketch-then-cylinder.panosolid.json": {
    savedBy: "087917ce, step 23a",
    version: 2,
    items: [["sketch-2", "sketch", false], ["feature-14", "cylinder", false]],
    names: ["Sketch 1", "Cylinder 1"],
    nextId: 15,
    // The slot above, then the part changed to a cylinder ⌀20 × 30 (it replaced the extrude): π · 10² · 30 = 3000π; the sketch stays.
    build: { "sketch-2": "sketch", "feature-14": { volume: 3000 * PI } },
    warning: null,
  },
  // Version 3 (24d1 on): every solid is a body.
  "v3-three-bodies.panosolid.json": {
    savedBy: "453785dd, step 24d1",
    version: 3,
    items: [["feature-1", "box", false], ["feature-2", "cylinder", false], ["sketch-3", "sketch", false], ["feature-12", "extrude", false]],
    names: ["Box 1", "Cylinder 1", "Sketch 1", "Extrude 1"],
    nextId: 13,
    // Box made 50 × 30 × 20 = 30000; cylinder ⌀20 × 30 = 3000π; a 10 × 10 square at x 100 to 110, z 0 to 10 on XZ, extruded 10
    // towards −Y: 1000, caps round (105, 0, 5) and (105, −10, 5).
    build: { "feature-1": { volume: 30000 }, "feature-2": { volume: 3000 * PI }, "sketch-3": "sketch", "feature-12": { volume: 1000, caps: [[105, 0, 5], [105, -10, 5]] } },
    warning: null,
  },
  "v3-suppressed-marker.panosolid.json": {
    savedBy: "498923df, step 24e",
    version: 3,
    items: [["feature-1", "box", false], ["feature-2", "cylinder", true], ["feature-3", "sphere", false], ["sketch-4", "sketch", false], ["feature-7", "extrude", false]],
    names: ["Box 1", "Cylinder 1", "Sphere 1", "Sketch 1", "Extrude 1"],
    nextId: 8,
    marker: "feature-3",
    // Box 40 · 30 · 20 = 24000; the cylinder suppressed; sphere ⌀30 = 4500π; the disc after the marker isn't built.
    build: { "feature-1": { volume: 24000 }, "feature-2": { status: "suppressed" }, "feature-3": { volume: 4500 * PI }, "sketch-4": { status: "rolled-back" }, "feature-7": { status: "rolled-back" } },
    warning: null,
  },
  "v3-marker-start.panosolid.json": {
    savedBy: "498923df, step 24e",
    version: 3,
    items: [["feature-1", "box", false], ["feature-2", "cylinder", true], ["feature-3", "sphere", false], ["sketch-4", "sketch", false], ["feature-7", "extrude", false]],
    names: ["Box 1", "Cylinder 1", "Sphere 1", "Sketch 1", "Extrude 1"],
    nextId: 8,
    marker: "start",
    // The same design rolled back to the start: nothing built.
    build: { "feature-1": { status: "rolled-back" }, "feature-2": { status: "rolled-back" }, "feature-3": { status: "rolled-back" }, "sketch-4": { status: "rolled-back" }, "feature-7": { status: "rolled-back" } },
    warning: null,
  },
  "v3-kept-shape.panosolid.json": {
    savedBy: "b356a35a, step 25 (its own kernel)",
    version: 3,
    items: [["feature-1", "box", false], ["feature-15", "extrude", false]],
    names: ["Box 1", "Extrude 1"],
    nextId: 16,
    // The L (50,0) (80,0) (80,10) (60,10) (60,30) (50,30), its sketch deleted, so the extrude keeps it: a 30 × 10 bar (centroid (65, 5))
    // and a 10 × 20 upright (centroid (55, 20)): area 300 + 200 = 500, × 6 = 3000; centroid ((300 · 65 + 200 · 55) / 500,
    // (300 · 5 + 200 · 20) / 500) = (61, 11). The box 24000.
    build: { "feature-1": { volume: 24000 }, "feature-15": { volume: 3000, caps: [[61, 11, 0], [61, 11, 6]], warning: "deleted-input" } },
    warning: "Extrude 1 keeps its last shape. Sketch 1 was deleted.",
  },
  "v3-face-flip.panosolid.json": {
    savedBy: "acc1385f, step 26e (its Design app and kernel)",
    version: 3,
    items: [["feature-1", "box", false], ["sketch-2", "sketch", false], ["feature-5", "extrude", false]],
    names: ["Box 1", "Sketch 1", "Extrude 1"],
    nextId: 6,
    // Box 24000. A circle r 5 round the top face's middle (20, 15) at z = 20, extruded 8 with Flip: down into the box, so the start cap
    // at z = 20 and the end at z = 12: 25π · 8 = 200π (the bodies overlap: no booleans yet).
    build: { "feature-1": { volume: 24000 }, "sketch-2": "sketch", "feature-5": { volume: 200 * PI, caps: [[20, 15, 20], [20, 15, 12]] } },
    warning: null,
  },
  "v3-face-pin.panosolid.json": {
    savedBy: "ddbb27ca, step 26f (its Design app and kernel)",
    version: 3,
    items: [["feature-1", "box", false], ["sketch-2", "sketch", false], ["feature-5", "extrude", false]],
    names: ["Box 1", "Sketch 1", "Extrude 1"],
    nextId: 6,
    // A circle r 5 on the box's top, pinned to its back right corner, extruded 10, then the box made 60 wide: the corner is at
    // (60, 30, 20). Box 60 · 30 · 20 = 36000; cylinder 25π · 10 = 250π from z 20 to 30.
    build: { "feature-1": { volume: 36000 }, "sketch-2": "sketch", "feature-5": { volume: 250 * PI, caps: [[60, 30, 20], [60, 30, 30]] } },
    warning: null,
  },
  "v3-body-pin.panosolid.json": {
    savedBy: "998ebb8c, step 27c (its Design app and kernel)",
    version: 3,
    items: [["feature-1", "box", false], ["sketch-2", "sketch", false], ["feature-5", "extrude", false]],
    names: ["Box 1", "Sketch 1", "Extrude 1"],
    nextId: 6,
    // A circle r 2 on the ground plane pinned to the box's bottom back right corner, extruded 5, the box made 60 wide: centre (60, 30).
    // Box 36000; cylinder 4π · 5 = 20π.
    build: { "feature-1": { volume: 36000 }, "sketch-2": "sketch", "feature-5": { volume: 20 * PI, caps: [[60, 30, 0], [60, 30, 5]] } },
    warning: null,
  },
  "v3-pin-lost.panosolid.json": {
    savedBy: "998ebb8c, step 27c (its Design app and kernel)",
    version: 3,
    items: [["sketch-2", "sketch", false], ["feature-5", "extrude", false]],
    names: ["Sketch 1", "Extrude 1"],
    nextId: 6,
    // The same with the box deleted: the pinned point has lost its edge and stays at (60, 30); the cylinder alone, 20π.
    build: { "sketch-2": "sketch", "feature-5": { volume: 20 * PI, caps: [[60, 30, 0], [60, 30, 5]] } },
    warning: "Sketch 1: a point snapped to an edge has lost that edge, so it stays where it was.",
  },
};

/** Exact answers agree to a billionth of their size (the kernel's volumes and centroids are exact up to rounding). */
const REL = 1e-9;
/** A drawn body is within 1 % of its exact volume: circles are drawn as polygons inside them (a round body a little under, a round hole a little over). */
const DRAWN_REL = 0.01;
const drawnClose = (drawn: number, exact: number) => Math.abs(drawn - exact) <= DRAWN_REL * exact;
const near = (got: number, want: number, rel = REL) => Math.abs(got - want) <= rel * Math.max(1, Math.abs(want));
const nearAll = (got: readonly number[], want: readonly number[]) => got.length === want.length && got.every((g, k) => near(g, want[k]));
const files = () => readdirSync(DIR).filter((f) => f.endsWith(".panosolid.json")).sort();
const text = (file: string) => readFileSync(new URL(file, DIR), "utf8");
const open = (t: string) => projectFromJson(t, [designWorkspace]);

/** What each item builds on today's kernel, in Want's form (exact volumes and cap centroids). */
async function built(doc: DesignDocument): Promise<Record<string, Want>> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const { order, results } = build;
    const out: Record<string, Want> = {};
    for (const id of order) {
      const r = results[id];
      const b = builtBody(build, id);
      if (r.status === "built" && b === undefined) out[id] = "sketch";
      else if (r.status === "built") {
        const view = await cache.view(b!.handle);
        const cap = (role: string) => view.face_centroids[view.face_roles.findIndex((x) => x !== null && "role" in x && x.role === role)];
        const isExtrude = view.face_roles.some((x) => x !== null && "role" in x && x.role === "end");
        out[id] = { volume: view.volume, ...(isExtrude ? { caps: [cap("start"), cap("end")] as [number[], number[]] } : {}), ...(r.warning ? { warning: r.warning.cause } : {}) };
      } else if (r.status === "failed") out[id] = { failed: r.cause };
      else out[id] = { status: r.status as "rolled-back" | "suppressed" };
    }
    return out;
  } finally {
    await cache.clear();
  }
}

/** Whether a build matches the hand-worked one: the same items and outcomes, volumes and cap centroids to 1e-9. */
function buildDiff(got: Record<string, Want>, want: Record<string, Want>): string | null {
  if (JSON.stringify(Object.keys(got)) !== JSON.stringify(Object.keys(want))) return `items ${Object.keys(got)} not ${Object.keys(want)}`;
  for (const [id, w] of Object.entries(want)) {
    const g = got[id];
    if (typeof w === "string" || !("volume" in w)) {
      if (JSON.stringify(g) !== JSON.stringify(w)) return `${id}: ${JSON.stringify(g)} not ${JSON.stringify(w)}`;
      continue;
    }
    if (typeof g === "string" || !("volume" in g)) return `${id}: ${JSON.stringify(g)}, not a body`;
    if (!near(g.volume, w.volume)) return `${id}: volume ${g.volume} not ${w.volume}`;
    if (JSON.stringify(g.warning) !== JSON.stringify(w.warning)) return `${id}: warning ${g.warning} not ${w.warning}`;
    if (!!g.caps !== !!w.caps || (w.caps && !(nearAll(g.caps![0], w.caps[0]) && nearAll(g.caps![1], w.caps[1])))) return `${id}: caps ${JSON.stringify(g.caps)} not ${JSON.stringify(w.caps)}`;
  }
  return null;
}

/** Every id the document holds (profiles, items, sketch points, curves and projections, kept shapes'), each once. */
function allIds(doc: DesignDocument): Set<string> {
  return new Set([
    ...doc.profiles.map((p) => p.id),
    ...doc.timeline.features.map((f) => f.id),
    ...doc.sketches.flatMap((s) => [...s.points.map((p) => p.id), ...s.curves.map((c) => c.id), ...(s.projected ?? []).map((p) => p.id)]),
    ...Object.values(doc.kept ?? {}).flatMap((k) => [...k.points.map((p) => p.id), ...k.curves.map((c) => c.id)]),
  ]);
}

test("the comparers: a volume or centroid 0.9 × REL off passes and 1.1 × off fails, a drawn volume at 0.9 × and 1.1 × DRAWN_REL likewise, and each kind of difference is named", () => {
  const want: Record<string, Want> = { "feature-1": { volume: 24000, caps: [[20, 15, 0], [20, 15, 10]] }, "sketch-2": "sketch", "feature-3": { status: "suppressed" } };
  const with1 = (w: Want): Record<string, Want> => ({ ...want, "feature-1": w });
  // 24000 · (1 ± 0.9e-9) is inside, 24000 · (1 + 1.1e-9) outside; a centroid's x of 20 off by 0.9e-9 and 1.1e-9 of max(1, 20).
  assert.equal(buildDiff(with1({ volume: 24000 * (1 + 0.9 * REL), caps: [[20, 15, 0], [20, 15, 10]] }), want), null);
  assert.equal(buildDiff(with1({ volume: 24000 * (1 - 0.9 * REL), caps: [[20, 15, 0], [20, 15, 10]] }), want), null);
  assert.match(buildDiff(with1({ volume: 24000 * (1 + 1.1 * REL), caps: [[20, 15, 0], [20, 15, 10]] }), want)!, /feature-1: volume/);
  assert.equal(buildDiff(with1({ volume: 24000, caps: [[20 * (1 + 0.9 * REL), 15, 0], [20, 15, 10]] }), want), null);
  assert.match(buildDiff(with1({ volume: 24000, caps: [[20, 15, 0], [20 * (1 + 1.1 * REL), 15, 10]] }), want)!, /feature-1: caps/);
  // A z of 0 is compared to 1e-9 mm (the scale is at least 1).
  assert.equal(buildDiff(with1({ volume: 24000, caps: [[20, 15, 0.9 * REL], [20, 15, 10]] }), want), null);
  assert.match(buildDiff(with1({ volume: 24000, caps: [[20, 15, 1.1 * REL], [20, 15, 10]] }), want)!, /caps/);
  // Every other way a build can differ.
  assert.match(buildDiff(with1({ volume: 24000 }), want)!, /feature-1: caps/, "caps missing");
  assert.match(buildDiff(with1({ volume: 24000, caps: [[20, 15, 0], [20, 15, 10]], warning: "deleted-input" }), want)!, /feature-1: warning/);
  assert.match(buildDiff(with1({ failed: "open-outline" }), want)!, /feature-1: .*not a body/);
  assert.match(buildDiff({ ...want, "feature-3": { status: "rolled-back" } }, want)!, /feature-3/);
  assert.match(buildDiff({ ...want, "sketch-2": { status: "rolled-back" } }, want)!, /sketch-2/);
  assert.match(buildDiff({ "sketch-2": "sketch", "feature-1": want["feature-1"], "feature-3": want["feature-3"] }, want)!, /items/, "another order");
  // Drawn: 1000 exact, so 990.1 and 1009.9 are in (0.9 %), 989 and 1011 out (1.1 %).
  assert.ok(drawnClose(1000 * (1 - 0.9 * DRAWN_REL), 1000) && drawnClose(1000 * (1 + 0.9 * DRAWN_REL), 1000));
  assert.ok(!drawnClose(1000 * (1 - 1.1 * DRAWN_REL), 1000) && !drawnClose(1000 * (1 + 1.1 * DRAWN_REL), 1000));
  assert.ok(drawnClose(0, 0), "nothing built, nothing drawn");
});

test("the corpus and its hand-worked answers list the same files", () => {
  assert.deepEqual(files(), Object.keys(CORPUS).sort());
  assert.equal(files().length, 17);
});

test("every old file is as its SpindleLabs saved it: the outer format 2 and Design's version as recorded", () => {
  for (const file of files()) {
    const raw = JSON.parse(text(file));
    assert.equal(raw.formatVersion, 2, file);
    assert.equal(raw.workspaces.design.version, CORPUS[file].version, file);
  }
});

test("every old file opens through today's reader, upgraded to version 21 with its items, names, flags, marker and counter as worked out", () => {
  for (const file of files()) {
    const want = CORPUS[file];
    const doc = open(text(file)).workspaces.design as DesignDocument;
    assert.equal(doc.version, 21, file);
    // Each solid item's body numbered once, 1 to n, the next n + 1 (35e; which body gets which: workspaces/design/test/body-numbers.test.ts).
    const solids = want.items.filter(([, type]) => type !== "sketch" && type !== "move").length;
    assert.deepEqual(doc.bodies!.map((b) => b.number).sort((x, y) => x - y), Array.from({ length: solids }, (_, i) => i + 1), file);
    assert.equal(doc.nextBody, solids + 1, file);
    assert.deepEqual(doc.timeline.features.map((f) => [f.id, f.intent.type, f.suppressed]), want.items, file);
    // The names: the old app's "Feature 1 (cylinder)" (by version 2 on a part of any id, issue #541) is "Cylinder 1", and so on.
    assert.deepEqual(doc.timeline.features.map((f) => f.provenance.self.label), want.names, file);
    assert.equal(doc.nextId, want.nextId, file);
    assert.equal(doc.timeline.marker, want.marker, file);
  }
});

test("every old file builds on today's kernel what was worked out by hand: each body's exact volume and cap centroids, or the same refusal", async () => {
  const start = await kernel.call("body_count");
  for (const file of files()) {
    const doc = open(text(file)).workspaces.design as DesignDocument;
    assert.equal(buildDiff(await built(doc), CORPUS[file].build), null, file);
  }
  assert.equal(await kernel.call("body_count"), start, "every body freed");
});

test("every old file saved and opened again is the same document, and a second save the same text", () => {
  for (const file of files()) {
    const first = open(text(file));
    const saved = projectToJson(first);
    const again = open(saved);
    assert.deepEqual(again, first, file);
    assert.equal(projectToJson(again), saved, file);
  }
});

test("every old file opens in the Design app: the bodies drawn (within 1 % where circles are drawn as polygons) and its warning", async () => {
  for (const file of files()) {
    const want = CORPUS[file];
    const doc = open(text(file)).workspaces.design as DesignDocument;
    const a = await app(doc);
    const volumes = Object.values(want.build).flatMap((w) => (typeof w !== "string" && "volume" in w ? [w.volume] : []));
    const exact = volumes.reduce((s, v) => s + v, 0);
    const drawn = a.volume();
    assert.ok(drawnClose(drawn, exact), `${file}: drawn ${drawn} mm³, exact ${exact}`);
    assert.equal(a.warning(), want.warning, file);
    assert.ok(await a.close(), `${file}: every body freed`);
  }
});

test("every old file takes today's edits: a new item's id repeats none of the file's, and the edited file opens", () => {
  for (const file of files()) {
    const doc = open(text(file)).workspaces.design as DesignDocument;
    // Built to the end first, so the cube goes in last whatever the marker was.
    const made = insertPreset(moveMarker(doc, null), "box", 10, 10, 10);
    assert.ok(!allIds(doc).has(made.id), `${file}: ${made.id} is new`);
    assert.equal(made.doc.nextId, doc.nextId + 1, file);
    assert.equal(made.doc.timeline.features.at(-1)!.id, made.id, file);
    readDesignDocument(JSON.parse(JSON.stringify(made.doc)));
  }
});

test("the marker files rolled forward build everything after the marker: the disc r 20 × 4 is 1600π, and from the start all four bodies", async () => {
  for (const file of ["v3-suppressed-marker.panosolid.json", "v3-marker-start.panosolid.json"]) {
    const doc = moveMarker(open(text(file)).workspaces.design as DesignDocument, null);
    const got = await built(doc);
    // π · 20² · 4 = 1600π; its caps round (100, 0) at z 0 and 4. The suppressed cylinder stays suppressed.
    assert.equal(
      buildDiff(got, {
        "feature-1": { volume: 24000 },
        "feature-2": { status: "suppressed" },
        "feature-3": { volume: 4500 * PI },
        "sketch-4": "sketch",
        "feature-7": { volume: 1600 * PI, caps: [[100, 0, 0], [100, 0, 4]] },
      }),
      null,
      file,
    );
  }
});

// ---- Old files worked on after the upgrade behave as the same design made today (issue #541) ----

type App = Awaited<ReturnType<typeof app>>;

/** Types `value` into the app's input `sel` as a person does. */
async function typeInto(a: App, sel: string, value: number) {
  const input = a.$(sel) as HTMLInputElement;
  input.value = String(value);
  input.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}

/** The drawn scene's corners, lowest and highest x, y, z, to 1e-4 mm. */
function drawnBounds(a: App): number[][] {
  const p = a.mesh()!.positions;
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  return [Math.min, Math.max].map((m) => [0, 1, 2].map((k) => r(m(...p.filter((_, i) => i % 3 === k)))));
}

test("issue #541 item 1: a version 3 file's sketch on a face follows its box when a Move is put before it, as a sketch drawn today does", async () => {
  // v3-face-flip: box 40 x 30 x 20 at the origin, a circle r 5 on its top round the middle (20, 15), extruded 8 down into it.
  const a = await app(open(text("v3-face-flip.panosolid.json")).workspaces.design as DesignDocument);
  // Before: the box x 0..40, y 0..30, z 0..20 holds everything (the cylinder x 15..25).
  assert.deepEqual(drawnBounds(a), [[0, 0, 0], [40, 30, 20]]);
  // Through the app's own menus: marker back to Box 1, Move the box 20 along x, marker to the end again.
  assert.equal(await a.menu("feature-1", "marker"), null);
  a.selection.set([bodyReference("body:feature-1")]);
  await a.key("move-tool");
  await typeInto(a, "#move-x", 20);
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.$("#move-error")!.hidden, true, a.$("#move-error")!.textContent ?? "");
  assert.equal(await a.menu("feature-5", "marker"), null);
  // By hand: the box is now x 20..60, so its top's middle is (40, 15) and the cylinder x 35..45, inside the box: everything
  // drawn lies in x 20..60, y 0..30, z 0..20. Unfixed the cylinder stayed at x 15..25: [[15, 0, 0], [60, 30, 20]].
  assert.deepEqual(drawnBounds(a), [[20, 0, 0], [60, 30, 20]]);
  assert.equal(a.warning(), null);
  // The saved design built afresh (what a reload shows): the cylinder's caps round (40, 15) at z 20 and 12, still 25π · 8 = 200π.
  const got = await built(open(projectToJson({ ...open(text("v3-face-flip.panosolid.json")), workspaces: { design: a.doc() } })).workspaces.design as DesignDocument);
  const cylinder = got["feature-5"] as { volume: number; caps: [number[], number[]] };
  assert.ok(near(cylinder.volume, 200 * PI) && nearAll(cylinder.caps[0], [40, 15, 20]) && nearAll(cylinder.caps[1], [40, 15, 12]), JSON.stringify(cylinder));
  assert.ok(await a.close());
});

test("issue #541 item 2: a hole drawn into a version 3 file's extruded square cuts the hole, as in a design made today", async () => {
  // v3-three-bodies: Sketch 1 (sketch-3) is a 10 x 10 square on XZ at x 100..110, z 0..10, extruded 10 (Extrude 1, feature-12): 1000.
  const a = await app(open(text("v3-three-bodies.panosolid.json")).workspaces.design as DesignDocument);
  const before = a.volume();
  await a.doubleClick("sketch-3");
  await a.key("sketch-circle");
  await a.click(105, 5);
  await a.click(107, 5);
  await a.finish();
  // By hand: a circle r 2 round (105, 5), inside the square, so the extrude is a plate with a hole: 1000 − π · 2² · 10 = 1000 − 40π.
  // Unfixed: no change, "Extrude 1 keeps its last shape. Sketch 1 has no closed outline: the sketch makes 2 separate loops; …".
  assert.equal(a.warning(), null);
  const change = a.volume() - before;
  assert.ok(drawnClose(-change, 40 * PI), `drawn change ${change}, exact ${-40 * PI}`);
  const got = await built(a.doc());
  assert.ok(near((got["feature-12"] as { volume: number }).volume, 1000 - 40 * PI), JSON.stringify(got["feature-12"]));
  assert.ok(await a.close());
});

test("issue #541 item 2, control: a side deleted from a version 3 file's extruded square still leaves the extrude keeping its last shape", async () => {
  // The square opened (one side gone) has no region round it either, so nothing is there to extrude: the extrude keeps the
  // 10 x 10 x 10 = 1000 it had, warned, before the fix and after it.
  const doc = open(text("v3-three-bodies.panosolid.json")).workspaces.design as DesignDocument;
  const a = await app(doc);
  const before = a.volume();
  const side = doc.sketches.find((s) => s.id === "sketch-3")!.curves[0].id;
  await a.doubleClick("sketch-3");
  await a.key("clear-selection");
  const sketch = doc.sketches.find((s) => s.id === "sketch-3")!;
  const line = sketch.curves[0] as { start: string; end: string };
  const at = (id: string) => sketch.points.find((p) => p.id === id)!;
  await a.click((at(line.start).x + at(line.end).x) / 2, (at(line.start).y + at(line.end).y) / 2);
  await a.key("delete-selection");
  await a.finish();
  assert.ok(!a.doc().sketches.find((s) => s.id === "sketch-3")!.curves.some((c) => c.id === side), "the side was deleted");
  assert.equal(a.volume(), before);
  assert.match(a.warning() ?? "", /^Extrude 1 keeps its last shape\. Sketch 1 has no closed outline/);
  assert.equal(Object.hasOwn(a.doc().timeline.features.at(-1)!.intent.parameters, "region"), false);
  assert.ok(await a.close());
});

test("issue #541 item 3: a version 2 file's cylinder part is Cylinder 1 after the upgrade, and Box 1 once made a box", async () => {
  // v2-sketch-then-cylinder: the old app labelled its one part "Feature 1 (cylinder)" though its id is feature-14. A design made
  // today calls it Cylinder 1 (the first cylinder), and a preset made another shape takes that shape's next name: Box 1.
  const doc = open(text("v2-sketch-then-cylinder.panosolid.json")).workspaces.design as DesignDocument;
  assert.deepEqual(doc.timeline.features.map((f) => f.provenance.self.label), ["Sketch 1", "Cylinder 1"]);
  const a = await app(doc);
  chooseShape(a, "Box");
  await a.settle();
  const part = a.doc().timeline.features.at(-1)!;
  assert.equal(part.intent.type, "box");
  assert.deepEqual(a.doc().timeline.features.map((f) => f.provenance.self.label), ["Sketch 1", "Box 1"]);
  assert.ok(await a.close());
});
