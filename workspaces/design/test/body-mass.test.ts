import { test } from "node:test";
import assert from "node:assert/strict";
import { materialLibrary, type BodyView } from "@fission/core";
import { DEFAULT_MASS_MATERIAL, GRAMS_PER_OUNCE, GRAMS_PER_POUND, MASS_MATERIAL_KEY, densityWords, massGrams, massMaterials, massShown, massWords, readMassMaterial, writeMassMaterial, type MaterialStorage } from "../src/body-mass.ts";
import { propertiesPanel } from "../src/properties.ts";
import { boxView } from "./views.ts";

const material = (id: string) => {
  const m = materialLibrary().get(id);
  assert.ok(m?.mechanical, id);
  return m;
};

test("hand-worked masses, the working shown", () => {
  // A 20 mm PLA cube: 20³ = 8000 mm³ = 8 cm³; PLA is 1.24 g/cm³ (its data sheet), so 8 × 1.24 = 9.92 g.
  assert.equal(massShown(8000, material("pla"), "mm"), "9.92 g");
  // The default 40 × 30 × 20 box in A36 steel: 24000 mm³ = 24 cm³ × 7.8 g/cm³ = 187.2 g, said to three figures: 187 g.
  assert.equal(massShown(24000, material("steel-a36"), "mm"), "187 g");
  // The same box in inches: 187.2 g / 28.349523125 g a ounce = 6.6033… oz, three figures 6.60, said 6.6 oz.
  assert.equal(massShown(24000, material("steel-a36"), "in"), "6.6 oz");
  // A 100 mm aluminium 6061 cube: 1000 cm³ × 2.7 g/cm³ = 2700 g = 2.7 kg; in pounds 2700 / 453.59237 = 5.9525… lb.
  assert.equal(massShown(1e6, material("aluminium-6061"), "mm"), "2.7 kg");
  assert.equal(massShown(1e6, material("aluminium-6061"), "in"), "5.95 lb");
  // A cylinder 10 mm across, 50 mm long in PETG: π × 5² × 50 = 3926.99 mm³ = 3.92699 cm³ × 1.28 g/cm³ = 5.0265 g.
  assert.equal(massShown(Math.PI * 25 * 50, material("petg"), "mm"), "5.03 g");
  // ABS at 1.05 g/cm³, 1 cm³ (1000 mm³): 1.05 g.
  assert.equal(massGrams(1000, 1050), 1.05);
});

test("the ounce and the pound are the exact international ones", () => {
  // 1 lb = 0.45359237 kg exactly (1959), 16 oz to the pound: 1 oz = 28.349523125 g.
  assert.equal(GRAMS_PER_POUND, 453.59237);
  assert.equal(GRAMS_PER_OUNCE, 28.349523125);
});

test("where the words change unit: grams to kilograms, ounces to pounds, by the number as rounded", () => {
  assert.equal(massWords(999.4, "mm"), "999 g");
  // 999.6 g rounds to 1000 g at three figures, so it is said in kilograms: 0.9996 kg, three figures 1.00.
  assert.equal(massWords(999.6, "mm"), "1 kg");
  assert.equal(massWords(1000, "mm"), "1 kg");
  assert.equal(massWords(15.9 * GRAMS_PER_OUNCE, "in"), "15.9 oz");
  // 16 oz is a pound.
  assert.equal(massWords(16 * GRAMS_PER_OUNCE, "in"), "1 lb");
  assert.equal(massWords(GRAMS_PER_POUND * 2.5, "in"), "2.5 lb");
});

test("the kernel's whole range of sizes: a 1 µm cube to a 1 km cube", () => {
  // 1 µm = 0.001 mm, so 1e-9 mm³ of PLA: 1e-9 × 1240 × 1e-6 = 1.24e-12 g.
  assert.equal(massWords(massGrams(1e-9, 1240)!, "mm"), "1.24 × 10⁻¹² g");
  // 1 km = 1e6 mm, so 1e18 mm³ of steel: 1e18 × 7800 × 1e-6 = 7.8e15 g = 7.8e12 kg.
  assert.equal(massWords(massGrams(1e18, 7800)!, "mm"), "7.8 × 10¹² kg");
});

test("no made-up mass: nothing positive and finite gives none", () => {
  for (const [v, d] of [[0, 1240], [-8000, 1240], [Number.NaN, 1240], [Infinity, 1240], [8000, 0], [8000, -1], [8000, Number.NaN]]) {
    assert.equal(massGrams(v, d), null, `${v} mm³ at ${d} kg/m³`);
  }
  assert.equal(massShown(0, material("pla"), "mm"), "—");
  assert.equal(massShown(8000, { id: "x", name: "No numbers" }, "mm"), "—");
});

test("seeded: grams agree with cm³ × g/cm³ worked another way, and the words read back within three figures", () => {
  let seed = Number(process.env.FISSION_SEED ?? 66);
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 2000; i++) {
    const volume = 10 ** (rand() * 27 - 9); // 1e-9 to 1e18 mm³
    const density = 500 + rand() * 9500; // kg/m³
    const unit = rand() < 0.5 ? "mm" : "in";
    // Another way: mm³ / 1000 is cm³, kg/m³ / 1000 is g/cm³.
    const want = (volume / 1000) * (density / 1000);
    const got = massGrams(volume, density)!;
    assert.ok(Math.abs(got - want) <= 1e-12 * want, `seed ${seed}: ${got} vs ${want}`);
    const words = massWords(got, unit);
    const m = /^([\d.,]+)(?: × 10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))? (g|kg|oz|lb)$/.exec(words);
    assert.ok(m, words);
    const sup = "⁰¹²³⁴⁵⁶⁷⁸⁹";
    const exp = m[2] ? Number([...m[2]].map((c) => (c === "⁻" ? "-" : String(sup.indexOf(c)))).join("")) : 0;
    const per = { g: 1, kg: 1000, oz: GRAMS_PER_OUNCE, lb: GRAMS_PER_POUND }[m[3] as "g"];
    const back = Number(m[1].replace(/,/g, "")) * 10 ** exp * per;
    assert.ok(Math.abs(back - got) <= 0.005 * got, `${words} for ${got} g`);
    assert.ok(unit === "mm" ? /g$/.test(words) : /(oz|lb)$/.test(words), `${words} in ${unit}`);
  }
});

/** A storage in memory, optionally one that throws on every call. */
function memory(throws = false): MaterialStorage & { kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (k) => {
      if (throws) throw new Error("storage off");
      return kept.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (throws) throw new Error("storage full");
      kept.set(k, v);
    },
  };
}

test("the material picked is kept in the browser, PLA when nothing usable is kept", () => {
  const s = memory();
  assert.equal(readMassMaterial(s).id, DEFAULT_MASS_MATERIAL);
  writeMassMaterial("steel-a36", s);
  assert.equal(s.kept.get(MASS_MATERIAL_KEY), "steel-a36");
  assert.equal(readMassMaterial(s).id, "steel-a36");
  s.kept.set(MASS_MATERIAL_KEY, "unobtainium");
  assert.equal(readMassMaterial(s).id, "pla", "a material no longer in the library");
  assert.equal(readMassMaterial(memory(true)).id, "pla", "storage that throws");
  assert.equal(readMassMaterial(null).id, "pla", "no storage");
  writeMassMaterial("abs", memory(true)); // never throws
});

test("every material offered has a density and says where it came from", () => {
  const all = massMaterials();
  assert.deepEqual(all.map((m) => m.id), ["pla", "petg", "abs", "aluminium-6061", "steel-a36"]);
  for (const m of all) assert.ok(m.mechanical!.density > 0, m.id);
  assert.equal(densityWords(material("pla")).startsWith("PLA: 1.24 g/cm³ (Density 1.24 g/cm³, ISO 1183; "), true, densityWords(material("pla")));
});

const { Window } = await import("happy-dom");

function panelIn(win: InstanceType<typeof Window>) {
  const doc = win.document as unknown as Document;
  const slot = doc.createElement("aside");
  doc.body.append(slot);
  const p = propertiesPanel(slot);
  const $ = <T extends HTMLElement>(id: string) => slot.querySelector<T>(`#${id}`)!;
  return { p, $, doc };
}

test("Body facts: the mass row follows the body, the material picked and the unit", () => {
  const win = new Window();
  const { p, $, doc } = panelIn(win);
  const choice = $<HTMLSelectElement>("mass-material");
  assert.equal(choice.value, "pla");
  assert.deepEqual([...choice.options].map((o) => o.textContent), ["PLA", "PETG", "ABS", "Aluminium 6061-T6", "Steel (A36 structural)"]);
  // A 20 mm cube: 8000 mm³, worked above: 9.92 g of PLA.
  const cube: BodyView = { ...boxView(20, 20, 20), volume: 8000, area: 2400, errors: [] } as BodyView;
  p.showBody(cube, "Body 1");
  assert.equal($("mass").textContent, "9.92 g");
  assert.match($("mass").title, /infill weighs less/);
  // Steel: 8 cm³ × 7.8 g/cm³ = 62.4 g.
  choice.value = "steel-a36";
  choice.dispatchEvent(new win.Event("change"));
  assert.equal($("mass").textContent, "62.4 g");
  assert.match(choice.title, /7\.8 g\/cm³/);
  // Inches: 62.4 / 28.349523125 = 2.2011 oz.
  doc.documentElement.dataset.unit = "in";
  doc.dispatchEvent(new win.Event("unitchange"));
  assert.equal($("mass").textContent, "2.2 oz");
  p.showNoBody();
  assert.equal($("mass").textContent, "—");
  // A new panel on the same page (Design mounted again) keeps the pick; nothing went into the design.
  const again = panelIn(win);
  assert.equal(again.$<HTMLSelectElement>("mass-material").value, "steel-a36");
  again.p.showBody(cube, "Body 1");
  assert.equal(again.$("mass").textContent, "2.2 oz");
});
