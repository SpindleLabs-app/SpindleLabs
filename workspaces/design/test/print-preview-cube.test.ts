// A real 20 mm cube from the shipped build played through the print preview's replayer, checked against the engine's own preview layers
// (the preview's panel and its hand-worked tests are in packages/print/test/print-preview.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { momentAt, playback, type Playback } from "@fission/core";
import { replay } from "@fission/core/gcode";
import { checkLayers, checkPrinter, checkProblems } from "../../../packages/testing/src/gcode-checks.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyFeatures } from "../src/browser.ts";
import { partDocument } from "../src/document.ts";
import { sliceBodies } from "../src/slice-print.ts";
import { PRINT_DEFAULTS } from "@fission/print";

test("a 20 mm cube from the shipped build plays as the engine sliced it: 100 layers of 0.2 mm, every layer's kinds the same", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const print = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  const p = playback(print.gcode);
  assert.deepEqual(p.problems, []);
  // 20 mm / 0.2 mm: 100 layers, each 0.2 mm, the top at 20.
  assert.equal(p.layers.length, 100);
  for (const l of p.layers) assert.ok(Math.abs(l.height - 0.2) < 1e-6, `height ${l.height} at ${l.z}`);
  assert.ok(Math.abs(p.layers[99].z - 20) < 1e-6);
  // Two code paths agreeing: the replayed G-code's layers and the engine's own preview layers, height and kinds.
  // The warm-up loop ("skirt") plays as the prime kind, with the prime line, so both sides leave it out here; it is
  // checked on its own below.
  const roleKind = { "outer-wall": "outer-wall", "inner-wall": "inner-wall", "solid-infill": "solid-infill", "sparse-infill": "sparse-infill" } as const;
  for (let k = 0; k < 100; k++) {
    assert.ok(Math.abs(p.layers[k].z - print.preview[k].zTop) < 1e-6);
    const played = new Set<string>();
    for (let i = 0; i < p.count; i++) if (p.plastic[i] && p.layer[i] === k && p.kind[i] !== "prime") played.add(p.kind[i]);
    const sliced = print.preview[k].paths.filter((x) => x.role !== "skirt").map((x) => roleKind[x.role as keyof typeof roleKind]);
    assert.deepEqual([...played].sort(), [...new Set(sliced)].sort(), `layer ${k}`);
  }
  // On by default: the engine's first layer has the warm-up loop, and the played first layer lays prime-kind plastic
  // well inside the plate (the prime line is at the plate's front edge, y < 1 mm; the loop is round the cube, y > 100).
  assert.ok(print.preview[0].paths.some((x) => x.role === "skirt"));
  assert.ok(print.preview.slice(1).every((l) => l.paths.every((x) => x.role !== "skirt")));
  let loopPieces = 0;
  for (let i = 0; i < p.count; i++) if (p.plastic[i] && p.layer[i] === 0 && p.kind[i] === "prime" && p.to[3 * i + 1] > 100) loopPieces++;
  assert.ok(loopPieces > 8, `${loopPieces} pieces of the loop played`);
  // Every line laid is about one 0.4 mm line wide (0.3 to 0.6: walls and infill differ a little).
  for (let i = 0; i < p.count; i++) if (p.plastic[i] && p.kind[i] !== "prime") assert.ok(p.width[i] > 0.3 && p.width[i] < 0.6, `width ${p.width[i]} of ${p.kind[i]}`);
});

test("hand-worked: a 20 mm cube's first layer, and every line as wide as the G-code says", async () => {
  const kernel = nodeKernel();
  const doc = partDocument("box", 20, 20, 20);
  const print = await sliceBodies(kernel, doc, bodyFeatures(doc), PRINT_DEFAULTS);
  const r = replay(print.gcode);
  const p = playback(print.gcode);
  // The slice has no arcs, so the playback's pieces are the replayer's moves one for one.
  assert.equal(p.count, r.moves.length);
  // Each line's width as the file states it: the last `;WIDTH:` comment before the move.
  const lines = print.gcode.split("\n");
  const stated: number[] = [];
  let w = Number.NaN;
  for (const l of lines) {
    const m = /^;WIDTH:([\d.]+)/.exec(l);
    stated.push(m ? (w = Number(m[1])) : w);
  }
  let checked = 0;
  for (let i = 0; i < p.count; i++) {
    if (!p.plastic[i] || p.kind[i] === "prime") continue;
    const want = stated[r.moves[i].line - 1];
    if (!Number.isFinite(want)) continue;
    // E has five decimals (about 1e-5 of a 0.6 mm push), so the width read back is good to well under 1e-3 mm.
    assert.ok(Math.abs(p.width[i] - want) < 1e-3, `line ${r.moves[i].line}: ${p.width[i]} drawn, ${want} stated`);
    checked++;
  }
  assert.ok(checked > 1000, `${checked} lines checked`);

  // The outer wall of the first layer, by hand: the cube's faces are 20 mm apart and the first layer's
  // lines are 0.5 mm wide (Bambu Studio's first-layer width), and the first layer is pulled in 0.15 mm so
  // its squashed line does not bulge past the faces (Bambu Studio's P1S elephant-foot value), so the outer
  // line's centre runs 0.25 + 0.15 = 0.4 mm in: a square of side 20 − 0.8 = 19.2 mm. The loop stops the
  // seam gap, 0.06 mm, short of its seam, so its last side is 19.2 − 0.06 = 19.14 mm: 3 × 19.2 + 19.14 =
  // 76.74 mm round. The file prints it at F3000, 50 mm/s: 76.74 ÷ 50 = 1.5348 s.
  const outer = [...Array(p.count).keys()].filter((i) => p.plastic[i] && p.layer[i] === 0 && p.kind[i] === "outer-wall");
  assert.equal(outer.length, 4);
  const length = (i: number) => Math.hypot(p.to[3 * i] - p.from[3 * i], p.to[3 * i + 1] - p.from[3 * i + 1]);
  outer.forEach((i, k) => assert.ok(Math.abs(length(i) - (k === 3 ? 19.14 : 19.2)) < 1e-9, `side ${k}: ${length(i)}`));
  const time = outer.reduce((t, i) => t + p.finish[i] - p.start[i], 0);
  assert.ok(Math.abs(time - 1.5348) < 1e-9, `outer wall ${time} s`);
  // Halfway through the first side's time the nozzle is halfway along it, 0.2 mm above the bed.
  const [a] = outer;
  const at = momentAt(p, (p.start[a] + p.finish[a]) / 2)!;
  assert.equal(at.piece, a);
  for (const k of [0, 1]) assert.ok(Math.abs(at.nozzle[k] - (p.from[3 * a + k] + p.to[3 * a + k]) / 2) < 1e-9);
  assert.ok(Math.abs(at.nozzle[2] - 0.2) < 1e-9);
  // And the square is the cube's footprint shrunk by 0.4 mm all round: 19.2 across in x and in y.
  const xs = outer.flatMap((i) => [p.from[3 * i], p.to[3 * i]]);
  const ys = outer.flatMap((i) => [p.from[3 * i + 1], p.to[3 * i + 1]]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 19.2) < 1e-9 && Math.abs(Math.max(...ys) - Math.min(...ys) - 19.2) < 1e-9);

  // The replayer's own checks pass on everything the preview shows: the file followed faithfully, on the P1S's
  // 256 × 256 mm plate and 250 mm height, layers going up within the limits and every wall closed to within
  // its 0.06 mm seam gap (and the file's 1 µm rounding).
  assert.deepEqual(checkProblems(r), []);
  assert.deepEqual(checkLayers(r, 0.06 + 1e-3), []);
  assert.deepEqual(checkPrinter(r, { bed: { x: 256, y: 256 }, height: 250, maxFeed: 30000, maxNozzle: 300, maxBed: 110 }), []);
});
