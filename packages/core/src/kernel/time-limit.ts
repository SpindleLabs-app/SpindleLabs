// How long each kernel call may take before the app gives up on it (step
// 35d3, the kernel watchdog of the boolean plan's rule 6: the only
// wall-clock limit anywhere, so a result never depends on the machine, only
// whether it arrived in time).
//
// A call's limit is its size in "calibration units", times how long one
// unit takes on this device, times HEADROOM, and never under the floor. One
// unit is the calibration boolean: two 10 mm cubes overlapping corner to
// corner, joined (36 face pairs), which the worker times as it starts
// (kernel.worker.ts, `calibrate`), so a slow phone gets limits as much
// longer as its kernel is slower, and is never failed for being slow.
//
// The cost per unit of size is measured on the shipped WebAssembly build
// against that same calibration boolean (2026-10-31, 1.0 ms a unit, the
// 35d2 kernel in Node): each is the worst ratio over sizes, which comes at
// the largest legal input, since every cost grows a little faster than its
// size. So the limit of any legal call is at least HEADROOM times what it
// needs, on any device whose calibration is as slow as its other calls.
import type { KernelOps } from "./kernel-client.ts";
import type { BodyHandle, BodySpec, BooleanOp, BooleanResult, Loop, Outline, ShapeSpec, SupportStyle } from "./kernel-types.ts";

/** The calibration boolean's bodies: two 10 mm cubes, the second moved 5 mm along each axis, so they overlap in a 5 mm cube (36 face pairs). */
export const CALIBRATION_TARGET: BodySpec = { box: { width: 10, depth: 10, height: 10 } };
export const CALIBRATION_TOOL: BodySpec = { moved: { body: { box: { width: 10, depth: 10, height: 10 } }, moves: [{ move: [5, 5, 5] }] } };

/** How long the calibration runs: its boolean again and again for at least 50 ms and 3 runs (at most 1,000), so a coarse clock or one slow first run hardly counts. */
export const CALIBRATION_MS = 50;
export const CALIBRATION_LEAST_RUNS = 3;
export const CALIBRATION_MOST_RUNS = 1000;

/** The kernel calls the calibration makes, as the worker (or a test) has them. */
export interface CalibrationCalls {
  build(spec: BodySpec): BodyHandle;
  boolean(target: BodyHandle, tools: BodyHandle[], op: BooleanOp): BooleanResult;
  free(body: BodyHandle): void;
  now(): number;
}

/**
 * Times the calibration boolean (the cubes joined) on this device: the ms
 * one unit takes. Leaves no body behind. Throws what the kernel throws.
 */
export function calibrate(calls: CalibrationCalls): number {
  const target = calls.build(CALIBRATION_TARGET);
  const tool = calls.build(CALIBRATION_TOOL);
  try {
    const start = calls.now();
    let runs = 0;
    let took = 0;
    while (runs < CALIBRATION_MOST_RUNS && (runs < CALIBRATION_LEAST_RUNS || took < CALIBRATION_MS)) {
      calls.boolean(target, [tool], "union").bodies.forEach((body) => calls.free(body));
      runs++;
      took = calls.now() - start;
    }
    return took / runs;
  } finally {
    calls.free(target);
    calls.free(tool);
  }
}

/** No call's limit is shorter: several seconds, so a call never fails for a hiccup of a busy device. */
export const LIMIT_FLOOR_MS = 10_000;

/** How many times its measured worst cost a call may take (as the kernel's own time budgets allow: about four). */
export const HEADROOM = 4;

/**
 * One calibration unit's time when the worker didn't measure it (a build
 * without the calibration boolean): 20 ms, twenty times this measuring
 * machine, a slow phone's worth.
 */
export const DEFAULT_UNIT_MS = 20;

/**
 * Units per face pair of a boolean (target faces × tool faces). Measured on
 * crossed gratings of n slots (6 + 4n faces each): A − B, the slowest op,
 * took 0.022 units a pair at n = 5, 0.052 at 20, 0.082 at 55 and 0.166 at
 * 111 (33,613 ms for 202,500 pairs), the costliest legal boolean.
 */
export const UNITS_PER_PAIR = 0.17;

/**
 * The most face pairs one boolean is timed for: the costliest legal boolean's
 * (111-slot gratings, 450 faces each). Bodies with more faces meet in fewer
 * places than the kernel's cap on meeting points allows, or are refused.
 */
export const MOST_PAIRS = 450 * 450;

/**
 * Units per corner of a body's profile (a circle counting as one, as the
 * kernel counts them): a 100 m plate with 1,996 round holes at the most
 * chords, the most corners a profile may have, built in 18,270 ms and shown
 * in 3,560 ms (10.9 units a corner); 5.8 a corner with 100 holes.
 */
export const UNITS_PER_CORNER = 11;

/** Units of a sphere's mesh at the most chords (a 500 mm sphere: 60 ms to show, 2 faces, 65,024 triangles). */
export const UNITS_PER_SPHERE = 60;

/**
 * Units per face of a body the kernel meshes again (body_view of a hidden
 * body, its STL or STEP), when the face's shape isn't known: a planar face
 * of the 1,996-hole plate took 1.8, a sphere's 30.
 */
export const UNITS_PER_FACE = 30;

/**
 * Units of a sketch's outline per curve, and per pair of curves (each pair
 * is checked for crossings): a closed loop of 2,000 lines took 458 ms
 * (0.23 a curve; 1.15e-4 a pair), 100 lines 5.3 ms (0.053; 5.3e-4).
 */
export const UNITS_PER_CURVE = 0.25;
export const UNITS_PER_CURVE_PAIR = 1.2e-4;

/** The units of finding the outline of a sketch of `curves` lines, circles and arcs. */
export function sketchUnits(curves: number): number {
  return UNITS_PER_CURVE * curves + UNITS_PER_CURVE_PAIR * curves * curves;
}

/**
 * Units of a sketch solve (step 47) per arc cubed: its Newton steps cost
 * about (arcs)² × (unknowns) each and a failure solves several prefixes.
 * The costliest sketch the kernel's tests know (a chain whose newest arc
 * fails) took 5.3e-4 at 25 arcs (14.5 ms), 3.6e-4 at 50 and 3.0e-4 at 100
 * (535 ms, the most a sketch may have) on the 47d1 build (unit 1.76 ms);
 * below 25 arcs every solve is a few ms, far under the floor. Lines alone
 * (no Newton) are well under a second at the 2,000-point limit, under the
 * floor too.
 */
export const UNITS_PER_ARC_CUBED = 6e-4;

/** The units of solving the sketch `text` (the solver's JSON): its arcs counted where the text names one. */
export function solveUnits(text: string): number {
  const arcs = text.split('"arc"').length - 1;
  return UNITS_PER_ARC_CUBED * arcs ** 3;
}

/**
 * Units of slicing per triangle per layer. Measured with 3 walls and 15 %
 * infill: the 2 mm grating of 111 slots (2,232 triangles) 0.088 at 0.2 mm
 * layers (1,967 ms), 0.081 at 0.08 mm and 0.097 with tree supports (the
 * most seen); a 20 mm box 0.06 (12 triangles, 100 layers, 74 ms); a 100 mm
 * cylinder 0.018 (628, 500, 5.5 s); a 120 mm sphere 0.0019 (59,048, 1,200,
 * 138 s). Generous for big meshes, whose layers each cut only a few of
 * their triangles, but never short.
 */
export const UNITS_PER_TRIANGLE_LAYER = 0.12;

/**
 * Units of slicing per mm² of the part's footprint (its box seen from above)
 * per layer, per "fill share" (0.25 + infill / 100: the walls, top and bottom
 * skins and sparse lines all grow with the area to fill). A box is 12
 * triangles however big, so the triangle count alone calls a 246 × 246 ×
 * 245 mm box at 100 % infill cheap: it took 24.4 s against a 24.1 s limit
 * and was stopped, 4.05 times the units' promise on one calibration and 8.7
 * on a faster one (slicer hunt 2026-10-31, M8). Measured again on the
 * shipped build at 2 walls, 0.2 mm layers and 100 % infill (calibration
 * 1.69 ms a unit), in units per mm²-layer before the share: 100 × 100 × 100
 * mm 6.1e-4 (5.2 s), 150 mm cube 3.7e-4 (10.6 s), 200 × 100 × 100 mm
 * 6.7e-4 (11.4 s); the hunt's box needed 2.1e-4. At 15 % they were 6e-5 to
 * 1e-4. 6e-4 times the full share 1.25 is 7.5e-4: above every one.
 */
export const UNITS_PER_AREA_LAYER = 6e-4;

/**
 * Units of supports, per style, from the faces that look down above the
 * first layer (the overhangs they hold up): per mm² of those faces seen from
 * above, per mm² per layer under them, and per layer of the highest one
 * (slicer hunt 2026-11-04, inputs 1: tree supports under an 80 mm plate on a
 * 10 mm column took 15 s against the 10 s floor, the supports uncounted).
 * Measured on the shipped build against the calibration, plates of 20 to 160
 * mm on columns 20 to 80 mm tall, 0.12 and 0.2 mm layers: tree supports grow
 * with the overhang's area (2.2 to 2.8 units a mm² at 100 layers under it:
 * 15,632 for the 80 mm plate, 36,568 for 120 mm) and a little with the layers
 * under it; normal supports by the layers (25 to 28 units a layer: 9,860 for
 * a 40 mm plate 400 layers up), hardly by the area. Each style's figures are
 * at least twice every one measured (time-limit.test.ts), on top of HEADROOM.
 */
export const SUPPORT_UNITS: Record<Exclude<SupportStyle, "off">, { perArea: number; perAreaLayer: number; perLayer: number }> = {
  normal: { perArea: 0.1, perAreaLayer: 0.002, perLayer: 50 },
  tree: { perArea: 4, perAreaLayer: 0.015, perLayer: 40 },
};

/** A face looks down, and may need holding up, when its normal is within 60° of straight down (the engine supports from 45°). */
const LOOKS_DOWN = -0.5;

/** One binary STL triangle's corners, as the readers below walk them. */
function eachTriangle(stl: Uint8Array, visit: (c: number[]) => void): void {
  const data = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  for (let at = 0; at + 84 <= stl.byteLength; ) {
    const count = data.getUint32(at + 80, true);
    if (at + 84 + 50 * count > stl.byteLength) break;
    for (let t = 0; t < count; t++) {
      const corners = at + 84 + 50 * t + 12;
      const c: number[] = [];
      for (let k = 0; k < 9; k++) c.push(data.getFloat32(corners + 4 * k, true));
      visit(c);
    }
    at += 84 + 50 * count;
  }
}

/**
 * The units of `style` supports under `stl` (read as sliceUnits reads it) at
 * `layerHeight`: SUPPORT_UNITS times the area seen from above of the faces
 * that look down (by their corners' winding, outward as the kernel writes
 * them) and start above the first layer, times that area times the layers
 * under each, and times the layers under the highest. A style not known is
 * costed as tree, the dearer. None for "off".
 */
export function supportUnits(stl: Uint8Array, layerHeight: number, style: SupportStyle): number {
  if (style === "off" || !(layerHeight > 0)) return 0;
  const k = style === "normal" ? SUPPORT_UNITS.normal : SUPPORT_UNITS.tree;
  let floor = Infinity;
  eachTriangle(stl, (c) => (floor = Math.min(floor, c[2], c[5], c[8])));
  if (!Number.isFinite(floor)) return 0;
  let area = 0;
  let areaLayers = 0;
  let layers = 0;
  eachTriangle(stl, (c) => {
    const low = Math.min(c[2], c[5], c[8]);
    if (!(low - floor > layerHeight)) return;
    // Twice the area seen from above, and the normal's z times twice the whole area (the cross product of two sides).
    const [ux, uy, uz, vx, vy, vz] = [c[3] - c[0], c[4] - c[1], c[5] - c[2], c[6] - c[0], c[7] - c[1], c[8] - c[2]];
    const nz = ux * vy - uy * vx;
    const whole = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
    if (!(whole > 0) || nz / whole > LOOKS_DOWN) return;
    const seen = -nz / 2;
    const under = ((c[2] + c[5] + c[8]) / 3 - floor) / layerHeight;
    area += seen;
    areaLayers += seen * under;
    layers = Math.max(layers, under);
  });
  const units = k.perArea * area + k.perAreaLayer * areaLayers + k.perLayer * layers;
  return Number.isFinite(units) ? units : 0;
}

/**
 * The units of slicing `stl` (binary STL files back to back, as slice_stl
 * takes them) at `layerHeight` and `infill` per cent: the larger of its
 * triangles times its layers (its height over the layer height) and its
 * footprint times its layers (UNITS_PER_AREA_LAYER), plus its supports'
 * (supportUnits). A file that doesn't read as STL is refused by the kernel at
 * once, so the part read so far is all that counts.
 */
export function sliceUnits(stl: Uint8Array, layerHeight: number, infill = 15, supports: SupportStyle = "off"): number {
  const data = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  let triangles = 0;
  let low = Infinity;
  let high = -Infinity;
  let [xLow, xHigh, yLow, yHigh] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let at = 0; at + 84 <= stl.byteLength; ) {
    const count = data.getUint32(at + 80, true);
    if (at + 84 + 50 * count > stl.byteLength) break;
    for (let t = 0; t < count; t++) {
      const corners = at + 84 + 50 * t + 12;
      for (let c = 0; c < 3; c++) {
        const z = data.getFloat32(corners + 12 * c + 8, true);
        if (z < low) low = z;
        if (z > high) high = z;
        const x = data.getFloat32(corners + 12 * c, true);
        const y = data.getFloat32(corners + 12 * c + 4, true);
        if (x < xLow) xLow = x;
        if (x > xHigh) xHigh = x;
        if (y < yLow) yLow = y;
        if (y > yHigh) yHigh = y;
      }
    }
    triangles += count;
    at += 84 + 50 * count;
  }
  const layers = Math.ceil((high - low) / layerHeight);
  if (!(Number.isFinite(layers) && layers > 0)) return 0;
  const share = 0.25 + (Number.isFinite(infill) ? Math.min(Math.max(infill, 0), 100) : 15) / 100;
  const area = (xHigh - xLow) * (yHigh - yLow);
  const fill = Number.isFinite(area) ? UNITS_PER_AREA_LAYER * area * layers * share : 0;
  return Math.max(UNITS_PER_TRIANGLE_LAYER * triangles * layers, fill) + supportUnits(stl, layerHeight, supports);
}

/** A built body's size, as the limits read it: its faces (for booleans) and the units of meshing it again (for its view, STL and STEP). */
export interface BodySize {
  faces: number;
  mesh: number;
}

const loopCorners = (loop: Loop) => ("circle" in loop ? 1 : loop.path.corners.length / 2);

function shape(spec: BodySpec): ShapeSpec {
  return "moved" in spec ? spec.moved.body : spec;
}

/** The units of building `spec` and showing it (make_*, body_build, export_stl). */
export function buildUnits(spec: BodySpec): number {
  const s = shape(spec);
  if ("box" in s) return 4 * UNITS_PER_CORNER;
  if ("cylinder" in s) return UNITS_PER_CORNER;
  if ("sphere" in s) return UNITS_PER_SPHERE;
  const { outer, holes } = s.extrude.profile;
  return UNITS_PER_CORNER * [outer, ...holes].reduce((n, loop) => n + loopCorners(loop), 0);
}

/** How many faces `spec` builds: a face per profile corner (a circle's one) and the two caps; a box 6, a cylinder 3, a sphere 2. */
export function buildFaces(spec: BodySpec): number {
  const s = shape(spec);
  if ("box" in s) return 6;
  if ("cylinder" in s) return 3;
  if ("sphere" in s) return 2;
  const { outer, holes } = s.extrude.profile;
  return 2 + [outer, ...holes].reduce((n, loop) => n + loopCorners(loop), 0);
}

/** A built body's size, from its spec. */
export function builtSize(spec: BodySpec): BodySize {
  return { faces: buildFaces(spec), mesh: buildUnits(spec) };
}

/**
 * The size of a body with `faces` faces whose shapes aren't known (a
 * boolean's result), each counted as costly to mesh as a sphere's face. Far
 * more than a planar face needs (the 40-slot gratings' union shown again:
 * 172 ms of 138,002), but booleans of curved faces (steps 37 onward) keep
 * it true without a change here.
 */
export function facesSize(faces: number): BodySize {
  return { faces, mesh: faces * UNITS_PER_FACE };
}

/**
 * The units of a boolean of `target` with each of `tools` in turn: each
 * tool meets every piece so far, at most all the faces of the target and
 * the tools before it, each step's pairs up to MOST_PAIRS.
 */
export function booleanUnits(target: BodySize, tools: BodySize[]): number {
  let faces = target.faces;
  let units = 0;
  for (const tool of tools) {
    units += Math.min(faces * tool.faces, MOST_PAIRS) * UNITS_PER_PAIR;
    faces += tool.faces;
  }
  return units;
}

/** The time limit, in ms, of a call of `units` on a device where a unit takes `unitMs`, no shorter than `floorMs`. */
export function limitMs(units: number, unitMs: number, floorMs: number = LIMIT_FLOOR_MS): number {
  return Math.max(floorMs, units * unitMs * HEADROOM);
}

/** A handle's size, for the calls that read it. */
export type SizeOf = (body: BodyHandle) => BodySize | undefined;

/**
 * The units of one call (`op` with `args`, handles as the app holds them;
 * `sizeOf` gives a live handle's size). The quick calls (version, the
 * pointer's rounding, freeing, counting) have none: the floor is theirs.
 */
export function callUnits<K extends keyof KernelOps>(op: K, args: KernelOps[K]["args"], sizeOf: SizeOf): number {
  // Arguments of the wrong shape (a nonsense profile, a null spec) are the
  // kernel's to refuse with its bad-request: reading them here must not throw
  // first, so anything unreadable has no units (the floor is its limit).
  try {
    const units = unitsOf(op, args, sizeOf);
    return Number.isFinite(units) && units > 0 ? units : 0;
  } catch {
    return 0;
  }
}

function unitsOf<K extends keyof KernelOps>(op: K, args: KernelOps[K]["args"], sizeOf: SizeOf): number {
  const a = args as unknown[];
  switch (op) {
    case "make_box":
      return buildUnits({ box: { width: 1, depth: 1, height: 1 } });
    case "make_cylinder":
      return buildUnits({ cylinder: { radius: 1, height: 1 } });
    case "make_sphere":
      return buildUnits({ sphere: { radius: 1 } });
    case "make_extrude":
      return buildUnits({ extrude: { profile: a[0] as Outline, distance: 1 } });
    case "body_build":
    case "export_stl":
      return buildUnits(a[0] as BodySpec);
    case "body_view":
    case "body_stl":
    case "body_step":
      return sizeOf(a[0] as BodyHandle)?.mesh ?? 0;
    case "body_boolean": {
      // An unknown handle is refused at once: the floor.
      const target = sizeOf(a[0] as BodyHandle);
      const tools = (a[1] as BodyHandle[]).map(sizeOf);
      return target && tools.every((t) => t) ? booleanUnits(target, tools as BodySize[]) : 0;
    }
    case "sketch_outline":
    case "sketch_regions":
      return sketchUnits((a[0] as unknown[]).length + (a[1] as unknown[]).length + (a[2] as unknown[]).length);
    case "solve_sketch":
      return typeof a[0] === "string" ? solveUnits(a[0]) : 0;
    case "slice_stl":
    case "print_file_stl":
      return sliceUnits(a[0] as Uint8Array, a[1] as number, a[3] as number, (a[4] ?? "off") as SupportStyle);
    default:
      return 0;
  }
}
