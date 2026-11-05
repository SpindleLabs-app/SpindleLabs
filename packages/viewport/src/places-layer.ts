// Places an overlay points at (36d, core's `OverlayPlace`): where a refused
// Combine's result would touch itself or be too thin, which have no face of
// their own to colour. Each corner a dot and each edge or gap a line, a few
// pixels wide whatever the zoom, in its severity's colour, drawn over
// everything (no depth test), so a place inside or behind the bodies still
// shows. Rebuilt whenever the overlays change; the viewer sets the lines'
// resolution from each view's renderer as it draws, as the body's edges.

import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { overlayPlaces, type AnalysisOverlay } from "@fission/core";

/** Over Move's handles (11) too: a refusal's place must show whatever else is drawn. */
export const PLACE_ORDER = 12;
/** A line's width and a dot's size, in CSS pixels. */
export const PLACE_PX = { line: 4, dot: 11 };

export class PlacesLayer {
  readonly group = new THREE.Group();
  /** How many dots and lines are drawn (the viewer says it on its element, `data-overlay-places`, for the e2e test). */
  counts = { points: 0, lines: 0 };

  /** What is drawn, so a repaint for a hover (most of them) builds nothing again. */
  private drawn = "";

  show(overlays: readonly AnalysisOverlay[]) {
    const { points, lines } = overlayPlaces(overlays);
    const key = JSON.stringify([points, lines]);
    if (key === this.drawn) return;
    this.clear();
    this.drawn = key;
    this.counts = { points: points.length, lines: lines.length };
    const linear = (c: readonly number[]) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    if (lines.length > 0) {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(lines.flatMap((l) => [...l.from, ...l.to]));
      geometry.setColors(lines.flatMap((l) => {
        const c = linear(l.colour);
        return [c.r, c.g, c.b, c.r, c.g, c.b];
      }));
      const material = new LineMaterial({ vertexColors: true, linewidth: PLACE_PX.line, depthTest: false, depthWrite: false, transparent: true });
      const mesh = new LineSegments2(geometry, material);
      mesh.renderOrder = PLACE_ORDER;
      mesh.onBeforeRender = (renderer) => renderer.getSize(material.resolution);
      this.group.add(mesh);
    }
    if (points.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap((p) => p.at), 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(points.flatMap((p) => linear(p.colour).toArray()), 3));
      const material = new THREE.PointsMaterial({ size: PLACE_PX.dot, sizeAttenuation: false, vertexColors: true, depthTest: false, depthWrite: false, transparent: true });
      const dots = new THREE.Points(geometry, material);
      dots.renderOrder = PLACE_ORDER;
      this.group.add(dots);
    }
  }

  private clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    this.counts = { points: 0, lines: 0 };
  }
}
