import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { DEFAULT_CUSTOM, LIGHT_AT, contrast, deriveCustom, luminance, parseHex, toHex } from "../src/custom-theme.ts";
import { SETTINGS_KEY, SettingsStore, type SettingsStorage } from "../src/settings.ts";
import { CUSTOM_KEYS, applyCustom, startTheme } from "../src/theme-choice.ts";

// The Custom theme: three hex colours become the colour tokens, with text kept readable.
const css = readFileSync(fileURLToPath(new URL("../src/theme.css", import.meta.url)), "utf8");
const start = css.indexOf("The colour tokens (U1a");
const lightAt = css.indexOf(':root[data-theme="light"]', start);
const end = css.indexOf("/* end of the colour tokens", lightAt);
const parse = (block: string): Map<string, string> => new Map([...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const dark = parse(css.slice(start, lightAt));
const light = new Map([...dark, ...parse(css.slice(lightAt, end))]);
const tokens = { dark, light };
const rgb = (hex: string) => parseHex(hex)!;

test("parseHex: #1a2b3c is 26, 43, 60 (0x1a = 16 + 10, 0x2b = 32 + 11, 0x3c = 48 + 12); three digits double; anything else is refused", () => {
  assert.deepEqual(parseHex("#1a2b3c"), [26, 43, 60]);
  assert.deepEqual(parseHex("ABC"), [170, 187, 204]); // 0xaa, 0xbb, 0xcc
  assert.equal(parseHex("#12"), null);
  assert.equal(parseHex("#12345g"), null);
  assert.equal(parseHex(""), null);
  assert.equal(toHex([26, 43, 60]), "#1a2b3c");
});

test("contrast: white on black is (1 + 0.05) / (0 + 0.05) = 21, and a colour on itself is 1", () => {
  assert.equal(contrast([255, 255, 255], [0, 0, 0]), 21);
  assert.equal(contrast([10, 20, 30], [10, 20, 30]), 1);
});

test("the base is light for a primary above luminance 0.179: #767676 (0.181) is light, #757575 (0.178) is dark", () => {
  assert.ok(luminance(rgb("#767676")) > LIGHT_AT && luminance(rgb("#757575")) < LIGHT_AT);
  assert.equal(deriveCustom({ ...DEFAULT_CUSTOM, primary: "#767676" }, tokens).base, "light");
  assert.equal(deriveCustom({ ...DEFAULT_CUSTOM, primary: "#757575" }, tokens).base, "dark");
  assert.equal(deriveCustom({ ...DEFAULT_CUSTOM, primary: "#ffffff" }, tokens).base, "light");
});

test("the standard colours change nothing: the dark theme's own page and blue, no notes", () => {
  const r = deriveCustom(DEFAULT_CUSTOM, tokens);
  assert.equal(r.base, "dark");
  assert.deepEqual(r.notes, []);
  assert.equal(r.vars["--page"], "#0f141c");
  assert.equal(r.vars["--surface"], dark.get("surface")); // no shift: the primary is the dark page itself
  assert.equal(r.vars["--accent"], "#4aa8ff");
  assert.equal(r.used.primary, "#0f141c");
});

test("hand-worked: a primary 16 brighter in every channel moves the panels 16 too", () => {
  // #0f141c = (15, 20, 28); adding 16 to each channel gives (31, 36, 44) = #1f242c.
  // The dark surface #161d2a = (22, 29, 42) becomes (38, 45, 58) = #262d3a.
  const r = deriveCustom({ ...DEFAULT_CUSTOM, primary: "#1f242c" }, tokens);
  assert.equal(r.vars["--page"], "#1f242c");
  assert.equal(r.vars["--surface"], "#262d3a");
  assert.deepEqual(r.notes, []);
});

test("a colour that is not hex is refused in words and the standard one kept", () => {
  const r = deriveCustom({ primary: "navy", secondary: "#12", highlight: "#4aa8ff" }, tokens);
  assert.equal(r.used.primary, DEFAULT_CUSTOM.primary);
  assert.equal(r.used.secondary, DEFAULT_CUSTOM.secondary);
  assert.equal(r.notes.length, 2);
  assert.match(r.notes[0], /Primary "navy" is not a hex colour/);
});

test("a primary too close to the words is nudged until text has 4.5 : 1 and dim text 3 : 1 on every panel, and says so", () => {
  const r = deriveCustom({ ...DEFAULT_CUSTOM, primary: "#808080" }, tokens);
  assert.equal(r.base, "light");
  assert.equal(r.notes.filter((n) => n.startsWith("Primary")).length, 1); // (the standard blue is also too faint on a light panel, and is lifted too)
  assert.match(r.notes[0], /^Primary #808080 was too close to the colour of the words/);
  assert.notEqual(r.used.primary, "#808080");
  const text = rgb(light.get("text")!);
  const dim = rgb(light.get("text-dim")!);
  for (const g of ["page", "surface", "surface-raised"]) {
    assert.ok(contrast(text, rgb(r.vars[`--${g}`])) >= 4.5, `${g} text`);
    assert.ok(contrast(dim, rgb(r.vars[`--${g}`])) >= 3, `${g} dim text`);
  }
});

test("a dark primary that already carries the words is left alone (the check can pass)", () => {
  assert.deepEqual(deriveCustom({ ...DEFAULT_CUSTOM, primary: "#000000" }, tokens).notes, []);
});

test("highlight: 3 : 1 on the raised panel is the line; the tightest grey that passes is kept, the next darker is lifted (boundary)", () => {
  const raised = rgb(deriveCustom(DEFAULT_CUSTOM, tokens).vars["--surface-raised"]);
  let edge = -1;
  for (let g = 0; g < 256; g++) if (contrast([g, g, g], raised) >= 3) {
    edge = g;
    break;
  }
  assert.ok(edge > 0, `a grey passes at ${edge}`);
  const at = deriveCustom({ ...DEFAULT_CUSTOM, highlight: toHex([edge, edge, edge]) }, tokens);
  assert.equal(at.notes.filter((n) => n.startsWith("Highlight")).length, 0);
  const below = deriveCustom({ ...DEFAULT_CUSTOM, highlight: toHex([edge - 1, edge - 1, edge - 1]) }, tokens);
  assert.equal(below.notes.filter((n) => n.startsWith("Highlight")).length, 1);
  assert.ok(contrast(rgb(below.vars["--accent"]), raised) >= 3);
});

test("highlight words (accent-text) reach 4.5 : 1 and the words on its fill are the near-black or the white, whichever reads better", () => {
  for (const h of ["#4aa8ff", "#ffd400", "#ff3b6b", "#7fffd4", "#9b59ff"]) {
    const r = deriveCustom({ ...DEFAULT_CUSTOM, highlight: h }, tokens);
    assert.ok(contrast(rgb(r.vars["--accent-text"]), rgb(r.vars["--surface-raised"])) >= 4.5, `${h} words`);
    assert.ok(contrast(rgb(r.vars["--on-accent"]), rgb(r.vars["--accent-bright"])) >= 4.5, `${h} on its fill`);
  }
  // Yellow's fill is bright, so near-black words; a deep violet's fill is dark, so white.
  assert.equal(deriveCustom({ ...DEFAULT_CUSTOM, highlight: "#ffd400" }, tokens).vars["--on-accent"], "#07111c");
});

test("the chosen-tool tint and glow follow the highlight at the theme's own strengths", () => {
  const r = deriveCustom({ ...DEFAULT_CUSTOM, highlight: "#ff8800" }, tokens);
  assert.equal(r.vars["--shade-74-168-255-016"], "rgba(255, 136, 0, 0.16)");
  assert.equal(r.vars["--shade-74-168-255-035"], "rgba(255, 136, 0, 0.35)");
});

test("applying it: the tokens go on the root, the colours are stored, the view is told, and Dark takes it all off", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const data = new Map<string, string>();
  const storage: SettingsStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  const settings = new SettingsStore(storage);
  const heard: unknown[] = [];
  doc.addEventListener("colourchange", (e) => heard.push((e as CustomEvent).detail));
  const r = applyCustom(doc, settings, { primary: "#ffffff", secondary: "#aabbcc", highlight: "#b35900" });
  assert.equal(doc.documentElement.dataset.theme, "light");
  assert.equal(doc.documentElement.style.getPropertyValue("--accent"), "#b35900");
  assert.equal(doc.documentElement.dataset.customSecondary, "#aabbcc");
  assert.equal(settings.get(CUSTOM_KEYS.base, ""), "light");
  assert.equal(JSON.parse(settings.get(CUSTOM_KEYS.vars, "{}"))["--accent"], "#b35900");
  assert.deepEqual(heard, [{ secondary: "#aabbcc" }]);
  assert.deepEqual(r.notes, []);
  // Choosing Dark takes every custom token off.
  settings.set("theme", "dark");
  const choose = startTheme(doc, settings, null);
  choose("dark");
  assert.equal(doc.documentElement.style.getPropertyValue("--accent"), "");
  assert.equal(doc.documentElement.dataset.customVars, undefined);
  assert.deepEqual(heard.at(-1), { secondary: null });
});

test("the pre-paint script replays a stored Custom theme, and ignores a damaged or hostile one", () => {
  const script = readFileSync(fileURLToPath(new URL("../../../apps/fission/public/theme-init.js", import.meta.url)), "utf8");
  const run = (stored: unknown) => {
    const attrs = new Map<string, string>();
    const style = new Map<string, string>();
    const doc = {
      documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), style: { setProperty: (k: string, v: string) => style.set(k, v) } },
      querySelector: () => ({ setAttribute: (k: string, v: string) => attrs.set(`meta.${k}`, v) }),
    };
    runInNewContext(script, { window: { localStorage: { getItem: (k: string) => (k === SETTINGS_KEY ? JSON.stringify(stored) : null) }, matchMedia: () => ({ matches: false }) }, document: doc });
    return { attrs, style };
  };
  const good = run({ theme: "custom", "custom-base": "light", "custom-primary": "#ffffff", "custom-secondary-used": "#aabbcc", "custom-vars": JSON.stringify({ "--page": "#ffffff", "--accent": "#ff8800" }) });
  assert.equal(good.attrs.get("data-theme"), "light");
  assert.equal(good.style.get("--accent"), "#ff8800");
  assert.equal(good.attrs.get("data-custom-secondary"), "#aabbcc");
  assert.equal(good.attrs.get("meta.content"), "#ffffff");
  // Only custom property names with plain values go on the root.
  const hostile = run({ theme: "custom", "custom-base": "dark", "custom-vars": JSON.stringify({ "background": "url(x)", "--ok": "#123456", "--bad;": "1", "--n": 5 }) });
  assert.deepEqual([...hostile.style.keys()], ["--ok"]);
  // A stored custom theme with no base (or a bad one) is the device's theme.
  assert.equal(run({ theme: "custom", "custom-base": "pink" }).attrs.get("data-theme"), "dark");
  // Not valid JSON in the vars: the base alone.
  assert.equal(run({ theme: "custom", "custom-base": "light", "custom-vars": "{oops" }).attrs.get("data-theme"), "light");
});
