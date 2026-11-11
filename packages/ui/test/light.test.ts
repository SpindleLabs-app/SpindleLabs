import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// U1b: the light theme's values for the colour tokens in theme.css. Every token
// is either given a light value or is on the short list of colours that are the
// same in both themes; the words on the cards meet WCAG 2's 4.5 : 1 (at least
// as well as the dark theme's own pairs where those are lower), icons and lines
// 3 : 1; and two pairs are worked out by hand.
const css = readFileSync(fileURLToPath(new URL("../src/theme.css", import.meta.url)), "utf8");
const start = css.indexOf("The colour tokens (U1a");
const lightAt = css.indexOf(':root[data-theme="light"]', start);
const end = css.indexOf("/* end of the colour tokens", lightAt);
assert.ok(start > 0 && lightAt > start && end > lightAt, "the token blocks are there");

const parse = (block: string): Map<string, string> => new Map([...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const dark = parse(css.slice(start, lightAt));
const lightOnly = parse(css.slice(lightAt, end));
const light = new Map([...dark, ...lightOnly]);

/**
 * Colours that are the same in both themes, and why: the bright blue fill and
 * its dark words (accent-bright, accent-deep, on-accent); white words on a
 * coloured fill (white, and the dark red and blue fills they sit on); the pale
 * chips whose dark words sit on them (the pointer's hint and its error note);
 * and the print preview's "support" green, a data colour.
 */
const SAME = ["accent-bright", "accent-deep", "fill-240-242-245-095", "fill-255-244-242-097", "fill-2f63ad", "fill-6b2328", "fill-82292f", "line-9aa3ad", "misc-3fbf7f", "on-accent", "text-1d2228", "text-8a1c12", "white"];

type Rgba = [number, number, number, number];
const colour = (text: string): Rgba => {
  const hex = text.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const [r, g, b, a = 1] = (text.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b, a];
};
const over = ([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
const linear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgba) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Token `name` of `theme` as a solid colour, laid over `under`. */
const solid = (theme: Map<string, string>, name: string, under: Rgba): Rgba => {
  const v = theme.get(name);
  assert.ok(v, `--${name} is defined`);
  return over(colour(v), under);
};

test("every token has a light value, or is on the list of those the same in both themes", () => {
  assert.deepEqual([...dark.keys()].filter((n) => !lightOnly.has(n)).sort(), SAME);
  for (const n of lightOnly.keys()) assert.ok(dark.has(n), `--${n} has a dark value too`);
});

test("hand-worked: the page's words on the light card, and the dark theme's for comparison", () => {
  const page = colour(light.get("page")!);
  const words = solid(light, "text", page);
  // Light page #e6eaf1 = (230, 234, 241): linear (0.7913, 0.8228, 0.8796), luminance 0.2126 × 0.7913 + 0.7152 × 0.8228 + 0.0722 × 0.8796 = 0.8200.
  assert.ok(Math.abs(luminance(page) - 0.82) < 0.001, `page ${luminance(page)}`);
  // The card #f5f7fa = (245, 247, 250): linear (0.9131, 0.9301, 0.9560), luminance 0.1941 + 0.6652 + 0.0690 = 0.9283.
  const card = solid(light, "surface", page);
  assert.ok(Math.abs(luminance(card) - 0.9283) < 0.001, `card ${luminance(card)}`);
  // The words #1d... (whatever --text came out as) on the card: (0.9283 + 0.05) / (L + 0.05), at least 4.5 : 1 and well above it for body text.
  assert.ok(contrast(words, card) >= 7, `words on card ${contrast(words, card)}`);
  // Dark: #e6e9ee on #161d2a is the pair the app has always used; 13.88 : 1 worked by the same formula.
  const darkPage = colour(dark.get("page")!);
  assert.ok(Math.abs(contrast(solid(dark, "text", solid(dark, "surface", darkPage)), solid(dark, "surface", darkPage)) - 13.88) < 0.02);
});

/** The darkest background a word sits on in each theme: the raised card over the page. */
const raised = (theme: Map<string, string>) => solid(theme, "surface-raised", colour(theme.get("page")!));

test("words meet 4.5 : 1 on the raised card (never worse than the dark theme's own pair below that)", () => {
  const texty = [...light.keys()].filter((n) => n === "text" || n.startsWith("text-") || ["accent-text", "accent", "danger", "warn", "ok"].includes(n)).filter((n) => !n.startsWith("text-white"));
  const short: string[] = [];
  for (const n of texty) {
    const onLight = contrast(solid(light, n, raised(light)), raised(light));
    const onDark = contrast(solid(dark, n, raised(dark)), raised(dark));
    // Words that sit on their own coloured fill (the guide's, the print preview's, a pale word on a dark red row) are tested in their own place; here, those that read on a card.
    if (onLight < Math.min(4.5, onDark) - 0.01) short.push(`${n}: ${onLight.toFixed(2)} light, ${onDark.toFixed(2)} dark`);
  }
  assert.deepEqual(short, []);
});

test("icons and lines meet 3 : 1: the accent and the card's edge against the page", () => {
  const page = colour(light.get("page")!);
  assert.ok(contrast(solid(light, "accent", page), page) >= 3);
  assert.ok(contrast(solid(light, "text-dim", raised(light)), raised(light)) >= 4.5);
});

test("the check fails on a washed-out word: the dark theme's accent text on a light card is 2.7 : 1", () => {
  const washed = contrast(solid(dark, "accent-text", raised(light)), raised(light));
  assert.ok(washed < 3, `the dark accent text on the light card is ${washed.toFixed(2)}`);
});

/**
 * The tinted rows words sit on (accessibility pass 2026-11-11): a picked command-search row (fill-1e3350), an open toolbar
 * group (fill-263142), a status chip (fill-1b2332) and the toolbar itself (fill-121824), each over the page. The dim words
 * (keys, reasons, group names, "now") must read at 4.5 : 1 on every one of them in both themes.
 */
const TINTS = ["fill-1e3350", "fill-263142", "fill-1b2332", "fill-121824"];

test("hand-worked: the light dim words on the toolbar's tint", () => {
  // --text-dim #4a4f57 = (74, 79, 87): linear (0.0685, 0.0782, 0.0953), L = 0.2126 × 0.0685 + 0.7152 × 0.0782 + 0.0722 × 0.0953 = 0.0773.
  // --fill-121824 light #dde2eb = (221, 226, 235): linear (0.7230, 0.7605, 0.8308), L = 0.1537 + 0.5439 + 0.0600 = 0.7576.
  // (0.7576 + 0.05) / (0.0773 + 0.05) = 0.8076 / 0.1273 = 6.34 : 1.
  const page = colour(light.get("page")!);
  const tint = solid(light, "fill-121824", page);
  assert.ok(Math.abs(contrast(solid(light, "text-dim", tint), tint) - 6.34) < 0.02, `${contrast(solid(light, "text-dim", tint), tint)}`);
});

test("dim words meet 4.5 : 1 on every tinted row, both themes; the accent words on the picked (active) fill too", () => {
  const short: string[] = [];
  for (const [name, theme] of [["dark", dark], ["light", light]] as const) {
    const page = colour(theme.get("page")!);
    for (const t of TINTS) {
      const bg = solid(theme, t, page);
      const r = contrast(solid(theme, "text-dim", bg), bg);
      if (r < 4.5) short.push(`${name} text-dim on ${t}: ${r.toFixed(2)}`);
    }
    // The picked choice in Settings and the current History row: the accent words on the active fill over the page and the card.
    for (const under of ["page", "surface"]) {
      const base = under === "page" ? page : solid(theme, "surface", page);
      const bg = solid(theme, "shade-74-168-255-016", base);
      const r = contrast(solid(theme, "accent-text", bg), bg);
      if (r < 4.5) short.push(`${name} accent-text on the active fill over ${under}: ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(short, []);
});

test("the tint check fails on the old dim words: light #656a73 on the picked command row is 3.1 : 1", () => {
  const page = colour(light.get("page")!);
  const bg = solid(light, "fill-1e3350", page);
  const old = contrast(colour("#656a73"), bg);
  assert.ok(old < 4.5 && Math.abs(old - 3.1) < 0.05, `${old}`);
});
