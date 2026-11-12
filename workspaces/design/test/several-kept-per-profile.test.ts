// SL #632 item 1 (hunt 2026-11-12 C, finding C4/C5; broken-solids hunt D4): two profiles of ONE sketch shared one
// kept shape (filed "<extrude>" or "<extrude>/<sketch>"), so once one was lost the shape was frozen; the other,
// edited and then lost too, came back at its shape from before the edit, not its last shape (the owner's rule, 24d2).
// From Design data version 19 each profile keeps its own shape (`keptKey`: "<extrude>/profile:<k>").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DESIGN_VERSION, migrateDesignV18, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { settleKept } from "../src/rebuild.ts";
import { addSketch, deleteCurve, drawRectangle, movePoint } from "../src/sketch.ts";
import { freshDesign } from "../src/start-fresh.ts";
import { kernel, regionsOf, volumesOf } from "./several-hunt-helpers.ts";

/** Squares A (0,0)-(10,10) and B (30,0)-(40,10) in one sketch, extruded 1 mm (A first; B too when `withB`), then edited. */
async function run(withB: boolean) {
  const s = addSketch(freshDesign());
  let d = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
  d = drawRectangle(d, s.id, [30, 0], [40, 10]).doc;
  const rs = await regionsOf(d, s.id);
  const at = (x: number) => rs.find((r) => Math.abs(r.c[0] - x) < 1e-6)!.ref;
  const made = extrudeSketch(d, s.id, 1, false, at(5), null, withB ? [{ sketch: s.id, region: at(35) }] : []);
  let doc: DesignDocument = made.doc;
  const step = async (next: DesignDocument) => (doc = await settleKept(kernel, doc, next));
  const sk = () => doc.sketches.find((x) => x.id === s.id)!;
  const side = (p: string, q: string) => sk().curves.find((c) => c.kind === "line" && [c.start, c.end].includes(p) && [c.start, c.end].includes(q))!.id;
  const pt = (x: number, y: number) => sk().points.find((p) => p.x === x && p.y === y)!.id;
  // 1. B's top side deleted: B lost, keeps its square, 10 x 10 x 1 = 100 mm3.
  await step(deleteCurve(doc, s.id, side(pt(30, 10), pt(40, 10))));
  // 2. A's corner (10,10) dragged to (20,10): A = (0,0) (10,0) (20,10) (0,10), a trapezium, area (10 + 20) / 2 x 10 = 150.
  const c = pt(10, 10);
  await step(movePoint(doc, s.id, c, 20, 10));
  // 3. A's top side deleted: A lost; its last shape was 150 mm2 x 1 mm = 150 mm3.
  await step(deleteCurve(doc, s.id, side(pt(0, 10), c)));
  return { doc, id: made.id, out: await volumesOf(doc, made.id) };
}

test("control: A alone, the same edits: A keeps its last shape, 150 mm3", async () => {
  const { out } = await run(false);
  assert.equal(out.status, "built");
  assert.ok(Math.abs(out.vols[0] - 150) < 1e-6, `${out.vols}`);
});

test("SL #632: A and B of the same sketch: A keeps its last shape 150, B its 100, 250 mm3 in all (was 100 + 100)", async () => {
  const { doc, id, out } = await run(true);
  assert.equal(out.status, "built", JSON.stringify(out.r));
  // Apart (A ends at x = 20, B starts at 30): two bodies, A's (the extrude's own) first.
  assert.equal(out.vols.length, 2, `${out.vols}`);
  assert.ok(Math.abs(out.vols[0] - 150) < 1e-6 && Math.abs(out.vols[1] - 100) < 1e-6, `${out.vols}`);
  // Each profile its own kept shape: the first under the extrude's id, the second under its place in the profiles.
  assert.deepEqual(Object.keys(doc.kept ?? {}).sort(), [id, `${id}/profile:1`]);
});

// Two real version 18 files, saved by main 4597ad7's own document functions on its kernel (the steps are in each
// test's comment): version 18 filed the shape of every profile of a sketch under one key.
const v18 = (name: string): Record<string, any> => JSON.parse(readFileSync(new URL(`files/${name}.json`, import.meta.url), "utf8"));

test("hand-worked upgrade: version 18's shared key (the first profile's sketch) becomes a copy for each profile, and A, lost next, keeps its last shape", async () => {
  // Made: Sketch 1 with squares A (0,0)-(10,10) and B (30,0)-(40,10), extruded 1 mm as feature-18 (A first, then B of
  // Sketch 1 too); B's top side deleted (B lost); then A's corner (10,10) dragged to (20,10), and saved. Version 18
  // filed B's shape under "feature-18", the first profile's key, which A read too: it still holds A at (10,10).
  const file = v18("v18-shared-kept");
  assert.equal(file.version, 18);
  assert.deepEqual(Object.keys(file.kept), ["feature-18"]);
  const doc = readDesignDocument(file);
  // B is `more`'s first (k = 1), of the first profile's sketch, so it read "feature-18": it gets "feature-18/profile:1",
  // the same 8 points and 8 curves; A keeps "feature-18" as it was.
  assert.equal(doc.version, 19);
  assert.deepEqual(doc.kept, { "feature-18": file.kept["feature-18"], "feature-18/profile:1": file.kept["feature-18"] });
  // Builds as it did: A from the sketch, the trapezium (0,0) (10,0) (20,10) (0,10), area (10 + 20) / 2 x 10 = 150,
  // x 1 mm = 150; B from its shape, 10 x 10 x 1 = 100.
  const built = await volumesOf(doc, "feature-18");
  assert.deepEqual(built.vols.map((v) => Math.round(v * 1e6) / 1e6), [150, 100]);
  // Saved and opened again: unchanged.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(doc))), doc);
  // The first edit after opening: A's top side deleted, A lost. Its last shape is the trapezium, 150, not the square
  // (100) its copy of the shared shape holds.
  const sk = doc.sketches.find((x) => x.id === "sketch-1")!;
  const pt = (x: number, y: number) => sk.points.find((p) => p.x === x && p.y === y)!.id;
  const top = sk.curves.find((x) => x.kind === "line" && [x.start, x.end].includes(pt(0, 10)) && [x.start, x.end].includes(pt(20, 10)))!.id;
  const d = await settleKept(kernel, doc, deleteCurve(doc, "sketch-1", top));
  const out = await volumesOf(d, "feature-18");
  assert.equal(out.status, "built");
  assert.ok(Math.abs(out.vols[0] - 150) < 1e-6 && Math.abs(out.vols[1] - 100) < 1e-6, `${out.vols}`);
});

test("hand-worked upgrade: version 18's \"<extrude>/<sketch>\" key becomes a copy for each profile of that sketch, and goes", async () => {
  // Made: Sketch 1 square A (0,0)-(10,10); Sketch 2 (sketch-10) squares B (30,0)-(40,10) and C (60,0)-(70,10); one
  // extrude feature-27 of A, then B and C; B's top side deleted: B lost, filed "feature-27/sketch-10", which C read too.
  const file = v18("v18-other-sketch-kept");
  assert.deepEqual(Object.keys(file.kept), ["feature-27/sketch-10"]);
  const shape = file.kept["feature-27/sketch-10"];
  const doc = readDesignDocument(file);
  // B is `more`'s first (profile:1), C its second (profile:2), both of sketch-10: each a copy; the old key goes.
  assert.deepEqual(doc.kept, { "feature-27/profile:1": shape, "feature-27/profile:2": shape });
  // The same upgrade alone (the step the reader runs): version 19, nothing else changed.
  const up = migrateDesignV18(file);
  assert.deepEqual({ ...up, kept: undefined }, { ...file, version: 19, kept: undefined });
  // Builds as it did: A 100, B from its shape 100, C from the sketch 100, apart: three bodies, 300 in all.
  const built = await volumesOf(doc, "feature-27");
  assert.deepEqual(built.vols.map((v) => Math.round(v * 1e6) / 1e6), [100, 100, 100]);
});

test("the reader takes a profile's own key and refuses any other after the slash, saying so", () => {
  const doc = readDesignDocument(v18("v18-other-sketch-kept"));
  assert.equal(DESIGN_VERSION, 19);
  const shape = doc.kept!["feature-27/profile:1"];
  const withKey = (key: string) => JSON.parse(JSON.stringify({ ...doc, kept: { [key]: shape } }));
  // The two profiles after the first, and the first's own (the extrude's id), open.
  for (const key of ["feature-27/profile:1", "feature-27/profile:2", "feature-27"]) assert.deepEqual(Object.keys(readDesignDocument(withKey(key)).kept!), [key]);
  // Version 18's form in a version 19 file, a place past the two, the first's place (its key is the bare id), a
  // place written with a 0 before it, and words after the number: each refused, naming the key.
  for (const key of ["feature-27/sketch-10", "feature-27/profile:3", "feature-27/profile:0", "feature-27/profile:01", "feature-27/profile:1x"])
    assert.throws(() => readDesignDocument(withKey(key)), { message: `Design data keeps a shape for ${key}, which is not an extrude of a sketch in the timeline and the place of another of its profiles` });
  // A version 18 file holding a key only version 19 writes is refused, saying so.
  const file = v18("v18-shared-kept");
  assert.throws(() => readDesignDocument({ ...file, kept: { "feature-18/profile:1": file.kept["feature-18"] } }), { message: "Design data says version 18 but keeps a shape for feature-18/profile:1, a profile's own, which version 19 brought" });
});
