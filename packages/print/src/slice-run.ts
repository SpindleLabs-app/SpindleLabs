// The slicing engine's side of Slice for printing, free of Design's own types: the bodies' STL files stacked for the
// engine (and what to say of how they sit), the calls to the engine, the slices under way (and stopping them), the words
// for a refusal, the file names, the progress and the time-lapse's words. Moved from Design's slice-print.ts (Slice page
// step 3); Design's dialog and Slice's page both use it, each making the bodies' STL files its own way.

import type { BuildPlate, KernelCalls, P1sPrintFile, SlicedPrint, SliceProgress, SupportStyle } from "@fission/core";
import { firstLayerReach, NO_EXTRAS, P1S_AREA, type FirstLayerExtras } from "./build-area.ts";
import { FILE_DEFAULTS, SUPPORT_OPTIONS, type NozzleType, type PrintChoices } from "./choices.ts";
import { FIT_PEG, FIT_THICK, fitPieceStl } from "./fit-piece.ts";
import { overhangArea } from "./overhang.ts";
import { grams, timeWords } from "./print-cost.ts";

/** The P1S's print file, as the save box names it (the shape of @fission/ui's SaveKind). */
export const P1S_KIND: { description: string; mime: string; extension: string } = { description: "Bambu Lab P1S print file", mime: "model/3mf", extension: ".gcode.3mf" };

/** What the dialog says of any slice, plain or packed. */
export type PrintFacts = Pick<SlicedPrint, "layers" | "filamentMm" | "filamentG" | "printTimeS" | "unprintedVolume"> & { levelNote?: string; overhangMm2?: number };

/**
 * The bodies' STL files back to back, one file per body, as the engine
 * reads them: each body stays its own mesh, so two that touch are never
 * welded into one (the engine joins their overlaps itself).
 */
export function stackStl(files: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(files.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of files) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

/** The lowest z in a binary STL (80-byte header, a count, then 50 bytes a triangle: normal, three corners, 2 spare); NaN when it holds no triangle. */
export function stlLowestZ(stl: Uint8Array): number {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = stl.length >= 84 ? Math.min(view.getUint32(80, true), Math.floor((stl.length - 84) / 50)) : 0;
  let low = Infinity;
  for (let t = 0; t < count; t++) {
    for (let c = 0; c < 3; c++) low = Math.min(low, view.getFloat32(84 + t * 50 + 12 + c * 12 + 8, true));
  }
  return count > 0 ? low : NaN;
}

/**
 * The gap under a body that is CAD rounding, not a body in the air: the engine cuts its first layer at 0.1 mm, so a
 * body this close to the plate or to another body prints as if it touched (slicer hunt 2026-11-04, inputs 3).
 */
export const LEVEL_GAP = 0.1;

/**
 * What the engine does when bodies sit at different heights (slicer hunt 2026-10-31, finding 3): it puts the lowest point
 * of all of them on the plate, so a body above the lowest one with nothing under it hangs in the air (it needs supports)
 * and a body sunk below the floor lifts the others off it. One sentence naming the first such body, or "" when they all
 * start at the same height (within LEVEL_GAP), fewer than two, or every one above the floor stands on another body
 * (`rests(i)`: slicer hunt 2026-11-04, inputs 2, a post on a block was said to hang in the air).
 */
export function levelNote(lowest: readonly number[], rests: (body: number) => boolean = () => false): string {
  const known = lowest.filter(Number.isFinite);
  if (known.length < 2) return "";
  const floor = Math.min(...known);
  const at = lowest.findIndex((z, i) => Number.isFinite(z) && z - floor > LEVEL_GAP && !rests(i));
  if (at < 0) return "";
  const gap = Math.round((lowest[at] - floor) * 10) / 10;
  return `Body ${at + 1} starts ${gap} mm above the lowest body. The lowest point goes on the plate, so it hangs in the air and only prints with supports on: set the bodies on one level to print them together.`;
}

/** A binary STL's triangles as corner coordinates, nine numbers each (x, y, z three times), reading only those it holds. */
function stlCorners(stl: Uint8Array): Float64Array {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = stl.length >= 84 ? Math.min(view.getUint32(80, true), Math.floor((stl.length - 84) / 50)) : 0;
  const out = new Float64Array(9 * count);
  for (let t = 0; t < count; t++) for (let k = 0; k < 9; k++) out[9 * t + k] = view.getFloat32(84 + t * 50 + 12 + 4 * k, true);
  return out;
}

type Point = readonly [number, number];
type Segment = readonly [number, number, number, number];

/** Where the triangles cross the plane z = `h`: one segment per triangle that has corners on both sides. */
function sectionAt(corners: Float64Array, h: number): Segment[] {
  const out: Segment[] = [];
  for (let t = 0; t < corners.length; t += 9) {
    const pts: number[] = [];
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3;
      const za = corners[t + 3 * a + 2];
      const zb = corners[t + 3 * b + 2];
      if ((za < h) === (zb < h)) continue;
      const f = (h - za) / (zb - za);
      pts.push(corners[t + 3 * a] + f * (corners[t + 3 * b] - corners[t + 3 * a]), corners[t + 3 * a + 1] + f * (corners[t + 3 * b + 1] - corners[t + 3 * a + 1]));
    }
    if (pts.length === 4) out.push([pts[0], pts[1], pts[2], pts[3]]);
  }
  return out;
}

/** Whether `p` is inside the closed outline the segments make (a ray to +x crosses it an odd number of times). */
function insideSection(p: Point, section: readonly Segment[]): boolean {
  let inside = false;
  for (const [x1, y1, x2, y2] of section) {
    if ((y1 > p[1]) === (y2 > p[1])) continue;
    if (x1 + ((p[1] - y1) / (y2 - y1)) * (x2 - x1) > p[0]) inside = !inside;
  }
  return inside;
}

const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Whether `p` is inside (or on) the triangle a, b, c seen from above. */
function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = cross(a[0], a[1], b[0], b[1], p[0], p[1]);
  const d2 = cross(b[0], b[1], c[0], c[1], p[0], p[1]);
  const d3 = cross(c[0], c[1], a[0], a[1], p[0], p[1]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Whether segments p1-p2 and q1-q2 cross, seen from above. */
function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1[0], q1[1], q2[0], q2[1], p1[0], p1[1]);
  const d2 = cross(q1[0], q1[1], q2[0], q2[1], p2[0], p2[1]);
  const d3 = cross(p1[0], p1[1], p2[0], p2[1], q1[0], q1[1]);
  const d4 = cross(p1[0], p1[1], p2[0], p2[1], q2[0], q2[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Whether the body `below` holds up a body whose underside is `base` (its triangles with a corner within LEVEL_GAP of
 * its lowest point `z`, seen from above): `below` has material LEVEL_GAP under that point, and there it overlaps the
 * underside (a corner of either inside the other, or their edges crossing).
 */
function holdsUp(below: Float64Array, base: readonly (readonly [Point, Point, Point])[], z: number): boolean {
  const section = sectionAt(below, z - LEVEL_GAP);
  if (section.length === 0) return false;
  for (const tri of base) {
    const centroid: Point = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3];
    if ([...tri, centroid].some((p) => insideSection(p, section))) return true;
    for (const [x1, y1, x2, y2] of section) {
      if (inTriangle([x1, y1], ...tri)) return true;
      for (let e = 0; e < 3; e++) if (segmentsCross([x1, y1], [x2, y2], tri[e], tri[(e + 1) % 3])) return true;
    }
  }
  return false;
}

/**
 * levelNote for the bodies' STL files (one per body, as the engine gets them): a body above the lowest one is named
 * only when no other body is under it, within LEVEL_GAP, so a design of stacked bodies (a post on a base, a lid on a
 * box) gets no note.
 */
export function levelNoteOf(files: readonly Uint8Array[]): string {
  const corners = files.map(stlCorners);
  const lowest = files.map(stlLowestZ);
  const rests = (i: number) => {
    const z = lowest[i];
    const c = corners[i];
    const base: [Point, Point, Point][] = [];
    for (let t = 0; t < c.length; t += 9) {
      if (Math.min(c[t + 2], c[t + 5], c[t + 8]) > z + LEVEL_GAP) continue;
      // A side wall seen from above is a line, not an underside: it covers nothing.
      if (Math.abs(cross(c[t], c[t + 1], c[t + 3], c[t + 4], c[t + 6], c[t + 7])) < 1e-9) continue;
      base.push([[c[t], c[t + 1]], [c[t + 3], c[t + 4]], [c[t + 6], c[t + 7]]]);
    }
    return corners.some((other, j) => j !== i && lowest[j] < z - LEVEL_GAP && holdsUp(other, base, z));
  };
  return levelNote(lowest, rests);
}

/** The highest z in a binary STL, as stlLowestZ reads it; NaN when it holds no triangle. */
export function stlHighestZ(stl: Uint8Array): number {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = stl.length >= 84 ? Math.min(view.getUint32(80, true), Math.floor((stl.length - 84) / 50)) : 0;
  let high = -Infinity;
  for (let t = 0; t < count; t++) {
    for (let c = 0; c < 3; c++) high = Math.max(high, view.getFloat32(84 + t * 50 + 12 + c * 12 + 8, true));
  }
  return count > 0 ? high : NaN;
}

/** The height of the bodies a refusal was for (slicer hunt 2026-11-04, ui 2), so its words can say how tall the part really is. */
const refusedHeights = new WeakMap<object, number>();

/** Calls the engine; a refusal remembers the bodies' height for refusalOf. */
async function engine<T>(height: number, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (typeof e === "object" && e !== null && Number.isFinite(height)) refusedHeights.set(e, height);
    throw e;
  }
}

/** A failed slice in words for the dialog: refusalWords of its message, with the part's own height when the engine said it is too tall. */
export function refusalOf(e: unknown): string {
  const height = typeof e === "object" && e !== null ? refusedHeights.get(e) : undefined;
  return refusalWords(e instanceof Error ? e.message : String(e), height);
}

/** A slice under way (sliceBodies, printFileOf): its kernel, and whether it was stopped before it reached the engine. */
interface SliceRun {
  kernel: KernelCalls;
  stopped: boolean;
}

/** The slices under way now, so the dialog's Stop and Close can stop them (stopSlices). */
const runs = new Set<SliceRun>();

/**
 * Stops every slice under way (slicer hunt 2026-11-04, ui 3: Close left the engine working for up to 75 s, every edit
 * waiting behind it): one still making the bodies' files never asks the engine, and the engine is let go from one
 * already asked (KernelCalls.stopSlicing), so the design is built again at once. Each such slice fails.
 */
export function stopSlices(): void {
  for (const run of runs) {
    run.stopped = true;
    run.kernel.stopSlicing?.();
  }
}

/** `slice` (the bodies' files, then the engine) as a run stopSlices can stop. */
async function asRun<T>(kernel: KernelCalls, slice: (run: SliceRun) => Promise<T>): Promise<T> {
  const run: SliceRun = { kernel, stopped: false };
  runs.add(run);
  try {
    return await slice(run);
  } finally {
    runs.delete(run);
  }
}

/** The bodies' STL files (one per body, as the kernel's export gives them) as the engine reads them: back to back, with the note on their heights, how tall they are together and the overhanging area. */
export function bodiesOfFiles(files: readonly Uint8Array[]): { stl: Uint8Array<ArrayBuffer>; note: string; height: number; overhang: number } {
  if (files.length === 0) throw new Error("There is no body to slice: make or show one first.");
  const height = Math.max(...files.map((f) => stlHighestZ(f))) - Math.min(...files.map((f) => stlLowestZ(f)));
  return { stl: stackStl(files), note: levelNoteOf(files), height, overhang: overhangArea(files) };
}

/** The bodies' files for `run`, or SliceDropped if it was stopped while they were made. */
async function runStl(run: SliceRun, files: () => Promise<readonly Uint8Array[]>) {
  const made = bodiesOfFiles(await files());
  if (run.stopped) throw new SliceDropped();
  return made;
}

/** Slices the bodies whose STL files `files` makes (in build order), as they are shown: then the engine. */
export function sliceStls(kernel: KernelCalls, files: () => Promise<readonly Uint8Array[]>, choices: PrintChoices): Promise<SlicedPrint & { levelNote: string; overhangMm2: number }> {
  return asRun(kernel, async (run) => {
    const { stl, note, height, overhang } = await runStl(run, files);
    return { ...(await engine(height, () => kernel.call("slice_stl", stl, choices.layerHeight, choices.walls, choices.infill, choices.supports, choices.warmUp, choices.betterGrip))), levelNote: note, overhangMm2: overhang };
  });
}

/** The same slice as the P1S's print file for `plate` and the `nozzle` fitted. */
export function printFileOfStls(kernel: KernelCalls, files: () => Promise<readonly Uint8Array[]>, choices: PrintChoices, plate: BuildPlate, nozzle: NozzleType = FILE_DEFAULTS.nozzle): Promise<P1sPrintFile & { levelNote: string; overhangMm2: number }> {
  return asRun(kernel, async (run) => {
    const { stl, note, height, overhang } = await runStl(run, files);
    return { ...(await engine(height, () => kernel.call("print_file_stl", stl, choices.layerHeight, choices.walls, choices.infill, choices.supports, plate, nozzle, choices.warmUp, choices.betterGrip))), levelNote: note, overhangMm2: overhang };
  });
}

/** The fit test piece (fit-piece.ts) as the P1S's print file, sliced with `choices` but never with supports (it needs none). */
export function testPieceFile(kernel: KernelCalls, choices: PrintChoices, plate: BuildPlate, nozzle: NozzleType = FILE_DEFAULTS.nozzle): Promise<P1sPrintFile> {
  return asRun(kernel, async (run) => {
    const stl = fitPieceStl();
    if (run.stopped) throw new SliceDropped();
    return engine(FIT_THICK + FIT_PEG, () => kernel.call("print_file_stl", stl, choices.layerHeight, choices.walls, choices.infill, "off", plate, nozzle, choices.warmUp, choices.betterGrip));
  });
}

/**
 * The G-code inside a P1S print file (a ZIP the engine writes with every file stored, never compressed): the plate's
 * Metadata/plate_1.gcode, as the printer would run it. Null when the bytes are not such a ZIP or hold no plate, so
 * the caller can fall back to the plain slice. The preview draws this, so it shows the file that is downloaded (its
 * time, its filament, its own start routine), not the plain file's (slicer hunt 2026-10-31, finding 4).
 */
export function gcodeOfPackage(bytes: Uint8Array): string | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 30 <= bytes.length && v.getUint32(at, true) === 0x04034b50) {
    const stored = v.getUint16(at + 8, true) === 0;
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const start = at + 30 + nameLen + v.getUint16(at + 28, true);
    if (start + size > bytes.length) return null;
    if (stored && new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen)) === "Metadata/plate_1.gcode") return new TextDecoder().decode(bytes.subarray(start, start + size));
    at = start + size;
  }
  return null;
}

/**
 * The layer moves of a P1S file's G-code, for the preview: from the first ";LAYER_CHANGE" to the end routine, absolute
 * moves with relative feeds. The file's start routine (purge, wipe, load line) lays plastic at heights of its own, which
 * the replayer would count as layers (a 20 mm cube read as 99 layers, not 100), and the end routine is not the part.
 */
export function printMovesOf(gcode: string): string | null {
  const first = gcode.search(/^;LAYER_CHANGE$/m);
  if (first < 0) return null;
  const end = gcode.indexOf(";===== end", first);
  // The height the nozzle was lifted to just before the first layer is set by the routine's last Z move: keep it.
  const zs = [...gcode.slice(0, first).matchAll(/^G[01] [^;\n]*\bZ(-?\d+(?:\.\d+)?)/gm)];
  const z = zs.length > 0 ? `G1 Z${zs[zs.length - 1][1]}\n` : "";
  return `G90\nM83\n${z}${gcode.slice(first, end < 0 ? undefined : end)}`;
}

/** Thrown by an event when the dialog was closed while it worked: the result is dropped, nothing is saved or shown. */
export class SliceDropped extends Error {
  constructor() {
    super("The dialog was closed before the slice finished.");
  }
}

/** The loop and brim an engine refusal names in its words for the part ("the part with its brim and warm-up loop"). */
const PART = "the part(?: with its (brim and warm-up loop|warm-up loop|brim))?";
const extrasNamed = (named: string | undefined): FirstLayerExtras => ({ warmUp: named?.includes("warm-up") ?? false, betterGrip: named?.includes("brim") ?? false });
const extrasWords = (e: FirstLayerExtras) => (e.warmUp && e.betterGrip ? "Better grip's brim and its warm-up loop" : e.warmUp ? "its warm-up loop" : "Better grip's brim");
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Whether a part w × d mm seen from above (any shape) fits the P1S's plate, its front strip and front-left corner. */
function fitsP1S(w: number, d: number): boolean {
  const { width, depth, primeStrip, keepOut } = P1S_AREA;
  return w <= width && d <= depth - primeStrip && (w <= width - keepOut.x || d <= depth - keepOut.y);
}

/**
 * What to do about a part w × d mm with its extras `e` round it that doesn't fit: turn the loop, the brim or both off
 * when without them it fits (the least first), else null. A width not known (null) is taken as the widest the plate
 * takes, and a part that would then fit only if narrower is told how narrow.
 */
function turnOffWords(e: FirstLayerExtras, w: number | null, d: number): string | null {
  const reach = firstLayerReach(e);
  const tries: [FirstLayerExtras, string, string][] = [
    [{ ...e, warmUp: false }, "its warm-up loop", "Warm-up loop"],
    [{ ...e, betterGrip: false }, "Better grip's brim", "Better grip"],
    [NO_EXTRAS, "Better grip's brim and its warm-up loop", "Better grip and Warm-up loop"],
  ];
  let narrower: string | null = null;
  for (const [less, what, turn] of tries) {
    if (less.warmUp === e.warmUp && less.betterGrip === e.betterGrip) continue;
    const shrink = 2 * (reach - firstLayerReach(less));
    if (fitsP1S(w === null ? P1S_AREA.width : w - shrink, d - shrink)) return `Without ${what} it fits: turn ${turn} off and slice again.`;
    const upTo = P1S_AREA.width - P1S_AREA.keepOut.x;
    if (w === null && narrower === null && fitsP1S(upTo, d - shrink)) narrower = `Without ${what} it fits if it is at most ${upTo} mm wide: turn ${turn} off and slice again.`;
  }
  return narrower;
}

/**
 * The engine's refusal in words for a beginner: "the part ... runs from (-22, 118) to (278, 138), off the 256 × 256 mm bed"
 * becomes how wide the part is and what the plate takes; "layer 1280 reaches z = 256.2 mm, above the printer's 256 mm"
 * becomes how tall (the part's `height` when known, else about the layer's); "starts in mid-air at z = 20 mm, around (35, 5), with nothing under it" says where the part hangs and what to do.
 * A part refused only with its warm-up loop or Better grip's brim round it says its own size and that size with them,
 * and to turn them off when without them it fits; so do the front strip's and the front-left corner's refusals. Any other
 * message is kept, starting with a capital.
 */
export function refusalWords(message: string, height?: number): string {
  const across = new RegExp(`${PART}, placed at [^)]*\\), runs from \\((-?[\\d.]+), (-?[\\d.]+)\\) to \\((-?[\\d.]+), (-?[\\d.]+)\\), off the (\\d+) × (\\d+) mm bed`).exec(message);
  if (across) {
    const [w, d] = [Number(across[4]) - Number(across[2]), Number(across[5]) - Number(across[3])];
    const wide = Math.max(w, d);
    const plate = `the P1S's plate takes ${across[6]} × ${across[7]} mm.`;
    const way = w >= d ? "wide" : "deep";
    if (across[1] === undefined) return `The part is ${round1(wide)} mm ${way}, and ${plate} Make it smaller or split it into pieces.`;
    const e = extrasNamed(across[1]);
    const own = wide - 2 * firstLayerReach(e);
    return `The part is ${round1(own)} mm ${way}, ${round1(wide)} mm with ${extrasWords(e)}, and ${plate} ${turnOffWords(e, w, d) ?? "Make it smaller or split it into pieces."}`;
  }
  const strip = new RegExp(`${PART} reaches y = -?[\\d.]+ mm, over the prime line's strip at the front of the bed \\(it must stay at y ≥ ([\\d.]+) mm\\); it is ([\\d.]+) mm deep, and fits when at most ([\\d.]+) mm deep`).exec(message);
  if (strip) {
    const d = Number(strip[3]);
    const front = `the P1S takes up to ${strip[4]} mm: the front ${strip[2]} mm of the plate is kept for the nozzle's prime line.`;
    if (strip[1] === undefined) return `The part is ${round1(d)} mm deep, and ${front} Make it smaller or split it into pieces.`;
    const e = extrasNamed(strip[1]);
    // Its width isn't said, so "it fits" is never said of one that might be too wide.
    return `The part is ${round1(d - 2 * firstLayerReach(e))} mm deep, ${round1(d)} mm with ${extrasWords(e)}, and ${front} ${turnOffWords(e, null, d) ?? "Make it smaller or split it into pieces."}`;
  }
  const corner = new RegExp(`${PART} is ([\\d.]+) × ([\\d.]+) mm and reaches into the P1S plate's front-left corner, which must stay clear \\([^)]*\\); moving it right or back would take it off the plate\\. Make it smaller or turn it so it clears the corner \\(a part up to ([\\d.]+) mm wide or ([\\d.]+) mm deep fits\\)`).exec(message);
  if (corner) {
    const [w, d, upW, upD] = [corner[2], corner[3], corner[4], corner[5]].map(Number);
    const reaches = "reaches into the P1S plate's front-left corner, which must stay clear, with no room on the plate to move it clear.";
    if (corner[1] === undefined) return `The part is ${round1(w)} × ${round1(d)} mm and ${reaches} Make it smaller or turn it so it clears the corner (up to ${upW} mm wide or ${upD} mm deep fits).`;
    const e = extrasNamed(corner[1]);
    const r2 = 2 * firstLayerReach(e);
    const what = extrasWords(e);
    return `The part is ${round1(w - r2)} × ${round1(d - r2)} mm, ${round1(w)} × ${round1(d)} mm with ${what}, and ${reaches} ${turnOffWords(e, w, d) ?? `Make it smaller or turn it so it clears the corner (with ${what}, up to ${round1(upW - r2)} mm wide or ${round1(upD - r2)} mm deep fits).`}`;
  }
  const tall = /reaches z = ([\d.]+) mm, above the printer's ([\d.]+) mm/.exec(message);
  // The engine names the first layer over the limit, not the part's top: given the part's height, say that (slicer hunt 2026-11-04, ui 2).
  if (tall && height !== undefined && Number.isFinite(height) && height > 0) return `The part is ${Math.round(height * 10) / 10} mm tall, and the P1S prints up to ${tall[2]} mm. Make it shorter or split it into pieces.`;
  if (tall) return `The part is about ${tall[1]} mm tall, and the P1S prints up to ${tall[2]} mm. Make it shorter or split it into pieces.`;
  const air = /starts in mid-air at z = (-?[\d.]+) mm, around \((-?[\d.]+), (-?[\d.]+)\), with nothing under it/.exec(message);
  if (air) return `Part of the model hangs in the air ${air[1]} mm above the plate, around (${air[2]}, ${air[3]}) mm, with nothing under it. Turn Supports on, or move it down onto the plate or the part.`;
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/** The plain file's name: the layer height, the walls and infill, its supports, "no-warm-up" without the loop and "grip" with Better grip, so two slices of one part never share a name. */
export function gcodeName(choices: PrintChoices, project?: string): string {
  return fitName(nameLead(project), settingsPart(choices), ".gcode");
}

/** Each plate's part of a P1S file's name. */
const PLATE_NAMES: Readonly<Record<BuildPlate, string>> = { textured: "textured", smooth: "smooth", cool_plate: "cool", supertack_plate: "supertack" };

/**
 * The P1S file's name: as the plain file's, plus the plate and, for a High Flow nozzle, "high-flow", so a file for one
 * plate or nozzle is never taken for another's.
 */
export function printFileName(choices: PrintChoices, plate: BuildPlate, nozzle: NozzleType = FILE_DEFAULTS.nozzle, project?: string): string {
  return fitName(nameLead(project), `${settingsPart(choices)}-${PLATE_NAMES[plate]}${nozzle === "high-flow" ? "-high-flow" : ""}`, P1S_KIND.extension);
}

/**
 * The project's name leads a file's name, so files of different projects look different on the printer's list; a project
 * not named yet (empty, or the "Untitled" it starts with) gives "spindlelabs".
 */
export const nameLead = (project?: string): string => {
  const name = (project ?? "").trim();
  return name === "" || /^untitled$/i.test(name) ? "spindlelabs" : name;
};

/**
 * The name a print file starts with: the project's own name, or when it has none (empty or "Untitled") the name of the
 * file it was opened from or saved to, so a saved "bracket" prints as "bracket-…", not "spindlelabs-…" (slicer hunt
 * 2026-11-04, package 4b: the app never names a project, so every print file was "spindlelabs-…").
 */
export const printLead = (project: string | undefined, file: string | null | undefined): string | undefined => (nameLead(project) === "spindlelabs" && file && file.trim() !== "" ? file : project);

const settingsPart = (choices: PrintChoices) => `-${choices.layerHeight}mm-${choices.walls}w-${choices.infill}pc${SUPPORT_SUFFIX[choices.supports]}${choices.warmUp ? "" : "-no-warm-up"}${choices.betterGrip ? "-grip" : ""}`;

/** The most a file's name may hold, as the save box cuts it (packages/ui save-file.ts): characters and bytes of UTF-8. */
const NAME_CHARS = 120;
const NAME_BYTES = 200;

/**
 * `lead`, `settings` and `extension` as one name, the lead cut (at whole characters, and never ending in a space) so the
 * whole fits the save box's limits: the settings part always stays whole, so two slices of one long-named project never
 * share a name (slicer hunt 2026-11-04, package 4a: the save box cut the settings off the end).
 */
function fitName(lead: string, settings: string, extension: string): string {
  const bytes = (t: string) => new TextEncoder().encode(t).length;
  let charsLeft = NAME_CHARS - [...settings].length - [...extension].length;
  let bytesLeft = NAME_BYTES - bytes(settings) - bytes(extension);
  let kept = "";
  for (const c of lead) {
    const size = bytes(c);
    if (charsLeft < 1 || bytesLeft < size) break;
    kept += c;
    charsLeft--;
    bytesLeft -= size;
  }
  return `${kept.length < lead.length ? kept.trimEnd() : kept}${settings}${extension}`;
}

/** Normal supports keep the name they had when supports were on or off. */
const SUPPORT_SUFFIX: Record<SupportStyle, string> = { off: "", normal: "-supports", tree: "-tree-supports" };

/** The supports select's value as a style: anything it does not list is off. */
export const supportStyle = (v: string): SupportStyle => SUPPORT_OPTIONS.find((o) => o.value === v)?.value ?? "off";

export { timeWords };

/**
 * What a slice came to, in words: "100 layers, 5.2 g of PLA (1.73 m of
 * filament), about 4 min of printing (plus heating and levelling)."
 * The time is the engine's estimate of the moves alone, so the words say
 * the printer's own warm-up comes on top.
 */
export function printWords(print: PrintFacts): string {
  const layers = `${print.layers} ${print.layers === 1 ? "layer" : "layers"}`;
  const time = timeWords(print.printTimeS);
  const timePart = time === null ? "" : `, about ${time} of printing (plus heating and levelling)`;
  return `${layers}, ${grams(print.filamentG)} g of PLA (${(print.filamentMm / 1000).toFixed(2)} m of filament)${timePart}.`;
}

/**
 * The warning for plastic the slice leaves out, or null: walls under about
 * 0.65 mm aren't printed yet (not only those thinner than one 0.4 mm line:
 * slicer hunt 2026-11-04, SH2), so the words say what thickness prints.
 * Under a hundredth of a mm³ rounds to nothing in the words, so it is not
 * worth a warning.
 */
export function unprintedWords(print: Pick<PrintFacts, "unprintedVolume">): string | null {
  if (!(print.unprintedVolume >= 0.005)) return null;
  return `Some walls are thinner than about 0.65 mm, which can't be printed yet, so about ${print.unprintedVolume.toFixed(2)} mm³ of the part won't print: make them at least 0.65 mm thick.`;
}

/**
 * The words under the progress bar: what the engine is doing now, with the layer when the stage goes layer by layer
 * ("Walls: layer 120 of 254"); nothing before its first report (the bodies being made into STL, or an engine from
 * before progress reports): the status line says "Slicing…" all along.
 */
export function progressWords(p: SliceProgress | null): string {
  if (p === null) return "";
  const layer = p.total > 1 ? `: layer ${p.done} of ${p.total}` : "…";
  switch (p.stage) {
    case "layers":
      return "Cutting the bodies into layers…";
    case "walls":
      return `Walls${layer}`;
    case "infill":
      return "Infill and solid layers…";
    case "supports":
      return `Supports${layer}`;
    case "paths":
      return `Putting the paths in order${layer}`;
    case "file":
      return "Writing the file…";
    default:
      return "";
  }
}

/** The least time constant of the bar's creep while the file is written: even after a quick slice, it creeps slowly. */
export const FILE_CRAWL_MIN_MS = 5_000;

/** The furthest the creep goes: the end is the engine's to say. */
const FILE_CRAWL_TOP = 0.99;

/**
 * Where the bar stands `inFileMs` into writing the file, from `fraction` where the engine left it, after `beforeMs` of
 * slicing before the file (slicer hunt 2026-11-04, ui 4: the engine tells nothing while it writes the file, which can
 * be most of a long slice, so the bar sat at 95 % as if hung). It creeps toward 0.99, never past it, with a time
 * constant of twice the time before the file (the file took 1.4 to 4 times that in the hunt's long slices), at least
 * FILE_CRAWL_MIN_MS: honest that it is still working, without claiming to know how far.
 */
export function fileCrawl(fraction: number, beforeMs: number, inFileMs: number): number {
  if (!(fraction < FILE_CRAWL_TOP) || !(inFileMs > 0)) return fraction;
  const tau = Math.max(FILE_CRAWL_MIN_MS, Number.isFinite(beforeMs) ? 2 * beforeMs : 0);
  return fraction + (FILE_CRAWL_TOP - fraction) * (1 - Math.exp(-inFileMs / tau));
}

/** Slice and download's words when a choice was changed while it sliced (slicer hunt 2026-11-04, ui 5). */
export const SLICE_EARLIER = "A choice was changed while it sliced, so this is the slice of the earlier choices: slice again for the new ones.";
/** The print preview's words when a choice was changed while its slice ran (the hunt's leftover: the preview said nothing). */
export const PREVIEW_EARLIER = "A choice was changed while it sliced, so this preview shows the earlier choices: preview again for the new ones.";

