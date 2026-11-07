// The weight and cost badge after a slice (Ben, 2026-11-04): "About 12 g of
// PLA, A$0.30, 1 h 20 min", with a price per kg the user can change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { costWords, DEFAULT_PRICE_PER_KG, MAX_PRICE_PER_KG, money, PRICE_KEY, readPrice, rememberedPrice } from "../src/print-cost.ts";

test("hand-worked: 12 g at A$25 a kg printing 80 minutes reads as Ben's example", () => {
  // 12 g is 0.012 kg; 0.012 × 25 = 0.30 dollars. 4,800 s is 80 min, one hour and 20 minutes.
  assert.equal(costWords({ filamentG: 12, printTimeS: 4800 }, 25), "About 12 g of PLA, A$0.30, 1 h 20 min of printing");
  // 3.46 g (under 10 g: one decimal, as the slice's own words) at A$32.50: 0.00346 × 32.5 = 0.11245, so A$0.11; 150 s is 2.5 min, rounded to 3.
  assert.equal(costWords({ filamentG: 3.46, printTimeS: 150 }, 32.5), "About 3.5 g of PLA, A$0.11, 3 min of printing");
  // 1,000 g at the default: one whole kilogram costs the price itself.
  assert.equal(costWords({ filamentG: 1000, printTimeS: 3600 }, DEFAULT_PRICE_PER_KG), `About 1000 g of PLA, A$${DEFAULT_PRICE_PER_KG.toFixed(2)}, 1 h of printing`);
});

test("money: cents to two places, a part costing less than half a cent says so", () => {
  assert.equal(money(0.3), "A$0.30");
  assert.equal(money(12.346), "A$12.35"); // 1234.6 cents, to the nearest cent
  assert.equal(money(0.004), "under A$0.01");
  assert.equal(money(0.005), "A$0.01");
});

test("no time from the engine leaves the time out; a weight that isn't a number gives no badge", () => {
  assert.equal(costWords({ filamentG: 12, printTimeS: Number.NaN }, 25), "About 12 g of PLA, A$0.30");
  assert.equal(costWords({ filamentG: Number.NaN, printTimeS: 60 }, 25), null);
  assert.equal(costWords({ filamentG: -1, printTimeS: 60 }, 25), null);
});

test("the price box reads a positive price up to the limit, with or without A$ or $, else refuses it", () => {
  assert.equal(readPrice("25"), 25);
  assert.equal(readPrice(" A$32.50 "), 32.5);
  assert.equal(readPrice("$19.9"), 19.9);
  for (const bad of ["", "0", "-5", "abc", "1e400", "NaN"]) assert.equal(readPrice(bad), null, bad);
  // The limit, A$1,000 a kg: 0.9× it reads, 1.1× it is refused.
  assert.equal(readPrice(String(0.9 * MAX_PRICE_PER_KG)), 0.9 * MAX_PRICE_PER_KG);
  assert.equal(readPrice(String(1.1 * MAX_PRICE_PER_KG)), null);
  assert.equal(readPrice(String(MAX_PRICE_PER_KG)), MAX_PRICE_PER_KG);
});

test("the price is remembered in the browser; nothing stored, something unreadable, or storage blocked gives the default", () => {
  const store = (v: string | null) => ({ getItem: (k: string) => (k === PRICE_KEY ? v : null), setItem() {} }) as unknown as Storage;
  assert.equal(rememberedPrice(store("40")), 40);
  assert.equal(rememberedPrice(store(null)), DEFAULT_PRICE_PER_KG);
  assert.equal(rememberedPrice(store("lots")), DEFAULT_PRICE_PER_KG);
  assert.equal(rememberedPrice(null), DEFAULT_PRICE_PER_KG);
  const blocked = { getItem() { throw new Error("blocked"); } } as unknown as Storage;
  assert.equal(rememberedPrice(blocked), DEFAULT_PRICE_PER_KG);
});
