// Bugs planted in sketch-shapes.ts (step 52c), each of which the shape tests
// must catch: the module is loaded from a temporary copy with one plant
// made (its relative imports pointed back at src/), so src/ is never
// touched, and the copy unplanted must pass first, so a catch is the
// plant's and not the copying's. Each check is the hand-worked or seeded
// one recorded for it in sketch-shapes.test.ts, run here on the copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SketchXY } from "@fission/core";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { addSketch } from "../src/sketch.ts";
import { seeded } from "../../../packages/testing/src/index.ts";

type Shapes = typeof import("../src/sketch-shapes.ts");

const SOURCE = new URL("../src/sketch-shapes.ts", import.meta.url);

interface Plant {
  name: string;
  find: string;
  replace: string;
}

const PLANTS: Plant[] = [
  { name: "no-level-or-upright", find: "  return levelled(next, sketchId, pairs);", replace: "  return next;" },
  { name: "hexagon-flats-left-a-rounding-off", find: "  const tidy = 8 * Number.EPSILON * scale;", replace: "  const tidy = -1;" },
  { name: "slot-end-the-wrong-way-round", find: '      { kind: "arc", start: 0, end: 1, centre: 2 },', replace: '      { kind: "arc", start: 1, end: 0, centre: 2 },' },
  { name: "circumscribed-not-stretched", find: "  const stretch = outside ? 1 / direction(half)[0] : 1;", replace: "  const stretch = 1;" },
  { name: "rectangle-height-on-the-wrong-side", find: "  return loop([a, b, offset(b, n, h), offset(a, n, h)]);", replace: "  return loop([a, b, offset(b, n, -h), offset(a, n, -h)]);" },
  { name: "overall-slot-centres-not-moved-in", find: "  return slotFrom(offset(e1, u, r), offset(e2, u, -r), n, r);", replace: "  return slotFrom(e1, e2, n, r);" },
  { name: "polygon-side-limit-off", find: "  for (let k = 0; k < n; k++) if (short(apart(corners[k], corners[(k + 1) % n]), scale)) return { note: SMALL_POLYGON };", replace: "" },
  { name: "lone-point-drawn-twice", find: "    if (there !== null) return doc;", replace: "" },
];

/** sketch-shapes.ts with `plant` made, loaded from a temporary copy. */
async function planted(plant: Plant, dir: string): Promise<Shapes> {
  const text = readFileSync(SOURCE, "utf8");
  const at = text.indexOf(plant.find);
  assert.ok(at >= 0 && text.indexOf(plant.find, at + 1) < 0, `${plant.name}: the text to replace must be in sketch-shapes.ts exactly once: ${plant.find}`);
  const copy = (text.slice(0, at) + plant.replace + text.slice(at + plant.find.length)).replace(/from "\.\/([^"]+)"/g, (_, f) => `from "${new URL(f, SOURCE).href}"`);
  const file = join(dir, `sketch-shapes-${plant.name}.ts`);
  writeFileSync(file, copy);
  return import(pathToFileURL(file).href);
}

/** The checks, each a hand-worked shape or the seeded model; the first that fails names itself. */
function check(m: Shapes): string | null {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const draw = (kind: Parameters<Shapes["startShape"]>[0], ps: SketchXY[], sides?: number): { doc: DesignDocument; drew: boolean; note?: string } => {
    let tool = { ...m.startShape(kind, s.id), ...(sides ? { sides } : {}) };
    let doc = s.doc;
    let drew = false;
    let note: string | undefined;
    for (const p of ps) {
      const r = m.shapeClick(doc, tool, p);
      [doc, tool, note] = [r.doc, r.tool, r.note];
      drew ||= r.drew;
    }
    return { doc, drew, note };
  };
  const sketch = (doc: DesignDocument) => doc.sketches.find((x) => x.id === s.id)!;
  // Centre rectangle (10, 5) / (16, 9): four constraints (sketch-shapes.test.ts, hand-worked).
  if (sketch(draw("centre-rectangle", [[10, 5], [16, 9]]).doc).constraints.length !== 4) return "centre rectangle: not kept level and upright";
  // The hexagon round (0, 0) through (10, 0): its top side exactly level.
  const hex = sketch(draw("polygon", [[0, 0], [10, 0]]).doc).points;
  if (hex[1].y !== hex[2].y) return "hexagon: its flat side is not exactly level";
  // The circumscribed hexagon through (2.75, 0): 5.5 across the flats.
  const nut = sketch(draw("outside-polygon", [[0, 0], [2.75, 0]]).doc).points;
  if (Math.abs(nut[0].x - 2.75) > 1e-12) return "nut trap: not 5.5 across the flats";
  // The 3-point rectangle (0, 0), (10, 0), (3, 4): its far corners (10, 4) and (0, 4).
  const r3 = sketch(draw("three-rectangle", [[0, 0], [10, 0], [3, 4]]).doc).points;
  if (r3[2].y !== 4) return "3-point rectangle: its height is on the wrong side";
  // The slot round (0, 0) and (20, 0) through (7, 3): its left end goes round through (−3, 0), away from the other centre.
  const sl = sketch(draw("slot", [[0, 0], [20, 0], [7, 3]]).doc);
  const left = sl.curves.find((c) => c.kind === "arc");
  if (left?.kind !== "arc" || sl.points.find((p) => p.id === left.start)?.y !== 3) return "slot: an end goes round the wrong way";
  // The overall slot (0, 0) to (26, 0), 6 wide: its centres at (3, 0) and (23, 0).
  const ov = sketch(draw("overall-slot", [[0, 0], [26, 0], [10, 3]]).doc).points;
  if (ov[3].x !== 3) return "overall slot: its centres are not 3 in from its ends";
  // A hexagon of radius 0.0009 has sides under the smallest piece: refused.
  if (draw("polygon", [[0, 0], [0.0009, 0]]).drew) return "polygon: a side under 0.001 mm was drawn";
  // A point on a point: refused.
  const one = draw("point", [[3, 4]]).doc;
  if (m.shapeClick(one, m.startShape("point", s.id), [3, 4]).drew) return "point: a second point drawn on the first";
  // Seeded: 40 random polygons' sides all one length.
  const rand = seeded(52_011n);
  for (let k = 0; k < 40; k++) {
    const c: SketchXY = [Math.round(rand.next() * 40) - 20, Math.round(rand.next() * 40) - 20];
    const p: SketchXY = [c[0] + 1 + Math.round(rand.next() * 10), c[1] + Math.round(rand.next() * 10)];
    const pts = sketch(draw("outside-polygon", [c, p], 3 + (k % 8)).doc).points;
    const d = pts.map((q, i) => Math.hypot(pts[(i + 1) % pts.length].x - q.x, pts[(i + 1) % pts.length].y - q.y));
    if (Math.abs((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 - ((pts[0].x + pts[1].x) / 2 - c[0]) ** 2 - ((pts[0].y + pts[1].y) / 2 - c[1]) ** 2) > 1e-6) return `seeded polygon ${k}: the side's middle is not where clicked`;
    if (d.some((x) => Math.abs(x - d[0]) > 1e-9)) return `seeded polygon ${k}: unequal sides`;
  }
  return null;
}

test("each bug planted in the sketch shapes is caught by a shape check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sketch-shapes-planted-"));
  try {
    const clean = await planted({ name: "none", find: "export const DEFAULT_SIDES = 6;", replace: "export const DEFAULT_SIDES = 6;" }, dir);
    assert.equal(check(clean), null, "the unplanted copy fails");
    const report: string[] = [];
    for (const plant of PLANTS) {
      const caught = check(await planted(plant, dir));
      report.push(`${plant.name}: ${caught ?? "NOT CAUGHT"}`);
      assert.ok(caught !== null, `${plant.name} was not caught`);
    }
    if (process.env.FISSION_PLANTED_REPORT) console.log(report.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
