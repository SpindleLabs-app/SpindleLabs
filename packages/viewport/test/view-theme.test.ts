import { test } from "node:test";
import assert from "node:assert/strict";
import { backdropAt } from "../src/backdrop.ts";
import { EDGE_COLOUR } from "../src/highlight.ts";
import { BUILD_AREA_COLOURS, GROUND_GRID, PALETTES, SKETCH_COLOURS, setViewTheme, setViewCustom, customSky, onViewTheme, viewTheme, type ViewTheme } from "../src/view-theme.ts";

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
  assert.deepEqual(backdropAt(0), [234, 244, 255]); // the top row of the light sky
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
  const middle: Rgb = [(234 + 176) / 2, (244 + 208) / 2, (255 + 244) / 2]; // (205, 226, 249.5)
  // The sketch line 0x0b6fcf = (11, 111, 207): linear (0.0033, 0.1589, 0.6239), luminance 0.0007 + 0.1136 + 0.0450 = 0.1593.
  // The sky's middle: linear (0.6105, 0.7605, 0.9516), luminance 0.1298 + 0.5439 + 0.0687 = 0.7424.
  // (0.7424 + 0.05) / (0.1593 + 0.05) = 3.78.
  assert.ok(Math.abs(contrast(hex(PALETTES.light.sketch.line), middle) - 3.78) < 0.1, `${contrast(hex(PALETTES.light.sketch.line), middle)}`);
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

test("custom sky, light: the secondary is the bottom and its paler self the top (hand-worked)", () => {
  // #b0d0f4 = (176, 208, 244). The top is 0.65 of the way to white: 176 + 79 × 0.65 = 227.35, 208 + 47 × 0.65 = 238.55, 244 + 11 × 0.65 = 251.15.
  const sky = customSky([176, 208, 244], "light");
  assert.deepEqual(sky.backdrop, { top: [227, 239, 251], bottom: [176, 208, 244] });
});

test("custom sky, dark: the secondary sunk toward black, 0.22 and 0.08 of it (hand-worked)", () => {
  // (176, 208, 244) × 0.22 = (38.7, 45.8, 53.7); × 0.08 = (14.1, 16.6, 19.5).
  const sky = customSky([176, 208, 244], "dark");
  assert.deepEqual(sky.backdrop, { top: [39, 46, 54], bottom: [14, 17, 20] });
});

test("custom sky: a secondary too dark for the sketch line to read on is lifted until it has 3 : 1; one that already does is not", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const c of [[48, 96, 176], [0, 0, 0], [255, 255, 255], [255, 0, 255], [128, 128, 128]] as [number, number, number][]) {
      const { backdrop } = customSky(c, theme);
      const middle: Rgb = [0, 1, 2].map((i) => (backdrop.top[i] + backdrop.bottom[i]) / 2) as unknown as Rgb;
      assert.ok(contrast(hex(PALETTES[theme].sketch.line), middle) >= 3, `${theme} ${c}`);
    }
  }
  // Dark blue on the light theme is lifted: the bottom is lighter than asked.
  assert.ok(customSky([48, 96, 176], "light").backdrop.bottom[0] > 48);
  // The standard light blue is not moved.
  assert.deepEqual(customSky([176, 208, 244], "light").backdrop.bottom, [176, 208, 244]);
});

test("setViewCustom: the next theme draw takes the sky and ground from it, and null puts the standard ones back", () => {
  setViewCustom([176, 208, 244]);
  setViewTheme("light");
  assert.deepEqual(backdropAt(0), [227, 239, 251]);
  setViewCustom(null);
  setViewTheme("light");
  assert.deepEqual(backdropAt(0), [234, 244, 255]);
  setViewTheme("dark");
});
