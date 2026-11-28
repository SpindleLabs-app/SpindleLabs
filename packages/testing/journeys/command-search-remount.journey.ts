// SL #891 (nightly monkey): the command search box stayed open over a Design mounted afresh (an Open, or an Undo,
// restores the project and mounts Design again), and a command clicked in it then ran the old mount's code, which wrote
// to a properties panel that had left the page and threw. Design now closes its box when it is put away.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "@fission/design";
import { app } from "./design-app.ts";

test("the command search box open when Design is mounted afresh (an Undo restores the project) goes with the old mount, so none of its commands can run there (SL #891)", { timeout: 30_000 }, async () => {
  // With the old box left open the Undo never settled here (the test timed out), so the time limit makes that a failure.
  const a = await app(partDocument("box", 10, 10, 10));
  // One step to undo: Body 1 duplicated (a click on its top face, then Ctrl+D).
  const m = a.mesh()!;
  const t = m.triangle_faces.findIndex((_, k) => m.normals[3 * m.indices[3 * k] + 2] > 0.999); // a triangle facing +z: the top
  await a.pick({ face: m.triangle_faces[t] });
  await a.key("duplicate-bodies");
  assert.equal(a.doc().timeline.features.length, 2);
  await a.key("command-search");
  assert.ok(a.$("#command-search-input"), "the box is open");
  await a.undo(); // the shell's restore: Design unmounted and mounted again on the project before the Duplicate
  assert.equal(a.doc().timeline.features.length, 1);
  assert.equal(a.$("#command-search-input"), null, "the old mount's box is gone");
  assert.equal(a.$("#command-search-list"), null);
  assert.ok(await a.close());
});
