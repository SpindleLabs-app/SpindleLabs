// A field of the saved Design data must never land without a version bump or a line in docs/project-format.md.
// Cold read 2026-10-31: step 35e2h added `face.body` (it changes what is built) to version 4 with neither, so a
// version 4 reader of an older build opened such a file and silently built the sketch in the wrong place.
//
// This test reads the saved types' property names from the source and holds them to a ledger for the current
// version. Adding a field fails it until its author (1) adds the name below, (2) writes it into
// docs/project-format.md, and (3) if an older reader would build something different without it, raises
// DesignDocument.version and writes the migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const read = (p: string) => readFileSync(root(p), "utf8");

/** The property names of `export interface name { … }`, found by their indentation of two spaces. */
export function propertyNames(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`no interface ${name}`);
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^ {2}([A-Za-z_]\w*)\??:/gm)].map((m) => m[1]);
}

// Design data version 13 (hunt 11-06): each Combine piece's remembered faces (`faces` on BodyRecord), which a version 12
// reader would renumber pieces without. Version 12 (35e2n): a Move's `scale` (Scale) and a Duplicate's `mirror` (Mirror body), in parameters, which
// hold no typed fields, so nothing new below; a version 11 reader would refuse the Move and build the copy unmirrored.
// Version 11 (35e2m): a Duplicate item (`intent.type` "duplicate", its `body` in its parameters, which hold
// no typed fields, so nothing new below), which a version 10 reader would refuse as an unknown item. Version 10: an extrude of a sketch may join, cut or intersect bodies made before it (`operation` and
// `bodies` in its parameters, which hold no typed fields, so nothing new below), which a version 9 reader would build
// as a new body. Version 9 (48): an extrude of a sketch may name its region (`region`, held to its fields below), which
// a version 8 reader would build as the sketch's one outline. Version 8 (47e, 47f): construction curves
// (`construction` on each curve kind) and dimensions (two new constraint kinds), which a version 7 reader would build
// without. Changing any list: see the top of this file.
// Design data version 14 (FK2): a circle tagged with its fit (`fit` on SketchCircleCurve), which a version 13 reader
// would drop on saving, losing what the hole is for.
// Design data version 15 (35f1f2b): a pin's `name` or a projection's `edge` may hold a Combine result's edge by its name
// across the design ("design:…", its `feature` the Combine), in fields already listed, so nothing new below; a version 14
// reader would hold such a point where it was.
// Design data version 16 (hunt 11-08): an Extrude Join's piece holding only the extrude is `body:<the extrude>`, where
// version 15 named it piece 1 (the upgrade renames every body id in the data), in fields already listed (a BodyRecord's
// `id` and `faces`), so nothing new below; a version 15 reader would refuse the extrude's own id as a body.
const LEDGER_VERSION = 16;
const LEDGER: { file: string; type: string; names: string[] }[] = [
  { file: "workspaces/design/src/document.ts", type: "DesignDocument", names: ["version", "nextId", "profiles", "sketches", "timeline", "kept", "bodies", "nextBody", "hidden", "shownPlanes"] },
  { file: "workspaces/design/src/document.ts", type: "Sketch", names: ["id", "points", "curves", "constraints", "face", "pins", "projected"] },
  { file: "workspaces/design/src/document.ts", type: "KeptShape", names: ["points", "curves", "placement"] },
  { file: "workspaces/design/src/document.ts", type: "SketchLineCurve", names: ["id", "kind", "start", "end", "construction"] },
  { file: "workspaces/design/src/document.ts", type: "SketchCircleCurve", names: ["id", "kind", "centre", "radius", "construction", "fit"] },
  { file: "workspaces/design/src/document.ts", type: "SketchArcCurve", names: ["id", "kind", "start", "end", "centre", "construction"] },
  { file: "workspaces/design/src/document.ts", type: "SketchDistance", names: ["id", "kind", "a", "b", "value"] },
  { file: "workspaces/design/src/document.ts", type: "SketchDiameter", names: ["id", "kind", "circle", "value"] },
  { file: "workspaces/design/src/face-sketch.ts", type: "SketchFace", names: ["frame", "side", "held", "body"] },
  { file: "workspaces/design/src/regions.ts", type: "RegionRef", names: ["outer", "centroid"] },
  { file: "workspaces/design/src/regions.ts", type: "RegionPiece", names: ["curve", "reversed"] },
  { file: "workspaces/design/src/document.ts", type: "BodyRecord", names: ["id", "number", "faces"] },
];

test("the saved types' fields are exactly the ledger of the current data version", () => {
  const doc = read("workspaces/design/src/document.ts");
  assert.match(doc, new RegExp(`^ {2}version: ${LEDGER_VERSION};`, "m"), "DesignDocument.version changed: update LEDGER_VERSION and the ledger");
  for (const { file, type, names } of LEDGER) {
    assert.deepEqual(propertyNames(read(file), type), names, `${type} changed: add the field to the ledger, to docs/project-format.md, and bump the version if older readers would build it differently`);
  }
});

test("every ledger field is written in docs/project-format.md", () => {
  const format = read("docs/project-format.md");
  for (const { type, names } of LEDGER) {
    for (const n of names) assert.ok(new RegExp(`\`${n}\`|\\b${n}\\??:|"${n}"`).test(format), `docs/project-format.md never mentions ${type}.${n}`);
  }
});

test("the ledger can fail: an extra field, a missing one and an unknown interface are all seen", () => {
  const src = "export interface Thing {\n  a: number;\n  b?: string;\n  /** doc */\n  c: boolean;\n    nested: number;\n}\n";
  assert.deepEqual(propertyNames(src, "Thing"), ["a", "b", "c"], "nested (deeper indent) is not a field");
  assert.notDeepEqual(propertyNames(src.replace("  c: boolean;\n", "  c: boolean;\n  d: number;\n"), "Thing"), ["a", "b", "c"]);
  assert.throws(() => propertyNames(src, "Other"), /no interface Other/);
});
