// TestLab's material words (materials.ts): what a study made of each starter material is told, worked by hand from the sheets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { materialLibrary } from "@fission/core";
import { materialWords, mpaWords, sourceLines, testMaterials } from "../src/materials.ts";

const mech = (id: string) => materialLibrary().get(id)!.mechanical!;

test("megapascals in words: whole from 100, three figures below", () => {
  assert.equal(mpaWords(35e6), "35 MPa");
  assert.equal(mpaWords(2.16e9), "2,160 MPa");
  assert.equal(mpaWords(68.9e9), "68,900 MPa");
  assert.equal(mpaWords(248.2112625540e6), "248 MPa");
  assert.equal(mpaWords(1.234e6), "1.23 MPa");
  assert.equal(mpaWords(99.94e6), "99.9 MPa");
});

test("hand-worked: a printed material is said by its weaker way, across the layers, with the other way beside it", () => {
  // PLA: across the layers min(2160, 2370) = 2160 MPa and 35 MPa; along them min(2680, 2750) = 2680 MPa and 39 MPa; 1240 kg/m³ = 1.24 g/cm³.
  assert.equal(
    materialWords(mech("pla")),
    "Stiffness 2,160 MPa, breaking strength 35 MPa, 1.24 g/cm³. These are the weaker numbers, across the layers (along them: 2,680 MPa and 39 MPa), used until TestLab knows which way the part is printed.",
  );
  // ABS: across min(2960, 1590) = 1590 MPa, 32 MPa; along min(3800, 1880) = 1880 MPa, 41 MPa; 1.05 g/cm³.
  assert.match(materialWords(mech("abs")), /^Stiffness 1,590 MPa, breaking strength 32 MPa, 1\.05 g\/cm³\. .*along them: 1,880 MPa and 41 MPa/);
  // A metal is one way: aluminium 68.9 GPa = 68,900 MPa, yield 276 MPa, 2.7 g/cm³.
  assert.equal(materialWords(mech("aluminium-6061")), "Stiffness 68,900 MPa, yield strength 276 MPa, 2.7 g/cm³.");
  // A36: 36 ksi = 248.2 MPa, said whole; 29,000 ksi = 199,948 MPa; 7.8 g/cm³.
  assert.equal(materialWords(mech("steel-a36")), "Stiffness 199,948 MPa, yield strength 248 MPa, 7.8 g/cm³.");
});

test("every number's source is said, with the document it came from", () => {
  for (const m of testMaterials()) {
    const lines = sourceLines(m.mechanical!);
    assert.equal(lines.length, 4, m.id);
    assert.match(lines[0], /^Density: /);
    assert.match(lines[3], new RegExp(`^Poisson's ratio ${m.mechanical!.poissonsRatio}: `));
    for (const l of lines) assert.match(l, /\(.{10,}\)\.$/, `${m.id}: ${l}`);
  }
  assert.match(sourceLines(mech("petg"))[3], /Assumed from printed PLA \(0\.35\) and ABS/);
  assert.deepEqual(testMaterials().map((m) => m.name), ["PLA", "PETG", "ABS", "Aluminium 6061-T6", "Steel (A36 structural)"]);
});
