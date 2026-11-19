// TestLab's suggestions (T5c6): after a Run, ways to make the part hold more, read
// from that Run's own answer. Every number shown is worked out from the answer,
// never guessed, and says what it rests on:
// - The answer is linear, so every stress grows in step with the loads: the loads
//   that give a safety factor of TARGET are the loads times SF / TARGET, exactly.
// - With only clamps and forces or pressures, the stress in a part of one material
//   does not depend on its stiffness at all, only (a little) on its Poisson's ratio,
//   so another material's safety factor is about SF times its strength over this
//   one's ("about", and Run again to be sure).
// - A printed part is tested with its weaker strength, across the layers; along the
//   layers it is stronger, so the safety factor is at most SF times along / across,
//   reached only if all the stress ran along the layers (TestLab can't yet tell).
// A change of shape (thicker, a rounded corner, a hold moved) can't be worked out
// without trying it, so it gets no number: change it and Run again. A rounded corner
// is offered only when the biggest stress sits at a sharp inside corner, a moved hold
// only when it sits where the part is held. Styles: styles/testlab-suggest.css.

import { weakerWay, type Mechanical, type StressTestResult } from "@fission/core";
import { mpaWords, testMaterials } from "./materials.ts";
import { figure, safetyBand } from "./run.ts";
import type { Result } from "./results.ts";

/** The safety factor the suggestions aim for: the start of the safe band (run.ts `safetyBand`). */
export const TARGET = 2;

/**
 * How far two faces must turn from each other at an edge for it to count as a sharp
 * corner: 10° (in radians). A rounded corner helps where the surface turns hard; two
 * faces meeting almost flat concentrate little stress, and a fillet there would help
 * little.
 */
export const SHARP_TURN = (10 * Math.PI) / 180;

/** One suggestion: what to do, why, and the safety factor it gives where that was worked out (null: no number). */
export interface Suggestion {
  id: "thicker" | "corner" | "hold" | "material" | "layers" | "load";
  title: string;
  words: string;
  gain: string | null;
}

type Vec = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);

/** The distance from `p` to the segment from `a` to `b`. */
function toSegment(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
  return length(sub(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]));
}

/**
 * Whether the answer's surface has a sharp inside corner within `radius` of `at`: an
 * edge where two different faces of the body meet, the surface turning inwards (the
 * second face rises above the first's outward side, the kernel winding triangles
 * outwards) by more than SHARP_TURN.
 */
export function insideCornerNear(r: Pick<StressTestResult, "points" | "triangles" | "triangleFaces">, at: readonly number[], radius: number): boolean {
  const p = (i: number) => [r.points[3 * i], r.points[3 * i + 1], r.points[3 * i + 2]];
  const sides = new Map<string, number[]>();
  for (let t = 0; t < r.triangleFaces.length; t++)
    for (let k = 0; k < 3; k++) {
      const a = r.triangles[3 * t + k];
      const b = r.triangles[3 * t + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const list = sides.get(key);
      if (list) list.push(t);
      else sides.set(key, [t]);
    }
  const corners = (t: number) => [r.triangles[3 * t], r.triangles[3 * t + 1], r.triangles[3 * t + 2]];
  const normal = (t: number) => {
    const [a, b, c] = corners(t).map(p);
    return cross(sub(b, a), sub(c, a));
  };
  for (const [key, ts] of sides) {
    if (ts.length !== 2 || r.triangleFaces[ts[0]] === r.triangleFaces[ts[1]]) continue;
    const [a, b] = key.split(",").map(Number);
    if (toSegment(at, p(a), p(b)) > radius) continue;
    const n1 = normal(ts[0]);
    const n2 = normal(ts[1]);
    const far = corners(ts[1]).find((i) => i !== a && i !== b);
    if (far === undefined || !(length(n1) > 0) || !(length(n2) > 0)) continue;
    const turn = Math.atan2(length(cross(n1, n2)), dot(n1, n2));
    if (turn > SHARP_TURN && dot(n1, sub(p(far), p(a))) > 0) return true;
  }
  return false;
}

/** Whether a point of the answer within `radius` of `at` is held still (its displacement exactly zero: a clamped point). */
export function heldNear(r: Pick<StressTestResult, "points" | "displacement">, at: readonly number[], radius: number): boolean {
  for (let i = 0; i + 2 < r.points.length; i += 3) {
    if (r.displacement[i] !== 0 || r.displacement[i + 1] !== 0 || r.displacement[i + 2] !== 0) continue;
    if (length(sub([r.points[i], r.points[i + 1], r.points[i + 2]], at)) <= radius) return true;
  }
  return false;
}

/** A number to three significant figures with thousands commas ("1,780", "892", "0.091"). */
function threeFigures(x: number): string {
  return Number(x.toPrecision(3)).toLocaleString("en", { maximumSignificantDigits: 3 });
}

const verbOf = (m: Mechanical) => (m.strengthKind === "yield" ? "bend for good" : "break");

/** The safety factor it would have, in words: "about 1.44 (now 0.182)". */
const gainWords = (about: boolean, upTo: boolean, now: number, then: number) => `${upTo ? "up to " : about ? "about " : ""}${figure(then)} (now ${figure(now)})`;

/**
 * The suggestions for a result, in order: thicker, a rounded inside corner, the hold,
 * stronger materials, the print's layers, a smaller load. None when nothing is stressed.
 */
export function suggestionsOf(r: Result): Suggestion[] {
  const sf = r.answer.safetyFactor;
  if (sf === null) return [];
  const m = r.material.mechanical;
  const strength = weakerWay(m).strength;
  const at = r.answer.maxVonMisesAt;
  const near = r.answer.size;
  const out: Suggestion[] = [
    {
      id: "thicker",
      title: "Make it thicker at the red dot",
      words: "The red dot is where the stress is highest. More material there, mostly in the direction it bends, lowers the stress fast. Change it in Design and Run again to see by how much.",
      gain: null,
    },
  ];
  if (insideCornerNear(r.answer, at, near))
    out.push({
      id: "corner",
      title: "Round the sharp inside corner",
      words: "The highest stress is at a sharp inside corner, where stress bunches up (and reads higher the finer the mesh). Rounding it (a fillet) spreads the stress out. Fillets are coming to Design; until then, a thicker corner helps.",
      gain: null,
    });
  if (heldNear(r.answer, at, near))
    out.push({
      id: "hold",
      title: "Hold it differently",
      words: "The highest stress is right where the part is held. Holding it over more of the part, or closer to where it is pushed, lowers it. Change the hold and Run again to see by how much.",
      gain: null,
    });
  const better = testMaterials()
    .filter((x) => x.name !== r.material.name)
    .map((x) => ({ name: x.name, mechanical: x.mechanical!, then: (sf * weakerWay(x.mechanical!).strength) / strength }))
    .filter((x) => x.then > sf)
    .sort((a, b) => b.then - a.then);
  if (better.length > 0)
    out.push({
      id: "material",
      title: "Use a stronger material",
      words: `${better.map((x) => `${x.name}: about ${figure(x.then)}`).join("; ")}. The stress in this test hardly depends on how stiff the material is, so each is this result's safety factor times that material's strength over ${r.material.name}'s (${mpaWords(strength)}). Choose it in Made of and Run again to be sure.`,
      gain: gainWords(true, false, sf, better[0].then),
    });
  if (m.printed && m.strength.alongLayers > m.strength.acrossLayers) {
    const then = (sf * m.strength.alongLayers) / m.strength.acrossLayers;
    out.push({
      id: "layers",
      title: "Print it so the layers run along the stress",
      words: `TestLab uses ${r.material.name}'s weaker strength, across the layers (${mpaWords(m.strength.acrossLayers)}). Along the layers it is ${mpaWords(m.strength.alongLayers)}, so laying the part so the stress runs along its layers could raise the safety factor to at most ${figure(then)}. TestLab can't yet tell which way the stress runs; that comes with the print direction from SliceLab.`,
      gain: gainWords(false, true, sf, then),
    });
  }
  if (safetyBand(sf) !== "safe") {
    const share = sf / TARGET;
    const loads = r.setUp.loads;
    const keep = loads.length === 1 ? `${threeFigures(loads[0].amount * share)} ${loads[0].unit}` : `${threeFigures(share)} times these loads`;
    out.push({
      id: "load",
      title: "Or load it less",
      words: `To hold with a safety factor of ${TARGET}, keep the load to about ${keep}. Worked out exactly from this result: the stress grows in step with the load.`,
      gain: gainWords(false, false, sf, TARGET),
    });
  }
  return out;
}

/** The suggestions as the panel shows them, open when the part would break or holds only just; null when there are none. */
export function suggestSection(doc: Document, r: Result): HTMLElement | null {
  const list = suggestionsOf(r);
  if (list.length === 0) return null;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const band = safetyBand(r.answer.safetyFactor);
  const box = el("details", "testlab-suggest");
  box.open = band !== "safe";
  box.append(el("summary", undefined, band === "fails" ? `How to make it hold` : "How to make it stronger"));
  box.append(el("p", "testlab-suggest-intro", `Read from this result. A safety factor is shown only where it was worked out from it; for a change of shape, make the change and Run again. Aim for ${TARGET} or more, so it doesn't ${verbOf(r.material.mechanical)}.`));
  const ol = el("ol", "testlab-suggest-list");
  for (const s of list) {
    const li = el("li");
    li.dataset.suggest = s.id;
    const head = el("div", "testlab-suggest-head");
    head.append(el("strong", undefined, s.title));
    if (s.gain !== null) head.append(el("span", "testlab-suggest-gain", `Safety factor ${s.gain}`));
    li.append(head, el("p", undefined, s.words));
    ol.append(li);
  }
  box.append(ol);
  return box;
}
