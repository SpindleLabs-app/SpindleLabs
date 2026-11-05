// The places an overlay points at, as drawn (places-layer.ts, 36d): an
// edge or a gap as a line and a corner as a dot, in its severity's colour,
// over everything (no depth test), built once per change.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { AnalysisOverlay } from "@fission/core";
import { PLACE_ORDER, PLACE_PX, PlacesLayer } from "../src/places-layer.ts";

const REFUSED: AnalysisOverlay = {
  id: "design.refused-combine",
  label: "Where Combine 1 can't be made",
  marks: [],
  places: [
    { severity: "error", from: [10, 0, 10], to: [10, 10, 10] },
    { severity: "error", point: [10, 10, 10] },
  ],
};

test("a refused Combine's edge is one line from end to end and its corner one dot, over everything, a few pixels wide", () => {
  const layer = new PlacesLayer();
  layer.show([REFUSED]);
  assert.deepEqual(layer.counts, { points: 1, lines: 1 });
  const [line, dots] = layer.group.children as [LineSegments2, THREE.Points];
  assert.ok(line instanceof LineSegments2 && dots instanceof THREE.Points);
  // The line's two ends are the edge's, as given: (10, 0, 10) and (10, 10, 10).
  const start = line.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
  const end = line.geometry.getAttribute("instanceEnd") as THREE.InterleavedBufferAttribute;
  assert.equal(start.count, 1);
  assert.deepEqual([start.getX(0), start.getY(0), start.getZ(0), end.getX(0), end.getY(0), end.getZ(0)], [10, 0, 10, 10, 10, 10]);
  assert.deepEqual([...dots.geometry.getAttribute("position").array], [10, 10, 10]);
  for (const o of [line, dots]) {
    const m = o.material as THREE.Material;
    assert.equal(m.depthTest, false, "drawn over the bodies");
    assert.equal(o.renderOrder, PLACE_ORDER);
  }
  assert.equal(line.material.linewidth, PLACE_PX.line);
  assert.equal((dots.material as THREE.PointsMaterial).size, PLACE_PX.dot);
  assert.equal((dots.material as THREE.PointsMaterial).sizeAttenuation, false, "the same size at any zoom");
});

test("the same places again build nothing; none left clears the layer", () => {
  const layer = new PlacesLayer();
  layer.show([REFUSED]);
  const first = [...layer.group.children];
  layer.show([{ ...REFUSED, label: "relabelled" }]);
  assert.deepEqual(layer.group.children, first, "a repaint for a hover keeps the same objects");
  layer.show([{ id: "other", label: "x", marks: [] }]);
  assert.equal(layer.group.children.length, 0);
  assert.deepEqual(layer.counts, { points: 0, lines: 0 });
});
