// A stack of sketches, each pinned to the bodies of the two extrudes before it (app hunt 2026-11-04): asking
// whether an item builds or is greyed went through every path down the stack, so the time doubled every few
// layers and a 61-item design froze the tab for 17 s when opened. Each answer is now worked out once per question.
import { test } from "node:test";
import assert from "node:assert/strict";
import { builds, buildingItems, greyedBy, greyedItems, partFeature, readDesignDocument, type DesignDocument } from "../src/document.ts";

const prov = (id: string, label: string) => ({ self: { workspace: "design", id, label }, from: [] });

/** A box, then `layers` times a sketch on XY with one point pinned to each of the last two solids, extruded. */
function stack(layers: number): DesignDocument {
  let n = 2;
  const features: unknown[] = [{ id: "feature-1", intent: { type: "box", parameters: { width: 10, depth: 10, height: 10 }, summary: "Box" }, dependsOn: [], suppressed: false, provenance: prov("feature-1", "Box 1") }];
  const sketches: unknown[] = [];
  const solids = ["feature-1"];
  for (let k = 0; k < layers; k++) {
    const s = `sketch-${n++}`, a = `point-${n++}`, b = `point-${n++}`, l = `line-${n++}`, e = `feature-${n++}`;
    const to = [solids[solids.length - 1], solids[Math.max(0, solids.length - 2)]];
    features.push({ id: s, intent: { type: "sketch", parameters: { plane: "XY" }, summary: `Sketch ${k}` }, dependsOn: [...new Set(to)], suppressed: false, provenance: prov(s, `Sketch ${k + 1}`) });
    sketches.push({ id: s, points: [{ id: a, x: 0, y: 0 }, { id: b, x: 10, y: 0 }], curves: [{ id: l, kind: "line", start: a, end: b }], constraints: [], pins: [{ point: a, kind: "endpoint", name: "top&front", feature: to[0] }, { point: b, kind: "endpoint", name: "top&back", feature: to[1] }] });
    features.push({ id: e, intent: { type: "extrude", parameters: { sketch: s, distance: 5 }, summary: `Extrude ${k}` }, dependsOn: [s], suppressed: false, provenance: prov(e, `Extrude ${k + 1}`) });
    solids.push(e);
  }
  return readDesignDocument({ version: 7, nextId: n, profiles: [], sketches, timeline: { features } });
}

test("a 57-item pinned stack: the part, and whether the top item builds, are answered in well under a frame's worth of work each", () => {
  // 28 layers: the old search took 1.2 s here and doubled about every 3 layers more.
  const doc = stack(28);
  const top = doc.timeline.features[doc.timeline.features.length - 1];
  for (const ask of [() => partFeature(doc), () => builds(doc, top), () => greyedBy(doc, top)]) {
    const t = performance.now();
    ask();
    const ms = performance.now() - t;
    assert.ok(ms < 100, `took ${ms.toFixed(0)} ms`);
  }
});

test("the pinned stack's answers: worked by hand, and the same as the whole-timeline walk", () => {
  const doc = stack(6);
  const items = doc.timeline.features;
  // Nothing suppressed and no marker: every item builds and none is greyed, so the part is the last extrude.
  assert.equal(partFeature(doc), items[items.length - 1]);
  for (const f of items) assert.equal(builds(doc, f), true);
  // Suppress the box: layer 1's sketch is pinned to it, layer 2's too (its two pins name extrude 1 and the box),
  // and every later layer through those, so every other item is greyed by the box and nothing builds.
  const off: DesignDocument = { ...doc, timeline: { ...doc.timeline, features: items.map((f) => (f.id === "feature-1" ? { ...f, suppressed: true } : f)) } };
  const offItems = off.timeline.features;
  for (const f of offItems.slice(1)) assert.equal(greyedBy(off, f), "feature-1", f.id);
  assert.equal(partFeature(off), null);
  // Suppress only the top layer's sketch: its extrude is greyed by it, so the part is the extrude below.
  const topSketch = items[items.length - 2];
  const topOff: DesignDocument = { ...doc, timeline: { ...doc.timeline, features: items.map((f) => (f === topSketch ? { ...f, suppressed: true } : f)) } };
  assert.equal(partFeature(topOff), topOff.timeline.features[items.length - 3]);
  // The per-item answers agree with the whole-timeline walk on all three.
  for (const d of [doc, off, topOff]) {
    const building = buildingItems(d);
    const greyed = greyedItems(d);
    for (const f of d.timeline.features) {
      assert.equal(builds(d, f), building.has(f), f.id);
      if (!f.suppressed) assert.equal(greyedBy(d, f), greyed.get(f) ?? null, f.id);
    }
  }
});
