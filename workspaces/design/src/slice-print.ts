// Slice for printing (H2a, the slicer's first step into the app): every
// body shown, sliced by the slicing engine with the owner's printer's
// defaults (Bambu Lab P1S, 0.4 mm nozzle, PLA) and the beginner's four
// choices (quality, walls, infill, supports), downloaded as the P1S's own
// print file (.gcode.3mf, W6c: its start and end routines, for the build
// plate chosen) or, for another printer, plain G-code. The workspace offers it as File ▾
// > Slice for printing; its dialog holds the choices, says what the slice
// came to (layers, filament) and warns about any part too thin to print.
// Nothing is saved into the project: choices, never results (decision 6,
// docs/progress/slice.md). Styles: src/styles/slice-print.css.

import type { BuildPlate, Feature, KernelCalls, P1sPrintFile, SlicedPrint, SliceProgress, StlFile, SupportStyle } from "@fission/core";
import { repeatGuard, type SaveKind } from "@fission/ui";
import { bodyIdOf, type DesignDocument } from "./document.ts";
import { endStls } from "./move-tool.ts";
import { presetBar, type PresetSettings } from "./slice-presets.ts";
import { firstLayerReach, NO_EXTRAS, P1S_AREA, type FirstLayerExtras } from "./build-area.ts";

/**
 * The beginner's choices: layer height (mm), walls, infill (%), supports under overhangs (off, normal or tree), and the
 * warm-up loop: two loops round the first layer, printed before the part, so the nozzle's first uneven plastic goes on
 * a line peeled off afterwards instead of on the part (Ben 11-01: the first 10–30 s of a first layer did not stick); and
 * Better grip: a 5 mm brim round the first layer (peeled off afterwards) and a slower, 5 °C hotter first layer.
 */
export interface PrintChoices {
  layerHeight: number;
  walls: number;
  infill: number;
  supports: SupportStyle;
  warmUp: boolean;
  betterGrip: boolean;
}

/** The P1S's defaults for a 0.4 mm nozzle and PLA, as the engine's own (0.2 mm layers, 2 walls, 15 % infill, no supports), with the warm-up loop on and Better grip off. */
export const PRINT_DEFAULTS: PrintChoices = { layerHeight: 0.2, walls: 2, infill: 15, supports: "off", warmUp: true, betterGrip: false };

/** Each choice's options, as the dialog lists them. */
export const QUALITY_OPTIONS: readonly { label: string; value: number }[] = [
  { label: "Fine (0.12 mm layers)", value: 0.12 },
  { label: "Detailed (0.16 mm layers)", value: 0.16 },
  { label: "Standard (0.2 mm layers)", value: 0.2 },
  { label: "Fast (0.28 mm layers)", value: 0.28 },
];
export const WALL_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const INFILL_OPTIONS: readonly number[] = [0, 10, 15, 20, 25, 40, 60, 100];
export const SUPPORT_OPTIONS: readonly { label: string; value: SupportStyle }[] = [
  { label: "Off", value: "off" },
  { label: "Normal (columns)", value: "normal" },
  { label: "Tree (less plastic)", value: "tree" },
];

/** The nozzle fitted to the P1S, as the engine names it (kernel-types.ts' NozzleType: the kernel call checks the two agree). */
export type NozzleType = "standard" | "high-flow";

/** Which file to save: the P1S's print file, or plain G-code for another printer. */
export type PrintFormat = "p1s" | "gcode";

/** The file's choices: its kind and, for the P1S's, the build plate (the owner's textured PEI by default) and the nozzle fitted (the stock Standard by default; the dialog remembers the last one chosen, as a printer's nozzle rarely changes). */
export interface FileChoices {
  format: PrintFormat;
  plate: BuildPlate;
  nozzle: NozzleType;
}

export const FILE_DEFAULTS: FileChoices = { format: "p1s", plate: "textured", nozzle: "standard" };

/**
 * The file kinds, as the dialog lists them. The plain file's start
 * routine primes a line across the P1S plate's front-left corner, which
 * the P1S keeps clear, so it is named as not for the P1S.
 */
export const FORMAT_OPTIONS: readonly { label: string; value: PrintFormat }[] = [
  { label: "Bambu Lab P1S (.gcode.3mf)", value: "p1s" },
  { label: "Plain G-code, not for the P1S (.gcode)", value: "gcode" },
];
export const PLATE_OPTIONS: readonly { label: string; value: BuildPlate }[] = [
  { label: "Textured PEI plate", value: "textured" },
  { label: "Smooth PEI or High Temp plate", value: "smooth" },
  { label: "Cool Plate", value: "cool_plate" },
  { label: "Cool Plate SuperTack", value: "supertack_plate" },
];
export const NOZZLE_OPTIONS: readonly { label: string; value: NozzleType }[] = [
  { label: "0.4 mm Standard", value: "standard" },
  { label: "0.4 mm High Flow", value: "high-flow" },
];

/** Where the dialog keeps the nozzle last chosen (this browser only). */
export const NOZZLE_KEY = "spindlelabs.slice.nozzle";

/** The nozzle last chosen, or the default when none was kept, the value is not one of ours, or storage is blocked. */
export function rememberedNozzle(storage: Pick<Storage, "getItem"> | null): NozzleType {
  try {
    const v = storage?.getItem(NOZZLE_KEY);
    return v === "standard" || v === "high-flow" ? v : FILE_DEFAULTS.nozzle;
  } catch {
    return FILE_DEFAULTS.nozzle;
  }
}

/** Where the dialog keeps the warm-up loop's last setting (this browser only): turned off once, it stays off. */
export const WARM_UP_KEY = "spindlelabs.slice.warm-up";

/** The warm-up loop's last setting, or on (the default) when none was kept, the value is not ours, or storage is blocked. */
export function rememberedWarmUp(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(WARM_UP_KEY) !== "off";
  } catch {
    return PRINT_DEFAULTS.warmUp;
  }
}

/** Where the dialog keeps Better grip's last setting (this browser only): turned on once, it stays on. */
export const GRIP_KEY = "spindlelabs.slice.better-grip";

/** Better grip's last setting, or off (the default) when none was kept, the value is not ours, or storage is blocked. */
export function rememberedBetterGrip(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(GRIP_KEY) === "on";
  } catch {
    return PRINT_DEFAULTS.betterGrip;
  }
}

/**
 * Stored settings (a preset's, slice-presets.ts) checked choice by choice against the dialog's own lists, or null when
 * any is missing or one the dialog doesn't offer: a preset never puts a value in that the dialog couldn't show.
 */
export function presetSettingsOf(raw: unknown): PresetSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const listed = <T>(options: readonly { value: T }[], v: unknown): v is T => options.some((o) => o.value === v);
  const among = <T>(values: readonly T[], v: unknown): v is T => values.includes(v as T);
  const { layerHeight, walls, infill, supports, warmUp, betterGrip, format, plate, nozzle } = r;
  if (!listed(QUALITY_OPTIONS, layerHeight) || !among(WALL_OPTIONS, walls) || !among(INFILL_OPTIONS, infill) || !listed(SUPPORT_OPTIONS, supports)) return null;
  if (typeof warmUp !== "boolean" || typeof betterGrip !== "boolean") return null;
  if (!listed(FORMAT_OPTIONS, format) || !listed(PLATE_OPTIONS, plate) || !listed(NOZZLE_OPTIONS, nozzle)) return null;
  return { layerHeight, walls, infill, supports, warmUp, betterGrip, format, plate, nozzle };
}

/** The P1S's print file, as the save box names it. */
export const P1S_KIND: SaveKind = { description: "Bambu Lab P1S print file", mime: "model/3mf", extension: ".gcode.3mf" };

/** What the dialog says of any slice, plain or packed. */
export type PrintFacts = Pick<SlicedPrint, "layers" | "filamentMm" | "filamentG" | "printTimeS" | "unprintedVolume"> & { levelNote?: string };

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

/** The bodies shown as the engine reads them: each body's STL from the kernel, back to back, the note on their heights, and how tall they are together. */
async function bodiesStl(kernel: KernelCalls, doc: DesignDocument, features: readonly SliceBody[]): Promise<{ stl: Uint8Array<ArrayBuffer>; note: string; height: number }> {
  if (features.length === 0) throw new Error("There is no body to slice: make or show one first.");
  const files: StlFile[] = await endStls(kernel, doc, features.map((f) => ("body" in f ? { ...f, name: "body" } : { body: bodyIdOf(f.id), feature: f, name: "body" })));
  const height = Math.max(...files.map((f) => stlHighestZ(f.bytes))) - Math.min(...files.map((f) => stlLowestZ(f.bytes)));
  return { stl: stackStl(files.map((f) => f.bytes)), note: levelNoteOf(files.map((f) => f.bytes)), height };
}

/** A body to slice: an item's own (by the item), or any body by its id and the item its row stands for (35f1: a Combine's piece). */
export type SliceBody = Feature | { body: string; feature: Feature };

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

/** The bodies' files for `run`, or SliceDropped if it was stopped while they were made. */
async function runStl(run: SliceRun, doc: DesignDocument, features: readonly SliceBody[]) {
  const stl = await bodiesStl(run.kernel, doc, features);
  if (run.stopped) throw new SliceDropped();
  return stl;
}

/** Slices `features` (bodies, in build order) as they are shown: each body's STL from the kernel, then the engine. */
export function sliceBodies(kernel: KernelCalls, doc: DesignDocument, features: readonly SliceBody[], choices: PrintChoices): Promise<SlicedPrint & { levelNote: string }> {
  return asRun(kernel, async (run) => {
    const { stl, note, height } = await runStl(run, doc, features);
    return { ...(await engine(height, () => kernel.call("slice_stl", stl, choices.layerHeight, choices.walls, choices.infill, choices.supports, choices.warmUp, choices.betterGrip))), levelNote: note };
  });
}

/** The same slice as the P1S's print file for `plate` and the `nozzle` fitted. */
export function printFileOf(kernel: KernelCalls, doc: DesignDocument, features: readonly SliceBody[], choices: PrintChoices, plate: BuildPlate, nozzle: NozzleType = FILE_DEFAULTS.nozzle): Promise<P1sPrintFile & { levelNote: string }> {
  return asRun(kernel, async (run) => {
    const { stl, note, height } = await runStl(run, doc, features);
    return { ...(await engine(height, () => kernel.call("print_file_stl", stl, choices.layerHeight, choices.walls, choices.infill, choices.supports, plate, nozzle, choices.warmUp, choices.betterGrip))), levelNote: note };
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
const supportStyle = (v: string): SupportStyle => SUPPORT_OPTIONS.find((o) => o.value === v)?.value ?? "off";

const grams = (g: number) => (g < 10 ? g.toFixed(1) : Math.round(g).toString());

/**
 * The moves' time in words, rounded to the nearest minute: "4 min",
 * "1 h 5 min"; under half a minute is "under a minute". Null for a time
 * that is not a number or below 0 (an engine fault), so no figure shows.
 */
export function timeWords(s: number): string | null {
  if (!(s >= 0) || !Number.isFinite(s)) return null;
  const min = Math.round(s / 60);
  if (min === 0) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
}

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

export interface SlicePrintEvents {
  /** Slices the bodies shown with these choices and saves the file chosen (`alive()` turns false once the dialog is closed: then throw SliceDropped before saving or showing anything); saved false when the user closed the save box, with the name it was saved under. */
  slice(choices: PrintChoices, file: FileChoices, alive: () => boolean): Promise<{ print: PrintFacts; saved: boolean; name: string }>;
  /**
   * Slices the bodies shown, as the file chosen (what Slice and download would save), and opens the print preview (H2b,
   * H2c); nothing is saved. `changed()` turns true once a choice is changed while it slices: the preview then says it
   * shows the earlier choices (PREVIEW_EARLIER).
   */
  preview(choices: PrintChoices, file: FileChoices, alive: () => boolean, changed: () => boolean): Promise<void>;
  /** Calls `listener` as a slice reports how far it has got (KernelCalls.onProgress); returns the way to stop. Left out: the bar just says it is slicing. */
  onProgress?(listener: (progress: SliceProgress) => void): () => void;
  /** Called when the warm-up loop or Better grip is ticked or unticked (the build area counts them). */
  extrasChanged?(extras: FirstLayerExtras): void;
  /** The clock that tells a double press from two presses, in ms (the tests' own); left out, performance.now(). */
  now?(): number;
}

export interface SlicePrint {
  /** Opens the dialog. */
  ask(): void;
  /** Whether the dialog is open. */
  readonly open: boolean;
}

/**
 * The choices each toolbar slot's dialog had last, by the page and the slot's id (slicer hunt 2026-11-04, ui 1): Undo
 * and Redo put Design away and mount it again, which builds a new toolbar (#toolbar, or #split-toolbar in the split
 * view) with a new dialog in it, so the new dialog starts from these instead of the defaults. A page loaded again
 * starts fresh, and a slot with no id keeps nothing.
 */
const keptChoices = new WeakMap<Document, Map<string, PresetSettings>>();

export const SLICE_PRINT_TITLE = "Slice for printing: turn the bodies shown into a print file for a Bambu Lab P1S (0.4 mm nozzle, PLA).";

/**
 * The dialog, in the toolbar slot's page, modal (native <dialog>) like
 * Start fresh's: Close or Escape close it; keys pressed in it never reach
 * the app's shortcuts. Slice and download slices and saves, then says what
 * the slice came to; a refusal says why, in the engine's words.
 */
export function slicePrint(slot: HTMLElement, events: SlicePrintEvents): SlicePrint {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, text = "") => {
    const e = document.createElement(tag);
    e.id = id;
    if (text) e.textContent = text;
    return e;
  };
  const dialog = el("dialog", "slice-print-dialog");
  dialog.className = "slice-print";
  dialog.setAttribute("aria-labelledby", "slice-print-heading");
  const heading = el("h2", "slice-print-heading", "Slice for printing");
  const printer = el("p", "slice-print-printer", "For a Bambu Lab P1S with a 0.4 mm nozzle and PLA. Every body shown is printed, placed in the middle of the plate.");
  // Placeholders never pretend to work: until a real test print passes (H3a), the dialog says so.
  const untested = el("p", "slice-print-untested", "First version: these files haven't been test-printed yet, so open one in Bambu Studio or a G-code viewer to check it before printing it.");
  const choice = <T extends string | number>(id: string, label: string, options: readonly { label: string; value: T }[], value: T) => {
    const wrap = document.createElement("label");
    wrap.className = "slice-print-choice";
    wrap.textContent = label;
    const select = el("select", id);
    select.classList.add("dark-select"); // styles/dark-select.css (packages/ui)
    for (const o of options) {
      const option = document.createElement("option");
      option.value = String(o.value);
      option.textContent = o.label;
      select.append(option);
    }
    select.value = String(value);
    wrap.append(select);
    return { wrap, select };
  };
  const quality = choice("slice-print-quality", "Quality", QUALITY_OPTIONS, PRINT_DEFAULTS.layerHeight);
  const walls = choice("slice-print-walls", "Walls", WALL_OPTIONS.map((n) => ({ label: `${n} ${n === 1 ? "wall" : "walls"}`, value: n })), PRINT_DEFAULTS.walls);
  const infill = choice("slice-print-infill", "Infill", INFILL_OPTIONS.map((n) => ({ label: `${n} %`, value: n })), PRINT_DEFAULTS.infill);
  // Supports: off by default, as most parts made to print need none; otherwise the engine props up every overhang steeper than 45° from upright, as columns or as trees.
  const supports = choice("slice-print-supports", "Supports", SUPPORT_OPTIONS, PRINT_DEFAULTS.supports);
  supports.wrap.title = "Prints break-away supports under parts that hang out too far (more than 45° from upright) to print on thin air. Normal: columns straight down under the whole overhang. Tree: branches that merge on the way down, usually less plastic and easier to snap off.";
  const format = choice("slice-print-format", "File", FORMAT_OPTIONS, FILE_DEFAULTS.format);
  format.wrap.title = "The P1S's own print file, with its start and end routines, ready to send to the printer; or plain G-code for another printer.";
  const plate = choice("slice-print-plate", "Build plate", PLATE_OPTIONS, FILE_DEFAULTS.plate);
  plate.wrap.title = "The plate on the printer's bed. The bed is heated for PLA on it: 55 °C on the textured and smooth plates, 35 °C on the Cool Plate, 45 °C on the SuperTack. The textured plate's first layer prints 0.04 mm lower, as its bumps stop the nozzle when the printer finds the bed.";
  const storage = (() => {
    try {
      return slot.ownerDocument.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  const nozzle = choice("slice-print-nozzle", "Nozzle", NOZZLE_OPTIONS, rememberedNozzle(storage));
  nozzle.wrap.title = "The nozzle on your P1S. Bambu Studio won't send a file made for the other kind (Standard is the one it comes with; High Flow is Bambu's faster hotend). Your choice is remembered.";
  // The warm-up loop: a tick box, on unless turned off here before (remembered like the nozzle).
  const warmUpWrap = document.createElement("label");
  warmUpWrap.className = "slice-print-choice slice-print-check";
  const warmUp = el("input", "slice-print-warm-up");
  warmUp.type = "checkbox";
  warmUp.checked = rememberedWarmUp(storage);
  warmUpWrap.append(warmUp, document.createTextNode("Warm-up loop"));
  warmUpWrap.title =
    "Prints two loops round the part's first layer before the part, so the nozzle's first, uneven plastic goes on a line you peel off afterwards instead of on the part. Helps when the start of the first layer doesn't stick. Your choice is remembered.";
  warmUp.addEventListener("change", () => {
    try {
      storage?.setItem(WARM_UP_KEY, warmUp.checked ? "on" : "off");
    } catch {
      // Storage blocked: the choice still holds for this dialog.
    }
    events.extrasChanged?.({ warmUp: warmUp.checked, betterGrip: grip.checked });
  });
  nozzle.select.addEventListener("change", () => {
    try {
      storage?.setItem(NOZZLE_KEY, nozzle.select.value);
    } catch {
      // Storage blocked: the choice still holds for this dialog.
    }
  });
  // The plate and the nozzle matter to the P1S's file only.
  const plateFor = () => {
    plate.select.disabled = format.select.value !== "p1s";
    nozzle.select.disabled = format.select.value !== "p1s";
  };
  format.select.addEventListener("change", plateFor);
  const status = el("p", "slice-print-status");
  status.setAttribute("role", "status");
  // The bar while a slice runs (Ben, 2026-11-01): how far the engine has got, from its own reports; no value (the
  // browser's moving bar) until the first one, and hidden when nothing runs.
  const bar = el("div", "slice-print-progress");
  bar.hidden = true;
  const meter = el("progress", "slice-print-meter");
  meter.max = 1;
  meter.setAttribute("aria-labelledby", "slice-print-stage");
  const stage = el("span", "slice-print-stage");
  bar.append(meter, stage);
  const actions = el("div", "slice-print-actions");
  actions.className = "slice-print-actions";
  const close = el("button", "slice-print-close", "Close");
  close.type = "button";
  const preview = el("button", "slice-print-preview", "Preview");
  preview.type = "button";
  preview.title = "Watch it print: the slice in 3D, layer by layer, with a time-lapse of the nozzle laying it down.";
  const go = el("button", "slice-print-go", "Slice and download");
  go.title = "Slices the bodies shown and saves the file chosen above.";
  go.type = "button";
  // Better grip: a tick box, off unless turned on here before (remembered like the warm-up loop).
  const gripWrap = document.createElement("label");
  gripWrap.className = "slice-print-choice slice-print-check";
  const grip = el("input", "slice-print-grip");
  grip.type = "checkbox";
  grip.checked = rememberedBetterGrip(storage);
  gripWrap.append(grip, document.createTextNode("Better grip"));
  gripWrap.title =
    "Prints a 5 mm brim round the part's first layer, and prints that layer slower and 5 °C hotter, so parts whose first layer lifts or comes loose hold on to the plate. Peel the brim off afterwards. Your choice is remembered.";
  grip.addEventListener("change", () => {
    try {
      storage?.setItem(GRIP_KEY, grip.checked ? "on" : "off");
    } catch {
      // Storage blocked: the choice still holds for this dialog.
    }
    events.extrasChanged?.({ warmUp: warmUp.checked, betterGrip: grip.checked });
  });
  actions.append(close, preview, go);
  // The choices in one block: two columns where there is room, so the dialog fits a laptop's height (Ben 10-31: Supports was cut off).
  const choices6 = document.createElement("div");
  choices6.className = "slice-print-choices";
  choices6.append(format.wrap, plate.wrap, nozzle.wrap, quality.wrap, walls.wrap, infill.wrap, supports.wrap, warmUpWrap, gripWrap);

  const say = (text: string, bad: boolean) => {
    status.textContent = text;
    status.classList.toggle("slice-print-bad", bad);
    // On a phone the dialog scrolls and the buttons stick to its bottom: bring the words into view, not under them.
    if (text) status.scrollIntoView?.({ block: "nearest" });
  };
  const choices = (): PrintChoices => ({ layerHeight: Number(quality.select.value), walls: Number(walls.select.value), infill: Number(infill.select.value), supports: supportStyle(supports.select.value), warmUp: warmUp.checked, betterGrip: grip.checked });
  const file = (): FileChoices => ({ format: format.select.value === "gcode" ? "gcode" : "p1s", plate: PLATE_OPTIONS.find((o) => o.value === plate.select.value)?.value ?? "textured", nozzle: nozzle.select.value === "high-flow" ? "high-flow" : "standard" });
  // Presets (Ben, 2026-11-04): the settings saved under a name, picked in the heading line (slice-presets.ts). Putting
  // one in goes through each choice's own change, so the nozzle, warm-up loop and Better grip are remembered as if picked.
  const inputs = { layerHeight: quality.select, walls: walls.select, infill: infill.select, supports: supports.select, format: format.select, plate: plate.select, nozzle: nozzle.select };
  const presets = presetBar(document, storage, {
    current: () => ({ ...choices(), ...file() }),
    apply(s) {
      for (const [k, select] of Object.entries(inputs)) {
        select.value = String(s[k as keyof typeof inputs]);
        select.dispatchEvent(new (document.defaultView?.Event ?? Event)("change"));
      }
      for (const [box, on] of [[warmUp, s.warmUp], [grip, s.betterGrip]] as const) {
        box.checked = on;
        box.dispatchEvent(new (document.defaultView?.Event ?? Event)("change"));
      }
    },
    say,
    settingsOf: presetSettingsOf,
  });
  // Mounted again (Undo, Redo): the choices the last dialog in this slot had, the preset picked marked as changed if they differ.
  if (slot.id && !keptChoices.has(document)) keptChoices.set(document, new Map());
  const keptHere = slot.id ? keptChoices.get(document) : undefined;
  const kept = keptHere?.get(slot.id);
  if (kept) {
    for (const [k, select] of Object.entries(inputs)) select.value = String(kept[k as keyof typeof inputs]);
    warmUp.checked = kept.warmUp;
    grip.checked = kept.betterGrip;
    plateFor();
    presets.changed();
  }
  const keep = () => keptHere?.set(slot.id, { ...choices(), ...file() });
  keep();
  // The heading and the presets share one line where there is room, so the dialog grows no taller.
  const top = document.createElement("div");
  top.className = "slice-print-top";
  top.append(heading, presets.element);
  dialog.append(top, printer, untested, choices6, bar, status, actions);
  slot.append(dialog);
  let busy = false;
  /** Shows the bar from now until `end` is called, following the engine's reports. */
  const showProgress = () => {
    meter.removeAttribute("value");
    stage.textContent = progressWords(null);
    bar.hidden = false;
    let best = 0;
    const win = document.defaultView;
    const now = () => win?.performance?.now() ?? Date.now();
    const started = now();
    // While the engine writes the file it tells nothing: the bar creeps on by itself (fileCrawl), saying how long.
    let creep: ReturnType<typeof setInterval> | null = null;
    const stopCreep = () => {
      if (creep !== null) win?.clearInterval(creep);
      creep = null;
    };
    const startCreep = () => {
      const fileAt = now();
      const from = best;
      creep =
        win?.setInterval(() => {
          const inFile = now() - fileAt;
          meter.value = Math.max(meter.value, fileCrawl(from, fileAt - started, inFile));
          if (inFile >= 1000) stage.textContent = `Still writing the file… ${Math.floor(inFile / 1000)} s so far`;
        }, 250) ?? null;
    };
    const stop = events.onProgress?.((p) => {
      // Forward only: two calls (the plain slice after the file) each start from 0.
      if (!(p.fraction >= best)) return;
      best = p.fraction;
      meter.value = Math.max(creep === null ? 0 : meter.value, Math.min(1, Math.max(0, p.fraction)));
      if (creep === null || p.stage !== "file" || p.fraction >= 1) stage.textContent = progressWords(p);
      if (p.fraction >= 1) stopCreep();
      else if (p.stage === "file" && creep === null) startCreep();
    });
    return () => {
      stopCreep();
      stop?.();
      bar.hidden = true;
    };
  };
  // Closing the dialog drops a slice still running: its file is not saved and its preview not opened (slicer hunt
  // 2026-10-31), and the engine is stopped, so the design's edits don't wait behind it (slicer hunt 2026-11-04, ui 3).
  // While a slice runs, Close says Stop ("Cancel" is wider, and wraps the buttons onto two lines at 375 px): it stops
  // the slice and closes the dialog, whose choices stay for next time.
  let generation = 0;
  dialog.addEventListener("close", () => {
    generation++;
    if (busy) stopSlices();
    // The keyboard goes back to File ▾, where the dialog was opened from, as the print preview's does (slicer hunt 2026-11-04, ui 7).
    document.getElementById("file-menu")?.focus();
  });
  // A choice focused by Tab (or a phone keyboard's Next) under the buttons stuck to the dialog's bottom is scrolled up
  // clear of them (slicer hunt 2026-11-04, ui 6: Infill and Supports were hidden under them at 375 × 667).
  dialog.addEventListener("focusin", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || actions.contains(target)) return;
    const covered = target.getBoundingClientRect().bottom + 8 - actions.getBoundingClientRect().top;
    if (covered > 0 && actions.getBoundingClientRect().height > 0) dialog.scrollTop += covered;
  });
  const working = (on: boolean) => {
    busy = on;
    go.disabled = preview.disabled = on;
    close.textContent = on ? "Stop" : "Close";
    close.title = on ? "Stops the slice; nothing is saved." : "";
  };
  const alive = () => {
    const mine = generation;
    return () => mine === generation && dialog.open;
  };
  // A result stays displayed next to choices it no longer matches: any change clears it, and one made while a slice
  // runs is said with its result (slicer hunt 2026-11-04, ui 5).
  let changedWhileBusy = false;
  for (const c of [quality, walls, infill, supports, format, plate, nozzle, { select: warmUp }, { select: grip }])
    c.select.addEventListener("change", () => {
      if (busy) changedWhileBusy = true;
      else say("", false);
      presets.changed();
      keep();
    });
  // A double press, or presses while it slices and just after, are one slice and one file (clumsy-user hunt 11-04).
  // A disabled button hears no press, so the end of a slice counts as one: a tap that came during it waits again.
  // A changed choice (or a preset picked) asks for a new file, so its press is meant however soon.
  const clock = events.now ? () => events.now!() : undefined;
  const goRepeats = repeatGuard(clock);
  const previewRepeats = repeatGuard(clock);
  dialog.addEventListener("change", () => (goRepeats.reset(), previewRepeats.reset()));
  go.addEventListener("click", async () => {
    if (goRepeats() || busy) return;
    working(true);
    changedWhileBusy = false;
    const mine = alive();
    say("Slicing…", false);
    const end = showProgress();
    try {
      const { print, saved, name } = await events.slice(choices(), file(), mine);
      end();
      const earlier = changedWhileBusy ? SLICE_EARLIER : null;
      const warnings = [unprintedWords(print), print.levelNote || null, earlier].filter((w): w is string => w !== null);
      say([saved ? `Saved ${name}:` : "Sliced, but not saved:", printWords(print), ...warnings].join(" "), warnings.length > 0);
    } catch (e) {
      end();
      // Dropped (closed, or stopped by Stop): nothing to say, the engine's "stopped" included.
      if (e instanceof SliceDropped || !mine()) say("", false);
      else say(refusalOf(e), true);
    } finally {
      working(false);
      goRepeats();
    }
  });
  preview.addEventListener("click", async () => {
    if (previewRepeats() || busy) return;
    working(true);
    changedWhileBusy = false;
    const mine = alive();
    say("Slicing…", false);
    const end = showProgress();
    try {
      await events.preview(choices(), file(), mine, () => changedWhileBusy);
      end();
      say("", false);
      dialog.close();
    } catch (e) {
      end();
      // Dropped (closed, or stopped by Stop): nothing to say, the engine's "stopped" included.
      if (e instanceof SliceDropped || !mine()) say("", false);
      else say(refusalOf(e), true);
    } finally {
      working(false);
      previewRepeats();
    }
  });
  close.addEventListener("click", () => dialog.close());
  // Its keys stay in it: a sketch tool key can't act behind the dialog.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  return {
    ask() {
      if (dialog.open) return;
      if (!busy) say("", false); // a slice still running keeps saying so
      presets.refresh(); // another tab may have changed them
      dialog.showModal();
      go.focus();
    },
    get open() {
      return dialog.open;
    },
  };
}
