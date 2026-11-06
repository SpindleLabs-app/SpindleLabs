// What the beginner chooses for a print and the lists the choices come from (quality, walls, infill, supports, file, plate,
// nozzle), the remembered switches and the check of stored settings against the lists. Shared by Design's Slice for
// printing dialog and Slice's page; moved from Design's slice-print.ts (Slice page step 2b).

import type { BuildPlate, SupportStyle } from "@fission/core";
import type { PresetSettings } from "./slice-presets.ts";

/**
 * The beginner's choices: layer height (mm), walls, infill (%), supports under overhangs (off, normal or tree), and the
 * warm-up loop: two loops round the first layer, printed before the part, so the nozzle's first uneven plastic goes on
 * a line peeled off afterwards instead of on the part (Ben 11-01: the first 10–30 s of a first layer did not stick); and
 * Better grip: a 5 mm brim round the first layer (peeled off afterwards) and a slower, 5 °C hotter first layer.
 */
export interface PrintChoices {
  layerHeight: number;
  walls: number;
  infill: number;
  supports: SupportStyle;
  warmUp: boolean;
  betterGrip: boolean;
}

/** The P1S's defaults for a 0.4 mm nozzle and PLA, as the engine's own (0.2 mm layers, 2 walls, 15 % infill, no supports), with the warm-up loop on and Better grip off. */
export const PRINT_DEFAULTS: PrintChoices = { layerHeight: 0.2, walls: 2, infill: 15, supports: "off", warmUp: true, betterGrip: false };

/** Each choice's options, as the dialog lists them. */
export const QUALITY_OPTIONS: readonly { label: string; value: number }[] = [
  { label: "Fine (0.12 mm layers)", value: 0.12 },
  { label: "Detailed (0.16 mm layers)", value: 0.16 },
  { label: "Standard (0.2 mm layers)", value: 0.2 },
  { label: "Fast (0.28 mm layers)", value: 0.28 },
];
export const WALL_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const INFILL_OPTIONS: readonly number[] = [0, 10, 15, 20, 25, 40, 60, 100];
export const SUPPORT_OPTIONS: readonly { label: string; value: SupportStyle }[] = [
  { label: "Off", value: "off" },
  { label: "Normal (columns)", value: "normal" },
  { label: "Tree (less plastic)", value: "tree" },
];

/** The nozzle fitted to the P1S, as the engine names it (kernel-types.ts' NozzleType: the kernel call checks the two agree). */
export type NozzleType = "standard" | "high-flow";

/** Which file to save: the P1S's print file, or plain G-code for another printer. */
export type PrintFormat = "p1s" | "gcode";

/** The file's choices: its kind and, for the P1S's, the build plate (the owner's textured PEI by default) and the nozzle fitted (the stock Standard by default; the dialog remembers the last one chosen, as a printer's nozzle rarely changes). */
export interface FileChoices {
  format: PrintFormat;
  plate: BuildPlate;
  nozzle: NozzleType;
}

export const FILE_DEFAULTS: FileChoices = { format: "p1s", plate: "textured", nozzle: "standard" };

/**
 * The file kinds, as the dialog lists them. The plain file's start
 * routine primes a line across the P1S plate's front-left corner, which
 * the P1S keeps clear, so it is named as not for the P1S.
 */
export const FORMAT_OPTIONS: readonly { label: string; value: PrintFormat }[] = [
  { label: "Bambu Lab P1S (.gcode.3mf)", value: "p1s" },
  { label: "Plain G-code, not for the P1S (.gcode)", value: "gcode" },
];
export const PLATE_OPTIONS: readonly { label: string; value: BuildPlate }[] = [
  { label: "Textured PEI plate", value: "textured" },
  { label: "Smooth PEI or High Temp plate", value: "smooth" },
  { label: "Cool Plate", value: "cool_plate" },
  { label: "Cool Plate SuperTack", value: "supertack_plate" },
];
export const NOZZLE_OPTIONS: readonly { label: string; value: NozzleType }[] = [
  { label: "0.4 mm Standard", value: "standard" },
  { label: "0.4 mm High Flow", value: "high-flow" },
];

/** Where the dialog keeps the nozzle last chosen (this browser only). */
export const NOZZLE_KEY = "spindlelabs.slice.nozzle";

/** The nozzle last chosen, or the default when none was kept, the value is not one of ours, or storage is blocked. */
export function rememberedNozzle(storage: Pick<Storage, "getItem"> | null): NozzleType {
  try {
    const v = storage?.getItem(NOZZLE_KEY);
    return v === "standard" || v === "high-flow" ? v : FILE_DEFAULTS.nozzle;
  } catch {
    return FILE_DEFAULTS.nozzle;
  }
}

/** Where the dialog keeps the warm-up loop's last setting (this browser only): turned off once, it stays off. */
export const WARM_UP_KEY = "spindlelabs.slice.warm-up";

/** The warm-up loop's last setting, or on (the default) when none was kept, the value is not ours, or storage is blocked. */
export function rememberedWarmUp(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(WARM_UP_KEY) !== "off";
  } catch {
    return PRINT_DEFAULTS.warmUp;
  }
}

/** Where the dialog keeps Better grip's last setting (this browser only): turned on once, it stays on. */
export const GRIP_KEY = "spindlelabs.slice.better-grip";

/** Better grip's last setting, or off (the default) when none was kept, the value is not ours, or storage is blocked. */
export function rememberedBetterGrip(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(GRIP_KEY) === "on";
  } catch {
    return PRINT_DEFAULTS.betterGrip;
  }
}

/**
 * Stored settings (a preset's, slice-presets.ts) checked choice by choice against the dialog's own lists, or null when
 * any is missing or one the dialog doesn't offer: a preset never puts a value in that the dialog couldn't show.
 */
export function presetSettingsOf(raw: unknown): PresetSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const listed = <T>(options: readonly { value: T }[], v: unknown): v is T => options.some((o) => o.value === v);
  const among = <T>(values: readonly T[], v: unknown): v is T => values.includes(v as T);
  const { layerHeight, walls, infill, supports, warmUp, betterGrip, format, plate, nozzle } = r;
  if (!listed(QUALITY_OPTIONS, layerHeight) || !among(WALL_OPTIONS, walls) || !among(INFILL_OPTIONS, infill) || !listed(SUPPORT_OPTIONS, supports)) return null;
  if (typeof warmUp !== "boolean" || typeof betterGrip !== "boolean") return null;
  if (!listed(FORMAT_OPTIONS, format) || !listed(PLATE_OPTIONS, plate) || !listed(NOZZLE_OPTIONS, nozzle)) return null;
  return { layerHeight, walls, infill, supports, warmUp, betterGrip, format, plate, nozzle };
}
