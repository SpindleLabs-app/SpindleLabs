import { test } from "node:test";
import assert from "node:assert/strict";
import { backdropAt } from "../src/backdrop.ts";
import { EDGE_COLOUR } from "../src/highlight.ts";
import { BUILD_AREA_COLOURS, GROUND_GRID, PALETTES, SKETCH_COLOURS, setViewTheme, onViewTheme, viewTheme, type ViewTheme } from "../src/view-theme.ts";

// U1b: the 3D view's colours in each theme. The dark palette is exactly what the
// view always used; the light one is a pale sky with the drawing colours
// darkened until they read on it (WCAG's 3 : 1 for lines and icons).

type Rgb = readonly [number, number, number];
const hex = (n: number): Rgb => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const linear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the dark palette is the one the view always had", () => {
  assert.deepEqual(PALETTES.dark.backdrop, { top: [30, 38, 52], bottom: [14, 16, 22] });
  assert.equal(PALETTES.dark.sketch.line, 0x6cc4ff);
  assert.deepEqual(PALETTES.dark.ground, { centre: 0x46536a, lines: 0x2a3242 });
  assert.equal(viewTheme(), "dark");
});

test("setViewTheme copies a palette over the live colours, and dark puts every one back", () => {
  const seen: ViewTheme[] = [];
  const stop = onViewTheme((t) => seen.push(t));
  setViewTheme("light");
  assert.equal(viewTheme(), "light");
  assert.deepEqual(backdropAt(0), [243, 246, 251]); // the top row of the light sky
  assert.equal(SKETCH_COLOURS.line, PALETTES.light.sketch.line);
  assert.equal(BUILD_AREA_COLOURS.outside, PALETTES.light.buildArea.outside);
  assert.equal(GROUND_GRID.centre, PALETTES.light.ground.centre);
  setViewTheme("dark");
  assert.deepEqual(backdropAt(0), [30, 38, 52]);
  assert.deepEqual(backdropAt(1), [14, 16, 22]);
  assert.equal(SKETCH_COLOURS.line, 0x6cc4ff);
  assert.deepEqual([...EDGE_COLOUR], [0x28 / 255, 0x2b / 255, 0x31 / 255]);
  stop();
  setViewTheme("dark");
  assert.deepEqual(seen, ["light", "dark"]); // stopped: the last call told nobody
});

test("light: every sketch and grid line reads on the sky's middle at 3 : 1 or better (hand-worked for the sketch line)", () => {
  const middle: Rgb = [(243 + 203) / 2, (246 + 212) / 2, (251 + 226) / 2]; // (223, 229, 238.5)
  // The sketch line 0x0b6fcf = (11, 111, 207): linear (0.0033, 0.1589, 0.6239), luminance 0.0007 + 0.1136 + 0.0450 = 0.1593.
  // The sky's middle: linear (0.7379, 0.7835, 0.8546), luminance 0.1569 + 0.5604 + 0.0617 = 0.7790.
  // (0.7790 + 0.05) / (0.1593 + 0.05) = 3.96.
  assert.ok(Math.abs(contrast(hex(PALETTES.light.sketch.line), middle) - 3.96) < 0.1, `${contrast(hex(PALETTES.light.sketch.line), middle)}`);
  const weak: string[] = [];
  for (const [name, value] of Object.entries(PALETTES.light.sketch)) {
    if (["grid", "hover", "planeOff"].includes(name)) continue; // the grid is meant to be faint; hover is a light tint on purpose; the quiet plane is
    if (contrast(hex(value), middle) < 3) weak.push(`${name} ${contrast(hex(value), middle).toFixed(2)}`);
  }
  assert.deepEqual(weak, []);
  assert.ok(contrast(hex(PALETTES.light.buildArea.fits), middle) >= 3);
  assert.ok(contrast(hex(PALETTES.light.buildArea.outside), middle) >= 3);
});

test("the check fails on a dark-theme line over the light sky: the old sketch line is 1.7 : 1 there", () => {
  const middle: Rgb = [223, 229, 238.5];
  assert.ok(contrast(hex(PALETTES.dark.sketch.line), middle) < 2, `${contrast(hex(PALETTES.dark.sketch.line), middle)}`);
});
