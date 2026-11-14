// The body's vertex and edge colours (big designs speed pass): what
// Viewer.paint draws after every hover, selection or overlay change, worked
// out into arrays kept from one paint to the next instead of allocating a
// colour per vertex, and handed to the GPU only where they changed.
//
// The numbers are exactly the ones paint made before: each colour is
// converted from sRGB by THREE.Color.setRGB as it was, once per distinct
// colour instead of once per vertex; the vertices take the base colour and
// then, triangle by triangle in order, their triangle's tint.

import * as THREE from "three";
import { triangleColours, type AnalysisOverlay, type DisplayMesh, type ViewportHighlight } from "@fission/core";
import { BASE_COLOUR, faceMixes, segmentColours, SELECTION_COLOUR, tint, type Rgb } from "./highlight.ts";

const scratch = new THREE.Color();

/** An sRGB colour as the linear numbers a vertex colour holds (THREE.Color converts from sRGB). */
export function linearOf(c: Rgb): [number, number, number] {
  scratch.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  return [scratch.r, scratch.g, scratch.b];
}

/**
 * Each vertex's colour (linear RGB, three numbers a vertex) into `out`
 * (positions.length long): the base colour, a face's overlay colour, tinted
 * towards the selection colour on selected and hovered faces. Vertices
 * belong to one face each (the kernel's display mesh), so per-vertex colour
 * is per-face colour.
 */
export function faceColourArray(mesh: Pick<DisplayMesh, "positions" | "indices" | "triangle_faces">, overlays: readonly AnalysisOverlay[], highlight: ViewportHighlight, hoverFace: number | null, out: Float32Array): Float32Array {
  const perTriangle = triangleColours(mesh.triangle_faces, overlays);
  const mixes = faceMixes(mesh.triangle_faces, highlight, hoverFace);
  const base = linearOf(BASE_COLOUR);
  for (let i = 0; i + 2 < out.length; i += 3) {
    out[i] = base[0];
    out[i + 1] = base[1];
    out[i + 2] = base[2];
  }
  // Tints are mixed in sRGB, like the colours are chosen; one conversion per (colour, mix) met.
  const tinted = new Map<Rgb | null, Map<number, [number, number, number]>>();
  const { indices } = mesh;
  perTriangle.forEach((c, t) => {
    const mix = mixes[t];
    if (!c && mix === 0) return;
    let byMix = tinted.get(c);
    if (!byMix) tinted.set(c, (byMix = new Map()));
    let colour = byMix.get(mix);
    if (!colour) byMix.set(mix, (colour = linearOf(tint(c ?? BASE_COLOUR, SELECTION_COLOUR, mix))));
    for (let k = 0; k < 3; k++) out.set(colour, 3 * indices[3 * t + k]);
  });
  return out;
}

/** Each edge-line segment's colour, start and end (six numbers a segment), into `out` (edge_lines.length long). */
export function edgeColourArray(edgeLineEdges: readonly number[], highlight: ViewportHighlight, hoverEdge: number | null, out: Float32Array): Float32Array {
  const linear = new Map<Rgb, [number, number, number]>();
  out.fill(0);
  segmentColours(edgeLineEdges, highlight, hoverEdge).forEach((c, s) => {
    let colour = linear.get(c);
    if (!colour) linear.set(c, (colour = linearOf(c)));
    out.set(colour, 6 * s);
    out.set(colour, 6 * s + 3);
  });
  return out;
}

/**
 * Copies `next` over `target` (the same length) and says which run of
 * entries changed, as a start and a count, so only that run goes to the GPU;
 * null when nothing did.
 */
export function copyChanged(target: Float32Array, next: Float32Array): { start: number; count: number } | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < next.length; i++) {
    // Object.is, so a NaN stays unchanged and a −0 replacing a 0 still counts.
    if (!Object.is(target[i], next[i])) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  target.set(next.subarray(first, last + 1), first);
  return { start: first, count: last - first + 1 };
}
