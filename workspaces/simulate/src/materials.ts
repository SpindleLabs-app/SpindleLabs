// The materials a study can be made of, in words (TestLab T2): the one
// materials library's starter materials (core material.ts), each said with
// the numbers TestLab will use and where every number came from, so nobody
// has to trust a figure they can't check.

import { materialLibrary, weakerWay, type Material, type Mechanical } from "@fission/core";

/** The materials a study can be made of: those in the library with mechanical numbers, in the library's order. */
export const testMaterials = (): Material[] => materialLibrary().all().filter((m) => m.mechanical !== undefined);

/** Pascals as megapascals in words: whole MPa from 100, else three significant figures ("35 MPa", "1,880 MPa", "68,900 MPa"). */
export function mpaWords(pa: number): string {
  const mpa = pa / 1e6;
  return Math.abs(mpa) >= 100 ? `${Math.round(mpa).toLocaleString("en")} MPa` : `${Number(mpa.toPrecision(3)).toLocaleString("en")} MPa`;
}

/**
 * What TestLab uses of a material, in one or two sentences: the stiffness
 * and strength (the weaker way for a printed one, said so), its density.
 */
export function materialWords(m: Mechanical): string {
  const weak = weakerWay(m);
  const strength = m.strengthKind === "yield" ? "yield strength" : "breaking strength";
  const both = `Stiffness ${mpaWords(weak.stiffness)}, ${strength} ${mpaWords(weak.strength)}, ${(m.density / 1000).toLocaleString("en", { maximumFractionDigits: 3 })} g/cm³.`;
  if (!m.printed) return both;
  return `${both} These are the weaker numbers, across the layers (along them: ${mpaWords(m.stiffness.alongLayers)} and ${mpaWords(m.strength.alongLayers)}), used until TestLab knows which way the part is printed.`;
}

/** Each number's source, one line each: "Stiffness: <what the document says> (<document>)". */
export function sourceLines(m: Mechanical): string[] {
  const s = m.sources;
  return [
    `Density: ${s.density.says} (${s.density.document}).`,
    `Stiffness: ${s.stiffness.says} (${s.stiffness.document}).`,
    `Strength: ${s.strength.says} (${s.strength.document}).`,
    `Poisson's ratio ${m.poissonsRatio}: ${s.poissonsRatio.says} (${s.poissonsRatio.document}).`,
  ];
}
