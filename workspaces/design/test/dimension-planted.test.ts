// Bugs planted in sketch dimensions (constraints.ts, step 47e), one at a
// time, each of which `dimensionChecks` must catch, by the check recorded
// for it. Each plant is a text edit of the real source, loaded from a copy
// in a temporary folder (every other import points back at src/), so src/
// is never touched. The drawing and the tool's picks are pinned by hand in
// dimensions.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { seeded } from "../../../packages/testing/src/index.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { partDocument, type DesignDocument, type Sketch } from "../src/document.ts";
import { addSketch, drawCircle, drawLine } from "../src/sketch.ts";
import type * as Constraints from "../src/constraints.ts";

const kernel = nodeKernel();
const LINEAR = 1e-5;

interface Plant {
  name: string;
  find: string;
  replace: string;
  /** The check that catches it (`dimensionChecks`). */
  caught: string;
}

const PLANTS: Plant[] = [
  { name: "length-told-off-by-a-thousandth", find: '["distance", known(c.a), known(c.b), c.value]', replace: '["distance", known(c.a), known(c.b), c.value * 1.001]', caught: "holds" },
  { name: "diameter-leaves-the-radius", find: "? { ...q, radius: made.value / 2 } : q", replace: "? { ...q } : q", caught: "diameter" },
  { name: "sized-circle-still-free", find: 'c.kind === "circle" && !sized.has(c.id)).length', replace: 'c.kind === "circle").length', caught: "diameter" },
  { name: "a-set-size-added-again", find: "AXES[made.kind].every((axis) => redundantAxes.has(axis))", replace: "AXES[made.kind].length === 0", caught: "redundant" },
  { name: "smallest-dimension-halved", find: "value < DIMENSION_LIMITS.min ||", replace: "value < DIMENSION_LIMITS.min / 2 ||", caught: "limits" },
  { name: "change-holds-nothing", find: 'made.kind === "distance" ? [made.a] : []', replace: "[]", caught: "change" },
  { name: "change-keeps-the-old-value", find: "const made: SketchConstraint = { ...old, value };", replace: "const made: SketchConstraint = { ...old };", caught: "change" },
];

/** constraints.ts with `plant` made (or none), from a copy in `dir`. */
async function planted(plant: Plant | null, dir: string): Promise<typeof Constraints> {
  const source = new URL("../src/constraints.ts", import.meta.url);
  let text = readFileSync(source, "utf8");
  if (plant) {
    const at = text.indexOf(plant.find);
    assert.ok(at >= 0 && text.indexOf(plant.find, at + 1) < 0, `${plant.name}: the text to replace must be in constraints.ts exactly once: ${plant.find}`);
    text = text.slice(0, at) + plant.replace + text.slice(at + plant.find.length);
  }
  text = text.replace(/from "\.\/([^"]+)"/g, (_, g: string) => `from "${new URL(g, source).href}"`);
  const target = join(dir, `${plant?.name ?? "none"}-constraints.ts`);
  writeFileSync(target, text);
  return import(pathToFileURL(target).href);
}

const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const xy = (s: Sketch, p: string) => s.points.find((q) => q.id === p)!;
const apart = (s: Sketch, a: string, b: string) => Math.hypot(xy(s, a).x - xy(s, b).x, xy(s, a).y - xy(s, b).y);

/** The first check that fails with these constraints functions, as "name: why", or null when all pass. */
async function dimensionChecks(m: typeof Constraints): Promise<string | null> {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const id = s0.id;
  const line = drawLine(s0.doc, id, [0, 0], [4, 2]);
  // holds: seeded lengths on either line of a two-line chain drawn fresh each time, each within LINEAR once added.
  const rand = seeded(47_006n);
  const chain = drawLine(line.doc, id, "point-4", [9, -3]).doc;
  assert.ok(sketchOf(chain, id).points.some((p) => p.id === "point-6"), "the chain's far end is point-6");
  for (let k = 0; k < 20; k++) {
    const value = 1 + Math.round(rand.next() * 40_000) / 1000;
    const [a, b] = rand.next() < 0.5 ? ["point-3", "point-4"] : ["point-4", "point-6"];
    const got = await m.addConstraint(kernel, chain, id, { kind: "distance", a, b, value });
    if ("refused" in got) continue;
    const s = sketchOf(got.doc, id);
    const err = Math.abs(apart(s, a, b) - value);
    if (err > LINEAR) return `holds: ${a}–${b} is ${err} off ${value}`;
  }
  // diameter: a circle's diameter 16 sets its radius to 8 and leaves it no free radius.
  const c = drawCircle(line.doc, id, [20, 0], 5);
  const d = await m.addConstraint(kernel, c.doc, id, { kind: "diameter", circle: c.id, value: 16 });
  if ("refused" in d) return `diameter: refused, ${d.refused}`;
  const circle = sketchOf(d.doc, id).curves.find((q) => q.id === c.id);
  if (circle?.kind !== "circle" || circle.radius !== 8) return `diameter: radius ${circle?.kind === "circle" ? circle.radius : "gone"}, not 8`;
  const circles = JSON.parse(m.solverRequest(sketchOf(d.doc, id)).text).circles;
  if (circles !== 0) return `diameter: ${circles} free radii, not 0`;
  // redundant: the same length twice is refused.
  const once = await m.addConstraint(kernel, line.doc, id, { kind: "distance", a: "point-3", b: "point-4", value: 10 });
  if ("refused" in once) return `holds: refused, ${once.refused}`;
  const twice = await m.addConstraint(kernel, once.doc, id, { kind: "distance", a: "point-4", b: "point-3", value: 10 });
  if (!("refused" in twice) || !/would add nothing/.test(twice.refused)) return "redundant: the same length was added twice";
  // limits: 0.9× the smallest refused, 1.1× taken.
  if (m.dimensionProblem(0.9e-3) === null) return "limits: 0.0009 mm taken";
  if (m.dimensionProblem(1.1e-3) !== null) return "limits: 0.0011 mm refused";
  // change: 10 → 4, the line's start held at (0, 0), its end 4 from it.
  const ch = await m.changeDimension(kernel, once.doc, id, once.id, 4);
  if ("refused" in ch) return `change: refused, ${ch.refused}`;
  const s = sketchOf(ch.doc, id);
  if (xy(s, "point-3").x !== 0 || xy(s, "point-3").y !== 0) return `change: the start moved to ${xy(s, "point-3").x}, ${xy(s, "point-3").y}`;
  if (Math.abs(apart(s, "point-3", "point-4") - 4) > LINEAR) return `change: the line is ${apart(s, "point-3", "point-4")}, not 4`;
  return null;
}

test("each bug planted in the dimensions is caught, by the check recorded for it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dimension-planted-"));
  try {
    // The copy unplanted must pass, so a catch below is the plant's and not the copying's.
    assert.equal(await dimensionChecks(await planted(null, dir)), null, "the unplanted copy fails");
    for (const plant of PLANTS) {
      const caught = await dimensionChecks(await planted(plant, dir));
      assert.ok(caught !== null, `${plant.name} was not caught`);
      assert.match(caught, new RegExp(`^${plant.caught}:`), `${plant.name} was caught by another check than "${plant.caught}": ${caught}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
