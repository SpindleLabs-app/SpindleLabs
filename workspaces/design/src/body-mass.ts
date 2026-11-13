// A body's mass in Body facts (step 66a): its exact volume (the kernel's,
// from the B-rep, never the display mesh) times the density of a material
// picked from the one materials library (core material.ts, TestLab T2's
// numbers with their sources). The pick is a view setting kept in this
// browser, like the print check, not the design's: bodies have no material
// of their own yet (66b), so nothing is recorded and no undo step is made.
// The mass is the body as solid material; a print with infill weighs less,
// and the panel says so.

import { materialLibrary, type Material, type Unit } from "@fission/core";
import { formatQuantity } from "@fission/ui";

/** Where the material picked for the mass is kept in the browser. */
export const MASS_MATERIAL_KEY = "fission.facts-material";
/** The material a first visit shows: PLA, what most people print in. */
export const DEFAULT_MASS_MATERIAL = "pla";

/** One avoirdupois ounce and pound in grams, both exact by definition (the international pound, 1959: 0.45359237 kg). */
export const GRAMS_PER_POUND = 453.59237;
export const GRAMS_PER_OUNCE = GRAMS_PER_POUND / 16;

/** The words under the mass, so nobody takes it for a print's weight. */
export const SOLID_NOTE = "As solid material. A print with infill weighs less: Slice for printing says its weight.";

/** The materials a mass can be worked out for: those in the library with a density, in the library's order. */
export const massMaterials = (): Material[] => materialLibrary().all().filter((m) => m.mechanical !== undefined);

/**
 * The mass in grams of `volume` mm³ of a material `density` kg/m³: 1 mm³ is
 * 1e-9 m³ and 1 kg is 1000 g, so grams = volume × density × 1e-6. Null for
 * a volume or density that is no positive finite number (nothing built, a
 * broken view), never a made-up mass.
 */
export function massGrams(volume: number, density: number): number | null {
  if (!(Number.isFinite(volume) && volume > 0 && Number.isFinite(density) && density > 0)) return null;
  return volume * density * 1e-6;
}

/** Three significant figures, said as the app says numbers (a tiny or huge one with a power of ten). */
const three = (x: number): string => formatQuantity(Number(x.toPrecision(3)));

/**
 * A mass in words for the unit chosen in Settings: millimetres in grams up
 * to 1000 g, then kilograms; inches in ounces under a pound, then pounds.
 * Three significant figures, as the volume badge gives.
 */
export function massWords(grams: number, unit: Unit): string {
  if (unit === "in") {
    const oz = grams / GRAMS_PER_OUNCE;
    // Rounded first, so 15.999 oz is said as 1 lb, not "16 oz".
    return Number(oz.toPrecision(3)) < 16 ? `${three(oz)} oz` : `${three(grams / GRAMS_PER_POUND)} lb`;
  }
  return Number(grams.toPrecision(3)) < 1000 ? `${three(grams)} g` : `${three(grams / 1000)} kg`;
}

/** The part of localStorage the pick uses (any of it may throw: storage off, private mode, full). */
export type MaterialStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): MaterialStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The material last picked in this browser, or PLA when none is kept, the kept one is no longer in the library or storage can't be read. */
export function readMassMaterial(storage: MaterialStorage | null = browserStorage()): Material {
  const all = massMaterials();
  let kept: string | null = null;
  try {
    kept = storage?.getItem(MASS_MATERIAL_KEY) ?? null;
  } catch {
    kept = null;
  }
  return all.find((m) => m.id === kept) ?? all.find((m) => m.id === DEFAULT_MASS_MATERIAL) ?? all[0];
}

/** Keeps the pick for the next visit; storage that refuses it only loses that. */
export function writeMassMaterial(id: string, storage: MaterialStorage | null = browserStorage()): void {
  try {
    storage?.setItem(MASS_MATERIAL_KEY, id);
  } catch {
    // Not kept: the next visit starts at PLA.
  }
}

/** The mass row's words for a body of `volume` mm³ in material `m`, or "—" when no mass can be worked out. */
export function massShown(volume: number, m: Material, unit: Unit): string {
  const grams = m.mechanical ? massGrams(volume, m.mechanical.density) : null;
  return grams === null ? "—" : massWords(grams, unit);
}

/** Where the density came from, for the Material row's tooltip: "PLA: 1.24 g/cm³ (Density 1.24 g/cm³, ISO 1183; maker's technical data sheet …)". */
export function densityWords(m: Material): string {
  if (!m.mechanical) return `${m.name}: no density in the library.`;
  const s = m.mechanical.sources.density;
  return `${m.name}: ${(m.mechanical.density / 1000).toLocaleString("en", { maximumFractionDigits: 3 })} g/cm³ (${s.says}; ${s.document}).`;
}
