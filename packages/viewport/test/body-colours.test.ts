import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { NO_HIGHLIGHT, triangleColours, type AnalysisOverlay, type OverlaySeverity, type ViewportHighlight } from "@fission/core";
import { copyChanged, edgeColourArray, faceColourArray, linearOf, mapColourArray, MAP_SELECTED_MIX } from "../src/body-colours.ts";
import { BASE_COLOUR, faceMixes, segmentColours, SELECTION_COLOUR, tint, type Rgb } from "../src/highlight.ts";

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** Viewer.paint's colours as it worked them out before this pass (a THREE.Color per vertex), kept here as the reference. */
function before(mesh: { positions: number[]; indices: number[]; triangle_faces: number[]; edge_lines: number[]; edge_line_edges: number[] }, overlays: AnalysisOverlay[], highlight: ViewportHighlight, hoverFace: number | null, hoverEdge: number | null) {
  const linear = (c: Rgb) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).toArray();
  const perTriangle = triangleColours(mesh.triangle_faces, overlays);
  const mixes = faceMixes(mesh.triangle_faces, highlight, hoverFace);
  const colours = new Float32Array(mesh.positions.length).fill(0);
  for (let i = 0; i < colours.length / 3; i++) colours.set(linear(BASE_COLOUR), 3 * i);
  perTriangle.forEach((c, t) => {
    if (!c && mixes[t] === 0) return;
    const colour = linear(tint(c ?? BASE_COLOUR, SELECTION_COLOUR, mixes[t]));
    for (let k = 0; k < 3; k++) colours.set(colour, 3 * mesh.indices[3 * t + k]);
  });
  const lineColours = new Float32Array(mesh.edge_lines.length);
  segmentColours(mesh.edge_line_edges, highlight, hoverEdge).forEach((c, s) => {
    const colour = linear(c);
    lineColours.set(colour, 6 * s);
    lineColours.set(colour, 6 * s + 3);
  });
  return { colours, lineColours };
}

test("the base colour's linear value, worked by hand", () => {
  // 0x9a / 255 = 0.60392 in sRGB; linear = ((0.60392 + 0.055) / 1.055)^2.4 = 0.62457^2.4 = e^(2.4 × ln 0.62457) = e^(−1.1297) = 0.3231.
  assert.ok(Math.abs(linearOf(BASE_COLOUR)[0] - 0.3231) < 1e-4);
  // 0 and 1 are their own linear values.
  assert.deepEqual(linearOf([0, 1, 0]), [0, 1, 0]);
});

test("copyChanged copies and names only the run that changed, worked by hand", () => {
  const target = new Float32Array([1, 2, 3, 4, 5, 6]);
  // Entries 1 and 3 differ: the run is 1..3, three long, and the target becomes the new array.
  assert.deepEqual(copyChanged(target, new Float32Array([1, 9, 3, 8, 5, 6])), { start: 1, count: 3 });
  assert.deepEqual([...target], [1, 9, 3, 8, 5, 6]);
  assert.equal(copyChanged(target, new Float32Array([1, 9, 3, 8, 5, 6])), null);
  assert.deepEqual(copyChanged(target, new Float32Array([0, 9, 3, 8, 5, 7])), { start: 0, count: 6 });
});

test("paint's colours are exactly as before on seeded bodies, overlays, selections and hovers, reusing the arrays", () => {
  const severities: OverlaySeverity[] = ["info", "warning", "error"];
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = seeded(seed);
    const faces = 1 + Math.floor(rnd() * 30);
    const edges = 1 + Math.floor(rnd() * 40);
    const vertices = 3 + Math.floor(rnd() * 300);
    const triangles = 1 + Math.floor(rnd() * 200);
    // Vertices one face each, as the kernel's display mesh has them; triangles pick their face's vertices.
    const vertexFace = Array.from({ length: vertices }, () => Math.floor(rnd() * faces));
    const triangle_faces: number[] = [];
    const indices: number[] = [];
    for (let t = 0; t < triangles; t++) {
      const v = Math.floor(rnd() * vertices);
      triangle_faces.push(vertexFace[v]);
      indices.push(v, Math.floor(rnd() * vertices), Math.floor(rnd() * vertices));
    }
    const segments = Math.floor(rnd() * 120);
    const mesh = {
      positions: Array.from({ length: 3 * vertices }, () => rnd()),
      indices,
      triangle_faces,
      edge_lines: Array.from({ length: 6 * segments }, () => rnd()),
      edge_line_edges: Array.from({ length: segments }, () => Math.floor(rnd() * edges)),
    };
    const faceOut = new Float32Array(mesh.positions.length);
    const edgeOut = new Float32Array(mesh.edge_lines.length);
    for (let step = 0; step < 6; step++) {
      const pick = (n: number, of: number) => Array.from({ length: n }, () => Math.floor(rnd() * of));
      const highlight: ViewportHighlight = step === 0 ? NO_HIGHLIGHT : { body: rnd() < 0.15, faces: pick(Math.floor(rnd() * 4), faces + 2), edges: pick(Math.floor(rnd() * 4), edges + 2) };
      const overlays: AnalysisOverlay[] = Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({
        id: `o${i}`,
        label: "check",
        marks: Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => {
          const severity = severities[Math.floor(rnd() * 3)];
          const r = rnd();
          return r < 0.5 ? { target: { face: Math.floor(rnd() * faces) }, severity } : r < 0.85 ? { target: { triangles: pick(5, triangles + 3) }, severity } : { target: { body: true as const }, severity };
        }),
      }));
      const hoverFace = rnd() < 0.5 ? Math.floor(rnd() * faces) : null;
      const hoverEdge = rnd() < 0.5 ? Math.floor(rnd() * edges) : null;
      const want = before(mesh, overlays, highlight, hoverFace, hoverEdge);
      assert.deepEqual(faceColourArray(mesh, overlays, highlight, hoverFace, faceOut), want.colours, `faces, seed ${seed} step ${step}`);
      assert.deepEqual(edgeColourArray(mesh.edge_line_edges, highlight, hoverEdge, edgeOut), want.lineColours, `edges, seed ${seed} step ${step}`);
    }
  }
});

test("over a colour map a selected face shows as a pale patch: each of its vertices MAP_SELECTED_MIX of the way to white (by hand)", () => {
  // Two triangles, faces 0 and 1, three vertices each; the map gives every vertex (0.2, 0.4, 0.6) linear.
  const mesh = { positions: new Array(18).fill(0), indices: [0, 1, 2, 3, 4, 5], triangle_faces: [0, 1] };
  const map = new Float32Array(18).fill(0).map((_, i) => [0.2, 0.4, 0.6][i % 3]);
  const out = mapColourArray(mesh, map, { body: false, faces: [1], edges: [] }, new Float32Array(18));
  // Face 0 keeps the map; face 1: 0.2 + (1 − 0.2) × m, 0.4 + 0.6m, 0.6 + 0.4m.
  const m = MAP_SELECTED_MIX;
  const want = [0.2 + 0.8 * m, 0.4 + 0.6 * m, 0.6 + 0.4 * m];
  for (let v = 0; v < 6; v++)
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[3 * v + k] - (v < 3 ? [0.2, 0.4, 0.6][k] : want[k])) < 1e-6, `vertex ${v}`);
  // Nothing selected: the map as it is; the map itself never changed.
  assert.deepEqual([...mapColourArray(mesh, map, { body: false, faces: [], edges: [] }, new Float32Array(18))], [...map]);
  assert.equal(map[9], Math.fround(0.2));
});
