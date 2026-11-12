// The later old files (#512 item 2): eight projects saved by SpindleLabs at Design data versions 9 to 15, each
// made by running that commit's own document functions on its own committed kernel (old-files/make/later/ has the
// scripts and the commit each ran at; remade, they are byte for byte the files kept). The first corpus
// (old-files.journey.ts) stops at version 3, so until these the upgrades from 4 on were only checked with
// hand-written data. Each must open through today's reader, upgraded to today's version with its items, names,
// flags, hidden bodies, body numbers, counters and units, build on the real kernel the bodies worked out by hand
// below, and save and open again unchanged. Run with `npm run journeys`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { projectFromJson, projectToJson } from "@fission/core";
import { BodyCache, designWorkspace, partDocument, rebuildTimeline, type DesignDocument } from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";

const kernel = nodeKernel();
const DIR = new URL("../old-files/later/", import.meta.url);
/** Volumes and corners are compared to a billionth of their size (at least 1): the bodies are flat-sided, so the kernel's answers are exact up to rounding. */
const REL = 1e-9;

type Box = [[number, number, number], [number, number, number]];
interface LaterFile {
  /** The Design data version as saved. */
  version: number;
  /** Each timeline item after the upgrade: id, type, suppressed, name, the words its row shows. */
  items: [string, string, boolean, string, string][];
  /** Every body built today: its exact volume (mm³) and its bounding box. */
  bodies: Record<string, { volume: number; bounds: Box }>;
  hidden: string[];
  /** Each body record's id and number, as stored. */
  numbers: [string, number][];
  nextBody: number;
  nextId: number;
  units: string;
}

// The rich design (make/later/rich.ts): a box 40 × 30 × 20 with its corner at the origin; Sketch 1, a rectangle
// x 50..60, y 0..10 with a construction line across it, extruded 5 as a new body; Sketch 2, a rectangle x 18..22,
// y 13..17, extruded 20; Sketch 3, a circle not extruded; a Move of Extrude 1; from version 11 a copy of the box,
// suppressed; the box hidden; the project in inches.
const box = 40 * 30 * 20; // 24000
const square = 4 * 4 * 20; // Sketch 2's rectangle 4 × 4, 20 deep: 320
const BOX: Box = [[0, 0, 0], [40, 30, 20]];

/** From version 10 on Sketch 2 is a Cut through the box: wholly inside it (x 18..22 within 0..40, y 13..17 within 0..30) and as deep as it is tall, so the box loses 320: 23680. From version 12 Extrude 1 (10 × 10 × 5 = 500) is scaled 2× about (50, 0, 0): every length doubles, so 500 · 2³ = 4000, x from 50 + 2 · (50 − 50) = 50 to 50 + 2 · 10 = 70, y 0..20, z 0..10. */
const richFrom12 = (version: number): LaterFile => ({
  version,
  items: [
    ["feature-1", "box", false, "Box 1", "Box: 40 × 30 × 20 mm"],
    ["sketch-2", "sketch", false, "Sketch 1", "Sketch 1 on the XY plane"],
    ["feature-14", "extrude", false, "Extrude 1", "Extrude Sketch 1 by 5 mm"],
    ["sketch-15", "sketch", false, "Sketch 2", "Sketch 2 on the XY plane"],
    ["feature-24", "extrude", false, "Extrude 2", "Extrude Sketch 2 by 20 mm, cut from Box 1"],
    ["sketch-25", "sketch", false, "Sketch 3", "Sketch 3 on the XY plane"],
    ["feature-28", "move", false, "Scale 1", "Scale Extrude 1 by 2× about (50, 0, 0) mm"],
    ["feature-29", "duplicate", true, "Mirror 1", "Mirror of Box 1 across the YZ plane"],
  ],
  bodies: {
    "body:feature-1": { volume: box - square, bounds: BOX },
    "body:feature-14": { volume: 500 * 8, bounds: [[50, 0, 0], [70, 20, 10]] },
  },
  hidden: ["body:feature-1"],
  // The suppressed copy keeps its number 3; the Cut makes no body of its own, so none.
  numbers: [["body:feature-1", 1], ["body:feature-14", 2], ["body:feature-29", 3]],
  nextBody: 4,
  nextId: 30,
  units: "in",
});

/** A Combine Cut (make/later/combine.ts): Box 1, 30 × 10 × 10 at the origin; Box 2, 4 × 20 × 20, moved (x, −5, −5) so it spans y −5..15 and z −5..15, through all of Box 1's 10 × 10 section; cut from Box 1, two pieces are left, x 0..x and x + 4..30; the piece numbered 1 moved up 50; Box 1's own body hidden. Saved at version 12, with no remembered faces: the piece kept as piece:1 is the one the file's Move moved. */
const cut = (x: number): LaterFile => ({
  version: 12,
  items: [
    ["feature-1", "box", false, "Box 1", "Box: 30 × 10 × 10 mm"],
    ["feature-2", "box", false, "Box 2", "Box: 4 × 20 × 20 mm"],
    ["feature-3", "move", false, "Move 1", `Move Box 2 by (${x}, -5, -5) mm`],
    ["feature-4", "combine", false, "Combine 1", "Cut Box 2 from Box 1"],
    ["feature-5", "move", false, "Move 2", "Move Combine 1 by (0, 0, 50) mm"],
  ],
  bodies: {
    // x · 10 · 10 left of the tool, (30 − (x + 4)) · 10 · 10 right of it, that one 50 up.
    "body:feature-1": { volume: x * 100, bounds: [[0, 0, 0], [x, 10, 10]] },
    "body:feature-4/piece:1": { volume: (26 - x) * 100, bounds: [[x + 4, 0, 50], [30, 10, 60]] },
  },
  hidden: ["body:feature-1"],
  numbers: [["body:feature-1", 1], ["body:feature-2", 2], ["body:feature-4/piece:1", 3]],
  nextBody: 4,
  nextId: 6,
  units: "mm",
});

const LATER: Record<string, LaterFile> = {
  // Version 9: no Cut yet, so Sketch 2 is its own body (4 × 4 × 20 = 320 at x 18..22, y 13..17, z 0..20) and the box
  // whole (24000); no Scale yet, so the Move lifts Extrude 1 (10 × 10 × 5 = 500) by 7: z 7..12. No copy before 11.
  "v9-rich.spindlelabs.json": {
    version: 9,
    items: [
      ["feature-1", "box", false, "Box 1", "Box: 40 × 30 × 20 mm"],
      ["sketch-2", "sketch", false, "Sketch 1", "Sketch 1 on the XY plane"],
      ["feature-14", "extrude", false, "Extrude 1", "Extrude Sketch 1 by 5 mm"],
      ["sketch-15", "sketch", false, "Sketch 2", "Sketch 2 on the XY plane"],
      ["feature-24", "extrude", false, "Extrude 2", "Extrude Sketch 2 by 20 mm"],
      ["sketch-25", "sketch", false, "Sketch 3", "Sketch 3 on the XY plane"],
      ["feature-28", "move", false, "Move 1", "Move Extrude 1 by (0, 0, 7) mm"],
    ],
    bodies: {
      "body:feature-1": { volume: box, bounds: BOX },
      "body:feature-14": { volume: 500, bounds: [[50, 0, 7], [60, 10, 12]] },
      "body:feature-24": { volume: square, bounds: [[18, 13, 0], [22, 17, 20]] },
    },
    hidden: ["body:feature-1"],
    numbers: [["body:feature-1", 1], ["body:feature-14", 2], ["body:feature-24", 3]],
    nextBody: 4,
    nextId: 29,
    units: "in",
  },
  "v12-rich.spindlelabs.json": richFrom12(12),
  "v13-rich.spindlelabs.json": richFrom12(13),
  "v14-rich.spindlelabs.json": richFrom12(14),
  "v15-rich.spindlelabs.json": richFrom12(15),
  // Version 15, Join (make/later/join.ts): a cube 10 × 10 × 10; Extrude 1, a rectangle x 20..24, y 0..4, 10 high,
  // joined to the cube but apart from it (20 > 10), so a piece of its own, 4 · 4 · 10 = 160; Extrude 2, x 8..12,
  // y 2..6, 5 high, joined and touching it: the cube gains the part outside it, x 10..12, 2 · 4 · 5 = 40, so 1040 over
  // x 0..12. The piece moved 100 along x (x 120..124), copied in place, then hidden. Today the piece is Extrude 1's
  // own body (v16) and keeps its number 2 and its six faces. (The copy's row words, still "a piece of Extrude 1"
  // after the upgrade, are #512 item 1, checked where that is fixed.)
  "v15-join-piece.spindlelabs.json": {
    version: 15,
    items: [
      ["feature-1", "box", false, "Box 1", "Box: 10 × 10 × 10 mm"],
      ["sketch-2", "sketch", false, "Sketch 1", "Sketch 1 on the XY plane"],
      ["feature-11", "extrude", false, "Extrude 1", "Extrude Sketch 1 by 10 mm, joined to Box 1"],
      ["sketch-12", "sketch", false, "Sketch 2", "Sketch 2 on the XY plane"],
      ["feature-21", "extrude", false, "Extrude 2", "Extrude Sketch 2 by 5 mm, joined to Box 1"],
      ["feature-22", "move", false, "Move 1", "Move Extrude 1 by (100, 0, 0) mm"],
      ["feature-23", "duplicate", false, "Copy 1", ""],
    ],
    bodies: {
      "body:feature-1": { volume: 1000 + 40, bounds: [[0, 0, 0], [12, 10, 10]] },
      "body:feature-11": { volume: 160, bounds: [[120, 0, 0], [124, 4, 10]] },
      "body:feature-23": { volume: 160, bounds: [[120, 0, 0], [124, 4, 10]] },
    },
    hidden: ["body:feature-11"],
    numbers: [["body:feature-1", 1], ["body:feature-11", 2], ["body:feature-23", 3]],
    nextBody: 4,
    nextId: 24,
    units: "mm",
  },
  // Unequal pieces: x 0..10 (1000) and 14..30 (1600). Equal: x 0..13 and 17..30, 1300 each, so only the remembered
  // place, not the size, can say which is piece:1.
  "v12-cut-unequal.spindlelabs.json": cut(10),
  "v12-cut-equal.spindlelabs.json": cut(13),
};

const files = () => readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const text = (file: string) => readFileSync(new URL(file, DIR), "utf8");
const open = (t: string) => projectFromJson(t, [designWorkspace]);
const design = (t: string) => open(t).workspaces.design as DesignDocument;
const near = (got: number, want: number) => Math.abs(got - want) <= REL * Math.max(1, Math.abs(want));

/** Every body today's kernel builds from a document: volume and bounds. */
async function bodies(doc: DesignDocument): Promise<Record<string, { volume: number; bounds: Box }>> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const out: Record<string, { volume: number; bounds: Box }> = {};
    for (const id of Object.keys(build.bodies).sort()) {
      const view = await cache.view(build.bodies[id].handle);
      out[id] = { volume: view.volume, bounds: view.bounds as Box };
    }
    return out;
  } finally {
    await cache.clear();
  }
}

/** Whether built bodies match the hand-worked ones: the same ids, volumes and corners to REL. */
function bodiesDiff(got: LaterFile["bodies"], want: LaterFile["bodies"]): string | null {
  if (JSON.stringify(Object.keys(got).sort()) !== JSON.stringify(Object.keys(want).sort())) return `bodies ${Object.keys(got)} not ${Object.keys(want)}`;
  for (const [id, w] of Object.entries(want)) {
    const g = got[id];
    if (!near(g.volume, w.volume)) return `${id}: volume ${g.volume} not ${w.volume}`;
    if (!g.bounds.every((c, i) => c.every((x, k) => near(x, w.bounds[i][k])))) return `${id}: bounds ${JSON.stringify(g.bounds)} not ${JSON.stringify(w.bounds)}`;
  }
  return null;
}

test("the comparer: a volume or corner 0.9 × REL off passes, 1.1 × off fails, and a missing or extra body is named", () => {
  const want: LaterFile["bodies"] = { "body:a": { volume: 4000, bounds: [[50, 0, 0], [70, 20, 10]] } };
  const at = (volume: number, x: number): LaterFile["bodies"] => ({ "body:a": { volume, bounds: [[50, 0, 0], [x, 20, 10]] } });
  // 4000 · (1 ± 0.9e-9) is inside, 4000 · (1 + 1.1e-9) outside; a corner of 70 likewise.
  assert.equal(bodiesDiff(at(4000 * (1 + 0.9 * REL), 70), want), null);
  assert.equal(bodiesDiff(at(4000 * (1 - 0.9 * REL), 70), want), null);
  assert.match(bodiesDiff(at(4000 * (1 + 1.1 * REL), 70), want)!, /body:a: volume/);
  assert.equal(bodiesDiff(at(4000, 70 * (1 + 0.9 * REL)), want), null);
  assert.match(bodiesDiff(at(4000, 70 * (1 + 1.1 * REL)), want)!, /body:a: bounds/);
  // A corner at 0 is compared to REL mm (the scale is at least 1).
  assert.equal(bodiesDiff({ "body:a": { volume: 4000, bounds: [[50, 0.9 * REL, 0], [70, 20, 10]] } }, want), null);
  assert.match(bodiesDiff({ "body:a": { volume: 4000, bounds: [[50, 1.1 * REL, 0], [70, 20, 10]] } }, want)!, /bounds/);
  assert.match(bodiesDiff({}, want)!, /^bodies/);
  assert.match(bodiesDiff({ ...at(4000, 70), "body:b": want["body:a"] }, want)!, /^bodies/);
});

test("the later files and their hand-worked answers list the same files, one for each of versions 9, 12, 13, 14 and 15", () => {
  assert.deepEqual(files(), Object.keys(LATER).sort());
  assert.deepEqual([...new Set(Object.values(LATER).map((f) => f.version))].sort((a, b) => a - b), [9, 12, 13, 14, 15]);
});

test("every later file is as its SpindleLabs saved it: the outer format 2 and Design's version as recorded", () => {
  for (const file of files()) {
    const raw = JSON.parse(text(file));
    assert.equal(raw.formatVersion, 2, file);
    assert.equal(raw.workspaces.design.version, LATER[file].version, file);
  }
});

test("every later file opens upgraded to today's version, with its items, names, row words, suppressed copy, hidden body, numbers, counters and units", () => {
  const today = partDocument("box", 1, 1, 1).version;
  for (const file of files()) {
    const want = LATER[file];
    const project = open(text(file));
    const doc = project.workspaces.design as DesignDocument;
    assert.equal(doc.version, today, file);
    // The row words: all but those #512 item 1 fixes (written "" above).
    const items = doc.timeline.features.map((f, i) => [f.id, f.intent.type, f.suppressed, f.provenance.self.label, want.items[i]?.[4] === "" ? "" : (f.intent as { summary?: string }).summary]);
    assert.deepEqual(items, want.items, file);
    assert.deepEqual(doc.hidden, want.hidden, file);
    assert.deepEqual(doc.bodies!.map((b) => [b.id, b.number]), want.numbers, file);
    assert.equal(doc.nextBody, want.nextBody, file);
    assert.equal(doc.nextId, want.nextId, file);
    assert.equal(project.units.length, want.units, file);
  }
});

test("what each version added survives the upgrade: the construction line, the hole tag from 14, the Join piece's six faces", () => {
  for (const file of files().filter((f) => f.includes("rich"))) {
    const doc = design(text(file));
    const sketch1 = doc.sketches.find((s) => s.id === "sketch-2")!;
    // Sketch 1: the rectangle's four lines and the construction line across it.
    assert.deepEqual(sketch1.curves.map((c) => [c.kind, !!(c as { construction?: boolean }).construction]), [["line", false], ["line", false], ["line", false], ["line", false], ["line", true]], file);
    const circle = doc.sketches.find((s) => s.id === "sketch-25")!.curves[0] as { kind: string; radius: number; fit?: unknown };
    assert.equal(circle.kind, "circle", file);
    assert.equal(circle.radius, 2, file);
    assert.deepEqual(circle.fit, LATER[file].version >= 14 ? { kind: "bolt-normal", role: "hole" } : undefined, file);
  }
  const join = design(text("v15-join-piece.spindlelabs.json"));
  const piece = join.bodies!.find((b) => b.id === "body:feature-11")!;
  // The rectangle's four sides and its two caps.
  assert.deepEqual(piece.faces, ["face:feature-11/end", "face:feature-11/side:line-10", "face:feature-11/side:line-5", "face:feature-11/side:line-7", "face:feature-11/side:line-9", "face:feature-11/start"]);
});

test("every later file builds on today's kernel the bodies worked out by hand: each one's exact volume and bounding box", async () => {
  const start = await kernel.call("body_count");
  for (const file of files()) assert.equal(bodiesDiff(await bodies(design(text(file))), LATER[file].bodies), null, file);
  assert.equal(await kernel.call("body_count"), start, "every body freed");
});

test("every later file saved and opened again is the same project, and a second save the same text", () => {
  for (const file of files()) {
    const first = open(text(file));
    const saved = projectToJson(first);
    const again = open(saved);
    assert.deepEqual(again, first, file);
    assert.equal(projectToJson(again), saved, file);
  }
});
