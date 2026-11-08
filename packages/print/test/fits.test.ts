// Fits that know your printer (fits.ts): the profile from a measured test
// piece, the sizes to print, the fit tables and the profile kept in this
// browser. Hand-worked cases first (working shown), then the limits at 0.9×
// and 1.1×, then seeded random printers against a simple closed-form model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { allowanceAt, FIT_CHOICES, fitId, fitOfId, fitTag, isFit, fitSizes, fitKey, forgetMeasures, keepMeasures, keptMeasures, LIMITS, METRIC, PIECE, printedSize, printsAs, profileFor, profileOf, profileWords, sizesWords, targetSize, TYPICAL_PROFILE, type Fit, type FitMeasures, type FitProfile } from "../src/fits.ts";

/** The piece a printer with shrink s, outsides growing e and holes closing c (per side, at 5, 10, 15 mm) would print. */
function piece(s: number, e: readonly [number, number, number], c: readonly [number, number, number]): FitMeasures {
  return {
    length: s * PIECE.length + 2 * e[2],
    pegs: PIECE.sizes.map((d, i) => s * d + 2 * e[i]!) as unknown as [number, number, number],
    holes: PIECE.sizes.map((d, i) => s * d - 2 * c[i]!) as unknown as [number, number, number],
  };
}

const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b} (within ${tol})`);
const ok = (p: FitProfile | { refused: string }): FitProfile => {
  assert.ok(!("refused" in p), "refused" in p ? p.refused : "");
  return p as FitProfile;
};

// The worked printer: shrink 99.6 %, outsides +0.20, +0.15, +0.12 mm a side, holes −0.25, −0.20, −0.15 mm a side.
// Its piece, by hand:
//   length  0.996·120 + 2·0.12 = 119.52 + 0.24 = 119.76
//   peg 15  0.996·15 + 0.24 = 14.94 + 0.24 = 15.18;  peg 10  9.96 + 0.30 = 10.26;  peg 5  4.98 + 0.40 = 5.38
//   hole 15 14.94 − 0.30 = 14.64;  hole 10  9.96 − 0.40 = 9.56;  hole 5  4.98 − 0.50 = 4.48
const WORKED: FitMeasures = { length: 119.76, pegs: [5.38, 10.26, 15.18], holes: [4.48, 9.56, 14.64] };

test("hand-worked: the worked printer's piece gives back its shrink and allowances", () => {
  const p = ok(profileOf(WORKED));
  // s = (119.76 − 15.18) / 105 = 104.58 / 105 = 0.996
  close(p.scale, 0.996, 1e-12);
  // e_5 = (5.38 − 4.98) / 2 = 0.20, e_10 = (10.26 − 9.96) / 2 = 0.15, e_15 = (15.18 − 14.94) / 2 = 0.12
  [0.2, 0.15, 0.12].forEach((e, i) => close(p.pegGrow[i]!, e, 1e-12));
  // c_5 = (4.98 − 4.48) / 2 = 0.25, c_10 = (9.96 − 9.56) / 2 = 0.20, c_15 = (14.94 − 14.64) / 2 = 0.15
  [0.25, 0.2, 0.15].forEach((c, i) => close(p.holeShrink[i]!, c, 1e-12));
  assert.equal(p.measured, true);
});

test("hand-worked: an M3 bolt's clearance hole, an 8 mm printed peg's slide fit and a 12 mm pin's press fit", () => {
  const p = ok(profileOf(WORKED));
  // M3 normal clearance (ISO 273 medium) is 3.4 mm. Under 5 mm the hole closes a flat 0.25 a side:
  // 0.996·d − 0.5 = 3.4, d = 3.9 / 0.996 = 3.915662650…
  const m3 = fitSizes(p, { role: "hole", kind: "bolt-normal" }, 3);
  assert.ok(!("refused" in m3));
  close(m3.target, 3.4, 1e-12);
  close(m3.printed, 3.9 / 0.996);
  close(m3.printed, 3.91566265, 1e-8);
  // An 8 mm peg into a printed hole, slide: it takes half the 0.15 gap, so it should come out 7.925. Between 5 and
  // 10 mm the outside grows e(d) = 0.20 − 0.01·(d − 5), so 0.996·d + 0.40 − 0.02·(d − 5) = 7.925,
  // 0.976·d + 0.50 = 7.925, d = 7.425 / 0.976 = 7.607581967…
  const peg = fitSizes(p, { role: "peg", kind: "slide", partner: "printed" }, 8);
  assert.ok(!("refused" in peg));
  close(peg.target, 7.925, 1e-12);
  close(peg.printed, 7.6075819672, 1e-9);
  // A 12 mm metal pin pressed in: the hole should come out 12.00. Between 10 and 15 mm the hole closes
  // c(d) = 0.20 − 0.01·(d − 10), so 0.996·d − 0.40 + 0.02·(d − 10) = 12, 1.016·d = 12.6, d = 12.401574803…
  const pin = fitSizes(p, { role: "hole", kind: "press", partner: "bought" }, 12);
  assert.ok(!("refused" in pin));
  close(pin.printed, 12.6 / 1.016);
  close(pin.printed, 12.4015748, 1e-7);
  assert.equal(sizesWords({ role: "hole", kind: "bolt-normal" }, m3), "clearance for an M3 bolt: 3.00 mm in the design, should come out 3.40 mm, printed at 3.92 mm");
});

test("hand-worked: the fit tables (ISO 273 clearances, tap sizes D − pitch, the gaps)", () => {
  const t = (fit: Fit, d: number) => targetSize(fit, d);
  assert.equal(t({ role: "hole", kind: "bolt-close" }, 5), 5.3);
  assert.equal(t({ role: "hole", kind: "bolt-normal" }, 8), 9);
  // M4 coarse pitch 0.7: 4 − 0.7 = 3.3. M2.5: 2.5 − 0.45 = 2.05.
  close(t({ role: "hole", kind: "screw-thread" }, 4) as number, 3.3, 1e-12);
  close(t({ role: "hole", kind: "screw-thread" }, 2.5) as number, 2.05, 1e-12);
  // A 6 mm bought shaft turning loosely: 6 + 0.30. A printed 6 mm peg's loose hole: 6 + 0.15. A peg going into a bearing, press: 6 − 0.
  close(t({ role: "hole", kind: "loose", partner: "bought" }, 6) as number, 6.3, 1e-12);
  close(t({ role: "hole", kind: "loose", partner: "printed" }, 6) as number, 6.15, 1e-12);
  assert.equal(t({ role: "peg", kind: "press", partner: "bought" }, 6), 6);
  // Every clearance is above the bolt, every tap size under it.
  for (const m of METRIC) assert.ok(m.close > m.size && m.normal > m.close && m.size - m.pitch < m.size && m.pitch > 0, `M${m.size}`);
});

test("a bolt fit needs a metric size, and a fit needs a size above 0", () => {
  const bad = targetSize({ role: "hole", kind: "bolt-normal" }, 3.5);
  assert.ok(typeof bad !== "number" && /metric size .* not 3\.5 mm/.test(bad.refused), JSON.stringify(bad));
  for (const d of [0, -1, NaN, Infinity]) assert.ok(typeof targetSize({ role: "hole", kind: "slide", partner: "bought" }, d) !== "number", String(d));
  // A peg smaller than its gap has nothing left.
  assert.ok(typeof targetSize({ role: "peg", kind: "loose", partner: "bought" }, 0.2) !== "number");
  assert.equal(printedSize(TYPICAL_PROFILE, "hole", 0), null);
  assert.equal(printedSize(TYPICAL_PROFILE, "hole", NaN), null);
});

test("allowances between the test sizes lie on straight lines, flat past the ends", () => {
  const sides = [0.3, 0.2, 0.1] as const;
  close(allowanceAt(sides, 1), 0.3, 0); // below 5: the 5 mm one
  close(allowanceAt(sides, 7.5), 0.25, 1e-15); // halfway from 5 to 10
  close(allowanceAt(sides, 12.5), 0.15, 1e-15); // halfway from 10 to 15
  close(allowanceAt(sides, 40), 0.1, 0); // past 15: the 15 mm one
  close(allowanceAt(sides, 10), 0.2, 0);
});

// ---------------------------------------------------------------- the limits at 0.9× and 1.1×

const refusedWith = (m: FitMeasures, pattern: RegExp) => {
  const p = profileOf(m);
  assert.ok("refused" in p, "should be refused");
  assert.match(p.refused, pattern);
};

test("limits: a number too far from its size (10 mm peg, limit 1 + 0.03·10 = 1.3 mm off) passes at 0.9× and is refused at 1.1×", () => {
  const limit = LIMITS.near + LIMITS.nearPerMm * 10;
  close(limit, 1.3, 1e-12);
  // Moving only the 10 mm peg's measure; everything else is the worked piece. At 0.9×: 11.17 grows 0.605 a side,
  // past sideHigh, so the check before it must be the one that lets it through: use a hole instead, closing in.
  const holes = (off: number): FitMeasures => ({ ...WORKED, holes: [WORKED.holes[0], 10 - off, WORKED.holes[2]] });
  // 0.9×: hole 10 measured 10 − 1.17 = 8.83 is near enough, then refused by the allowance (0.565 a side is fine, its
  // step from 0.25 at 5 mm is 0.063 per mm, fine; from 0.15 at 15 mm 0.083 per mm, fine): accepted.
  ok(profileOf(holes(0.9 * limit)));
  refusedWith(holes(1.1 * limit), /^The 10 mm hole was measured as 8\.57 mm, too far from 10\.00 mm/);
  // Bigger as well as smaller, and the plate's length (limit 1 + 3.6 = 4.6).
  refusedWith({ ...WORKED, pegs: [WORKED.pegs[0], 10 + 1.1 * limit, WORKED.pegs[2]] }, /^The 10 mm peg was measured as 11\.43 mm, too far/);
  refusedWith({ ...WORKED, length: 120 - 1.1 * 4.6 }, /^The plate's length was measured as 114\.94 mm, too far from 120\.00 mm/);
});

test("limits: the shrink (1 ± 0.02) passes at 0.9× and is refused at 1.1×, both ways", () => {
  const e = [0.15, 0.15, 0.15] as const;
  const c = [0.15, 0.15, 0.15] as const;
  for (const dir of [1, -1]) {
    close(ok(profileOf(piece(1 + dir * 0.9 * 0.02, e, c))).scale, 1 + dir * 0.018, 1e-12);
    refusedWith(piece(1 + dir * 1.1 * 0.02, e, c), /^The plate's length and the 15 mm peg don't agree \(they say the plastic shrank to (102\.2|97\.8) %/);
  }
});

test("limits: an allowance (−0.3 … 0.6 mm a side) passes at 0.9× and is refused at 1.1×, pegs and holes", () => {
  // Only the 15 mm one at the limit; the 10 mm one close enough that the step stays under 0.1 per mm.
  ok(profileOf(piece(1, [0.2, 0.3, 0.9 * 0.6], [0.2, 0.2, 0.2])));
  refusedWith(piece(1, [0.2, 0.3, 1.1 * 0.6], [0.2, 0.2, 0.2]), /^The 15 mm peg grew by 0\.66 mm on each side, more than a printer does/);
  ok(profileOf(piece(1, [0.15, 0.15, 0.15], [0.2, 0.3, 0.9 * 0.6])));
  refusedWith(piece(1, [0.15, 0.15, 0.15], [0.2, 0.3, 1.1 * 0.6]), /^The 15 mm hole closed in by 0\.66 mm on each side/);
  // Below the limit: outsides growing 0.4 keep each peg wider than its hole.
  ok(profileOf(piece(1, [0.4, 0.4, 0.4], [0, -0.1, 0.9 * -0.3])));
  refusedWith(piece(1, [0.4, 0.4, 0.4], [0, -0.1, 1.1 * -0.3]), /^The 15 mm hole closed in by -0\.33 mm/);
  ok(profileOf(piece(1, [0, -0.1, 0.9 * -0.3], [0.4, 0.4, 0.4])));
  refusedWith(piece(1, [0, -0.1, 1.1 * -0.3], [0.4, 0.4, 0.4]), /^The 15 mm peg grew by -0\.33 mm/);
});

test("limits: two test sizes too different (0.1 mm per mm of size) pass at 0.9× and are refused at 1.1×", () => {
  // From −0.1 at 5 mm to −0.1 + 5·slope at 10 mm (and the same at 15).
  const at = (k: number): [number, number, number] => [-0.1, -0.1 + 5 * k * LIMITS.slope, -0.1 + 5 * k * LIMITS.slope];
  ok(profileOf(piece(1, at(0.9), [0.15, 0.15, 0.15])));
  refusedWith(piece(1, at(1.1), [0.15, 0.15, 0.15]), /^The 5 mm and 10 mm pegs are too different to both be right/);
  ok(profileOf(piece(1, [0.15, 0.15, 0.15], at(0.9))));
  refusedWith(piece(1, [0.15, 0.15, 0.15], at(1.1)), /^The 5 mm and 10 mm holes are too different/);
});

test("broken inputs: an empty, negative, NaN or missing number is refused by name", () => {
  for (const bad of [0, -5, NaN, Infinity, undefined as unknown as number]) {
    refusedWith({ ...WORKED, length: bad }, /^The plate's length needs a measurement in mm above 0\.$/);
    refusedWith({ ...WORKED, pegs: [bad, WORKED.pegs[1], WORKED.pegs[2]] }, /^The 5 mm peg needs a measurement/);
    refusedWith({ ...WORKED, holes: [WORKED.holes[0], WORKED.holes[1], bad] }, /^The 15 mm hole needs a measurement/);
  }
  // Pegs and holes swapped (a common slip): every other check passes it (each number is near its size, the shrink
  // and allowances are in range), so only the peg-wider-than-hole check catches it.
  refusedWith({ ...WORKED, pegs: WORKED.holes, holes: WORKED.pegs }, /^The 5 mm peg should measure wider than the 5 mm hole: the pegs and holes look swapped/);
  // At the edge: a peg 0.01 mm wider than its hole passes, 0.01 mm narrower is refused.
  ok(profileOf(piece(1, [0.1, 0.1, 0.1], [0.1, -0.095, 0.1])));
  refusedWith(piece(1, [0.1, 0.1, 0.1], [0.1, -0.105, 0.1]), /^The 10 mm peg should measure wider than the 10 mm hole/);
});

// ---------------------------------------------------------------- kept in this browser

class Store {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

test("kept: a measured piece is kept per nozzle, read back as the same profile, and forgotten", () => {
  const s = new Store();
  assert.equal(profileFor(s, "standard"), TYPICAL_PROFILE);
  const at = new Date("2026-11-05T12:00:00Z");
  ok(keepMeasures(s, "high-flow", WORKED, at));
  assert.equal(profileFor(s, "standard"), TYPICAL_PROFILE, "the other nozzle keeps the typical one");
  assert.deepEqual(profileFor(s, "high-flow"), profileOf(WORKED));
  assert.deepEqual(keptMeasures(s, "high-flow"), { measured: WORKED, at: "2026-11-05T12:00:00.000Z" });
  forgetMeasures(s, "high-flow");
  assert.equal(profileFor(s, "high-flow"), TYPICAL_PROFILE);
});

test("kept: a refused piece is never kept, and a corrupt or hand-edited entry is ignored", () => {
  const s = new Store();
  const r = keepMeasures(s, "standard", { ...WORKED, length: 90 }, new Date());
  assert.ok("refused" in r);
  assert.equal(s.map.size, 0);
  const key = fitKey("standard");
  for (const raw of ["{", "null", "[]", JSON.stringify({ version: 2, measured: WORKED, at: "x" }), JSON.stringify({ version: 1, measured: { ...WORKED, pegs: [1, 2] }, at: "x" }), JSON.stringify({ version: 1, measured: { ...WORKED, length: 90 }, at: "x" })]) {
    s.map.set(key, raw);
    assert.equal(keptMeasures(s, "standard"), null, raw);
    assert.equal(profileFor(s, "standard"), TYPICAL_PROFILE, raw);
  }
});

test("kept: storage that throws (blocked or full) never breaks anything", () => {
  const throwing = {
    getItem(): string {
      throw new Error("blocked");
    },
    setItem(): void {
      throw new Error("full");
    },
    removeItem(): void {
      throw new Error("blocked");
    },
  };
  assert.equal(profileFor(throwing, "standard"), TYPICAL_PROFILE);
  const r = keepMeasures(throwing, "standard", WORKED, new Date());
  assert.ok("refused" in r && /won't keep it/.test(r.refused));
  forgetMeasures(throwing, "standard");
  assert.equal(profileFor(null, "standard"), TYPICAL_PROFILE);
});

test("words: the typical profile says it is an estimate; a measured one says it was measured", () => {
  assert.match(profileWords(TYPICAL_PROFILE), /^Typical for a P1S with PLA \(an estimate until you measure/);
  assert.equal(profileWords(ok(profileOf(WORKED))), "Measured on your printer: shrinks to 99.60 %; outsides grow 0.15 mm on each side, holes close in 0.20 mm on each side (at 10 mm).");
});

// ---------------------------------------------------------------- seeded random printers against a simple model

/** mulberry32: the same seed gives the same printers. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = Number(process.env.FISSION_SEED ?? 20261105);

/**
 * The model: the size to print solved in closed form, one straight piece at a time. On a piece where the allowance
 * is a + k·(d − d0), a hole's s·d − 2a − 2k·(d − d0) = T gives d = (T + 2a − 2k·d0) / (s − 2k) (a peg's with the
 * signs flipped); the answer is the one that lands on its own piece.
 */
function modelSize(p: FitProfile, role: "hole" | "peg", want: number): number {
  const sides = role === "hole" ? p.holeShrink : p.pegGrow;
  const sign = role === "hole" ? -1 : 1;
  const [x0, x1, x2] = PIECE.sizes;
  const pieces: [number, number, number, number][] = [
    [-Infinity, x0, sides[0], 0],
    [x0, x1, sides[0], (sides[1] - sides[0]) / (x1 - x0)],
    [x1, x2, sides[1], (sides[2] - sides[1]) / (x2 - x1)],
    [x2, Infinity, sides[2], 0],
  ];
  for (const [lo, hi, a, k] of pieces) {
    const d0 = Number.isFinite(lo) ? lo : 0;
    const d = (want - sign * 2 * a + sign * 2 * k * d0) / (p.scale + sign * 2 * k);
    if (d >= lo - 1e-9 && d <= hi + 1e-9) return d;
  }
  throw new Error("no piece holds the answer");
}

test(`seeded (${SEED}): 500 random printers give back their own allowances, and every size to print matches the model`, () => {
  const r = random(SEED);
  const span = (lo: number, hi: number) => lo + (hi - lo) * r();
  const fits: Fit[] = [
    { role: "hole", kind: "bolt-close" },
    { role: "hole", kind: "bolt-normal" },
    { role: "hole", kind: "screw-thread" },
    ...(["press", "slide", "loose"] as const).flatMap((kind) => (["hole", "peg"] as const).flatMap((role) => (["bought", "printed"] as const).map((partner): Fit => ({ role, kind, partner })))),
  ];
  for (let n = 0; n < 500; n++) {
    const s = span(0.99, 1.01);
    // Allowances in the limits, each step under the slope limit.
    // Inside the side limits (and near enough at 5 mm), and a peg always wider than its hole (e + c > 0).
    const triple = (): [number, number, number] => {
      for (;;) {
        const a = span(-0.25, 0.5);
        const b = a + span(-0.3, 0.3);
        const c = b + span(-0.3, 0.3);
        if ([a, b, c].every((x) => x >= -0.25 && x <= 0.5)) return [a, b, c];
      }
    };
    let e = triple();
    let c = triple();
    while (!e.every((x, i) => x + c[i]! > 0.001)) [e, c] = [triple(), triple()];
    const p = ok(profileOf(piece(s, e, c)));
    close(p.scale, s, 1e-12);
    e.forEach((x, i) => close(p.pegGrow[i]!, x, 1e-11));
    c.forEach((x, i) => close(p.holeShrink[i]!, x, 1e-11));
    for (let k = 0; k < 6; k++) {
      const fit = fits[Math.floor(r() * fits.length)]!;
      const typed = fit.kind.startsWith("bolt") || fit.kind === "screw-thread" ? METRIC[Math.floor(r() * METRIC.length)]!.size : Math.round(span(1, 40) * 100) / 100;
      const sizes = fitSizes(p, fit, typed);
      assert.ok(!("refused" in sizes), `${n}.${k} ${JSON.stringify(fit)} ${typed}`);
      // Printed at that size, it comes out as it should; and it is the model's size.
      close(printsAs(p, fit.role, sizes.printed), sizes.target, 1e-9);
      close(sizes.printed, modelSize(p, fit.role, sizes.target), 1e-9);
      // The design's own number is never what changes.
      assert.equal(sizes.typed, typed);
    }
  }
});

test("a hole is printed bigger and a peg smaller than they should come out, whenever the printer closes holes and grows outsides", () => {
  for (const want of [1, 3.4, 5, 7.5, 10, 12.5, 15, 40]) {
    assert.ok(printedSize(TYPICAL_PROFILE, "hole", want)! > want, `hole ${want}`);
    assert.ok(printedSize(TYPICAL_PROFILE, "peg", want)! < want, `peg ${want}`);
  }
});

// ---------------------------------------------------------------- tagging a circle (FK2)


test("every fit in the list has its own id, which gives back the same fit", () => {
  // 3 bolt or screw fits, then 3 tightnesses × 2 partners for holes and again for pegs: 3 + 6 + 6 = 15.
  assert.equal(FIT_CHOICES.length, 15);
  assert.equal(new Set(FIT_CHOICES.map((c) => c.id)).size, 15);
  for (const c of FIT_CHOICES) {
    assert.equal(fitId(c.fit), c.id);
    assert.deepEqual(fitOfId(c.id), c.fit);
    assert.ok(isFit(c.fit), c.id);
  }
  assert.equal(fitOfId(""), null);
  assert.equal(fitOfId("bolt"), null);
});

test("isFit takes exactly a fit, and nothing near one", () => {
  assert.ok(isFit({ role: "hole", kind: "bolt-normal" }));
  assert.ok(isFit({ role: "peg", kind: "loose", partner: "bought" }));
  for (const bad of [
    null,
    [],
    "bolt-normal",
    { role: "peg", kind: "bolt-normal" }, // a peg is never a bolt hole
    { role: "hole", kind: "bolt-normal", partner: "bought" }, // a bolt fit has no partner
    { role: "hole", kind: "slide" }, // a pin fit needs its partner
    { role: "hole", kind: "slide", partner: "steel" },
    { role: "shaft", kind: "slide", partner: "bought" },
    { role: "hole", kind: "snug", partner: "bought" },
    { role: "hole", kind: "toString", partner: "bought" }, // an object's own key is not a kind
    { role: "hole", kind: "bolt-close", extra: 1 },
    { role: "hole", kind: "press", partner: "printed", size: 3 },
  ])
    assert.equal(isFit(bad), false, JSON.stringify(bad));
});

test("hand-worked: the tags shown beside a circle's diameter", () => {
  assert.equal(fitTag({ role: "hole", kind: "bolt-normal" }, 3), "M3 bolt");
  assert.equal(fitTag({ role: "hole", kind: "bolt-close" }, 2.5), "M2.5 bolt, close");
  assert.equal(fitTag({ role: "hole", kind: "screw-thread" }, 4), "M4 thread");
  // 3.5 mm is no M size, so a bolt fit on it can't be printed fitted, and the tag says so.
  assert.equal(fitTag({ role: "hole", kind: "bolt-normal" }, 3.5), "bolt fit: not an M size");
  assert.equal(fitTag({ role: "hole", kind: "slide", partner: "bought" }, 6), "pin, slide");
  assert.equal(fitTag({ role: "hole", kind: "loose", partner: "printed" }, 6), "peg hole, loose");
  assert.equal(fitTag({ role: "peg", kind: "press", partner: "printed" }, 6), "peg, press");
  assert.equal(fitTag({ role: "peg", kind: "slide", partner: "bought" }, 8), "into bearing, slide");
});
