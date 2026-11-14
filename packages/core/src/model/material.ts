// The one materials library for the whole project: a Design appearance, a
// Render material, TestLab's mechanical numbers and the Slice / Laser
// process presets are all views of the same Material.
//
// Built (TestLab T2): the mechanical half, for the five starter materials,
// each number with where it came from. Still DRAFT: the appearance, process
// and stock halves (step 66, I3), and a project's own materials.

/** Where a number came from: the document and what it says, so a person can check it. */
export interface Source {
  /** The document: "maker's technical data sheet V2.0 for a PLA filament", "ASTM A36". */
  document: string;
  /** What the document gives, as it gives it: "Young's modulus (X-Y) 2680 ± 130 MPa, ISO 527". */
  says: string;
}

/**
 * What TestLab needs, in SI units (kg/m³, Pa). A printed plastic is
 * weaker and softer across its layers than along them, so stiffness and
 * strength are given both ways from the start; the solver uses the
 * weaker way until the printed-material model (TestLab's growth plan)
 * knows the build direction. A metal is the same both ways.
 */
export interface Mechanical {
  /** kg/m³. */
  density: number;
  /** Young's modulus, Pa: along the layers (in the X-Y plane of the print) and across them (Z). Equal for a metal. */
  stiffness: { alongLayers: number; acrossLayers: number };
  /** Strength, Pa, both ways: the yield strength of a metal, the tensile strength of a printed plastic (`strengthKind`). */
  strength: { alongLayers: number; acrossLayers: number };
  /** "yield": where a metal starts to bend for good; "tensile": where a printed test bar broke (plastics give no clean yield). */
  strengthKind: "yield" | "tensile";
  /** Poisson's ratio: how much it narrows as it is stretched. */
  poissonsRatio: number;
  /** True for a material that is printed in layers, so the two ways differ. */
  printed: boolean;
  /** Where each number came from; a number with no measurement is said to be assumed in `poissonsRatio`'s source. */
  sources: { density: Source; stiffness: Source; strength: Source; poissonsRatio: Source };
  /** Anything a person should know about the numbers, in plain words. */
  notes: string[];
}

export interface Material {
  id: string;
  name: string;
  /** How it looks in Design and Render (DRAFT, with step 66). */
  appearance?: { colour: string; roughness: number; metalness: number };
  /** What TestLab needs. Absent until someone fills it in. */
  mechanical?: Mechanical;
  /** Presets for the making workspaces, keyed by printer or machine profile (DRAFT). */
  processes?: {
    /** Slice: print settings, per printer profile. */
    print?: Record<string, unknown>;
    /** Laser: power and speed for cut, engrave and score, per machine. */
    laser?: Record<string, { power: number; speed: number; passes: number }>;
  };
  /** Manufacture: stock sizes and how it machines (DRAFT). */
  stock?: { forms: string[]; surfaceSpeed?: number };
}

/** The one materials library: every workspace reads the same Material. */
export interface MaterialLibrary {
  all(): readonly Material[];
  get(id: string): Material | undefined;
}

const MPa = 1e6;
const GPa = 1e9;
/** One pound-force per square inch in pascals: 4.4482216152605 N / (0.0254 m)² (both exact by definition). */
export const PSI = 4.4482216152605 / (0.0254 * 0.0254);

/** Freezes every object inside, so no reader can change a starter material for every other workspace. */
function deepFreeze<T>(x: T): T {
  if (typeof x === "object" && x !== null) {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/** The maker's sheets for the three printed plastics: specimens printed at 100% infill, tested to ISO 527 (tension) and ISO 178 (bending). */
const sheet = (plastic: string, version: string): string => `Maker's technical data sheet ${version} for a ${plastic} filament (printed test bars, 100% infill)`;

/**
 * The rule for a printed plastic's stiffness, the same for all three: the
 * lower of the sheet's tensile (ISO 527) and bending (ISO 178) modulus,
 * each way. Lower is the safe side: the part is shown bending at least as
 * much as it will. (The ABS sheet's tensile modulus, 3800 MPa, is twice its
 * bending modulus and well above other ABS, so the rule takes 1880 MPa.)
 */
export const printedStiffness = (tensile: number, bending: number): number => Math.min(tensile, bending);

const printedNotes = [
  "Measured on test bars printed solid (100% infill); a part with less infill is weaker and bends more.",
  "Strength is where a test bar broke when pulled, not a safe working limit.",
];

/** The five starter materials, with their mechanical numbers and where each came from (TestLab T2). */
export const STARTER_MATERIALS: readonly Material[] = deepFreeze([
  {
    id: "pla",
    name: "PLA",
    mechanical: {
      density: 1240,
      stiffness: { alongLayers: printedStiffness(2680 * MPa, 2750 * MPa), acrossLayers: printedStiffness(2160 * MPa, 2370 * MPa) },
      strength: { alongLayers: 39 * MPa, acrossLayers: 35 * MPa },
      strengthKind: "tensile",
      poissonsRatio: 0.35,
      printed: true,
      sources: {
        density: { document: sheet("PLA", "V2.0"), says: "Density 1.24 g/cm³, ISO 1183" },
        stiffness: { document: sheet("PLA", "V2.0"), says: "Young's modulus 2680 ± 130 MPa (X-Y) and 2160 ± 90 MPa (Z), ISO 527; bending modulus 2750 ± 60 MPa (X-Y) and 2370 ± 50 MPa (Z), ISO 178" },
        strength: { document: sheet("PLA", "V2.0"), says: "Tensile strength 39 ± 2 MPa (X-Y) and 35 ± 3 MPa (Z), ISO 527" },
        poissonsRatio: { document: "Sabik, Rucka, Andrzejewska and Wojtczak, Tensile failure study of 3D printed PLA using DIC technique and FEM analysis, Mechanics of Materials 175 (2022) 104506", says: "Poisson's ratio 0.349 ± 0.009, printed PLA pulled along the raster" },
      },
      notes: printedNotes,
    },
  },
  {
    id: "petg",
    name: "PETG",
    mechanical: {
      density: 1280,
      stiffness: { alongLayers: printedStiffness(1810 * MPa, 2050 * MPa), acrossLayers: printedStiffness(1540 * MPa, 1810 * MPa) },
      strength: { alongLayers: 34 * MPa, acrossLayers: 23 * MPa },
      strengthKind: "tensile",
      poissonsRatio: 0.36,
      printed: true,
      sources: {
        density: { document: sheet("high-flow PETG", "V1.0"), says: "Density 1.28 g/cm³, ISO 1183" },
        stiffness: { document: sheet("high-flow PETG", "V1.0"), says: "Young's modulus 1810 ± 190 MPa (X-Y) and 1540 ± 130 MPa (Z), ISO 527; bending modulus 2050 ± 120 MPa (X-Y) and 1810 ± 140 MPa (Z), ISO 178" },
        strength: { document: sheet("high-flow PETG", "V1.0"), says: "Tensile strength 34 ± 4 MPa (X-Y) and 23 ± 4 MPa (Z), ISO 527" },
        poissonsRatio: { document: "Sabik et al. 2022 for PLA and Cantrell et al., Table II, for ABS (both cited on those materials)", says: "Assumed from printed PLA (0.35) and ABS (0.36 to 0.38): no measurement for printed PETG was found" },
      },
      notes: [...printedNotes, "Poisson's ratio is assumed, not measured for PETG; it changes the bend only a little."],
    },
  },
  {
    id: "abs",
    name: "ABS",
    mechanical: {
      density: 1050,
      stiffness: { alongLayers: printedStiffness(3800 * MPa, 1880 * MPa), acrossLayers: printedStiffness(2960 * MPa, 1590 * MPa) },
      strength: { alongLayers: 41 * MPa, acrossLayers: 32 * MPa },
      strengthKind: "tensile",
      poissonsRatio: 0.36,
      printed: true,
      sources: {
        density: { document: sheet("ABS", "V2.0"), says: "Density 1.05 g/cm³, ISO 1183" },
        stiffness: { document: sheet("ABS", "V2.0"), says: "Young's modulus 3800 ± 190 MPa (X-Y) and 2960 ± 110 MPa (Z), ISO 527; bending modulus 1880 ± 110 MPa (X-Y) and 1590 ± 100 MPa (Z), ISO 178" },
        strength: { document: sheet("ABS", "V2.0"), says: "Tensile strength 41 ± 1 MPa (X-Y) and 32 ± 2 MPa (Z), ISO 527" },
        poissonsRatio: { document: "Cantrell et al., Experimental characterization of the mechanical properties of 3D-printed ABS and polycarbonate parts (University of Florida), Table II", says: "Poisson's ratio 0.36 to 0.38 for printed ABS in every orientation tested" },
      },
      notes: [...printedNotes, "The sheet's pulling stiffness is twice its bending stiffness, so the lower, bending figure is used."],
    },
  },
  {
    id: "aluminium-6061",
    name: "Aluminium 6061-T6",
    mechanical: {
      density: 2700,
      stiffness: { alongLayers: 68.9 * GPa, acrossLayers: 68.9 * GPa },
      strength: { alongLayers: 276 * MPa, acrossLayers: 276 * MPa },
      strengthKind: "yield",
      poissonsRatio: 0.33,
      printed: false,
      sources: {
        density: { document: "Metal supplier's data sheet for aluminium 6061-T6 / 6061-T651", says: "Density 2.7 g/cc" },
        stiffness: { document: "Metal supplier's data sheet for aluminium 6061-T6 / 6061-T651", says: "Modulus of elasticity 68.9 GPa" },
        strength: { document: "Metal supplier's data sheet for aluminium 6061-T6 / 6061-T651", says: "Tensile yield strength 276 MPa" },
        poissonsRatio: { document: "Metal supplier's data sheet for aluminium 6061-T6 / 6061-T651", says: "Poisson's ratio 0.33" },
      },
      notes: ["Typical values for the T6 temper; other tempers are much softer."],
    },
  },
  {
    id: "steel-a36",
    name: "Steel (A36 structural)",
    mechanical: {
      density: 7800,
      stiffness: { alongLayers: 29_000_000 * PSI, acrossLayers: 29_000_000 * PSI },
      strength: { alongLayers: 36_000 * PSI, acrossLayers: 36_000 * PSI },
      strengthKind: "yield",
      poissonsRatio: 0.26,
      printed: false,
      sources: {
        density: { document: "ASTM A36 structural steel, as summarised in its encyclopaedia entry", says: "Density 7.8 g/cm³" },
        stiffness: { document: "ASTM A36 structural steel, as summarised in its encyclopaedia entry", says: "Young's modulus 29,000 ksi (200 GPa)" },
        strength: { document: "ASTM A36 (the standard's minimum for plates, bars and shapes under 8 in thick)", says: "Minimum yield strength 36 ksi (250 MPa)" },
        poissonsRatio: { document: "ASTM A36 structural steel, as summarised in its encyclopaedia entry", says: "Poisson's ratio 0.26" },
      },
      notes: ["The yield strength is the standard's minimum, so real A36 is usually a little stronger."],
    },
  },
] satisfies Material[]);

/**
 * What is wrong with a material's mechanical numbers, in words; empty when
 * nothing is. Every number finite and above 0; Poisson's ratio from 0 up
 * to but not including 0.5 (at 0.5 a solid can't change its volume and the
 * solver's sums divide by zero; below 0 is real only for special lattices).
 */
export function mechanicalProblems(m: Mechanical): string[] {
  const out: string[] = [];
  const positive = (x: number, what: string): void => {
    if (!Number.isFinite(x) || x <= 0) out.push(`${what} must be a number above 0.`);
  };
  positive(m.density, "Density");
  positive(m.stiffness.alongLayers, "Stiffness along the layers");
  positive(m.stiffness.acrossLayers, "Stiffness across the layers");
  positive(m.strength.alongLayers, "Strength along the layers");
  positive(m.strength.acrossLayers, "Strength across the layers");
  if (!Number.isFinite(m.poissonsRatio) || m.poissonsRatio < 0 || m.poissonsRatio >= 0.5) out.push("Poisson's ratio must be from 0 up to, but not including, 0.5.");
  if (!m.printed && (m.stiffness.alongLayers !== m.stiffness.acrossLayers || m.strength.alongLayers !== m.strength.acrossLayers)) out.push("A material that isn't printed is the same both ways.");
  return out;
}

/** The weaker way of a material: the stiffness and strength TestLab uses until it knows the build direction. */
export function weakerWay(m: Mechanical): { stiffness: number; strength: number } {
  return { stiffness: Math.min(m.stiffness.alongLayers, m.stiffness.acrossLayers), strength: Math.min(m.strength.alongLayers, m.strength.acrossLayers) };
}

const library: MaterialLibrary = {
  all: () => STARTER_MATERIALS,
  get: (id) => STARTER_MATERIALS.find((m) => m.id === id),
};

/** The materials library: the starter materials (a project's own materials come with step 66, I3). */
export function materialLibrary(): MaterialLibrary {
  return library;
}
