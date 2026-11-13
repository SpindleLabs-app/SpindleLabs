import { test } from "node:test";
import assert from "node:assert/strict";
import { materialLibrary, mechanicalProblems, weakerWay, printedStiffness, STARTER_MATERIALS, PSI, type Mechanical } from "../src/model/material.ts";

const mech = (id: string): Mechanical => {
  const m = materialLibrary().get(id)?.mechanical;
  assert.ok(m, `${id} has mechanical numbers`);
  return m;
};

test("the library holds the five starter materials, each with checked mechanical numbers and a source for every one", () => {
  assert.deepEqual(materialLibrary().all().map((m) => m.id), ["pla", "petg", "abs", "aluminium-6061", "steel-a36"]);
  for (const m of STARTER_MATERIALS) {
    assert.deepEqual(mechanicalProblems(m.mechanical!), [], m.id);
    for (const [what, s] of Object.entries(m.mechanical!.sources)) assert.ok(s.document.length > 10 && s.says.length > 3, `${m.id} ${what} says where it came from`);
  }
  assert.equal(materialLibrary().get("wood"), undefined);
  assert.equal(materialLibrary(), materialLibrary(), "one library");
});

test("hand-worked: each number is the sheet's figure turned into SI units", () => {
  // PLA sheet: density 1.24 g/cm³ = 1.24 × 1000 kg/m³ = 1240 kg/m³; tensile 39 MPa (X-Y), 35 MPa (Z);
  // stiffness the lower of tensile and bending modulus each way: X-Y min(2680, 2750) = 2680 MPa, Z min(2160, 2370) = 2160 MPa.
  const pla = mech("pla");
  assert.equal(pla.density, 1240);
  assert.deepEqual(pla.stiffness, { alongLayers: 2.68e9, acrossLayers: 2.16e9 });
  assert.deepEqual(pla.strength, { alongLayers: 39e6, acrossLayers: 35e6 });
  // PETG sheet: 1.28 g/cm³; X-Y min(1810, 2050) = 1810 MPa, Z min(1540, 1810) = 1540 MPa; 34 and 23 MPa.
  const petg = mech("petg");
  assert.equal(petg.density, 1280);
  assert.deepEqual(petg.stiffness, { alongLayers: 1.81e9, acrossLayers: 1.54e9 });
  assert.deepEqual(petg.strength, { alongLayers: 34e6, acrossLayers: 23e6 });
  // ABS sheet: 1.05 g/cm³; X-Y min(3800, 1880) = 1880 MPa (the bending figure), Z min(2960, 1590) = 1590 MPa; 41 and 32 MPa.
  const abs = mech("abs");
  assert.equal(abs.density, 1050);
  assert.deepEqual(abs.stiffness, { alongLayers: 1.88e9, acrossLayers: 1.59e9 });
  assert.deepEqual(abs.strength, { alongLayers: 41e6, acrossLayers: 32e6 });
  // Aluminium 6061-T6: 2.7 g/cc = 2700 kg/m³, 68.9 GPa, yield 276 MPa, ν 0.33, the same both ways.
  const al = mech("aluminium-6061");
  assert.deepEqual([al.density, al.stiffness.alongLayers, al.stiffness.acrossLayers, al.strength.alongLayers, al.poissonsRatio, al.printed], [2700, 68.9e9, 68.9e9, 276e6, 0.33, false]);
  // A36: 1 psi = 4.4482216152605 N / 0.00064516 m² = 6894.757293168 Pa; minimum yield 36,000 psi = 248.2112625540 MPa
  // (the encyclopaedia rounds it to 250); E 29,000,000 psi = 199.948 GPa (rounded there to 200).
  const steel = mech("steel-a36");
  assert.ok(Math.abs(PSI - 6894.757293168) < 1e-6);
  assert.ok(Math.abs(steel.strength.alongLayers - 248.2112625540e6) < 1);
  assert.ok(Math.abs(steel.stiffness.alongLayers - 199.948e9) < 1e6);
  assert.deepEqual([steel.density, steel.poissonsRatio, steel.strengthKind], [7800, 0.26, "yield"]);
  // Plastics break rather than yield, so their strength is the sheet's tensile strength.
  assert.deepEqual([pla.strengthKind, petg.strengthKind, abs.strengthKind], ["tensile", "tensile", "tensile"]);
});

test("the weaker way is what TestLab uses until it knows the build direction", () => {
  assert.deepEqual(weakerWay(mech("pla")), { stiffness: 2.16e9, strength: 35e6 });
  assert.deepEqual(weakerWay(mech("petg")), { stiffness: 1.54e9, strength: 23e6 });
  assert.deepEqual(weakerWay(mech("aluminium-6061")), { stiffness: 68.9e9, strength: 276e6 });
  assert.equal(printedStiffness(5, 3), 3);
  assert.equal(printedStiffness(3, 5), 3);
});

test("every number broken is refused in words", () => {
  const good = mech("pla");
  const bad = (change: Partial<Mechanical>): string[] => mechanicalProblems({ ...good, ...change });
  assert.deepEqual(bad({ density: 0 }), ["Density must be a number above 0."]);
  assert.deepEqual(bad({ density: Number.NaN }), ["Density must be a number above 0."]);
  assert.deepEqual(bad({ stiffness: { alongLayers: -1, acrossLayers: 1 } }), ["Stiffness along the layers must be a number above 0."]);
  assert.deepEqual(bad({ stiffness: { alongLayers: 1, acrossLayers: Infinity } }), ["Stiffness across the layers must be a number above 0."]);
  assert.deepEqual(bad({ strength: { alongLayers: 0, acrossLayers: 1 } }), ["Strength along the layers must be a number above 0."]);
  assert.deepEqual(bad({ strength: { alongLayers: 1, acrossLayers: 0 } }), ["Strength across the layers must be a number above 0."]);
  assert.deepEqual(bad({ poissonsRatio: -0.01 }), ["Poisson's ratio must be from 0 up to, but not including, 0.5."]);
  assert.deepEqual(bad({ poissonsRatio: 0.5 }), ["Poisson's ratio must be from 0 up to, but not including, 0.5."]);
  assert.deepEqual(bad({ printed: false }), ["A material that isn't printed is the same both ways."]);
  assert.deepEqual(mechanicalProblems({ ...mech("steel-a36"), strength: { alongLayers: 1, acrossLayers: 2 } }), ["A material that isn't printed is the same both ways."]);
});

test("Poisson's ratio at 0.9× and 1.1× of the 0.5 limit", () => {
  const good = mech("pla");
  assert.deepEqual(mechanicalProblems({ ...good, poissonsRatio: 0.45 }), []); // 0.9 × 0.5
  assert.equal(mechanicalProblems({ ...good, poissonsRatio: 0.55 }).length, 1); // 1.1 × 0.5
  assert.deepEqual(mechanicalProblems({ ...good, poissonsRatio: 0 }), []);
});

test("the starter materials can't be changed by whoever reads them", () => {
  assert.ok(Object.isFrozen(STARTER_MATERIALS));
  assert.throws(() => (STARTER_MATERIALS as unknown as unknown[]).push({}));
  const pla = STARTER_MATERIALS[0].mechanical as { density: number; stiffness: { alongLayers: number }; notes: string[] };
  assert.throws(() => { pla.density = 1; });
  assert.throws(() => { pla.stiffness.alongLayers = 1; });
  assert.throws(() => pla.notes.push("x"));
  assert.equal(mech("pla").density, 1240);
});

test("each starter material shows its name and, for every number, the document it came from and what that document says", () => {
  // Written out from the documents themselves (not read back from the code): the three plastics cite the maker's
  // sheet for their filament (PLA and ABS sheet V2.0, high-flow PETG V1.0), printed bars at 100% infill.
  const sheet = (plastic: string, version: string) => `Maker's technical data sheet ${version} for a ${plastic} filament (printed test bars, 100% infill)`;
  const pla = sheet("PLA", "V2.0");
  const petg = sheet("high-flow PETG", "V1.0");
  const abs = sheet("ABS", "V2.0");
  const alu = "Metal supplier's data sheet for aluminium 6061-T6 / 6061-T651";
  const a36 = "ASTM A36 structural steel, as summarised in its encyclopaedia entry";
  assert.equal(pla, "Maker's technical data sheet V2.0 for a PLA filament (printed test bars, 100% infill)");
  assert.equal(petg, "Maker's technical data sheet V1.0 for a high-flow PETG filament (printed test bars, 100% infill)");
  const printed = [
    "Measured on test bars printed solid (100% infill); a part with less infill is weaker and bends more.",
    "Strength is where a test bar broke when pulled, not a safe working limit.",
  ];
  const expected = {
    pla: {
      name: "PLA",
      sources: {
        density: { document: pla, says: "Density 1.24 g/cm³, ISO 1183" },
        stiffness: { document: pla, says: "Young's modulus 2680 ± 130 MPa (X-Y) and 2160 ± 90 MPa (Z), ISO 527; bending modulus 2750 ± 60 MPa (X-Y) and 2370 ± 50 MPa (Z), ISO 178" },
        strength: { document: pla, says: "Tensile strength 39 ± 2 MPa (X-Y) and 35 ± 3 MPa (Z), ISO 527" },
        poissonsRatio: { document: "Sabik, Rucka, Andrzejewska and Wojtczak, Tensile failure study of 3D printed PLA using DIC technique and FEM analysis, Mechanics of Materials 175 (2022) 104506", says: "Poisson's ratio 0.349 ± 0.009, printed PLA pulled along the raster" },
      },
      notes: printed,
    },
    petg: {
      name: "PETG",
      sources: {
        density: { document: petg, says: "Density 1.28 g/cm³, ISO 1183" },
        stiffness: { document: petg, says: "Young's modulus 1810 ± 190 MPa (X-Y) and 1540 ± 130 MPa (Z), ISO 527; bending modulus 2050 ± 120 MPa (X-Y) and 1810 ± 140 MPa (Z), ISO 178" },
        strength: { document: petg, says: "Tensile strength 34 ± 4 MPa (X-Y) and 23 ± 4 MPa (Z), ISO 527" },
        poissonsRatio: { document: "Sabik et al. 2022 for PLA and Cantrell et al., Table II, for ABS (both cited on those materials)", says: "Assumed from printed PLA (0.35) and ABS (0.36 to 0.38): no measurement for printed PETG was found" },
      },
      notes: [...printed, "Poisson's ratio is assumed, not measured for PETG; it changes the bend only a little."],
    },
    abs: {
      name: "ABS",
      sources: {
        density: { document: abs, says: "Density 1.05 g/cm³, ISO 1183" },
        stiffness: { document: abs, says: "Young's modulus 3800 ± 190 MPa (X-Y) and 2960 ± 110 MPa (Z), ISO 527; bending modulus 1880 ± 110 MPa (X-Y) and 1590 ± 100 MPa (Z), ISO 178" },
        strength: { document: abs, says: "Tensile strength 41 ± 1 MPa (X-Y) and 32 ± 2 MPa (Z), ISO 527" },
        poissonsRatio: { document: "Cantrell et al., Experimental characterization of the mechanical properties of 3D-printed ABS and polycarbonate parts (University of Florida), Table II", says: "Poisson's ratio 0.36 to 0.38 for printed ABS in every orientation tested" },
      },
      notes: [...printed, "The sheet's pulling stiffness is twice its bending stiffness, so the lower, bending figure is used."],
    },
    "aluminium-6061": {
      name: "Aluminium 6061-T6",
      sources: {
        density: { document: alu, says: "Density 2.7 g/cc" },
        stiffness: { document: alu, says: "Modulus of elasticity 68.9 GPa" },
        strength: { document: alu, says: "Tensile yield strength 276 MPa" },
        poissonsRatio: { document: alu, says: "Poisson's ratio 0.33" },
      },
      notes: ["Typical values for the T6 temper; other tempers are much softer."],
    },
    "steel-a36": {
      name: "Steel (A36 structural)",
      sources: {
        density: { document: a36, says: "Density 7.8 g/cm³" },
        stiffness: { document: a36, says: "Young's modulus 29,000 ksi (200 GPa)" },
        strength: { document: "ASTM A36 (the standard's minimum for plates, bars and shapes under 8 in thick)", says: "Minimum yield strength 36 ksi (250 MPa)" },
        poissonsRatio: { document: a36, says: "Poisson's ratio 0.26" },
      },
      notes: ["The yield strength is the standard's minimum, so real A36 is usually a little stronger."],
    },
  };
  assert.deepEqual(Object.keys(expected), materialLibrary().all().map((m) => m.id));
  for (const [id, want] of Object.entries(expected)) {
    const m = materialLibrary().get(id);
    assert.equal(m?.name, want.name, id);
    assert.deepEqual(mech(id).sources, want.sources, `${id}: where each number came from`);
    assert.deepEqual(mech(id).notes, want.notes, `${id}: notes`);
  }
  // Each number stored is the figure its source states, in SI: g/cm³ (and g/cc) × 1000 = kg/m³; 1.24 → 1240,
  // 1.28 → 1280, 1.05 → 1050, 2.7 → 2700, 7.8 → 7800.
  for (const m of STARTER_MATERIALS) {
    const says = m.mechanical!.sources.density.says;
    const figure = Number(/Density ([\d.]+) g\/c/.exec(says)?.[1]);
    assert.equal(Math.round(figure * 1000), m.mechanical!.density, `${m.id}: ${says}`);
  }
});

test("a material that isn't printed is refused when only its stiffness differs between the two ways", () => {
  // Steel with equal strength both ways but 200 GPa along and 190 GPa across: a metal has no layers, so the
  // two ways must agree for stiffness on its own, not only for strength.
  const steel = mech("steel-a36");
  assert.deepEqual(mechanicalProblems({ ...steel, stiffness: { alongLayers: 200e9, acrossLayers: 190e9 } }), ["A material that isn't printed is the same both ways."]);
  assert.deepEqual(mechanicalProblems({ ...steel, stiffness: { alongLayers: 200e9, acrossLayers: 200e9 } }), []);
});
