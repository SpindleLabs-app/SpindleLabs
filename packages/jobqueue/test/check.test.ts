// The automatic file check (check.ts): print files through the P1S's plate, the print check and the real slicing
// engine (the committed kernel build); laser drawings against the 1400 × 900 bed with Laser's own colours; the check's
// answer into the queue. Hand-worked sizes with the working shown, 0.9×/1.1× of the fit tolerance, seeded random parts
// against a plain model of the P1S's plate rules written here from its description, and every refusal in words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_DEFAULTS } from "@fission/print";
import { nodeKernel } from "../../testing/src/node-kernel.ts";
import { OP_LOOK } from "../../../workspaces/laser/src/ops.ts";
import { apply, bedFit, checkAction, checkLaserFile, checkPrintFile, FIT_TOLERANCE, KH1490_BED, LASER_COLOURS, LASER_DXF_COLOURS, newQueue, QUEUE_LIMITS, withStudent, type FileCheck } from "../src/index.ts";
import { binaryStlOf } from "../src/stl.ts";
import { parsePaint } from "../src/svg.ts";
import { boxMesh, textStl } from "./meshes.ts";

const kernel = nodeKernel();
const svgOf = (body: string, w = 2000, h = 2000) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const cutRect = (w: number, h: number) => svgOf(`<rect width="${w}" height="${h}" fill="none" stroke="#f00"/>`);
const BARE = { ...PRINT_DEFAULTS, warmUp: false, betterGrip: false };

function passed(c: FileCheck): Extract<FileCheck, { passed: true }> {
  assert.ok(c.passed, c.passed ? "" : c.reason);
  return c;
}
function refused(c: FileCheck, words: RegExp): void {
  assert.ok(!c.passed, "passed when it should be refused");
  assert.match(c.reason, words);
}

test("Laser's own colours: the check reads exactly what Laser writes", () => {
  // Laser's SVG paints (ops.ts OP_LOOK): cut and score by their stroke, engrave by its fill.
  const paint = (look: string, prop: string) => parsePaint(new RegExp(`${prop}="([^"]+)"`).exec(look)![1]!);
  assert.deepEqual(paint(OP_LOOK.cut.svgPaint, "stroke"), { kind: "rgb", rgb: LASER_COLOURS.cut });
  assert.deepEqual(paint(OP_LOOK.score.svgPaint, "stroke"), { kind: "rgb", rgb: LASER_COLOURS.score });
  assert.deepEqual(paint(OP_LOOK.engrave.svgPaint, "fill"), { kind: "rgb", rgb: LASER_COLOURS.engrave });
  for (const l of ["cut", "score", "engrave"] as const) assert.equal(LASER_DXF_COLOURS[l], OP_LOOK[l].dxfColour);
  // And a drawing painted with Laser's own paint strings is read on the right layers.
  const body = (["engrave", "score", "cut"] as const).map((l, k) => `<rect x="${k * 20}" width="10" height="10" ${OP_LOOK[l].svgPaint}/>`).join("");
  const c = passed(checkLaserFile("parts.svg", svgOf(body)));
  assert.match(c.facts.join(" "), /1 shape to cut, 1 line to score, 1 shape to engrave/);
});

test("hand-worked: a laser drawing on the 1400 × 900 bed, turned, too big, and the time never made up", () => {
  // 600 × 300 fits as it is; the sheet it uses is its box, 600 × 300 = 180 000 mm².
  const c = passed(checkLaserFile("sign.svg", cutRect(600, 300)));
  assert.deepEqual(c.estimate, { minutes: null, amount: 180_000 });
  assert.match(c.facts.join(" "), /600 × 300 mm/);
  assert.match(c.facts.join(" "), /Laser time: not yet/);
  // 800 × 1300 is taller than 900, but turned a quarter turn it is 1300 × 800, inside 1400 × 900.
  const t = passed(checkLaserFile("tall.svg", cutRect(800, 1300)));
  assert.match(t.notes.join(" "), /turned a quarter turn/);
  // 1500 × 300: 100 mm too wide, and turned (300 × 1500) 600 mm too tall, so no.
  refused(checkLaserFile("long.svg", cutRect(1500, 300)), /1500 × 300 mm.*1400 × 900 mm.*100 mm too wide.*turned a quarter turn it doesn't fit either/);
  // 1000 × 1000: too tall as it is and turned.
  refused(checkLaserFile("square.svg", cutRect(1000, 1000)), /100 mm too tall/);
  // The same through a DXF: a 1401 mm line is 1 mm too wide.
  const dxf = (len: number) => new TextEncoder().encode(["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "CUT", "62", "1", "10", "0", "20", "0", "11", String(len), "21", "0", "0", "ENDSEC", "0", "EOF"].join("\n"));
  passed(checkLaserFile("a.dxf", dxf(1400)));
  refused(checkLaserFile("a.dxf", dxf(1401)), /1 mm too wide/);
});

test("the bed's tolerance: 0.9× of it past the edge fits, 1.1× doesn't (both sides, as it is and turned)", () => {
  const bed = KH1490_BED;
  // At the long side (1400 × 10: turned it is 10 × 1400, taller than 900), at the short side with a width that
  // can't turn (1300 × 900), and turned (900 × 1400).
  for (const [w, h, dw, dh] of [[bed.width, 10, 1, 0], [1300, bed.height, 0, 1], [bed.height, bed.width, 1, 1]] as const) {
    assert.ok(bedFit(w + 0.9 * FIT_TOLERANCE * dw, h + 0.9 * FIT_TOLERANCE * dh, bed).fits !== null, `${w} × ${h} at 0.9×`);
    assert.equal(bedFit(w + 1.1 * FIT_TOLERANCE * dw, h + 1.1 * FIT_TOLERANCE * dh, bed).fits, null, `${w} × ${h} at 1.1×`);
  }
  // Through a whole file: a drawing 1400 + 0.9 µm wide passes, 1400 + 1.1 µm doesn't.
  passed(checkLaserFile("edge.svg", cutRect(1400 + 0.9 * FIT_TOLERANCE, 10)));
  refused(checkLaserFile("edge.svg", cutRect(1400 + 1.1 * FIT_TOLERANCE, 10)), /too wide/);
});

test("a spline that might reach past the edge is refused as too close to tell, never passed on a guess", () => {
  // A quadratic spline 0..1390 along x, rising to 10 (its control point at 20): the sampled box is 1390 × 10 but the
  // control points allow 10 mm more, so up to 1400: fits either way. Stretched to 1395 it might reach 1405: refused.
  const spline = (len: number) => new TextEncoder().encode(["0", "SECTION", "2", "ENTITIES", "0", "SPLINE", "8", "0", "62", "1", "71", "2", "40", "0", "40", "0", "40", "0", "40", "1", "40", "1", "40", "1", "10", "0", "20", "0", "10", String(len / 2), "20", "20", "10", String(len), "20", "0", "0", "ENDSEC", "0", "EOF"].join("\n"));
  passed(checkLaserFile("s.dxf", spline(1390)));
  refused(checkLaserFile("s.dxf", spline(1395)), /too close to be sure/);
});

test("laser refusals: wrong files, too large a file, an unreadable drawing", () => {
  refused(checkLaserFile("a.pdf", new Uint8Array([1])), /SVG and DXF/);
  refused(checkLaserFile("photo.png", new Uint8Array([1])), /picture/);
  refused(checkLaserFile("part.stl", new Uint8Array([1])), /print job/);
  refused(checkLaserFile("a.svg", new Uint8Array(0)), /empty/);
  refused(checkLaserFile("a.svg", new Uint8Array(QUEUE_LIMITS.fileBytes + 1)), /up to 50 MB/);
  refused(checkLaserFile("a.svg", svgOf(`<rect width="5" height="5" fill="none" stroke="green"/>`)), /outline in #008000/);
  refused(checkLaserFile("a.svg", new Uint8Array([0x3c, 0xff, 0xfe])), /isn't readable text/);
});

/** The P1S's plate as its rules read (build-area.ts' description), for a box with nothing round it: the part is
 * centred on the 256 × 256 plate; the front 5 mm is kept, so at most 251 mm deep; the front-left corner x < 18,
 * y < 28 must stay clear, so a box needs to fit right of it (at most 256 − 18 = 238 wide) or behind it (at most
 * 256 − 28 = 228 deep); at most 250 tall. */
function p1sModel(w: number, d: number, h: number): boolean {
  return w <= 256 && d <= 251 && h <= 250 && (w <= 238 || d <= 228);
}

test("hand-worked: a 20 mm box prints, with the slicer's time and filament; text and binary STL agree", async () => {
  const box = boxMesh(20, 20, 10);
  const bin = passed(await checkPrintFile("cube.stl", binaryStlOf(box), { kernel }));
  const txt = passed(await checkPrintFile("cube.stl", textStl(box), { kernel }));
  assert.deepEqual(bin.estimate, txt.estimate);
  // The box is 20 × 20 × 10 mm; time is whole minutes rounded up and filament to a tenth of a gram, both above 0.
  assert.match(bin.facts.join(" "), /20 × 20 × 10 mm/);
  assert.ok(Number.isInteger(bin.estimate.minutes) && bin.estimate.minutes! > 0);
  assert.equal(bin.estimate.amount, Math.round(bin.estimate.amount! * 10) / 10);
  // 20 × 20 × 10 mm is 4 cm³; at most all of it is PLA (1.24 g/cm³ by the engine's density): under 5 g, and the
  // shell alone (two 0.42 mm walls round the sides) is more than 0.5 g.
  assert.ok(bin.estimate.amount! > 0.5 && bin.estimate.amount! < 4 * 1.24, String(bin.estimate.amount));
  assert.deepEqual(bin.notes, []);
});

test("print refusals and notes: too big, too tall, only without the warm-up loop, supports, open skin, units", async () => {
  // 300 mm wide: the plate is 256.
  refused(await checkPrintFile("wide.stl", binaryStlOf(boxMesh(300, 20, 5)), { kernel }), /part is 300 mm wide \(256 × 256 mm fits\)/);
  // 260 mm tall: the P1S prints to 250.
  refused(await checkPrintFile("tall.stl", binaryStlOf(boxMesh(20, 20, 260)), { kernel }), /260 mm tall \(250 mm fits\)/);
  // 250 wide fits bare, but the warm-up loop adds 3.96 mm each side (257.9 > 256): sliced without it, said so.
  const loop = passed(await checkPrintFile("rail.stl", binaryStlOf(boxMesh(250, 20, 2)), { kernel }));
  assert.match(loop.notes.join(" "), /only without the warm-up loop/);
  // A T: a 10 × 10 × 20 column under a 40 × 10 × 5 plate. 30 × 10 = 300 mm² of the plate hangs over nothing.
  const col = boxMesh(10, 10, 20, [15, 0, 0]);
  const top = boxMesh(40, 10, 5, [0, 0, 20]);
  const t = { positions: [...col.positions, ...top.positions], indices: [...col.indices, ...top.indices.map((i) => i + 8)] };
  const tee = passed(await checkPrintFile("tee.stl", binaryStlOf(t), { kernel }));
  assert.match(tee.notes.join(" "), /Needs supports \(about 300 mm²/);
  // A box with a triangle missing: 3 edges used once, refused in words before the slicer is asked (it refuses one too).
  const holed = boxMesh(20, 20, 10);
  refused(await checkPrintFile("holed.stl", binaryStlOf({ positions: holed.positions, indices: holed.indices.slice(0, 6).concat(holed.indices.slice(9)) }), { kernel }), /isn't closed: 3 of its edges aren't shared/);
  // A part 1.5 mm across was probably saved in other units.
  const tiny = await checkPrintFile("tiny.stl", binaryStlOf(boxMesh(1.5, 1, 1)), { kernel });
  assert.match(tiny.notes.join(" "), /no units/);
  // A material other than PLA: the weight is PLA's, said.
  const petg = passed(await checkPrintFile("cube.stl", binaryStlOf(boxMesh(20, 20, 10)), { kernel, material: "PETG black" }));
  assert.match(petg.notes.join(" "), /worked out for PLA; PETG black/);
  // Wrong files.
  refused(await checkPrintFile("part.3mf", new Uint8Array([1]), { kernel }), /STL files for now/);
  refused(await checkPrintFile("part.gcode.3mf", new Uint8Array([1]), { kernel }), /already sliced/);
  refused(await checkPrintFile("part.svg", new Uint8Array([1]), { kernel }), /laser job/);
  refused(await checkPrintFile("part.stl", new Uint8Array(QUEUE_LIMITS.fileBytes + 1), { kernel }), /up to 50 MB/);
  refused(await checkPrintFile("part.stl", new TextEncoder().encode("solid x\nouter loop\nvertex 0 0 0\n"), { kernel }), /cut short/);
});

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("seeded random boxes near the plate's limits: the check agrees with the model of the P1S's rules", async () => {
  let fits = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const r = mulberry(seed);
    // Sizes across each limit (218..262 wide and deep, so 228, 238, 251 and 256 are all crossed), 1 mm tall to keep
    // the slices quick; every fourth one tall, across 250.
    const [w, d] = [218 + Math.round(r() * 44), 218 + Math.round(r() * 44)];
    const h = seed % 4 === 0 ? 245 + Math.round(r() * 10) : 1;
    const shape = seed % 4 === 0 ? boxMesh(10, 10, h) : boxMesh(w, d, h);
    const [mw, md] = seed % 4 === 0 ? [10, 10] : [w, d];
    const c = await checkPrintFile(`r${seed}.stl`, binaryStlOf(shape), { kernel, choices: BARE });
    assert.equal(c.passed, p1sModel(mw, md, h), `seed ${seed}: ${mw} × ${md} × ${h}: ${c.passed ? "passed" : c.reason}`);
    if (c.passed) fits += 1;
  }
  // Both answers came up (the seeds aren't all on one side of the limits).
  assert.ok(fits > 3 && fits < 21, String(fits));
});

test("into the queue: a pass keeps the estimate and notes, a refusal its reason, and long words are cut to fit", async () => {
  let q = withStudent(newQueue([{ id: "p1s", name: "P1S", kind: "print" }, { id: "laser", name: "Laser", kind: "laser" }])!, "s1", "Sam K.")!;
  const send = (machine: string, fileName: string) => {
    const a = apply(q, { kind: "send", by: { role: "student", id: "s1" }, at: 1, job: { machine, fileName, fileBytes: 100, material: "PLA", estimate: { minutes: null, amount: null } } });
    assert.ok(a.ok);
    q = a.queue;
    return a.id;
  };
  const print = send("p1s", "cube.stl");
  const check = await checkPrintFile("cube.stl", binaryStlOf(boxMesh(20, 20, 10)), { kernel });
  const a = apply(q, checkAction(print, 2, check));
  assert.ok(a.ok, JSON.stringify(a));
  q = a.queue;
  const job = q.jobs.find((j) => j.id === print)!;
  assert.equal(job.state, "waiting");
  assert.deepEqual(job.estimate, (check as Extract<FileCheck, { passed: true }>).estimate);
  assert.match(job.notes.join(" "), /20 × 20 × 10 mm/);
  // A laser job's time stays unknown in the queue: no number is made up.
  const laser = send("laser", "sign.svg");
  const b = apply(q, checkAction(laser, 3, checkLaserFile("sign.svg", cutRect(100, 50))));
  assert.ok(b.ok);
  q = b.queue;
  assert.deepEqual(q.jobs.find((j) => j.id === laser)!.estimate, { minutes: null, amount: 5000 });
  // A refusal longer than the queue's 300 characters is cut with "…" and taken.
  const big = send("laser", "big.svg");
  const long: FileCheck = { passed: false, reason: "x".repeat(400), notes: ["n".repeat(400)] };
  const c = apply(q, checkAction(big, 4, long));
  assert.ok(c.ok, JSON.stringify(c));
  const refusedJob = c.queue.jobs.find((j) => j.id === big)!;
  assert.equal(refusedJob.state, "check-failed");
  assert.equal([...refusedJob.reason!].length, 300);
  assert.ok(refusedJob.reason!.endsWith("…"));
  // The queue refuses notes it can't keep (a deliberate break of a good action: a note with a control character, too many notes).
  const bad = checkAction(big, 4, { passed: false, reason: "too big", notes: ["fine", "bad\u0007"] });
  const d = apply(q, bad);
  assert.ok(!d.ok && d.refusal.kind === "bad-input" && d.refusal.detail === "notes");
  const many = apply(q, { kind: "check", by: { role: "check" }, at: 4, id: big, passed: false, reason: "r", notes: Array.from({ length: QUEUE_LIMITS.notes + 1 }, () => "n") });
  assert.ok(!many.ok && many.refusal.detail === "notes");
});
