// TestLab's suggestions after a Run (suggest.ts, T5c6): each number worked out by hand beside it, the inside-corner
// and held-point checks on surfaces built by hand, SHARP_TURN at 0.9× and 1.1×, and the panel's section.
import { test } from "node:test";
import assert from "node:assert/strict";
import { materialLibrary, type StableId, type StressTestResult } from "@fission/core";
import { resultOf, resultSection, type RunSetUp } from "../src/results.ts";
import { heldNear, insideCornerNear, SHARP_TURN, suggestionsOf, suggestSection, TARGET } from "../src/suggest.ts";
import type { Load } from "../src/study.ts";

const { Window } = await import("happy-dom");

const face = (label: string) => ({ ref: { kind: "face" as const, id: label as StableId }, label });
const load = (l: Partial<Load>): Load => ({ id: "load-1", faces: [face("Top face")], amount: 9800, unit: "N", direction: "down", ...l });
const pla = { name: "PLA", mechanical: materialLibrary().get("pla")!.mechanical! };
const steel = { name: "Steel (A36 structural)", mechanical: materialLibrary().get("steel-a36")!.mechanical! };
const bens: RunSetUp = { body: "Body 1", held: ["Top face 2"], loads: [load({})] };

/**
 * A floor (face 1, z = 0, x from 5 to 15, outward +z) meeting a second face (face 2) along the edge x = 5, z = 0
 * (y from 0 to 10). The second face leaves the edge towards −x, `turn` radians above the floor's plane: a positive turn
 * rises on the floor's outside (an inside corner), a negative one drops below it (an outside corner), 0 is flat.
 */
function crease(turn: number, at: [number, number, number] = [5, 5, 0], held = false): StressTestResult {
  const far = [5 - 10 * Math.cos(turn), 0, 10 * Math.sin(turn)];
  return {
    // points: 0 (5,0,0), 1 (15,0,0), 2 (5,10,0), 3 far
    points: [5, 0, 0, 15, 0, 0, 5, 10, 0, ...far],
    // Floor 0,1,2: (b−a)×(c−a) = (10,0,0)×(0,10,0) = (0,0,100), outward +z. Second 0,2,3: (0,10,0)×(−10,0,0) =
    // (0,0,100) when flat, so both wound outwards the same way.
    triangles: [0, 1, 2, 0, 2, 3],
    triangleFaces: [1, 2],
    displacement: held ? [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] : [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
    vonMises: [192, 0, 0, 0],
    maxDisplacement: 1,
    maxDisplacementAt: [15, 0, 0],
    maxVonMises: 192,
    maxVonMisesAt: at,
    safetyFactor: 0.182,
    applied: [0, 0, -9800],
    reaction: [0, 0, 9800],
    size: 2,
    nodes: 4,
    elements: 1,
    worstQuality: 0.5,
    method: "direct",
    iterations: 1,
    relativeResidual: 1e-12,
  };
}

test("hand-worked: an inside corner is found at a right angle and past SHARP_TURN, never at an outside corner or a flat join", () => {
  // A wall straight up (turn 90°): the second face's far corner (5,0,10) is 10 above the floor's outside: inside.
  assert.equal(insideCornerNear(crease(Math.PI / 2), [5, 5, 0], 2), true);
  // The same wall straight down: (5,0,−10) is below the floor, an ordinary box edge: outside, never a fillet's place.
  assert.equal(insideCornerNear(crease(-Math.PI / 2), [5, 5, 0], 2), false);
  assert.equal(insideCornerNear(crease(0), [5, 5, 0], 2), false, "two faces meeting flat");
  // SHARP_TURN is 10°: at 9° (0.9×) a shallow crease, at 11° (1.1×) a sharp one.
  assert.equal(insideCornerNear(crease(0.9 * SHARP_TURN), [5, 5, 0], 2), false);
  assert.equal(insideCornerNear(crease(1.1 * SHARP_TURN), [5, 5, 0], 2), true);
  assert.equal(insideCornerNear(crease(-1.1 * SHARP_TURN), [5, 5, 0], 2), false);
});

test("hand-worked: the corner and the hold count only within the radius of the red dot", () => {
  // The edge runs along x = 5, z = 0; a point at (5, 5, h) is h from it. Radius 2: 1.8 (0.9×) in, 2.2 (1.1×) out.
  assert.equal(insideCornerNear(crease(Math.PI / 2), [5, 5, 1.8], 2), true);
  assert.equal(insideCornerNear(crease(Math.PI / 2), [5, 5, 2.2], 2), false);
  // Held: only point 0, (5,0,0), is still. From (5,0,1.8) it is 1.8 away; from (5,0,2.2), 2.2.
  assert.equal(heldNear(crease(0, undefined, true), [5, 0, 1.8], 2), true);
  assert.equal(heldNear(crease(0, undefined, true), [5, 0, 2.2], 2), false);
  assert.equal(heldNear(crease(0), [5, 0, 0], 2), false, "nothing held still");
});

test("hand-worked: Ben's 9,800 N PLA run gets every suggestion, with the numbers worked from the result", () => {
  const r = resultOf(crease(Math.PI / 2, [5, 0, 0], true), pla, bens);
  const s = suggestionsOf(r);
  assert.deepEqual(
    s.map((x) => x.id),
    ["thicker", "corner", "hold", "material", "layers", "load"],
  );
  const by = (id: string) => s.find((x) => x.id === id)!;
  assert.equal(by("thicker").gain, null, "a change of shape gets no number");
  assert.equal(by("corner").gain, null);
  assert.equal(by("hold").gain, null);
  // Stress doesn't depend on the stiffness here, so SF scales with the strength. PLA across the layers: 35 MPa.
  // Aluminium 6061-T6: 0.182 × 276 / 35 = 1.4352, about 1.44. Steel: 0.182 × 248.21 / 35 = 1.2907, about 1.29.
  // ABS (32) and PETG (23) are weaker than PLA's 35, so they are not offered.
  assert.equal(by("material").gain, "about 1.44 (now 0.182)");
  assert.match(by("material").words, /^Aluminium 6061-T6: about 1\.44; Steel \(A36 structural\): about 1\.29\. /);
  assert.doesNotMatch(by("material").words, /ABS|PETG/);
  // Along PLA's layers 39 MPa against 35 across: at most 0.182 × 39 / 35 = 0.20280, 0.203.
  assert.equal(by("layers").gain, "up to 0.203 (now 0.182)");
  assert.match(by("layers").words, /across the layers \(35 MPa\)\. Along the layers it is 39 MPa/);
  // Linear: SF 2 at 9,800 × 0.182 / 2 = 891.8 N, to three figures 892 N.
  assert.equal(by("load").gain, `${TARGET} (now 0.182)`);
  assert.match(by("load").words, /keep the load to about 892 N\./);
});

test("hand-worked: a safe steel part is offered only what helps, with nothing open", () => {
  const safe = { ...crease(-Math.PI / 2), safetyFactor: 23 };
  const r = resultOf(safe, steel, { ...bens, loads: [load({ amount: 1000 })] });
  const s = suggestionsOf(r);
  // No inside corner, nothing held near the red dot, a metal (no layers), already safe (no load cut).
  // Aluminium: 23 × 276 / 248.21 = 25.575, about 25.6. Every plastic is weaker than steel.
  assert.deepEqual(
    s.map((x) => x.id),
    ["thicker", "material"],
  );
  assert.equal(s[1].gain, "about 25.6 (now 23)");
  const doc = new Window().document as unknown as Document;
  const box = suggestSection(doc, r)!;
  assert.equal((box as HTMLDetailsElement).open, false, "closed when it holds with room to spare");
  assert.equal(box.querySelector("summary")!.textContent, "How to make it stronger");
});

test("hand-worked: several loads are cut as a multiple; a metal past yield says bend for good", () => {
  const r = resultOf({ ...crease(-Math.PI / 2), safetyFactor: 0.5 }, steel, { ...bens, loads: [load({}), load({ id: "load-2", amount: 2, unit: "kg" })] });
  // SF 2 at 0.5 / 2 = 0.25 times both loads.
  assert.match(suggestionsOf(r).find((x) => x.id === "load")!.words, /about 0\.25 times these loads/);
  const doc = new Window().document as unknown as Document;
  const box = suggestSection(doc, r)!;
  assert.equal((box as HTMLDetailsElement).open, true);
  assert.equal(box.querySelector("summary")!.textContent, "How to make it hold");
  assert.match(box.querySelector(".testlab-suggest-intro")!.textContent!, /so it doesn't bend for good\./);
});

test("nothing stressed: no suggestions and no section", () => {
  const r = resultOf({ ...crease(0), safetyFactor: null, maxVonMises: 0 }, pla, bens);
  assert.deepEqual(suggestionsOf(r), []);
  assert.equal(suggestSection(new Window().document as unknown as Document, r), null);
});

test("the results section carries the suggestions under the card, each gain only where one was worked out", () => {
  const doc = new Window().document as unknown as Document;
  const r = resultOf(crease(Math.PI / 2, [5, 0, 0], true), pla, bens);
  const box = resultSection(doc, r, "stress", false, () => {});
  const items = [...box.querySelectorAll(".testlab-suggest li")];
  assert.equal(items.length, 6);
  assert.ok(box.querySelector(".testlab-results-card")!.compareDocumentPosition(box.querySelector(".testlab-suggest")!) & 4, "after the card");
  const gains = items.map((li) => li.querySelector(".testlab-suggest-gain")?.textContent ?? null);
  assert.deepEqual(gains, [null, null, null, "Safety factor about 1.44 (now 0.182)", "Safety factor up to 0.203 (now 0.182)", "Safety factor 2 (now 0.182)"]);
});
