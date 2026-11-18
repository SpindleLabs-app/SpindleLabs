// Symmetric extrude (step 53a1, Fusion's Symmetric direction): the body
// goes half its distance each way from the sketch's plane, so a 10 mm
// symmetric extrude is 10 mm thick with the sketch in its middle (the
// whole length, chosen over Fusion's half length so the typed number is
// the thickness a beginner measures). Built as the same extrude started
// half the distance back along its own way: the frame's origin moved by
// −d/2 along the direction it goes (its normal, turned round when
// flipped), its axes untouched, so the kernel's frame rules (unit and
// square axes) hold exactly as before and the faces keep their roles
// (start cap, end cap, sides) and names. A symmetric extrude has no Flip:
// both ways are the same body.

import type { BodySpec, Frame } from "@fission/core";

/** The world's XY plane as a frame: an extrude without a frame is on it, going up (kernel-types.ts `Frame`). */
export const XY_FRAME: Frame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };

/**
 * The extrude `spec` (as `placedSpec` makes it, start cap on the sketch's
 * plane) moved back half its distance along the way it goes, so it reaches
 * d/2 either side of the plane. Anything else is given back as it is.
 */
export function centredSpec(spec: BodySpec): BodySpec {
  if (!("extrude" in spec)) return spec;
  const e = spec.extrude;
  const frame = e.frame ?? XY_FRAME;
  const way = e.flip === true ? -1 : 1;
  const back = (e.distance / 2) * way;
  const origin: [number, number, number] = [frame.origin[0] - back * frame.normal[0], frame.origin[1] - back * frame.normal[1], frame.origin[2] - back * frame.normal[2]];
  return { extrude: { ...e, frame: { origin, x: [...frame.x], normal: [...frame.normal] } } };
}

/** Whether an extrude's parameters say it goes both ways from its plane. */
export const isSymmetricParams = (p: Readonly<Record<string, unknown>>): boolean => p.symmetric === true;
