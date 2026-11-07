// Overhangs that need supports, found by angle on the bodies' meshes (the
// rule H1a will paint with; here it gives the supports hint after a slice).
// A triangle needs support when it faces down more steeply than the angle
// allows: the slicing engine's own supports prop up a layer where it hangs
// out further than dz·tan(angle) past the layer below, so a wall leaning
// out exactly at the angle (45°) prints without, and one leaning further
// needs them.
//
// Worked by hand: a wall leaning out by λ from upright has outward normal at λ below the
// horizontal: n_z = −sin λ. It needs support when λ > angle, that is when
// −n_z > sin(angle). (A flat underside: λ = 90°, n_z = −1, always; an
// upright wall: λ = 0, n_z = 0, never; at 45°, −n_z = sin 45° exactly, not.)
// Triangles lying on the plate (every corner within 0.01 mm of the lowest
// point of all the bodies, which the engine puts on the plate) rest on it.

/** The overhang angle the engine's supports use: degrees a wall may lean out from upright and print without them. */
export const OVERHANG_ANGLE = 45;
/** How close to the lowest point (mm) a triangle counts as lying on the plate: levelNote's 0.01 mm. */
export const ON_PLATE_MM = 0.01;
/** Below this much hanging area (mm², a 2 mm × 2.5 mm patch) the hint says supports are not needed: a sliver that small bridges. */
export const SUPPORTS_MIN_MM2 = 5;

/** Each triangle's three corners in binary STL files (80-byte header, a count, then 50 bytes a triangle: normal, three corners, 2 spare), files back to back. */
function* triangles(files: readonly Uint8Array[]): Generator<number[]> {
  for (const stl of files) {
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    const count = stl.length >= 84 ? Math.min(view.getUint32(80, true), Math.floor((stl.length - 84) / 50)) : 0;
    for (let t = 0; t < count; t++) {
      const c: number[] = [];
      for (let k = 0; k < 9; k++) c.push(view.getFloat32(84 + t * 50 + 12 + k * 4, true));
      yield c;
    }
  }
}

/**
 * The area (mm²) of the bodies' faces that hang out more than `angle` degrees from upright with the plate not under
 * them: what supports would hold up. Faces are oriented by their corners' order (outward by the right-hand rule, as
 * the kernel writes them), never by the file's stored normal. Triangles with no area, or a corner that is not a
 * number, add nothing. 0 for no triangles, and for an angle that is not a number in 0–90. Each body is its own mesh, so
 * a face resting on another body (a plate on a column, before Combine) counts as hanging: the hint words carry no
 * figure for that reason.
 */
export function overhangArea(files: readonly Uint8Array[], angle: number = OVERHANG_ANGLE): number {
  if (!(angle >= 0 && angle <= 90)) return 0;
  let floor = Infinity;
  for (const c of triangles(files)) for (const z of [c[2], c[5], c[8]]) if (Number.isFinite(z)) floor = Math.min(floor, z);
  if (!Number.isFinite(floor)) return 0;
  const limit = Math.sin((angle * Math.PI) / 180);
  let area = 0;
  for (const c of triangles(files)) {
    if (!c.every(Number.isFinite)) continue;
    if (Math.max(c[2], c[5], c[8]) - floor <= ON_PLATE_MM) continue; // on the plate
    const [ux, uy, uz] = [c[3] - c[0], c[4] - c[1], c[5] - c[2]];
    const [vx, vy, vz] = [c[6] - c[0], c[7] - c[1], c[8] - c[2]];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 0)) continue;
    if (-n[2] / len > limit) area += len / 2;
  }
  return area;
}

/** What the hint after a slice says: whether supports are recommended, its words, and the switch it offers (null when the choice already agrees). */
export interface SupportsHint {
  recommended: boolean;
  words: string;
  /** The Supports choice its button sets, and the button's words; null when the choice made already agrees. */
  flip: { to: "normal" | "off"; label: string } | null;
}

/** The hint for `overhangMm2` of hanging area with supports `on` or off; null when the area is not a number (nothing known). */
export function supportsHint(overhangMm2: number, on: boolean): SupportsHint | null {
  if (!(overhangMm2 >= 0) || !Number.isFinite(overhangMm2)) return null;
  if (overhangMm2 >= SUPPORTS_MIN_MM2) {
    return {
      recommended: true,
      words: `Supports recommended: part of it hangs out more than ${OVERHANG_ANGLE}° with nothing under it.`,
      flip: on ? null : { to: "normal", label: "Turn supports on" },
    };
  }
  const words =
    overhangMm2 > 0
      ? `Supports not needed: only a sliver hangs out more than ${OVERHANG_ANGLE}°, small enough to print without.`
      : `Supports not needed: nothing hangs out more than ${OVERHANG_ANGLE}°.`;
  return { recommended: false, words, flip: on ? { to: "off", label: "Turn supports off" } : null };
}
