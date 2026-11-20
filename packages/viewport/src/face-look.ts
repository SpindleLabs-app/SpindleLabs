// Turning the camera to one face of the body shown (TestLab's results card, Ben 19 Nov: a face named on the card is a
// button that shows where it is). Pure: the viewer moves the camera (ViewportView.lookAtFace), gliding there (glide.ts).

import type { DisplayMesh, Framing } from "@fission/core";
import { fitDistance, standardUp } from "./views.ts";

type Vec3 = [number, number, number];

/** Room left round a face looked at, so its edges are not on the view's border under the floating cards: 25 %. */
export const FACE_LOOK_MARGIN = 1.25;

/**
 * Below this, a face's triangles' normals cancel too much for it to have one side to be seen from (the sum's length over
 * the sum of their lengths: a flat face is 1, half a tube 2/π ≈ 0.64, a tube's whole side 0): such a face is framed from
 * where the camera already looks.
 */
export const ROUND_FACE = 0.1;

/** What looking at one face needs: the sphere round its triangles (with FACE_LOOK_MARGIN), and its outward side (unit), or null for a face round on itself. */
export interface FaceLook {
  framing: Framing;
  toward: Vec3 | null;
}

/**
 * Face `face` of a display mesh as it is looked at: the box round its triangles' corners (centre and half its diagonal,
 * as a body is framed) and the area-weighted sum of its triangles' normals (the kernel winds them outwards), as a unit
 * direction. Null when the mesh has no triangle of that face, or they have no size.
 */
export function faceLook(mesh: Pick<DisplayMesh, "positions" | "indices" | "triangle_faces">, face: number): FaceLook | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const sum = [0, 0, 0];
  let total = 0;
  const p = (i: number): Vec3 => [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
  mesh.triangle_faces.forEach((f, t) => {
    if (f !== face) return;
    const [a, b, c] = [p(mesh.indices[3 * t]), p(mesh.indices[3 * t + 1]), p(mesh.indices[3 * t + 2])];
    for (const q of [a, b, c])
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], q[k]);
        hi[k] = Math.max(hi[k], q[k]);
      }
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (let k = 0; k < 3; k++) sum[k] += n[k];
    total += Math.hypot(n[0], n[1], n[2]);
  });
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
  if (!(total > 0) || !(radius > 0)) return null;
  const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const length = Math.hypot(sum[0], sum[1], sum[2]);
  const toward: Vec3 | null = length / total < ROUND_FACE ? null : [sum[0] / length, sum[1] / length, sum[2] / length];
  return { framing: { centre, radius: radius * FACE_LOOK_MARGIN }, toward };
}

/**
 * The camera for a face: looking at its centre from `fitDistance` away along its outward side (or along `towardNow`, the
 * way the camera looks from now, for a face with none), the screen's up the nearest standard view's (a top face is seen
 * as the top view, a side face with Z up). Vertical fov in degrees, aspect = width / height.
 */
export function faceLookPose(look: FaceLook, towardNow: readonly number[], fovDeg = 45, aspect = 1): { position: Vec3; target: Vec3; up: Vec3 } {
  let d = look.toward ?? towardNow;
  const l = Math.hypot(d[0], d[1], d[2]);
  d = l > 0 ? [d[0] / l, d[1] / l, d[2] / l] : [0, 0, 1];
  const dist = fitDistance(look.framing.radius, fovDeg, aspect);
  const [cx, cy, cz] = look.framing.centre;
  return { position: [cx + d[0] * dist, cy + d[1] * dist, cz + d[2] * dist], target: [cx, cy, cz], up: standardUp(d) };
}
