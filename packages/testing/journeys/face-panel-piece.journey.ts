// A face or edge picked on a split-off piece, in the running Design
// workspace (happy-dom, the real kernel), SL #538 item 4: the properties
// panel's Body section names the body the pick is on, with its volume.
// Until then it named the first body made by the item in the face's name:
// the far chunk of a cut bar showed "Body 1" and the near chunk's 6,000 mm³.

import { test } from "node:test";
import assert from "node:assert/strict";
import { addSketch, drawRectangle, extrudeSketch, partDocument } from "@fission/design";
import { app } from "./design-app.ts";

test("hand-worked: a bar cut in two by an Extrude Cut: a face or edge picked on either chunk shows that chunk's name and volume", async () => {
  // The bar 100 × 20 × 10 at the origin; the slot x 30..40, y −10..30 cut 20 up through it. The bar's id stays on
  // x 0..30 (Body 1: 30 × 20 × 10 = 6,000 mm³); x 40..100 is the extrude's piece (Body 2: 60 × 20 × 10 = 12,000 mm³).
  const start = partDocument("box", 100, 20, 10);
  const s = addSketch(start);
  const e = extrudeSketch(drawRectangle(s.doc, s.id, [30, -10], [40, 30]).doc, s.id, 20, false, undefined, { operation: "cut", bodies: [`body:${start.timeline.features[0].id}`] });
  const a = await app(e.doc);
  const m = a.mesh()!;
  const x = (i: number) => m.positions[3 * i];
  const z = (i: number) => m.positions[3 * i + 2];
  /** The joined face all of whose corners are at z = 10 (a top), on the far chunk (x ≥ 40) or the near one (x ≤ 30). */
  const top = (far: boolean) => {
    const faces = new Map<number, boolean>();
    m.triangle_faces.forEach((f, t) => {
      for (let k = 0; k < 3; k++) faces.set(f, (faces.get(f) ?? true) && z(m.indices[3 * t + k]) === 10 && (far ? x(m.indices[3 * t + k]) >= 40 : x(m.indices[3 * t + k]) <= 30));
    });
    const found = [...faces].filter(([, all]) => all).map(([f]) => f);
    assert.equal(found.length, 1, `one top on the ${far ? "far" : "near"} chunk`);
    return found[0];
  };
  /** The joined edge running along x = `at` at z = 10 (a top's end edge across the bar). */
  const endEdge = (at: number) => {
    const lines = new Map<number, boolean>();
    m.edge_line_edges.forEach((edge, l) => {
      const ends = [0, 3].map((k) => [m.edge_lines[6 * l + k], m.edge_lines[6 * l + k + 2]]);
      lines.set(edge, (lines.get(edge) ?? true) && ends.every(([ex, ez]) => ex === at && ez === 10));
    });
    const found = [...lines].filter(([, all]) => all).map(([edge]) => edge);
    assert.equal(found.length, 1, `one edge along x = ${at} at z = 10`);
    return found[0];
  };
  const panel = () => `${a.$("#body-heading")!.textContent}: ${a.$("#volume")!.textContent}`;
  const picked = async (pick: { face?: number; edge?: number }) => {
    a.selection.clear();
    await a.settle();
    await a.pick(pick);
    return panel();
  };
  assert.match(await picked({ face: top(false) }), /^Body 1: 6[,  ]?000(\D|$)/);
  assert.match(await picked({ face: top(true) }), /^Body 2: 12[,  ]?000(\D|$)/);
  // The far chunk's edges too: its top's edge on the slot's wall (x = 40) and its far end's (x = 100).
  assert.match(await picked({ edge: endEdge(40) }), /^Body 2: 12[,  ]?000(\D|$)/);
  assert.match(await picked({ edge: endEdge(100) }), /^Body 2: 12[,  ]?000(\D|$)/);
  // And the near chunk's, on its own wall (x = 30) and the bar's left end (x = 0).
  assert.match(await picked({ edge: endEdge(30) }), /^Body 1: 6[,  ]?000(\D|$)/);
  assert.match(await picked({ edge: endEdge(0) }), /^Body 1: 6[,  ]?000(\D|$)/);
});
