// The print check on the model (H1, Ben 2026-11-05): Inspect ▾ Print check
// turns it on and off (kept in this browser, off at first, so the view is
// plain until wanted). While on, every change to the bodies shown is checked
// (print-check.ts) and painted through the shared overlays, one legend line
// per finding with its number: red where supports are needed, amber where a
// wall is too thin, violet where a bridge may sag, and a red ring round the
// weakest neck. The printer is the P1S with a 0.4 mm nozzle; the layer
// height is the Slice for printing preset picked last (0.2 mm without one).
// Nothing is saved in the design: it is a view of it.

import type { AnalysisOverlay, OverlayPlace } from "@fission/core";
import { printCheck, P1S_RULES, type CheckMesh, type PrintCheck, type PrintRules } from "@fission/print";
import { PRESET_PICKED_KEY, readPresets } from "./slice-presets.ts";
import { presetSettingsOf } from "./slice-print.ts";

/** Where the on/off choice is kept (this browser only). */
export const PRINT_CHECK_KEY = "spindlelabs.design.print-check";

/** The overlays' ids: one per finding, so each has its own legend line. */
export const PRINT_CHECK_IDS = {
  supports: "design.print-check.supports",
  thin: "design.print-check.thin",
  sag: "design.print-check.sag",
  weakest: "design.print-check.weakest",
  /** The line shown when nothing needs fixing, or the part is too big to check live. */
  clear: "design.print-check",
} as const;

export const ALL_PRINT_CHECK_IDS: readonly string[] = Object.values(PRINT_CHECK_IDS);

/** Whether the print check was left on in this browser; off when storage is blocked or holds anything else. */
export function printCheckShownIn(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(PRINT_CHECK_KEY) === "on";
  } catch {
    return false;
  }
}

/** Keeps the choice for the next visit; a blocked storage keeps nothing and says nothing. */
export function keepPrintCheckShown(storage: Pick<Storage, "setItem" | "removeItem"> | null, on: boolean) {
  try {
    if (on) storage?.setItem(PRINT_CHECK_KEY, "on");
    else storage?.removeItem(PRINT_CHECK_KEY);
  } catch {
    // storage blocked: the choice lasts until the page closes
  }
}

/** The rules to check against: the P1S's, with the layer height of the Slice for printing preset picked last. */
export function printRulesIn(storage: Pick<Storage, "getItem"> | null): PrintRules {
  let picked: string | null = null;
  try {
    picked = storage?.getItem(PRESET_PICKED_KEY) ?? null;
  } catch {
    return P1S_RULES;
  }
  if (picked === null) return P1S_RULES;
  const preset = readPresets(storage, presetSettingsOf).presets.find((p) => p.id === picked);
  const h = preset?.settings.layerHeight;
  return typeof h === "number" && h > 0 && h < 1 ? { ...P1S_RULES, layerHeight: h } : P1S_RULES;
}

const mm = (x: number, places = 1) => `${Number(x.toFixed(places))} mm`;
const mm2 = (x: number) => `${Math.round(x).toLocaleString("en-GB")} mm²`;
/** A sampled area (within about 2 %): two significant figures from 100 mm² up, said to be about. */
const aboutMm2 = (x: number) => (x < 100 ? mm2(x) : `about ${Number(x.toPrecision(2)).toLocaleString("en-GB")} mm²`);

/**
 * The overlays for a check's findings (only those found), each with its number in its legend line and what to do
 * about it in its detail; one calm line when nothing was found, and one saying so when the part was too big to check.
 */
export function printCheckOverlays(found: PrintCheck, rules: PrintRules): AnalysisOverlay[] {
  if (found.skipped) return [{ id: PRINT_CHECK_IDS.clear, label: "Print check: too detailed to check live", detail: "The bodies have more triangles than the check reads while you model. Slice for printing still checks them.", marks: [] }];
  const out: AnalysisOverlay[] = [];
  if (found.supports.length > 0)
    out.push({
      id: PRINT_CHECK_IDS.supports,
      label: `Needs supports: ${aboutMm2(found.supportsArea)}`,
      detail: `Faces leaning out more than ${rules.overhangAngle}° from upright with nothing under them would droop or fail. Turn Supports on in Slice for printing, or give them a ${rules.overhangAngle}° chamfer, or turn the part over.`,
      marks: [{ target: { triangles: found.supports }, severity: "error" }],
    });
  if (found.thin.length > 0)
    out.push({
      id: PRINT_CHECK_IDS.thin,
      label: `Too thin to print: ${mm(found.thinnest ?? 0, 2)} thinnest`,
      detail: `Walls under ${mm(rules.lineWidth, 2)} (one line from the 0.4 mm nozzle) and skins under one ${mm(rules.layerHeight, 2)} layer are left out by the slicer. Make them thicker.`,
      marks: [{ target: { triangles: found.thin }, severity: "warning" }],
    });
  if (found.sag.length > 0)
    out.push({
      id: PRINT_CHECK_IDS.sag,
      label: `Bridge may sag: ${mm(found.longestBridge)} across`,
      detail: `Undersides held at both ends but more than ${mm(rules.bridgeLimit, 0)} across droop a little in the middle. Supports, or a shorter span, print them flat.`,
      marks: [{ target: { triangles: found.sag }, severity: "info" }],
    });
  if (found.weakest) {
    const w = found.weakest;
    const places: OverlayPlace[] = w.outline.map(([from, to]) => ({ severity: "error", from, to }));
    out.push({
      id: PRINT_CHECK_IDS.weakest,
      label: `Weakest spot (estimate): ${mm2(w.area)} at ${mm(w.z)} up`,
      detail: `The narrowest neck between bigger parts (${mm2(w.area)}, with ${mm2(w.above)} above it). Layers hold together less well than the plastic along them, so a push on the part above splits it here first. An estimate from the shape alone, not a strength test.`,
      marks: [],
      places,
    });
  }
  if (out.length === 0)
    out.push({
      id: PRINT_CHECK_IDS.clear,
      label: `Print check: nothing to fix (P1S, ${mm(rules.layerHeight, 2)} layers)`,
      detail: `No overhangs past ${rules.overhangAngle}°, no walls under ${mm(rules.lineWidth, 2)}, no bridges over ${mm(rules.bridgeLimit, 0)} and no narrow necks.`,
      marks: [{ target: { triangles: [] }, severity: "info" }],
    });
  return out;
}

/** The check of the bodies shown (their display meshes in the joined order) and its overlays. */
export function checkShown(meshes: readonly CheckMesh[], rules: PrintRules): { found: PrintCheck; overlays: AnalysisOverlay[] } {
  const found = printCheck(meshes, rules);
  return { found, overlays: printCheckOverlays(found, rules) };
}

/** What the check found, in a line read by the browser test: "supports 2 thin 0 sag 0 weakest 0". */
export function printCheckSummary(found: PrintCheck): string {
  return `supports ${found.supports.length} thin ${found.thin.length} sag ${found.sag.length} weakest ${found.weakest ? 1 : 0}${found.skipped ? " skipped" : ""}`;
}
