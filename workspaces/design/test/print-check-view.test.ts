// The print check on the model (print-check-view.ts): the on/off choice kept in this browser, the layer height from
// the Slice for printing preset picked last, and each finding's legend line with its numbers worked by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkShown, keepPrintCheckShown, printCheckOverlays, printCheckShownIn, printCheckSummary, printRulesIn, PRINT_CHECK_IDS, PRINT_CHECK_KEY } from "../src/print-check-view.ts";
import { P1S_RULES, type PrintCheck } from "@fission/slice";
import { PRESET_PICKED_KEY, PRESETS_KEY, PRESETS_VERSION } from "../src/slice-presets.ts";
import { FILE_DEFAULTS, PRINT_DEFAULTS } from "../src/slice-print.ts";

function memory(start: Record<string, string> = {}) {
  const kept = new Map(Object.entries(start));
  return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k), kept };
}
const blocked = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

test("the choice: off at first, kept on, taken off again; blocked storage is off and never throws", () => {
  const s = memory();
  assert.equal(printCheckShownIn(s), false);
  keepPrintCheckShown(s, true);
  assert.equal(s.kept.get(PRINT_CHECK_KEY), "on");
  assert.equal(printCheckShownIn(s), true);
  keepPrintCheckShown(s, false);
  assert.equal(s.kept.has(PRINT_CHECK_KEY), false);
  assert.equal(printCheckShownIn(memory({ [PRINT_CHECK_KEY]: "yes" })), false, "only our own word turns it on");
  assert.equal(printCheckShownIn(null), false);
  assert.equal(printCheckShownIn(blocked), false);
  assert.doesNotThrow(() => keepPrintCheckShown(blocked, true));
});

test("the layer height: the preset picked last, else the P1S's 0.2 mm", () => {
  const preset = (id: string, layerHeight: number) => ({ id, name: id, printer: "bambu-p1s", settings: { ...PRINT_DEFAULTS, ...FILE_DEFAULTS, layerHeight }, updatedAt: 1 });
  const store = JSON.stringify({ version: PRESETS_VERSION, presets: [preset("fine", 0.16), preset("draft", 0.28)] });
  assert.equal(printRulesIn(memory({ [PRESETS_KEY]: store, [PRESET_PICKED_KEY]: "fine" })).layerHeight, 0.16);
  assert.equal(printRulesIn(memory({ [PRESETS_KEY]: store, [PRESET_PICKED_KEY]: "draft" })).layerHeight, 0.28);
  assert.deepEqual(printRulesIn(memory({ [PRESETS_KEY]: store })), P1S_RULES, "none picked");
  assert.deepEqual(printRulesIn(memory({ [PRESETS_KEY]: store, [PRESET_PICKED_KEY]: "gone" })), P1S_RULES, "picked one deleted");
  assert.deepEqual(printRulesIn(memory({ [PRESETS_KEY]: "not json", [PRESET_PICKED_KEY]: "fine" })), P1S_RULES);
  assert.deepEqual(printRulesIn(blocked), P1S_RULES);
  assert.deepEqual(printRulesIn(null), P1S_RULES);
  // The rest are the P1S's whatever the preset: 45°, 0.42 mm lines, 10 mm bridges.
  const r = printRulesIn(memory({ [PRESETS_KEY]: store, [PRESET_PICKED_KEY]: "fine" }));
  assert.deepEqual({ ...r, layerHeight: 0.2 }, P1S_RULES);
});

const none: PrintCheck = { supports: [], thin: [], sag: [], supportsArea: 0, thinArea: 0, sagArea: 0, longestBridge: 0, thinnest: null, weakest: null, skipped: false };

test("each finding's legend line, its numbers by hand, in its colour", () => {
  const found: PrintCheck = {
    ...none,
    supports: [3, 4],
    supportsArea: 803.1, // a sampled 800 mm²: two significant figures, said to be about
    thin: [7],
    thinnest: 0.3,
    sag: [9],
    longestBridge: 14.2,
    weakest: { z: 14.1, area: 36, above: 360, centre: [11, 15, 14.1], outline: [[[8, 12, 14.1], [14, 12, 14.1]], [[14, 12, 14.1], [14, 18, 14.1]]] },
  };
  const o = printCheckOverlays(found, P1S_RULES);
  assert.deepEqual(
    o.map((x) => [x.id, x.label]),
    [
      [PRINT_CHECK_IDS.supports, "Needs supports: about 800 mm²"],
      [PRINT_CHECK_IDS.thin, "Too thin to print: 0.3 mm thinnest"],
      [PRINT_CHECK_IDS.sag, "Bridge may sag: 14.2 mm across"],
      [PRINT_CHECK_IDS.weakest, "Weakest spot (estimate): 36 mm² at 14.1 mm up"],
    ],
  );
  assert.deepEqual(o[0].marks, [{ target: { triangles: [3, 4] }, severity: "error" }]);
  assert.deepEqual(o[1].marks, [{ target: { triangles: [7] }, severity: "warning" }]);
  assert.deepEqual(o[2].marks, [{ target: { triangles: [9] }, severity: "info" }]);
  // The weakest spot is its outline, drawn over everything in red.
  assert.deepEqual(o[3].places, [
    { severity: "error", from: [8, 12, 14.1], to: [14, 12, 14.1] },
    { severity: "error", from: [14, 12, 14.1], to: [14, 18, 14.1] },
  ]);
  // A small area is said exactly.
  assert.equal(printCheckOverlays({ ...none, supports: [0], supportsArea: 25 }, P1S_RULES)[0].label, "Needs supports: 25 mm²");
});

test("nothing found: one calm line naming the printer and layers; too big: a line saying so", () => {
  assert.deepEqual(
    printCheckOverlays(none, { ...P1S_RULES, layerHeight: 0.16 }).map((x) => [x.id, x.label]),
    [[PRINT_CHECK_IDS.clear, "Print check: nothing to fix (P1S, 0.16 mm layers)"]],
  );
  assert.deepEqual(
    printCheckOverlays({ ...none, skipped: true }, P1S_RULES).map((x) => [x.id, x.label]),
    [[PRINT_CHECK_IDS.clear, "Print check: too detailed to check live"]],
  );
  assert.equal(printCheckSummary({ ...none, skipped: true }), "supports 0 thin 0 sag 0 weakest 0 skipped");
});

test("checkShown: a box floating 1 mm up over another, end to end", () => {
  const cube = (x0: number, z0: number, s: number) => {
    const c: number[][] = [];
    for (let i = 0; i < 8; i++) c.push([i & 1 ? x0 + s : x0, i & 2 ? s : 0, i & 4 ? z0 + s : z0]);
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    return { positions: c.flat(), indices: quads.flatMap(([a, b, cc, d]) => [a, b, cc, a, cc, d]) };
  };
  // A 10 mm cube on the plate and a 5 mm cube 1 mm above it: the small one's 25 mm² underside hangs.
  const { found, overlays } = checkShown([cube(0, 0, 10), cube(2, 11, 5)], P1S_RULES);
  assert.equal(printCheckSummary(found), "supports 2 thin 0 sag 0 weakest 0");
  assert.equal(overlays[0].label, "Needs supports: 25 mm²");
});
