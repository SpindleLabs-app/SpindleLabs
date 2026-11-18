// The automatic file check (step Q2, docs/progress/queue.md): what a job's file is checked against before the teacher
// sees it, through what the app already has. A print job's STL goes through the P1S's build area, the print check
// (supports, thin walls, sagging bridges, weak spots) and the slicing engine for its time and filament
// (packages/print). A laser job's SVG or DXF is read for its size against the laser's bed and its colours as the
// laser's layers (svg.ts, dxf.ts); its time is "not yet" until Laser's L3a gives one, never a made-up number.
//
// Each check answers passed with an estimate and notes for the teacher, or refused with one reason in plain words, and
// `checkAction` turns that into the queue's own check action. Nothing here touches the network or a person's data.

import type { KernelCalls } from "@fission/core";
import { buildArea, NO_EXTRAS, overhangArea, P1S_AREA, PRINT_DEFAULTS, printCheck, refusalOf, sliceStls, supportsHint, timeWords, unprintedWords, type PrintChoices } from "@fission/print";
import { readDxf } from "./dxf.ts";
import { QUEUE_LIMITS, type Action, type JobKind, type Use } from "./queue.ts";
import { binaryStlOf, isBinaryStl, readStl } from "./stl.ts";
import { readSvg, type DrawingRead, type LaserLayer } from "./svg.ts";

/** A machine the check knows the size of. The machine library (I15, Laser's L2b) takes these over when it exists. */
export interface LaserBed {
  name: string;
  width: number;
  height: number;
}

/** Ben's school laser: a VEVOR KH1490, 130 W CO2, a 1400 × 900 mm bed (Ruida controller). */
export const KH1490_BED: LaserBed = { name: "the school laser (1400 × 900 mm bed)", width: 1400, height: 900 };

/**
 * How far past the bed's edge (mm) a drawing may reach and still count as on it: a micrometre, far below what a laser
 * places, only so a drawing exactly the bed's size, whose numbers came through a file's decimals, isn't refused.
 */
export const FIT_TOLERANCE = 0.001;

/** What the check says of a file. */
export type FileCheck =
  | { passed: true; estimate: Use; facts: string[]; notes: string[] }
  | { passed: false; reason: string; notes: string[] };

const refused = (reason: string, notes: string[] = []): FileCheck => ({ passed: false, reason, notes });

const ext = (name: string): string => {
  const n = name.toLowerCase();
  if (n.endsWith(".gcode.3mf")) return ".gcode.3mf";
  const k = n.lastIndexOf(".");
  return k < 0 ? "" : n.slice(k);
};

const mm1 = (v: number): string => (Math.round(v * 10) / 10).toString();

/** What to do with a file the check doesn't read, by kind and extension. */
function wrongType(kind: JobKind, e: string): string {
  if (kind === "print") {
    if (e === ".3mf" || e === ".obj" || e === ".step" || e === ".stp" || e === ".f3d") return `The print check reads STL files for now: save or export the part as STL and send that.`;
    if (e === ".gcode" || e === ".gcode.3mf") return "That is a file already sliced for a printer: send the part itself as STL, so the check and the teacher see the part and the school's own settings are used.";
    if (e === ".svg" || e === ".dxf") return "That is a flat drawing for the laser: send it as a laser job, or send the 3D part as STL.";
    return "The print check reads STL files: save or export the part as STL and send that.";
  }
  if (e === ".pdf" || e === ".ai" || e === ".eps" || e === ".cdr") return "The laser check reads SVG and DXF drawings: save or export the drawing as SVG (or DXF) and send that.";
  if (e === ".png" || e === ".jpg" || e === ".jpeg" || e === ".bmp" || e === ".gif") return "That is a picture: the laser check reads only SVG and DXF drawings for now (pictures to engrave come later).";
  if (e === ".stl" || e === ".3mf") return "That is a 3D part for the printer: send it as a print job, or send a flat SVG or DXF drawing for the laser.";
  return "The laser check reads SVG and DXF drawings: save or export the drawing as SVG (or DXF) and send that.";
}

function sizeProblem(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "The file is empty.";
  if (bytes.length > QUEUE_LIMITS.fileBytes) return `The file is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the queue takes files up to 50 MB.`;
  return null;
}

// ---------------------------------------------------------------- print

/** What a print check needs: the kernel (the slicing engine), and the school's slice settings (the app's defaults if not given). */
export interface PrintCheckSetup {
  kernel: KernelCalls;
  choices?: PrintChoices;
  material?: string;
}

/** The print check of an STL file for the P1S. Never throws: an engine failure is a refusal in words. */
export async function checkPrintFile(fileName: string, bytes: Uint8Array, setup: PrintCheckSetup): Promise<FileCheck> {
  const e = ext(fileName);
  if (e !== ".stl") return refused(wrongType("print", e));
  const big = sizeProblem(bytes);
  if (big) return refused(big);
  const read = readStl(bytes);
  if (!read.ok) return refused(read.reason);
  const mesh = read.mesh;
  const notes: string[] = [];
  let choices: PrintChoices = { ...(setup.choices ?? PRINT_DEFAULTS) };

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a] as number, mesh.positions[i + a] as number);
      hi[a] = Math.max(hi[a] as number, mesh.positions[i + a] as number);
    }
  }
  const size = [0, 1, 2].map((a) => (hi[a] as number) - (lo[a] as number));
  if (Math.max(...size) < 2) notes.push(`The part is only ${size.map((s) => s.toFixed(2)).join(" × ")} mm. STL files carry no units: if it was saved in centimetres, metres or inches, save it again in millimetres.`);

  // The P1S's plate, with the warm-up loop and brim the settings print round the part; without them if only they don't fit.
  const extras = { warmUp: choices.warmUp, betterGrip: choices.betterGrip };
  const area = buildArea([mesh], P1S_AREA, extras);
  if (area === null) return refused("The STL file has nothing in it to print.");
  if (area.outside !== null) {
    const bare = buildArea([mesh], P1S_AREA, NO_EXTRAS);
    if (bare === null || bare.outside !== null) return refused((bare ?? area).outside!.replace("the bodies shown are", "the part is"), notes);
    choices = { ...choices, warmUp: false, betterGrip: false };
    notes.push("It fits on the plate only without the warm-up loop and brim round it, so it is sliced without them.");
  }
  // The slicing engine takes only a closed skin (it refuses the rest), so this is said in words before it is asked.
  if (mesh.openEdges > 0) return refused(`The part's surface isn't closed: ${mesh.openEdges} of its edges ${mesh.openEdges === 1 ? "isn't" : "aren't"} shared by exactly two triangles (a hole or a loose flap), so the slicer can't tell inside from outside. Repair it in the CAD program and save the STL again.`, notes);

  // The print check: what to look at before approving, not refusals (a teacher may know the part prints fine).
  const found = printCheck([mesh]);
  if (found.skipped) notes.push("The part has too many triangles for the print check (over 50,000), so supports, thin walls and weak spots weren't checked.");
  if (found.thinnest !== null) notes.push(`Thin walls: the thinnest is ${found.thinnest.toFixed(2)} mm, under the 0.42 mm line the printer lays, over ${mm1(found.thinArea)} mm² of the surface.`);
  if (found.longestBridge > 0) notes.push(`A bridge of about ${mm1(found.longestBridge)} mm may sag (over about 10 mm sags).`);
  if (found.weakest !== null) notes.push(`A weak spot ${mm1(found.weakest.z - (lo[2] as number))} mm up: a section of ${mm1(found.weakest.area)} mm² holds ${mm1(found.weakest.above)} mm² above it, so it may snap there.`);

  // Supports: the slice uses them when the part needs them, so its time and filament include them.
  const stl = isBinaryStl(bytes) ? bytes : binaryStlOf(mesh);
  const hanging = overhangArea([stl]);
  const hint = supportsHint(hanging, choices.supports !== "off");
  if (hint?.recommended && choices.supports === "off") {
    choices = { ...choices, supports: "normal" };
    // The print check's area leaves out what rests on the part below (a plate's underside over its column); Slice's
    // hint, which decides, counts every face leaning out. Say the print check's when it ran.
    const area = found.skipped ? hanging : found.supportsArea;
    notes.push(`Needs supports (about ${Math.round(area)} mm² hangs out with nothing under it), so it is sliced with supports.`);
  }

  let sliced: Awaited<ReturnType<typeof sliceStls>>;
  try {
    sliced = await sliceStls(setup.kernel, async () => [stl], choices);
  } catch (err) {
    return refused(refusalOf(err), notes);
  }
  const minutes = Math.ceil(sliced.printTimeS / 60);
  const grams = Math.round(sliced.filamentG * 10) / 10;
  if (!(minutes >= 0) || !(grams >= 0)) return refused("The slicer gave no time or filament for it, so it can't be estimated. Ask the teacher to slice it by hand.", notes);
  if (minutes > QUEUE_LIMITS.minutes) return refused(`It would take about ${timeWords(sliced.printTimeS)} to print, longer than the queue takes (a week). Make it smaller or split it.`, notes);
  if (grams > QUEUE_LIMITS.amount.g) return refused(`It would use about ${Math.round(grams)} g of filament, more than the queue takes (5 kg). Make it smaller or split it.`, notes);
  const unprinted = unprintedWords(sliced);
  if (unprinted) notes.push(unprinted);
  if (sliced.levelNote) notes.push(sliced.levelNote);
  if (setup.material !== undefined && !/\bpla\b/i.test(setup.material)) notes.push(`The filament weight is worked out for PLA; ${setup.material} weighs a little more or less.`);
  const facts = [`About ${timeWords(sliced.printTimeS) ?? "an unknown time"} of printing, plus heating and levelling.`, `About ${grams} g of filament (${sliced.layers} layers).`, `${mm1(size[0] as number)} × ${mm1(size[1] as number)} × ${mm1(size[2] as number)} mm.`];
  return { passed: true, estimate: { minutes, amount: grams }, facts, notes };
}

// ---------------------------------------------------------------- laser

/** Whether a w × h drawing goes on the bed: as it is, turned a quarter turn, or not (with the amounts over). */
export function bedFit(w: number, h: number, bed: LaserBed): { fits: "as-is" | "turned" | null; over: [number, number] } {
  const t = FIT_TOLERANCE;
  if (w <= bed.width + t && h <= bed.height + t) return { fits: "as-is", over: [0, 0] };
  if (h <= bed.width + t && w <= bed.height + t) return { fits: "turned", over: [0, 0] };
  return { fits: null, over: [Math.max(0, w - bed.width), Math.max(0, h - bed.height)] };
}

const LAYER_WORDS: Record<LaserLayer, [string, string]> = { cut: ["shape to cut", "shapes to cut"], score: ["line to score", "lines to score"], engrave: ["shape to engrave", "shapes to engrave"] };

/** The laser check of an SVG or DXF drawing against `bed`. Never throws. */
export function checkLaserFile(fileName: string, bytes: Uint8Array, bed: LaserBed = KH1490_BED): FileCheck {
  const e = ext(fileName);
  if (e !== ".svg" && e !== ".dxf") return refused(wrongType("laser", e));
  const big = sizeProblem(bytes);
  if (big) return refused(big);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    // Old DXF files are often in a Windows code page: their drawing is plain ASCII all the same.
    if (e === ".svg") return refused("The SVG file isn't readable text, so it is damaged. Save it again.");
    text = new TextDecoder("latin1").decode(bytes);
  }
  const read = e === ".svg" ? readSvg(text) : readDxf(text);
  if (!read.ok) return refused(read.reason);
  const d: DrawingRead = read.drawing;
  const notes = [...d.notes];
  const size = `${mm1(d.width)} × ${mm1(d.height)} mm`;
  const surely = bedFit(d.width, d.height, bed);
  const atMost = bedFit(d.width + d.slack, d.height + d.slack, bed);
  if (surely.fits === null) {
    const [ow, oh] = surely.over;
    const over = [ow > 0 ? `${mm1(ow)} mm too wide` : "", oh > 0 ? `${mm1(oh)} mm too tall` : ""].filter(Boolean).join(" and ");
    return refused(`The drawing is ${size}, and ${bed.name} takes ${bed.width} × ${bed.height} mm, so it is ${over}, and turned a quarter turn it doesn't fit either. Make it smaller or split it.`, notes);
  }
  if (atMost.fits === null) return refused(`The drawing is at least ${size} and its curves may reach ${d.slack.toFixed(3)} mm further, right at the edge of ${bed.name} (${bed.width} × ${bed.height} mm), too close to be sure it fits. Make it a little smaller.`, notes);
  if (surely.fits === "turned" || atMost.fits === "turned") notes.push("It fits on the bed only turned a quarter turn.");
  const layers = (["cut", "score", "engrave"] as const).filter((l) => d.layers[l] > 0).map((l) => `${d.layers[l]} ${LAYER_WORDS[l][d.layers[l] === 1 ? 0 : 1]}`);
  const area = Math.round(d.width * d.height);
  const facts = [`${size}, on ${bed.name}.`, `${layers.join(", ")}.`, "Laser time: not yet (the laser's time estimate comes with its path planning)."];
  return { passed: true, estimate: { minutes: null, amount: area }, facts, notes };
}

// ---------------------------------------------------------------- into the queue

/** A text cut to `max` characters, with "…" when cut. */
const cut = (s: string, max: number): string => ([...s].length <= max ? s : `${[...s].slice(0, max - 1).join("")}…`);

/** The most notes a check gives a job. */
export const MAX_NOTES = 12;

/** The queue's check action for job `id` from what the check said (texts cut to the queue's limits). */
export function checkAction(id: string, at: number, check: FileCheck): Action {
  const notes = check.notes.slice(0, MAX_NOTES).map((n) => cut(n, QUEUE_LIMITS.reasonChars));
  if (check.passed) return { kind: "check", by: { role: "check" }, at, id, passed: true, estimate: { ...check.estimate }, notes: [...check.facts.map((f) => cut(f, QUEUE_LIMITS.reasonChars)), ...notes].slice(0, MAX_NOTES + 3) };
  return { kind: "check", by: { role: "check" }, at, id, passed: false, reason: cut(check.reason, QUEUE_LIMITS.reasonChars), notes };
}
