// Mutation testing's survivors in packages/print/src/slice-run.ts (test audit D-5 part 3, stryker/print.json): each test
// here is worked by hand and fails under the mutants named beside it. The ones no test can kill are explained in
// packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KernelCalls } from "@fission/core";
import { fitPieceStl } from "../src/fit-piece.ts";
import {
  bodiesOfFiles,
  fileCrawl,
  gcodeName,
  gcodeOfPackage,
  levelNote,
  levelNoteOf,
  nameLead,
  P1S_KIND,
  PREVIEW_EARLIER,
  printFileName,
  printFileOfStls,
  printLead,
  printMovesOf,
  printWords,
  progressWords,
  refusalOf,
  refusalWords,
  SLICE_EARLIER,
  SliceDropped,
  sliceStls,
  stlHighestZ,
  stlLowestZ,
  stopSlices,
  supportStyle,
  testPieceFile,
  unprintedWords,
} from "../src/slice-run.ts";
import { PRINT_DEFAULTS } from "../src/choices.ts";

type P = [number, number, number];
/** A binary STL of `tris` (three corners each), its count field `count` (little-endian, as the format says). */
function stl(tris: P[][], count = tris.length): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50);
  const v = new DataView(out.buffer);
  v.setUint32(80, count, true);
  tris.forEach((t, i) => t.flat().forEach((x, k) => v.setFloat32(84 + i * 50 + 12 + k * 4, x, true)));
  return out;
}

/** "Body n starts g mm above the lowest body. …", as levelNote words it. */
const hangs = (n: number, g: number) =>
  `Body ${n} starts ${g} mm above the lowest body. The lowest point goes on the plate, so it hangs in the air and only prints with supports on: set the bodies on one level to print them together.`;

// ---------- the STL readers ----------

test("STL readers: the count is read little-endian and never past the triangles stored", () => {
  // Count 1, two triangles stored: only the first (z 4..6) is read. Read big-endian (the mutant), 1 is 16,777,216,
  // cut to the 2 stored, so the second triangle (z 1..9) would count and give 1 and 9.
  const two = stl([[[0, 0, 4], [1, 0, 5], [0, 1, 6]], [[0, 0, 1], [1, 0, 9], [0, 1, 5]]], 1);
  assert.equal(stlLowestZ(two), 4);
  assert.equal(stlHighestZ(two), 6);
  // Count 5 with one triangle stored (a cut-off file): (134 − 84) / 50 = 1 triangle is read. With × 50, + 84 or max for
  // min, the reader would go past the end (a RangeError) or read 5.
  const cut = stl([[[0, 0, 2], [1, 0, 3], [0, 1, 7]]], 5);
  assert.equal(stlHighestZ(cut), 7);
  assert.equal(stlLowestZ(cut), 2);
  // The same cut-off and short-count files through levelNoteOf, which reads the corners itself (stlCorners): body 2's
  // only read triangle is at z 4..6 (the second, at z 1, is past its count) on body 1 at z 0..2 far away: it hangs 4 mm.
  const floor = stl([[[50, 50, 0], [51, 50, 1], [50, 51, 2]]], 9);
  assert.equal(levelNoteOf([floor, two]), hangs(2, 4));
});

test("STL readers: every triangle and every corner is read, the lowest and highest wherever they are", () => {
  // Two triangles: the first z 5, 6, 7; the second z 5, 9, 1, its corner 2 the lowest (1) and corner 1 the highest (9).
  // Read at t / 50 or c / 12 in place of t × 50 or c × 12, the offsets round down to the first triangle or corner.
  const f = stl([[[0, 0, 5], [1, 0, 6], [0, 1, 7]], [[0, 0, 5], [1, 0, 9], [0, 1, 1]]]);
  assert.equal(stlLowestZ(f), 1);
  assert.equal(stlHighestZ(f), 9);
});

test("stackStl puts each file's bytes after the last", () => {
  const a = stl([[[0, 0, 1], [1, 0, 2], [0, 1, 3]]]);
  const b = stl([[[5, 5, 4], [6, 5, 5], [5, 6, 6]]]);
  assert.deepEqual([...bodiesOfFiles([a, b]).stl], [...a, ...b]);
});

test("STL readers: a file too short for its count, or with no triangle, has no highest point", () => {
  // 10 bytes: no count field at all (it is at bytes 80..83), so no triangle; reading it anyway would throw.
  assert.ok(Number.isNaN(stlHighestZ(new Uint8Array(10))));
  assert.ok(Number.isNaN(stlLowestZ(new Uint8Array(10))));
  // levelNoteOf reads the corners of such a file too: no triangle, so only one body is known, and no note.
  assert.equal(levelNoteOf([new Uint8Array(10), stl([[[0, 0, 5], [1, 0, 6], [0, 1, 7]]])]), "");
  // 84 bytes, count 0: no triangle, NaN (not −Infinity, the empty maximum).
  assert.ok(Number.isNaN(stlHighestZ(stl([]))));
  assert.ok(Number.isNaN(stlLowestZ(stl([]))));
});

test("P1S_KIND names the P1S file for the save box", () => {
  assert.deepEqual(P1S_KIND, { description: "Bambu Lab P1S print file", mime: "model/3mf", extension: ".gcode.3mf" });
});

// ---------- levelNote ----------

test("levelNote: a body not known (NaN) is left out, not taken as the floor", () => {
  // Lowest points NaN, 0 and 5: the floor is 0 (the NaN body is not known), and body 3 is 5 mm above it. Without the
  // filter, min(NaN, 0, 5) is NaN and no body would be named.
  assert.equal(levelNote([NaN, 0, 5]), hangs(3, 5));
});

test("levelNote: the gap is from the lowest body, which may be any body, and one body alone has no note", () => {
  // Lowest points 1 and 3: body 2 is 3 − 1 = 2 mm up (3 + 1 would also name body 1, as 1 + 1 = 2 > 0.1).
  assert.equal(levelNote([1, 3]), hangs(2, 2));
  // Body 1 the one up, at index 0: 5 − 0 = 5 mm.
  assert.equal(levelNote([5, 0]), hangs(1, 5));
  assert.strictEqual(levelNote([5]), "");
});

test("levelNote: exactly LEVEL_GAP (0.1 mm) above the lowest body is still level", () => {
  // 0.1 − 0 = 0.1 exactly in floating point, so the gap is not more than LEVEL_GAP: no note (>= would name body 2).
  assert.equal(levelNote([0, 0.1]), "");
  // Just over: 0.2 mm up is named, rounded to 0.2.
  assert.equal(levelNote([0, 0.2]), hangs(2, 0.2));
});

// ---------- the engine calls ----------

/** A kernel whose every call fails with `failure`; it has no stopSlicing (an engine from before it). */
const refusing = (failure: unknown, calls: unknown[][] = []) => ({ call: (...a: unknown[]) => (calls.push(a), Promise.reject(failure)) }) as unknown as KernelCalls;
/** One body from z 5 to z 12 (7 mm tall), seen from above a triangle 10 × 10 mm. */
const POST = stl([[[0, 0, 5], [10, 0, 12], [0, 10, 8]]]);

test("engine: a refusal that is not an object (a string, null) comes back as it was", async () => {
  // A WeakMap takes only objects: remembering the height of a string or of null (the mutants dropping a check) would
  // throw a TypeError in place of the engine's own refusal.
  await assert.rejects(sliceStls(refusing("a plain refusal"), () => Promise.resolve([POST]), PRINT_DEFAULTS), (e) => e === "a plain refusal");
  await assert.rejects(sliceStls(refusing(null), () => Promise.resolve([POST]), PRINT_DEFAULTS), (e) => e === null);
  // A string refusal has no height to say: the words keep the engine's "about".
  assert.equal(refusalOf("layer 9 reaches z = 300.2 mm, above the printer's 250 mm"), "The part is about 300.2 mm tall, and the P1S prints up to 250 mm. Make it shorter or split it into pieces.");
});

test("engine: the bodies' height is from their lowest point to their highest, 5 to 12 is 7 mm", async () => {
  // POST runs from z 5 to z 12: 12 − 5 = 7 mm (with + it would be 17).
  assert.equal(bodiesOfFiles([POST]).height, 7);
  let caught: unknown;
  await printFileOfStls(refusing(new Error("layer 1300 reaches z = 260.1 mm, above the printer's 250 mm")), () => Promise.resolve([POST]), PRINT_DEFAULTS, "textured").catch((e) => (caught = e));
  assert.equal(refusalOf(caught), "The part is 7 mm tall, and the P1S prints up to 250 mm. Make it shorter or split it into pieces.");
});

test("stopSlices with an engine that has no stopSlicing still drops the slice", async () => {
  // The kernel here has no stopSlicing: calling it without ?. would throw from stopSlices itself.
  const calls: unknown[][] = [];
  let release: () => void = () => undefined;
  const waiting = sliceStls(refusing(new Error("never asked"), calls), () => new Promise((r) => (release = () => r([POST]))), PRINT_DEFAULTS);
  assert.doesNotThrow(() => stopSlices());
  release();
  await assert.rejects(waiting, SliceDropped);
  assert.equal(calls.length, 0);
});

test("testPieceFile asks the engine for the fit piece as a P1S file, without supports, and says its height (2 + 6 = 8 mm)", async () => {
  const calls: unknown[][] = [];
  const kernel = { call: (...a: unknown[]) => (calls.push(a), Promise.resolve({ bytes: new Uint8Array(1) })) } as unknown as KernelCalls;
  const choices = { ...PRINT_DEFAULTS, supports: "tree" as const };
  const made = await testPieceFile(kernel, choices, "smooth", "high-flow");
  assert.deepEqual(made, { bytes: new Uint8Array(1) });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["print_file_stl", fitPieceStl(), 0.2, 2, 15, "off", "smooth", "high-flow", true, false, "bambu-pla-basic"]);
  // The fit piece is FIT_THICK (2) + FIT_PEG (6) = 8 mm tall, so a "too tall" refusal names 8 mm (− would say −4, refused as not > 0).
  let caught: unknown;
  await testPieceFile(refusing(new Error("layer 40 reaches z = 300 mm, above the printer's 250 mm")), choices, "textured").catch((e) => (caught = e));
  assert.equal(refusalOf(caught), "The part is 8 mm tall, and the P1S prints up to 250 mm. Make it shorter or split it into pieces.");
});

test("SliceDropped says the dialog was closed", () => {
  assert.equal(new SliceDropped().message, "The dialog was closed before the slice finished.");
});

// ---------- gcodeOfPackage ----------

/** A ZIP local file entry: signature, method, sizes, the name and `extra` bytes of extra field, then `data`. */
function entry(name: string, data: string, { method = 0, extra = 0, size }: { method?: number; extra?: number; size?: number } = {}): Uint8Array {
  const n = new TextEncoder().encode(name);
  const d = new TextEncoder().encode(data);
  const out = new Uint8Array(30 + n.length + extra + d.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(8, method, true);
  v.setUint32(18, size ?? d.length, true);
  v.setUint32(22, d.length, true);
  v.setUint16(26, n.length, true);
  v.setUint16(28, extra, true);
  out.set(n, 30);
  out.set(d, 30 + n.length + extra);
  return out;
}
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};
const PLATE = "Metadata/plate_1.gcode";

test("gcodeOfPackage: the plate's G-code, read past an extra field and to the very last byte", () => {
  // The plate entry alone, ending exactly at the last byte (start + size = length: not past it, so it is read).
  assert.equal(gcodeOfPackage(entry(PLATE, "G1 X1")), "G1 X1");
  // A 6-byte extra field after the name: the data starts 30 + 22 + 6 bytes in (− 6, or the field length read
  // big-endian, 0x0600 = 1536, would miss it).
  assert.equal(gcodeOfPackage(cat(entry("a.txt", "zz"), entry(PLATE, "G1 Y2", { extra: 6 }))), "G1 Y2");
});

test("gcodeOfPackage: a compressed plate, a wrong signature and a cut-off entry are not read", () => {
  // Method 8 (deflate): its bytes are not G-code, so null.
  assert.equal(gcodeOfPackage(entry(PLATE, "xx", { method: 8 })), null);
  // The same stored plate entry behind 4 bytes that are no signature: not a ZIP, null.
  const bad = entry(PLATE, "G1 X1");
  new DataView(bad.buffer).setUint32(0, 0x04034b51, true);
  assert.equal(gcodeOfPackage(bad), null);
  // An entry saying 50 bytes with 5 there: cut off, null (start − size would pass it and return the 5).
  assert.equal(gcodeOfPackage(entry(PLATE, "G1 X1", { size: 50 })), null);
});

// ---------- printMovesOf ----------

test("printMovesOf: from the first ;LAYER_CHANGE line on its own, with the routine's last Z move kept", () => {
  const gcode = [
    "; set up ;LAYER_CHANGE", // not a line of its own: no ^ would start here
    ";LAYER_CHANGE_NOT", // not the whole line: no $ would start here
    "G1 Z12.45", // two decimals, two whole digits
    "G0 X1 Y2 Z3", // a move with other words before Z: the routine's last Z move, 3
    "M1002 G1 Z77", // not a move line (G1 is not at its start), after it
    "G2 Z99", // G2 is not a straight move
    ";LAYER_CHANGE",
    "G1 Z0.2 F600",
    "G1 X5 E1",
    ";===== end of the print",
    "G1 Z250",
  ].join("\n");
  assert.equal(printMovesOf(gcode), "G90\nM83\nG1 Z3\n;LAYER_CHANGE\nG1 Z0.2 F600\nG1 X5 E1\n");
});

test("printMovesOf: each form of Z number is read whole", () => {
  const moves = (z: string) => printMovesOf(`G1 X1 Z${z}\n;LAYER_CHANGE\nG1 X2\n`);
  // Whole, decimal, two-digit decimal, negative: each kept as written.
  assert.equal(moves("5"), "G90\nM83\nG1 Z5\n;LAYER_CHANGE\nG1 X2\n");
  assert.equal(moves("12.75"), "G90\nM83\nG1 Z12.75\n;LAYER_CHANGE\nG1 X2\n");
  assert.equal(moves("-0.5"), "G90\nM83\nG1 Z-0.5\n;LAYER_CHANGE\nG1 X2\n");
  assert.equal(moves("0.4"), "G90\nM83\nG1 Z0.4\n;LAYER_CHANGE\nG1 X2\n");
});

test("printMovesOf: a file starting at its first layer, without a Z move or an end routine, keeps every byte", () => {
  // ;LAYER_CHANGE at index 0 is found (first = 0 is not "none"); no Z before it, so no lift line; no end routine, so
  // all to the last character ("x").
  assert.equal(printMovesOf(";LAYER_CHANGE\nG1 X1 E1\nx"), "G90\nM83\n;LAYER_CHANGE\nG1 X1 E1\nx");
  assert.equal(printMovesOf("G1 X1\nno layers"), null);
});

// ---------- the words ----------

test("refusalWords: a part as deep as it is wide is called wide", () => {
  // Runs from (0, 0) to (300, 300): 300 × 300, w = d, so "wide".
  assert.equal(
    refusalWords("the part, placed at (0, 0), runs from (0, 0) to (300, 300), off the 256 × 256 mm bed"),
    "The part is 300 mm wide, and the P1S's plate takes 256 × 256 mm. Make it smaller or split it into pieces.",
  );
});

test("refusalWords: a height of 0 or less is not said; the engine's own height is", () => {
  const tall = "layer 1300 reaches z = 260.2 mm, above the printer's 250 mm";
  const about = "The part is about 260.2 mm tall, and the P1S prints up to 250 mm. Make it shorter or split it into pieces.";
  assert.equal(refusalWords(tall, 0), about);
  assert.equal(refusalWords(tall, -3), about);
  assert.equal(refusalWords(tall, 251.04), "The part is 251 mm tall, and the P1S prints up to 250 mm. Make it shorter or split it into pieces.");
});

test("nameLead: only the whole name Untitled (any case) is not a name", () => {
  assert.equal(nameLead("untitled"), "spindlelabs");
  assert.equal(nameLead("Untitled 2"), "Untitled 2");
  assert.equal(nameLead("My untitled"), "My untitled");
});

test("printLead: a file name of only spaces is no name", () => {
  assert.equal(printLead(undefined, "   "), undefined);
  assert.equal(printLead("", " bracket "), " bracket ");
});

test("supportStyle: a value the list does not have is off", () => {
  assert.equal(supportStyle("bogus"), "off");
  assert.equal(supportStyle("tree"), "tree");
});

test("unprintedWords: 0.005 mm³ is the least worth a warning", () => {
  // 0.005 rounds to 0.01 in the words, so it is warned of (> would leave it out); 0.0049 is not.
  assert.match(unprintedWords({ unprintedVolume: 0.005 }) ?? "", /about 0\.01 mm³/);
  assert.equal(unprintedWords({ unprintedVolume: 0.0049 }), null);
});

test("progressWords: a stage of one step or none says no layer; a stage not known says nothing", () => {
  // total 1: one step, so no "layer 1 of 1" (> 1, not ≥ 1); total 0 likewise, with the ellipsis.
  assert.equal(progressWords({ stage: "walls", done: 1, total: 1 }), "Walls…");
  assert.equal(progressWords({ stage: "supports", done: 0, total: 0 }), "Supports…");
  assert.equal(progressWords({ stage: "paths", done: 3, total: 9 }), "Putting the paths in order: layer 3 of 9");
  assert.strictEqual(progressWords({ stage: "mystery" as never, done: 0, total: 0 }), "");
});

test("the earlier-choices words", () => {
  assert.equal(SLICE_EARLIER, "A choice was changed while it sliced, so this is the slice of the earlier choices: slice again for the new ones.");
  assert.equal(PREVIEW_EARLIER, "A choice was changed while it sliced, so this preview shows the earlier choices: preview again for the new ones.");
});

// ---------- levelNoteOf: what holds a body up ----------
// The lower body here is a set of upright triangles from z 0 to z 20, each cut at z ≈ 10 (the upper body's lowest
// point, 10.1, less LEVEL_GAP) into one chosen segment of the section; the upper body is one flat triangle at z 10.1,
// its underside. So each test picks exactly which outline is under the underside, and so which of holdsUp's ways of
// seeing an overlap (a corner or the centre of the underside inside the outline, a corner of the outline inside the
// underside, or their edges crossing) is the only one that can see it.

/**
 * An upright triangle whose cut at z ≈ 10 runs from `s` to `e`: corners e' = 2e − s and s at z 0, and s at z 20. Its
 * upright edge (s, z 0 to 20) is cut at exactly s, found first (edges are walked 0-1, 1-2, 2-0: 0-1 lies wholly under
 * the cut); its slanting edge 2-0 is cut halfway, at e (to within a few millionths, as z 10.1 is stored to 7 digits).
 */
const wall = (s: [number, number], e: [number, number]): P[] => [[2 * e[0] - s[0], 2 * e[1] - s[1], 0], [s[0], s[1], 0], [s[0], s[1], 20]];
/** The closed outline through `pts`, as walls. */
const loop = (pts: [number, number][]): P[][] => pts.map((p, i) => wall(p, pts[(i + 1) % pts.length]));
/** The underside: one flat triangle at z 10.1. */
const under = (a: [number, number], b: [number, number], c: [number, number]) => stl([[[...a, 10.1], [...b, 10.1], [...c, 10.1]]]);
/** Counter-clockwise from above: (0, 0), (10, 0), (0, 10); its centre (10/3, 10/3). */
const CCW = under([0, 0], [10, 0], [0, 10]);
/** The same triangle clockwise: (0, 0), (0, 10), (10, 0). */
const CW = under([0, 0], [0, 10], [10, 0]);
const HANGS = hangs(2, 10.1);
const rests = (below: P[][], top: Uint8Array) => levelNoteOf([stl(below), top]);

test("holdsUp: the underside wholly inside a wide outline (only its corners are inside: no outline corner or edge meets it)", () => {
  // The square ±50 holds all of the triangle; no corner of the square is in the triangle and no edges cross.
  const wide = loop([[-50, -50], [50, -50], [50, 50], [-50, 50]]);
  assert.equal(rests(wide, CCW), "");
  // The same square under a triangle 200 mm away holds nothing.
  assert.equal(rests(wide, under([200, 200], [210, 200], [200, 210])), HANGS);
});

test("holdsUp: a small outline wholly inside the underside (only the outline's corners are inside it)", () => {
  // The square 1..2 lies inside the triangle (x + y ≤ 4 < 10): no triangle corner, nor its centre (3.33, 3.33), is in
  // the square, and no edges cross; the square's corners, each the start of a segment, are in the triangle.
  const small = loop([[1, 1], [2, 1], [2, 2], [1, 2]]);
  assert.equal(rests(small, CCW), "");
  assert.equal(rests(small, CW), "");
  // Moved to 11..12 it is outside the triangle (x + y ≥ 22 > 10): nothing holds the body.
  assert.equal(rests(loop([[11, 11], [12, 11], [12, 12], [11, 12]]), CCW), HANGS);
});

test("holdsUp: one segment crossing the underside's edge (only the crossing sees it), either way round", () => {
  // From (−1, 4) to (2, 5): it crosses the edge x = 0 at y = 4 1/3. Its start is outside the triangle, its end (2, 5)
  // is inside but never tested as a corner; no ray to +x from a triangle corner (y 0 or 10) or the centre (y 10/3)
  // meets it (y 4..5), so no point is inside it.
  // Counter-clockwise, edge (0, 10) → (0, 0): d1 = −10 < 0, d2 = 20 > 0 and d3 = 17 > 0, d4 = −13 < 0.
  // Clockwise, edge (0, 0) → (0, 10): d1 = 10 > 0, d2 = −20 < 0 and d3 = −13 < 0, d4 = 17 > 0.
  const across = [wall([-1, 4], [2, 5])];
  assert.equal(rests(across, CCW), "");
  assert.equal(rests(across, CW), "");
  // Short of the edge, from (−3, 4) to (−1, 5): no crossing, no overlap.
  assert.equal(rests([wall([-3, 4], [-1, 5])], CCW), HANGS);
  assert.equal(rests([wall([-3, 4], [-1, 5])], CW), HANGS);
});

test("holdsUp: the hypotenuse crossed from outside, and a segment passing beside it", () => {
  // From (8, 8) (x + y = 16, outside) to (4, 4) (inside): crosses x + y = 10 at (5, 5). y 4..8 misses every ray.
  assert.equal(rests([wall([8, 8], [4, 4])], CCW), "");
  assert.equal(rests([wall([8, 8], [4, 4])], CW), "");
  // From (8, 8) to (6, 6): stops short of the hypotenuse (x + y = 12 > 10).
  assert.equal(rests([wall([8, 8], [6, 6])], CCW), HANGS);
});

/**
 * As `wall`, but with the end exact and the start found first by the slanting edge: corners 2s − e at z 0, e at z 20 and
 * e at z 0 (edges 0-1 slanting, cut halfway near s; 1-2 upright, cut at exactly e). The start's x and y are each worked
 * the same way, so a start on the line y = x or y = −x, or with x or y equal to e's, stays exactly on it.
 */
const wallToExact = (s: [number, number], e: [number, number]): P[] => [[2 * s[0] - e[0], 2 * s[1] - e[1], 0], [e[0], e[1], 20], [e[0], e[1], 0]];

test("holdsUp: a corner inside a slanting outline, its crossings worked from either end", () => {
  // The outline (−20, −20), (30.5, −20), (−20, 30.5) holds the triangle (its long side x + y = 10.5 passes 0.5 beyond
  // the triangle's x + y = 10). A ray to +x from the corner (10, 0) meets that side at x = 10.5 − 0 = 10.5 > 10, once:
  // inside. Walked one way the side runs from (30.5, −20): x = 30.5 + (20 / 50.5) · (−50.5) = 10.5; the other way from
  // (−20, 30.5): x = −20 + (−30.5 / −50.5) · 50.5 = 10.5. Mistaking any sign or operation in that sum moves the crossing
  // far from 10.5 for one of the two ways, and then no corner is seen inside (nothing else overlaps).
  const pts: [number, number][] = [[-20, -20], [30.5, -20], [-20, 30.5]];
  assert.equal(rests(loop(pts), CCW), "");
  assert.equal(rests(loop([...pts].reverse()), CCW), "");
});

test("holdsUp: a segment ending at the height of a corner of the underside, below it, is not crossed by its ray", () => {
  // From (15, −10) up to (15, 0), the end exact: a ray to +x from (0, 0) or (10, 0) runs along y = 0 and meets the
  // segment only at its top end. Counted only where one end is above the ray and the other not (y > 0 strictly), it is
  // not crossed, so nothing is inside; counting y ≥ 0 at either end would count it once and call the corner inside.
  // (15, 0) is outside the triangle and no edge crosses: the body hangs.
  assert.equal(rests([wallToExact([15, -10], [15, 0])], CCW), HANGS);
  // The same with the exact end first, (15, 0) down to (15, −10).
  assert.equal(rests([wall([15, 0], [15, -10])], CCW), HANGS);
});

test("holdsUp: a segment touching a corner of the underside does not hold it up", () => {
  // From (−5, 5) to (5, −5), exactly along y = −x: it passes through the corner (0, 0) only, the triangle lying in
  // x, y ≥ 0. Not inside: the ray from (0, 0) meets it at x = 0, not beyond. Not crossing an edge: (0, 0) is on the
  // segment's line, so for the edge (0, 0)–(10, 0) d3 = 0 (and d4 = 100), and for (0, 10)–(0, 0) d4 = 0 (d3 = 100).
  // Its start (−5, 5) is outside the triangle. Either way round, and for the triangle either way round: it hangs.
  for (const top of [CCW, CW]) {
    assert.equal(rests([wallToExact([-5, 5], [5, -5])], top), HANGS);
    assert.equal(rests([wallToExact([5, -5], [-5, 5])], top), HANGS);
  }
});

test("holdsUp: a segment ending on an edge of the underside touches it, it does not cross it", () => {
  // From (−2, 5) to exactly (0, 5), on the edge x = 0: d2 = 0, so no crossing (the next segment of a closed outline
  // starts there and is seen by its corner). The segment's start is outside, and its height 5 is no corner's.
  for (const top of [CCW, CW]) assert.equal(rests([wallToExact([-2, 5], [0, 5])], top), HANGS);
  // From (2, −3) up to exactly (2, 0), on the edge y = 0, and from (8, 8) to exactly (5, 5), on x + y = 10.
  for (const top of [CCW, CW]) {
    assert.equal(rests([wallToExact([2, -3], [2, 0])], top), HANGS);
    assert.equal(rests([wallToExact([8, 8], [5, 5])], top), HANGS);
  }
});

test("holdsUp: an outline corner exactly on an edge of the underside is in it; just outside one edge is not", () => {
  // Segments starting exactly on each edge (y = 0 at (5, 0), x + y = 10 at (5, 5), x = 0 at (0, 5)) and running away
  // from the triangle: only the start touches, and inTriangle takes "on" as inside (one cross product 0, the others
  // of one sign). Then starting 1 mm outside each edge: one cross product of the other sign, so outside.
  const away: [[number, number], [number, number]][] = [[[5, 0], [5, -5]], [[5, 5], [8, 8]], [[0, 5], [-5, 5]]];
  for (const top of [CCW, CW]) {
    for (const [s, e] of away) assert.equal(rests([wall(s, e)], top), "", `${s} on the edge`);
    for (const [s, e] of away) {
      const out: [number, number] = [s[0] + Math.sign(e[0] - s[0]), s[1] + Math.sign(e[1] - s[1])];
      assert.equal(rests([wall(out, e)], top), HANGS, `${out} outside`);
    }
  }
});

test("holdsUp: only the underside counts, and only as far as the file's count says", () => {
  const wide = loop([[-50, -50], [50, -50], [50, 50], [-50, 50]]);
  // The upper body's underside (z 10.1) is 200 mm away; over the wide outline it has only a lid at z 40 (lowest corner
  // 40 > 10.1 + 0.1: not underside) and an upright side wall from z 10.1 to 30 along y = 5 (seen from above a line,
  // cross product 0: it covers nothing). So nothing holds it up.
  const far: P[] = [[200, 200, 10.1], [210, 200, 10.1], [200, 210, 10.1]];
  const lid: P[] = [[0, 0, 40], [10, 0, 40], [0, 10, 40]];
  const side: P[] = [[0, 0, 10.1], [10, 10, 10.1], [5, 5, 30]]; // along y = x, so it is a line from above

  assert.equal(levelNoteOf([stl(wide), stl([lid, far])]), HANGS);
  assert.equal(levelNoteOf([stl(wide), stl([far, lid])]), HANGS);
  assert.equal(levelNoteOf([stl(wide), stl([far, side])]), HANGS);
  assert.equal(levelNoteOf([stl(wide), stl([side, far])]), HANGS);
  // A sloping underside from z 10.1 at (0, 0) up to 30: its lowest corner is within reach, so it is underside (were
  // its highest corner taken, 30 > 10.2, it would not be) and stands on the outline.
  assert.equal(levelNoteOf([stl(wide), stl([far, [[0, 0, 10.1], [10, 0, 30], [0, 10, 30]]])]), "");
  // An underside triangle over the outline but past the file's count (1): not read, so the body hangs.
  assert.equal(levelNoteOf([stl(wide), stl([far, [[0, 0, 10.1], [10, 0, 10.1], [0, 10, 10.1]]], 1)]), HANGS);
});

test("holdsUp: the body below must have material LEVEL_GAP under the underside, not above it", () => {
  // The lower body's outline reaches only up to z 10.15: cut at 10.1 − 0.1 = 10.0 it is there (the body rests), cut at
  // 10.2 it would not be.
  // Each wall's upright edge at s is cut at s; its slanting edge, from s at z 10.15 down to s + k(e − s) at z 0, is
  // cut 0.15 / 10.15 of the way down, so with k = 10.15 / 0.15 there, at e.
  const k = 10.15 / 0.15;
  const low = (s: [number, number], e: [number, number]): P[] => [[s[0] + k * (e[0] - s[0]), s[1] + k * (e[1] - s[1]), 0], [s[0], s[1], 0], [s[0], s[1], 10.15]];
  const pts: [number, number][] = [[-50, -50], [50, -50], [50, 50], [-50, 50]];
  assert.equal(rests(pts.map((p, i) => low(p, pts[(i + 1) % 4])), CCW), "");
});

test("slices end their run: a finished slice is not stopped again by a later stopSlices", async () => {
  let stops = 0;
  const kernel = { call: () => Promise.resolve({ layers: 1 }), stopSlicing: () => void stops++ } as unknown as KernelCalls;
  await sliceStls(kernel, () => Promise.resolve([POST]), PRINT_DEFAULTS);
  stopSlices();
  assert.equal(stops, 0, "the finished slice left the runs");
});

test("printFileOfStls asks print_file_stl with the P1S file's own filament (Automatic is Bambu PLA Basic)", async () => {
  const calls: unknown[][] = [];
  const kernel = { call: (...a: unknown[]) => (calls.push(a), Promise.resolve({ bytes: new Uint8Array(0) })) } as unknown as KernelCalls;
  await printFileOfStls(kernel, () => Promise.resolve([POST]), PRINT_DEFAULTS, "cool_plate");
  assert.equal(calls[0][0], "print_file_stl");
  assert.deepEqual(calls[0].slice(2), [0.2, 2, 15, "off", "cool_plate", "standard", true, false, "bambu-pla-basic"]);
});

test("holdsUp: the centre of the underside is the only thing inside an outline that meets it only at two corners", () => {
  // The underside a (20, 20), b (32, 14), c (28, 28) (counter-clockwise), centre (80/3, 62/3) ≈ (26.67, 20.67). The
  // outline is the rectangle x 15..28, y 20..34, walked as four segments: (15, 20) → (28, 20) along y = 20, through a;
  // (28, 34) → (28, 20) along x = 28, through c; (28, 34) → (15, 34); (15, 20) → (15, 34). So its corners (28, 20) and
  // (15, 34) are never a segment's start, and only the starts (15, 20) and (28, 34) are tested in the triangle: both are
  // outside. Each segment lies exactly on its line (its ends share a y or an x), so:
  // - a is on the bottom side: the ray to +x from a runs along that side (not counted) and passes under the right
  //   side, whose lower end is found a hair above y = 20 (to 7 digits); only the left side straddles y = 20, at x = 15,
  //   to the left. So a is outside. c is on the right side: its ray meets it at x = 28, not beyond: outside. b (32, 14)
  //   is below the rectangle: outside.
  // - The bottom side passes through a, the right side through c: each crossing test has a cross product of exactly 0
  //   there, so no edges cross; the other sides are far from the triangle.
  // - The centre's ray meets the right side once at x = 28 > 26.67: inside, so the body rests.
  // Any change to the centre (a sign, / 3 as × 3, or no centre) moves it at least 5 mm, out of the rectangle.
  const outline = [wall([15, 20], [28, 20]), wall([28, 34], [28, 20]), wall([28, 34], [15, 34]), wall([15, 20], [15, 34])];
  assert.equal(rests(outline, under([20, 20], [32, 14], [28, 28])), "");
  // The same rectangle 20 mm to the left (x −5..8) is clear of the triangle: it hangs.
  const left = [wall([-5, 20], [8, 20]), wall([8, 34], [8, 20]), wall([8, 34], [-5, 34]), wall([-5, 20], [-5, 34])];
  assert.equal(rests(left, under([20, 20], [32, 14], [28, 28])), HANGS);
});

// ---------- the refusal words ----------
// The reaches (build-area.ts): the warm-up loop 3.957 mm, Better grip's brim 4.714 mm, both 8.672 mm past the part on
// every side, so twice that across. The P1S takes up to 256 mm wide and 256 − 5 = 251 mm deep (the front 5 mm is the
// prime line's strip), and a part reaching into the 18 × 28 mm front-left corner must be at most 238 wide or 228 deep.

const across = (named: string, x2: number | string, y2: number | string) => `the part${named}, placed at (1, 2), runs from (0, 0) to (${x2}, ${y2}), off the 256 × 256 mm bed`;
const strip = (named: string, d: number | string) => `the part${named} reaches y = -2.5 mm, over the prime line's strip at the front of the bed (it must stay at y ≥ 5 mm); it is ${d} mm deep, and fits when at most 251 mm deep`;
const corner = (named: string, w: number | string, d: number | string) =>
  `the part${named} is ${w} × ${d} mm and reaches into the P1S plate's front-left corner, which must stay clear (x < 18 mm, y < 28 mm); moving it right or back would take it off the plate. Make it smaller or turn it so it clears the corner (a part up to 238 mm wide or 228 mm deep fits)`;
const PLATE_WORDS = "the P1S's plate takes 256 × 256 mm.";
const SMALLER = "Make it smaller or split it into pieces.";
const WARM = " with its warm-up loop";
const BRIM = " with its brim";
const BOTH = " with its brim and warm-up loop";

test("refusalWords: off the bed with the loop, the brim or both, and which to turn off", () => {
  // 260 × 100 with the loop: 260 − 2 × 3.957 = 252.1 mm wide without it; that fits (252.1 ≤ 256, 92.1 ≤ 251 and
  // 92.1 ≤ 228 clears the corner).
  assert.equal(refusalWords(across(WARM, 260, 100)), `The part is 252.1 mm wide, 260 mm with its warm-up loop, and ${PLATE_WORDS} Without its warm-up loop it fits: turn Warm-up loop off and slice again.`);
  // 258 × 10 with the brim: the loop is already off, so the first try (the loop off) is skipped; the brim off takes
  // 2 × 4.714 = 9.43 mm: 248.6 × 0.6 fits.
  assert.equal(refusalWords(across(BRIM, 258, 10)), `The part is 248.6 mm wide, 258 mm with Better grip's brim, and ${PLATE_WORDS} Without Better grip's brim it fits: turn Better grip off and slice again.`);
  // 262 × 240 with both: the loop off leaves the brim, 2 × (8.672 − 4.714) = 7.92 mm less, 254.1 × 232.1: too deep for
  // the corner (232.1 > 228) and too wide (> 238); the brim off, 9.43 mm less, 252.6 × 230.6: the same; both off,
  // 17.34 mm less, 244.7 × 222.7: clears the corner by depth.
  assert.equal(refusalWords(across(BOTH, 262, 240)), `The part is 244.7 mm wide, 262 mm with Better grip's brim and its warm-up loop, and ${PLATE_WORDS} Without Better grip's brim and its warm-up loop it fits: turn Better grip and Warm-up loop off and slice again.`);
  // 300 × 100 with the loop: 292.1 is still too wide, nothing to turn off helps.
  assert.equal(refusalWords(across(WARM, 300, 100)), `The part is 292.1 mm wide, 300 mm with its warm-up loop, and ${PLATE_WORDS} ${SMALLER}`);
  // 100 × 270 with the loop: deeper than wide, so "deep"; 262.1 deep without it, still more than 251.
  assert.equal(refusalWords(across(WARM, 100, 270)), `The part is 262.1 mm deep, 270 mm with its warm-up loop, and ${PLATE_WORDS} ${SMALLER}`);
  // A part not from (0, 0): from (−10, −20) to (250, 40) is 260 × 60.
  assert.equal(
    refusalWords("the part, placed at (1, 2), runs from (-10, -20) to (250, 40), off the 256 × 256 mm bed"),
    `The part is 260 mm wide, and ${PLATE_WORDS} ${SMALLER}`,
  );
  // From (0, −20) to (100, 250): 100 wide, 250 − (−20) = 270 deep.
  assert.equal(
    refusalWords("the part, placed at (1, 2), runs from (0, -20) to (100, 250), off the 256 × 256 mm bed"),
    `The part is 270 mm deep, and ${PLATE_WORDS} ${SMALLER}`,
  );
});

test("refusalWords: over the front strip, how deep, and the loop off when the width is not known", () => {
  const front = "the P1S takes up to 251 mm: the front 5 mm of the plate is kept for the nozzle's prime line.";
  assert.equal(refusalWords(strip("", 260)), `The part is 260 mm deep, and ${front} ${SMALLER}`);
  // 230 deep with the loop: 222.1 without it. The width is not said, so it is taken as the widest the plate takes
  // (256): 256 × 222.1 fits (222.1 ≤ 228 clears the corner).
  assert.equal(refusalWords(strip(WARM, 230)), `The part is 222.1 mm deep, 230 mm with its warm-up loop, and ${front} Without its warm-up loop it fits: turn Warm-up loop off and slice again.`);
  // 245 deep: 237.1 without the loop, past 228, so at 256 wide it reaches the corner; at most 238 wide it fits.
  assert.equal(refusalWords(strip(WARM, 245)), `The part is 237.1 mm deep, 245 mm with its warm-up loop, and ${front} Without its warm-up loop it fits if it is at most 238 mm wide: turn Warm-up loop off and slice again.`);
  // 262 deep: 254.1 without it, more than 251 (the plate's 256 less the 5 mm strip, not plus it) at any width.
  assert.equal(refusalWords(strip(WARM, 262)), `The part is 254.1 mm deep, 262 mm with its warm-up loop, and ${front} ${SMALLER}`);
  // 240 deep with the brim (the loop already off, so that try is skipped: with nothing taken off, 240 at 238 wide
  // would read as fitting): without the brim 230.6, fine at 238 wide.
  assert.equal(refusalWords(strip(BRIM, 240)), `The part is 230.6 mm deep, 240 mm with Better grip's brim, and ${front} Without Better grip's brim it fits if it is at most 238 mm wide: turn Better grip off and slice again.`);
  // 270 deep: 262.1 without it, more than 251 either way.
  assert.equal(refusalWords(strip(WARM, 270)), `The part is 262.1 mm deep, 270 mm with its warm-up loop, and ${front} ${SMALLER}`);
  // With both, 250 deep: the loop off gives 242.1 (too deep for the corner at 256 wide, fine at 238: kept as the
  // first "narrower" answer); the brim off 240.6 and both off 232.7 are still past 228, so the first answer is said.
  assert.equal(refusalWords(strip(BOTH, 250)), `The part is 232.7 mm deep, 250 mm with Better grip's brim and its warm-up loop, and ${front} Without its warm-up loop it fits if it is at most 238 mm wide: turn Warm-up loop off and slice again.`);
});

test("refusalWords: the plate's limits are inclusive, at exactly 251 and 228 mm deep", () => {
  // The loop's width across is 2 × 3.957079632679490; a depth of 228 or 251 plus that, less that again, is exactly 228
  // or 251 in floating point (checked first), so the part fits exactly at the limit.
  const two = 2 * 3.95707963267949;
  for (const at of [228, 251]) assert.equal(Number(String(at + two)) - two, at);
  assert.match(refusalWords(strip(WARM, String(228 + two))), /Without its warm-up loop it fits: turn/);
  assert.match(refusalWords(strip(WARM, String(251 + two))), /Without its warm-up loop it fits if it is at most 238 mm wide/);
  // In the corner: 238 + loop wide, 240 + loop deep: 238 × 240 without it, exactly at the corner's width limit, fits.
  assert.match(refusalWords(corner(WARM, String(238 + two), String(240 + two))), /Without its warm-up loop it fits: turn/);
  // The same 0.01 mm wider does not (it is past 238 and 240 > 228): the corner's own words.
  assert.match(refusalWords(corner(WARM, String(238.01 + two), String(240 + two))), /Make it smaller or turn it so it clears the corner \(with its warm-up loop, up to 230\.1 mm wide or 220\.1 mm deep fits\)/);
});

test("refusalWords: the front-left corner, with and without extras", () => {
  const reaches = "reaches into the P1S plate's front-left corner, which must stay clear, with no room on the plate to move it clear.";
  assert.equal(refusalWords(corner("", 240.25, 235)), `The part is 240.3 × 235 mm and ${reaches} Make it smaller or turn it so it clears the corner (up to 238 mm wide or 228 mm deep fits).`);
  // 242 × 233 with the loop: 234.1 × 225.1 without it, narrow enough (≤ 238).
  assert.equal(refusalWords(corner(WARM, 242, 233)), `The part is 234.1 × 225.1 mm, 242 × 233 mm with its warm-up loop, and ${reaches} Without its warm-up loop it fits: turn Warm-up loop off and slice again.`);
  // 256 × 250 with both: 238.7 × 232.7 with neither, still past both limits: the corner's limits less both reaches,
  // 238 − 17.34 = 220.7 wide or 228 − 17.34 = 210.7 deep.
  assert.equal(
    refusalWords(corner(BOTH, 256, 250)),
    `The part is 238.7 × 232.7 mm, 256 × 250 mm with Better grip's brim and its warm-up loop, and ${reaches} Make it smaller or turn it so it clears the corner (with Better grip's brim and its warm-up loop, up to 220.7 mm wide or 210.7 mm deep fits).`,
  );
});

test("refusalWords: in mid-air, and any other message with a capital", () => {
  assert.equal(
    refusalWords("layer 3 starts in mid-air at z = 12.5 mm, around (-35.25, 105.5), with nothing under it"),
    "Part of the model hangs in the air 12.5 mm above the plate, around (-35.25, 105.5) mm, with nothing under it. Turn Supports on, or move it down onto the plate or the part.",
  );
  assert.equal(
    refusalWords("layer 1 starts in mid-air at z = 3 mm, around (4.5, -2), with nothing under it"),
    "Part of the model hangs in the air 3 mm above the plate, around (4.5, -2) mm, with nothing under it. Turn Supports on, or move it down onto the plate or the part.",
  );
  // Not a message it knows, with or without a height: kept, with a capital.
  assert.equal(refusalWords("the engine stopped", 12), "The engine stopped");
  assert.equal(refusalWords("x"), "X");
});

// ---------- the file names ----------

test("file names: every choice and plate in the name, the filament only when not the file's own", () => {
  const c = { ...PRINT_DEFAULTS, layerHeight: 0.12, walls: 3, infill: 40 };
  assert.equal(gcodeName(c), "spindlelabs-0.12mm-3w-40pc.gcode");
  assert.equal(gcodeName({ ...c, supports: "normal", warmUp: false, betterGrip: true }, "bracket"), "bracket-0.12mm-3w-40pc-supports-no-warm-up-grip.gcode");
  assert.equal(gcodeName({ ...c, supports: "tree" }), "spindlelabs-0.12mm-3w-40pc-tree-supports.gcode");
  // Plain G-code's own filament is Generic PLA: said only for Bambu PLA Basic. The P1S file's is Bambu PLA Basic.
  assert.equal(gcodeName({ ...c, filament: "generic-pla" }), "spindlelabs-0.12mm-3w-40pc.gcode");
  assert.equal(gcodeName({ ...c, filament: "bambu-pla-basic" }), "spindlelabs-0.12mm-3w-40pc-bambu-pla-basic.gcode");
  assert.equal(printFileName({ ...c, filament: "bambu-pla-basic" }, "textured"), "spindlelabs-0.12mm-3w-40pc-textured.gcode.3mf");
  assert.equal(printFileName({ ...c, filament: "generic-pla" }, "smooth"), "spindlelabs-0.12mm-3w-40pc-generic-pla-smooth.gcode.3mf");
  assert.equal(printFileName(c, "cool_plate", "high-flow"), "spindlelabs-0.12mm-3w-40pc-cool-high-flow.gcode.3mf");
  assert.equal(printFileName(c, "supertack_plate", "standard", "lid"), "lid-0.12mm-3w-40pc-supertack.gcode.3mf");
});

test("file names: a long project name is cut to 120 characters and 200 bytes, never mid-character or ending in a space", () => {
  // Settings "-0.2mm-2w-15pc" (14) and ".gcode" (6) leave 100 characters and 200 − 20 = 180 bytes for the lead.
  assert.equal(gcodeName(PRINT_DEFAULTS, "a".repeat(150)), `${"a".repeat(100)}-0.2mm-2w-15pc.gcode`);
  // "é" is 2 bytes: 180 / 2 = 90 fit (the 90th exactly fills the bytes).
  assert.equal(gcodeName(PRINT_DEFAULTS, "é".repeat(150)), `${"é".repeat(90)}-0.2mm-2w-15pc.gcode`);
  // Cut just after a space: the 100 kept end "x… " and the space goes.
  assert.equal(gcodeName(PRINT_DEFAULTS, `${"x".repeat(99)} yyyy`), `${"x".repeat(99)}-0.2mm-2w-15pc.gcode`);
  // A name that fits is kept whole, its inner spaces too (only the project's ends are trimmed).
  assert.equal(gcodeName(PRINT_DEFAULTS, "  my part  "), "my part-0.2mm-2w-15pc.gcode");
});

test("printLead: a named project keeps its own name over the file's", () => {
  assert.equal(printLead("bracket", "saved-file"), "bracket");
  assert.equal(printLead(undefined, "saved-file"), "saved-file");
  assert.equal(nameLead(undefined), "spindlelabs");
});

// ---------- the slice's words ----------

test("printWords: layers, grams, metres and the time with its profile", () => {
  // 1730 mm is 1.73 m; 240 s is 4 min.
  assert.equal(printWords({ layers: 1, filamentMm: 1730, filamentG: 5.2, printTimeS: 240, unprintedVolume: 0 }), "1 layer, 5.2 g of PLA (1.73 m of filament), about 4 min of printing (plus heating and levelling).");
  // No time known: no time words.
  assert.equal(printWords({ layers: 100, filamentMm: 1730, filamentG: 5.2, printTimeS: NaN, unprintedVolume: 0 }, "generic-pla"), "100 layers, 5.2 g of PLA (1.73 m of filament).");
  // 3720 s is 1 h 2 min; 12345 mm is 12.35 m (to two places).
  assert.equal(
    printWords({ layers: 2, filamentMm: 12345, filamentG: 37.04, printTimeS: 3720, unprintedVolume: 0 }, "bambu-pla-basic"),
    "2 layers, 37 g of PLA (12.35 m of filament), about 1 h 2 min of printing with Bambu PLA Basic (plus heating and levelling).",
  );
});

test("progressWords: every stage's words", () => {
  assert.equal(progressWords(null), "");
  assert.equal(progressWords({ stage: "layers", done: 2, total: 9 }), "Cutting the bodies into layers…");
  assert.equal(progressWords({ stage: "walls", done: 120, total: 254 }), "Walls: layer 120 of 254");
  assert.equal(progressWords({ stage: "infill", done: 2, total: 9 }), "Infill and solid layers…");
  assert.equal(progressWords({ stage: "supports", done: 2, total: 9 }), "Supports: layer 2 of 9");
  assert.equal(progressWords({ stage: "file", done: 2, total: 9 }), "Writing the file…");
});

test("fileCrawl: creeps toward 0.99 with a time constant of twice the time before, at least 5 s", () => {
  // 1 s before the file: 2 s is under 5 s, so τ = 5 s; 5 s in: 0.5 + (0.99 − 0.5)(1 − e^−1) = 0.5 + 0.49 × 0.632121 = 0.809739.
  assert.ok(Math.abs(fileCrawl(0.5, 1000, 5000) - 0.8097390738) < 1e-9);
  // 10 s before: τ = 20 s; 20 s in: the same 0.809739. 5 s in: 0.5 + 0.49 × (1 − e^−0.25) = 0.5 + 0.49 × 0.221199 = 0.608388.
  assert.ok(Math.abs(fileCrawl(0.5, 10000, 20000) - 0.8097390738) < 1e-9);
  assert.ok(Math.abs(fileCrawl(0.5, 10000, 5000) - 0.6083877) < 1e-6);
  // Time before not known (NaN): τ = 5 s.
  assert.ok(Math.abs(fileCrawl(0.5, NaN, 5000) - 0.8097390738) < 1e-9);
  // Already at or past 0.99, or no time in the file yet: left where it is.
  assert.equal(fileCrawl(0.995, 1000, 5000), 0.995);
  assert.equal(fileCrawl(0.5, 1000, 0), 0.5);
  assert.equal(fileCrawl(0.5, 1000, -5), 0.5);
});
