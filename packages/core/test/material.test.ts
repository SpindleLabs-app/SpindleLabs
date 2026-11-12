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
