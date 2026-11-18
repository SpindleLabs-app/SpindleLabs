// What Design offers Laser to list (representations.ts DESIGN_OUTLINES): every ready-made profile and every sketch with
// curves that is not suppressed, by its browser name, handed over as an exact outline. Read from the project's data alone;
// the bodies' own list (lister.test.ts) stays bodies only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, RepresentationRegistry, type KernelCalls } from "@fission/core";
import { partDocument } from "../src/document.ts";
import { DESIGN_OUTLINES, registerDesign } from "../src/representations.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { suppressItem } from "../src/timeline-edits.ts";

/** A stand-in kernel: sketch_outline answers one closed 60 × 40 rectangle, whatever it is given. */
const RECT = { outer: { path: { corners: [0, 0, 60, 0, 60, 40, 0, 40], bulges: [0, 0, 0, 0] } }, holes: [] };
const kernel = { call: async (name: string) => (name === "sketch_outline" ? { closed: RECT } : {}) } as unknown as KernelCalls;
const registry = () => {
  const r = new RepresentationRegistry();
  registerDesign(r, kernel);
  return r;
};
const projectWith = (data: unknown) => ({ ...emptyProject(), workspaces: { design: data } });

test("the name is the one Laser asks for (workspaces/laser page.ts uses the same string)", () => {
  assert.equal(DESIGN_OUTLINES, "design:outlines");
});

test("a sketch with a rectangle is listed by its browser name and delivered as its exact outline; the body list is unchanged", async () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const doc = drawRectangle(s.doc, s.id, [0, 0], [60, 40]).doc;
  const r = registry();
  const listed = r.objectsOf(DESIGN_OUTLINES, projectWith(doc));
  const sketches = listed.filter((o) => o.type === "design.sketch");
  assert.equal(sketches.length, 1);
  assert.equal(sketches[0].id, s.id);
  assert.match(sketches[0].label, /^Sketch 1/);
  const { representation } = await r.deliver(sketches[0], ["outline"]);
  assert.equal(representation.kind, "outline");
  if (representation.kind === "outline") assert.deepEqual(representation.outline, RECT);
  // The bodies' list (Slice's) still holds only bodies.
  assert.ok(r.objectsOf("design", projectWith(doc)).every((o) => o.type === "design.feature"));
});

test("an empty sketch and a suppressed one are not listed (a test that can fail: the same sketch with curves is)", () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const sketchesOf = (d: unknown) => registry().objectsOf(DESIGN_OUTLINES, projectWith(d)).filter((o) => o.type === "design.sketch");
  assert.equal(sketchesOf(s.doc).length, 0);
  const drawn = drawRectangle(s.doc, s.id, [0, 0], [60, 40]).doc;
  assert.equal(sketchesOf(drawn).length, 1);
  assert.equal(sketchesOf(suppressItem(drawn, s.id, true)).length, 0);
});

test("no Design data, or data that does not read, lists nothing and never throws", () => {
  for (const data of [undefined, null, 7, "x", {}, { version: 99 }]) assert.deepEqual(registry().objectsOf(DESIGN_OUTLINES, projectWith(data)), [], JSON.stringify(data));
});

test("each listed sketch and profile is picked in the one selection as Design picks it from its browser row (Laser L1b3)", () => {
  // Design's own rows select a sketch or a profile as "outline:<its id>" (references.ts profileReference); Laser must
  // put the same thing in the selection, so a part picked there is the row lit here and back.
  const s = addSketch(partDocument("box", 40, 30, 20));
  const doc = drawRectangle(s.doc, s.id, [0, 0], [60, 40]).doc;
  const listed = registry().objectsOf(DESIGN_OUTLINES, projectWith(doc));
  const sketch = listed.find((o) => o.type === "design.sketch")!;
  assert.deepEqual(sketch.selectAs, { kind: "outline", id: `outline:${s.id}` });
  // A ready-made profile (a slot is extruded from one, "profile-1") the same way.
  const profiles = registry().objectsOf(DESIGN_OUTLINES, projectWith(partDocument("slot", 60, 20, 5))).filter((o) => o.type === "design.profile");
  assert.equal(profiles.length, 1);
  assert.deepEqual(profiles[0].selectAs, { kind: "outline", id: "outline:profile-1" });
});
