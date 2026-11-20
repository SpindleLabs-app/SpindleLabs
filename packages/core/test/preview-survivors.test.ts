// Mutation testing's survivors in the print preview's G-code replayer and playback (test audit D-5,
// stryker/kernel.json: src/print/gcode.ts and src/print/playback.ts). Each test is worked by hand and fails under
// the mutants named beside it. The ones no test can kill are explained in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine, replay, STILL } from "../src/print/gcode.ts";
import { kindOf, momentAt, playback, PRINT_KINDS } from "../src/print/playback.ts";

const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
/** Filament cross-section for 1.75 mm filament: π × 0.875² mm². */
const A = Math.PI * 0.875 * 0.875;
const kinds = (text: string) => replay(text).problems.map((p) => p.kind);

test("parseLine: comments, checksums and line numbers", () => {
  // "AB(note)CD": the comment becomes a space, so the macro is AB (followed by a space), never ABCD.
  assert.deepEqual(replay("AB(note)CD").ignored, { AB: 1 });
  // "*12": a checksum alone, starting the line, leaves nothing (a star at 0 still cuts).
  assert.equal(parseLine("*12", 1), null);
  // "123": no letters, so no words and nothing unreadable (no made-up word from an empty match).
  assert.deepEqual(parseLine("123", 1)?.problems, []);
  assert.equal(parseLine("123", 1)?.command, "");
  // N is skipped only as the very first word: after a command, or after another word, it is a word.
  assert.equal(parseLine("G1 N5", 1)?.words.get("N"), 5);
  assert.equal(parseLine("X1 N5", 1)?.words.get("N"), 5);
  assert.equal(parseLine("N5 G1", 1)?.words.has("N"), false);
  // Only the first G/M/T is the command; a later M is a word, and X alone is never a command.
  const gm = parseLine("G1 M5", 1)!;
  assert.equal(gm.command, "G1");
  assert.equal(gm.words.get("M"), 5);
  assert.equal(parseLine("X1", 1)?.command, "");
  // G001 is G1: every leading zero goes, not just one; a macro holding G01 keeps its name.
  assert.equal(parseLine("G001 X1", 1)?.command, "G1");
  assert.deepEqual(replay("AG01").ignored, { AG01: 1 });
});

test("parseLine: firmware macro names", () => {
  // AB is a two-letter name ending the line: a macro.
  assert.equal(parseLine("AB", 1)?.command, "AB");
  // "A B": a letter, a space, a letter: two bare words, not a macro "A B".
  assert.equal(parseLine("A B", 1)?.command, "");
  // "AB =": the name stops at the space, so it is AB.
  assert.equal(parseLine("AB =", 1)?.command, "AB");
  // "1 AB": a name must start the line, so this is bare words.
  assert.equal(parseLine("1 AB", 1)?.command, "");
  // "AB G1": a name that starts the line, with a G1 later, is still the macro AB.
  assert.equal(parseLine("AB G1", 1)?.command, "AB");
});

test("parseLine: problem texts", () => {
  assert.deepEqual(parseLine("G1 X1.2.3", 1)?.problems, [{ line: 1, kind: "bad-number", text: "X1.2.3 is not a number" }]);
  // "#" is part of X's word (so X1# is not a number) and an unreadable character of the line.
  assert.deepEqual(parseLine("G1 X1 #", 4)?.problems, [
    { line: 4, kind: "bad-number", text: "X1# is not a number" },
    { line: 4, kind: "bad-number", text: 'unreadable characters in "G1 X1 #"' },
  ]);
  assert.deepEqual(replay("G1 X F60").problems, [{ line: 1, kind: "bad-number", text: "X without a number" }]);
});

test("replay: modes at the start are absolute, Marlin, with nothing ambiguous", () => {
  // Absolute axes: X5 twice ends at 5, not 10.
  assert.equal(replay("G1 X5 F60\nG1 X5").end.x, 5);
  // Absolute E: E1 then E2 is 2 mm of filament in all, not 3; in Klipper too (no G91 or M83 yet).
  assert.equal(replay("G1 X1 E1 F60\nG1 X2 E2").filament, 2);
  assert.equal(replay("G1 X1 E1 F60\nG1 X2 E2", { flavour: "klipper" }).filament, 2);
  // Nothing ambiguous before any G90 after M83, nor after a G90 with no M83, nor after M83, M82, G90.
  assert.deepEqual(replay("G1 X1 E1 F60").problems, []);
  assert.deepEqual(replay("G90\nG1 X1 E1 F60").problems, []);
  assert.deepEqual(replay("M83\nM82\nG90\nG1 X1 E1 F60").problems, []);
  assert.deepEqual(replay("M83\nG90\nG1 X1 E1 F60").problems, [
    { line: 3, kind: "ambiguous-extruder", text: "E after G90 that followed M83: Marlin reads it as absolute, Klipper as relative; say M82 or M83 after G90" },
  ]);
  // Bare words with no command do nothing and are not listed as an ignored command.
  assert.deepEqual(replay("X5").ignored, {});
});

test("replay: ;TYPE: comments with spaces", () => {
  assert.equal(replay("; TYPE:WALL\nG1 X1 E1 F60").moves[0].feature, "WALL");
  assert.equal(replay(";TYPE :WALL\nG1 X1 E1 F60").moves[0].feature, "WALL");
  // With no ;TYPE: the move has no feature key at all.
  assert.equal("feature" in replay("G1 X1 E1 F60").moves[0], false);
});

test("replay: arcs by radius or with no centre are problems, each by its own kind and text", () => {
  // A G1 with an R word is a straight move, nothing to say.
  assert.deepEqual(replay("G1 X1 R5 F60").problems, []);
  const radius = { kind: "arc-radius-form", text: "arcs given by R are not followed; give the centre with I and J (recorded as a straight move)" };
  const noCentre = { kind: "bad-arc", text: "arc with its centre on its start (I and J both 0; recorded as a straight move)" };
  assert.deepEqual(replay("G2 X1 R1 F60").problems, [{ line: 1, ...radius }]);
  assert.deepEqual(replay("G3 X1 R1 F60").problems, [{ line: 1, ...radius }]);
  assert.deepEqual(replay("G2 X1 F60").problems, [{ line: 1, ...noCentre }]);
  assert.deepEqual(replay("G3 X1 F60").problems, [{ line: 1, ...noCentre }]);
});

test("replay: a quarter arc off the origin, by hand", () => {
  // From (10, 20) about the centre (10, 10) (I0 J−10), anticlockwise (G3) to (0, 10): it starts straight above
  // the centre (90°) and ends straight left of it (180°), a quarter turn of radius 10, so its path is
  // 2π × 10 / 4 = 5π mm and it ends exactly on its circle (no problem).
  const r = replay("G0 X10 Y20 F600\nG3 X0 Y10 I0 J-10");
  const arc = r.moves[1];
  assert.ok(close(arc.length, 5 * Math.PI), `length ${arc.length}`);
  assert.ok(close(arc.arc!.sweep, Math.PI / 2));
  assert.deepEqual(r.problems, []);
  // The same quarter clockwise (G2) from (10, 20) to (20, 10): 90° down to 0°, again 5π.
  assert.ok(close(replay("G0 X10 Y20 F600\nG2 X20 Y10 I0 J-10").moves[1].length, 5 * Math.PI));
});

test("replay: an arc's end off its circle, at and past the 0.05 mm limit", () => {
  // From (0, 0) about (0.05, 0) (I0.05) to (0.05, 0): it ends on its centre, r0 = 0.05, r1 = 0, so it is off its
  // circle by exactly 0.05 mm, the limit, which is allowed (only more than 0.05 is a problem).
  assert.deepEqual(kinds("G2 X0.05 I0.05 F60"), []);
  // From (0, 0) about (1, 0) to (2.1, 0): r0 = 1, r1 = 1.1, 0.1 mm off.
  assert.deepEqual(replay("G2 X2.1 I1 F60").problems, [{ line: 1, kind: "bad-arc", text: "arc ends 0.1000 mm off its circle" }]);
});

test("replay: moves of exactly STILL count as moves", () => {
  // Number("0.000001") is the same double as STILL (1e-6).
  assert.equal(Number("0.000001"), STILL);
  // Sideways by exactly STILL with filament pushed: laid along the move (extrude), not a blob.
  assert.equal(replay("G1 X0.000001 E1 F60").moves[0].kind, "extrude");
  // A travel of exactly STILL is recorded, and timed over its length: 1e-6 mm at 1 mm/s is 1e-6 s.
  const t = replay("G1 X0.000001 F60");
  assert.equal(t.moves.length, 1);
  assert.ok(close(t.seconds, 1e-6, 1e-18));
  // Pulled back by exactly STILL: rounding, not a retraction (only more than STILL is), so the next move is not retracted.
  assert.equal(replay("G1 E-0.000001 F60\nG1 X1").moves[1].retracted, false);
  assert.deepEqual(replay("G1 X1").problems, [{ line: 1, kind: "no-feed-rate", text: "a move before any feed rate (F) was given" }]);
});

test("replay: G20, G92, G28, G10/G11 and G4", () => {
  assert.deepEqual(replay("G20").problems, [{ line: 1, kind: "inches", text: "G20 (inches) is not followed: every number after it would be read as millimetres" }]);
  // At x 10, G92 X0 says the nozzle is at 0: the G-code's 5 is then 15 in the world.
  assert.equal(replay("G1 X10 F60\nG92 X0\nG1 X5").end.x, 15);
  // G92 X0 without E keeps E: E5 then E6 (absolute) is 6 mm of filament in all.
  assert.equal(replay("G1 X1 E5 F60\nG92 X0\nG1 X2 E6").filament, 6);
  // G28 Y homes only Y, G28 Z only Z, G28 alone all three.
  assert.deepEqual(replay("G1 X5 Y5 Z5 F60\nG28 Y").end, { x: 5, y: 0, z: 5, e: 0 });
  assert.deepEqual(replay("G1 X5 Y5 Z5 F60\nG28 Z").end, { x: 5, y: 5, z: 0, e: 0 });
  assert.deepEqual(replay("G1 X5 Y5 Z5 F60\nG28").end, { x: 0, y: 0, z: 0, e: 0 });
  // A firmware retraction marks the next move retracted until G11.
  assert.equal(replay("G10\nG1 X1 F60").moves[0].retracted, true);
  assert.equal(replay("G10\nG11\nG1 X1 F60").moves[0].retracted, false);
  // Dwell: P in ms, S in s.
  assert.equal(replay("G4 P500").seconds, 0.5);
  assert.equal(replay("G4 S2").seconds, 2);
  assert.equal(replay("G4 P500 S2").seconds, 2.5);
});

test("replay: temperatures", () => {
  assert.deepEqual(replay("M104 R200").temperatures, [{ line: 1, heater: "nozzle", celsius: 200, wait: false }]);
  assert.deepEqual(replay("M104 S-5").problems, [{ line: 1, kind: "bad-temperature", text: "M104 without a sensible S (0–500 °C)" }]);
  // 500 °C is the top of the range, still sensible.
  assert.deepEqual(replay("M104 S500").problems, []);
});

test("replay: machine settings, unknown motions and ignored commands", () => {
  const setting = (line: string) => replay(line).problems;
  assert.deepEqual(setting("M221 S90"), [{ line: 1, kind: "machine-setting", text: "M221: flow set to 90 %, so every extrusion lays down that share of what it says" }]);
  assert.deepEqual(setting("M220"), []);
  assert.deepEqual(replay("M220").ignored, { M220: 1 });
  for (const axis of ["X80", "Y80", "Z400"]) assert.deepEqual(kinds(`M92 ${axis}`), ["machine-setting"], axis);
  assert.deepEqual(setting("M200"), []);
  assert.deepEqual(setting("M211 S0"), [{ line: 1, kind: "machine-setting", text: "M211: soft end stops off, so the printer no longer stops a move past its limits" }]);
  assert.deepEqual(setting("M211 S1"), []);
  assert.deepEqual(setting("M302"), []);
  assert.deepEqual(kinds("M302 S1"), ["machine-setting"]);
  assert.deepEqual(setting("G29"), [{ line: 1, kind: "unknown-motion", text: "G29 is not followed and might move the nozzle" }]);
  // Macros whose names hold G1 or T1 are not motions or tools.
  assert.deepEqual(replay("XG1").ignored, { XG1: 1 });
  assert.deepEqual(replay("AT1").ignored, { AT1: 1 });
  // T1.5 is not a tool number; T10 is a tool.
  assert.deepEqual(replay("T1.5").ignored, { "T1.5": 1 });
  assert.deepEqual(kinds("T10"), ["machine-setting"]);
});

test("kindOf: every name the slicers write, and the legend's order", () => {
  const table: [string, string][] = [
    ["external perimeter", "outer-wall"],
    ["perimeter", "inner-wall"],
    ["top surface", "solid-infill"],
    ["bottom surface", "solid-infill"],
    ["top solid infill", "solid-infill"],
    ["internal solid infill", "solid-infill"],
    ["internal infill", "sparse-infill"],
    ["brim", "prime"],
    ["skirt/brim", "prime"],
  ];
  for (const [name, kind] of table) assert.equal(kindOf(name), kind, name);
  assert.deepEqual(PRINT_KINDS, ["outer-wall", "inner-wall", "solid-infill", "sparse-infill", "support", "prime", "other"]);
});

test("playback: an arc's pieces off the origin, both ways round, rising", () => {
  const deg = Math.PI / 180;
  // Anticlockwise quarter from (10, 20) about (10, 10) to (0, 10), at z 0.2: 18 pieces of 5°; the first ends at
  // 95°, (10 + 10 cos 95°, 10 + 10 sin 95°).
  const ccw = playback("G0 X10 Y20 Z0.2 F600\nG3 X0 Y10 I0 J-10");
  assert.equal(ccw.count, 19);
  assert.ok(close(ccw.to[3], 10 + 10 * Math.cos(95 * deg)) && close(ccw.to[4], 10 + 10 * Math.sin(95 * deg)), `${ccw.to.slice(3, 6)}`);
  // Clockwise quarter from (10, 20) about (10, 10) to (20, 10), rising from z 0.2 to 0.38: the first piece ends
  // at 85°, a 1/18 of the rise up (0.21), the second at 80° and 0.22.
  const cw = playback("G0 X10 Y20 Z0.2 F600\nG2 X20 Y10 Z0.38 I0 J-10");
  assert.ok(close(cw.to[3], 10 + 10 * Math.cos(85 * deg)) && close(cw.to[4], 10 + 10 * Math.sin(85 * deg)), `${cw.to.slice(3, 6)}`);
  assert.ok(close(cw.to[5], 0.21));
  assert.ok(close(cw.to[6], 10 + 10 * Math.cos(80 * deg)) && close(cw.to[8], 0.22), `${cw.to.slice(6, 9)}`);
  // Starting at 0° instead (from (20, 10) about (10, 10)), where sines tell the two ways apart: anticlockwise to
  // (10, 20) the first piece ends at 5°, clockwise to (10, 0) at −5°.
  const ccw0 = playback("G0 X20 Y10 Z0.2 F600\nG3 X10 Y20 I-10 J0");
  assert.ok(close(ccw0.to[3], 10 + 10 * Math.cos(5 * deg)) && close(ccw0.to[4], 10 + 10 * Math.sin(5 * deg)), `${ccw0.to.slice(3, 6)}`);
  const cw0 = playback("G0 X20 Y10 Z0.2 F600\nG2 X10 Y0 I-10 J0");
  assert.ok(close(cw0.to[3], 10 + 10 * Math.cos(5 * deg)) && close(cw0.to[4], 10 - 10 * Math.sin(5 * deg)), `${cw0.to.slice(3, 6)}`);
});

test("playback: an arc's plastic shared out among its pieces", () => {
  // 1 mm of filament over the quarter arc at z 0.2 (the first layer, 0.2 high): A mm³ in 18 pieces, each a chord
  // 2 × 10 × sin 2.5° long, so each piece's width is (A / 18) / (chord × 0.2) + 0.2 (1 − π/4).
  const p = playback("M83\nG0 X10 Y20 Z0.2 F600\nG3 X0 Y10 I0 J-10 E1");
  const chord = 20 * Math.sin((2.5 * Math.PI) / 180);
  assert.ok(close(p.width[1], A / 18 / (chord * 0.2) + 0.2 * (1 - Math.PI / 4)), `${p.width[1]}`);
});

test("playback: what counts as plastic, layers and widths at the edges", () => {
  // Filament 0 mm across lays no plastic, even on an extruding move.
  assert.equal(playback("G1 X10 E1 F60", { filamentDiameter: 0 }).plasticCount, 0);
  // A line rising from z 0.2 to 0.4 belongs to a layer at its top, 0.4.
  assert.equal(playback("M83\nG0 Z0.2 F600\nG1 X10 Z0.4 E1").layers[0].z, 0.4);
  // 0.200001 is the same double as 0.2 + STILL: no higher than STILL above the layer, so the same layer.
  assert.equal(0.2 + STILL, 0.200001);
  assert.equal(playback("M83\nG0 Z0.2 F600\nG1 X10 E1\nG0 Z0.200001\nG1 X0 E1").layers.length, 1);
  // A line exactly STILL long has no width worth working out: 0.
  assert.equal(playback("M83\nG0 Z0.2 F600\nG1 X0.000001 E1").width[1], 0);
  // A layer at z 0 (0 high), or exactly STILL high, has width 0.
  assert.equal(playback("M83\nG1 X10 E1 F600").width[0], 0);
  assert.equal(playback("M83\nG0 Z0.000001 F600\nG1 X10 E1").width[1], 0);
});

test("momentAt: a piece that takes no time is done at once", () => {
  // No feed rate: the move takes 0 s, so at second 0 it is all the way along.
  const p = playback("M83\nG0 Z0.2\nG1 X10 E1");
  assert.equal(momentAt(p, 0)?.along, 1);
});
