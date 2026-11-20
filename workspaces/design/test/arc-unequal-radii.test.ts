// SL #511 item 4: a hand-edited or damaged file with an arc whose ends are
// at different distances from its centre. The save/load hunt (2026-11-11)
// found that opening it solved the whole sketch again and silently moved
// points that follow no body (a rectangle corner went from (-20, 11) to
// (13.5, 20.9)). Since #545 a followed sketch is solved only round what
// moved, so the file (the hunt's own, test/files/arc-unequal-radii.json)
// now opens with only its projected points following their edge, and the
// bad arc's sketch is refused in the kernel's words when it is used. The
// reader keeps opening such an arc: a pinned arc end following a body edge
// makes one in a saved design, and refusing the file would lose that work.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { readDesignDocument } from "../src/document.ts";
import { sketchOutline } from "../src/sketch.ts";
import { BodyCache, followedDoc, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();
const file = JSON.parse(readFileSync(new URL("./files/arc-unequal-radii.json", import.meta.url), "utf8"));

test("#511 item 4, by hand: the arc's ends are 33.36 and 108.04 mm from its centre, and opening moves only the projected points", async () => {
  const doc = readDesignDocument(file.workspaces.design);
  const sketch = doc.sketches.find((s) => s.id === "sketch-14")!;
  const at = (id: string) => sketch.points.find((p) => p.id === id)!;
  // arc-25: start (-20, 11), end (56, -1.46), centre (-52, 1.5714…): √(32² + 9.4286²) = 33.36 and √(108² + 3.0314²) = 108.04.
  const r = (p: string) => Math.hypot(at(p).x - at("point-24").x, at(p).y - at("point-24").y);
  assert.ok(Math.abs(r("point-15") - 33.3601) < 1e-3 && Math.abs(r("point-23") - 108.0425) < 1e-3);
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  await cache.close();
  const after = followedDoc(doc, build).sketches.find((s) => s.id === "sketch-14")!;
  // The projected line's two points (projection-32 made line-35 from point-33 and point-34) follow the box's edge; every
  // other point, the rectangle's corner point-15 the bad arc shares included, stays exactly where the file has it.
  const projected = new Set(["point-33", "point-34"]);
  const moved = after.points.filter((p) => !projected.has(p.id) && (p.x !== at(p.id).x || p.y !== at(p.id).y)).map((p) => p.id);
  assert.deepEqual(moved, []);
  assert.deepEqual(after.points.find((p) => p.id === "point-15"), at("point-15"));
});

test("#511 item 4: the bad arc's sketch is refused in the kernel's words, naming the arc and how far off it is", async () => {
  const doc = readDesignDocument(file.workspaces.design);
  await assert.rejects(sketchOutline(kernel, doc, "sketch-14"), /^Error: arc 1 has its centre [0-9.]+ mm off the line midway between its ends; it must be within 0\.00001 mm of it, the same distance from both$/);
});
