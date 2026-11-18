// TestLab's results (step T5b): a checked answer from the kernel turned into
// what the view and the panel show. The view draws the part bent, `scale`
// times its real bend (said in words), coloured by its stress or its bend
// on one scale from zero to the largest; the panel says the biggest bend
// and stress, the safety factor in a colour and a sentence, and always that
// it is an estimate. Results are never saved in the file: a Run makes them,
// and a design edit marks them out of date. Styles: styles/testlab-results.css.

import type { AnalysisOverlay, DisplayMesh, Mechanical, StressTestResult } from "@fission/core";
import { weakerWay } from "@fission/core";
import { mpaWords } from "./materials.ts";
import { bends, bentMesh, boxDiagonal, drawnScale, ESTIMATE, figure, safetyBand, safetyWords, scaleColour, vertexColours, type SafetyBand } from "./run.ts";

/** What the view's colours show. */
export type ColourBy = "stress" | "bend";

/** One result as the page keeps it (in memory only). */
export interface Result {
  answer: StressTestResult;
  /** How many times bigger than real the bend is drawn. */
  scale: number;
  mesh: DisplayMesh;
  vertexPoint: number[];
  /** Each point's bend, mm. */
  bend: number[];
  material: { name: string; mechanical: Mechanical };
}

/** The overlay that marks where the biggest stress and the biggest bend are. */
export const RESULT_OVERLAY = "testlab-result";

/** A checked answer ready to draw. */
export function resultOf(answer: StressTestResult, material: Result["material"]): Result {
  const scale = drawnScale(answer.maxDisplacement, boxDiagonal(answer.points));
  const { mesh, vertexPoint } = bentMesh(answer, scale);
  return { answer, scale, mesh, vertexPoint, bend: bends(answer), material };
}

/** The view's colours for the result by stress (0 to the largest) or by bend (0 to the largest). */
export function resultColours(r: Result, by: ColourBy): number[] {
  return by === "stress" ? vertexColours(r.vertexPoint, r.answer.vonMises, r.answer.maxVonMises) : vertexColours(r.vertexPoint, r.bend, r.answer.maxDisplacement);
}

/** The point of the answer's surface nearest `at` (where the kernel says a largest is), drawn where the bent part has it. */
function drawnAt(r: Result, at: readonly number[]): [number, number, number] {
  const p = r.answer.points;
  let best = 0;
  let gap = Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const d = Math.hypot(p[i] - at[0], p[i + 1] - at[1], p[i + 2] - at[2]);
    if (d < gap) [gap, best] = [d, i];
  }
  const u = r.answer.displacement;
  return [p[best] + r.scale * u[best], p[best + 1] + r.scale * u[best + 1], p[best + 2] + r.scale * u[best + 2]];
}

/** Dots at the biggest stress (red) and the biggest bend (violet), drawn over the coloured part. */
export function resultOverlay(r: Result): AnalysisOverlay {
  return {
    id: RESULT_OVERLAY,
    label: "Biggest stress and bend",
    detail: "The red dot is where the stress is biggest; the violet dot is where the part moves most.",
    marks: [],
    places: [
      { severity: "info", point: drawnAt(r, r.answer.maxDisplacementAt) },
      { severity: "error", point: drawnAt(r, r.answer.maxVonMisesAt) },
    ],
  };
}

/** "Drawn 2,000 times bigger than the real bend", or that it is drawn as it is. */
export function scaleWords(scale: number): string {
  return scale === 1 ? "The bend is drawn as big as it really is." : `The bend is drawn ${scale.toLocaleString("en")} times bigger than it really is, so you can see it.`;
}

/** The result's lines, each a label and its words, in the panel's order. */
export function resultLines(r: Result): { label: string; words: string }[] {
  const m = r.material.mechanical;
  const strength = weakerWay(m).strength;
  const kind = m.strengthKind === "yield" ? "yield strength" : "breaking strength";
  return [
    { label: "Biggest bend", words: `${figure(r.answer.maxDisplacement)} mm` },
    { label: "Biggest stress", words: `${figure(r.answer.maxVonMises)} MPa (${r.material.name}'s ${kind}: ${mpaWords(strength)}${m.printed ? ", across the layers" : ""})` },
  ];
}

/** The safety factor in words for its badge ("3.4", "over 1,000"), or "none" when nothing is stressed. */
export function factorWords(factor: number | null): string {
  if (factor === null) return "none";
  return factor > 1000 ? "over 1,000" : figure(factor);
}

/** How the answer was worked out, in one sentence (the panel's details). */
export function methodWords(r: Result): string {
  const a = r.answer;
  const off = Math.hypot(a.applied[0] + a.reaction[0], a.applied[1] + a.reaction[1], a.applied[2] + a.reaction[2]) / Math.hypot(...a.applied);
  return `A mesh of ${a.elements.toLocaleString("en")} tetrahedra (ten points each) with ${a.nodes.toLocaleString("en")} points, about ${figure(a.size)} mm apart, solved ${a.method === "direct" ? "directly" : "step by step"}; the loads and what holds the part balance to within ${off < 1e-9 ? "a billionth" : `${figure(off * 100)}%`}.`;
}

/** The results section of the panel (`stale`: the design changed since the Run). */
export function resultSection(doc: Document, r: Result, by: ColourBy, stale: boolean, colourBy: (by: ColourBy) => void): HTMLElement {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const box = el("section", "testlab-results");
  box.setAttribute("aria-label", "Result");
  box.dataset.stale = String(stale);
  box.append(el("h3", undefined, stale ? "Result (out of date)" : "Result"));
  const band: SafetyBand = safetyBand(r.answer.safetyFactor);
  const factor = el("p", "testlab-results-factor");
  factor.dataset.band = band;
  factor.append(el("span", "testlab-results-factor-label", "Safety factor"), el("strong", "testlab-results-factor-value", factorWords(r.answer.safetyFactor)));
  box.append(factor, el("p", "testlab-results-words", safetyWords(r.answer.safetyFactor, r.material.mechanical.strengthKind)));
  const facts = el("dl", "testlab-results-facts");
  for (const line of resultLines(r)) facts.append(el("dt", undefined, line.label), el("dd", undefined, line.words));
  box.append(facts);
  // The colour scale: what the colours mean, from 0 to the largest.
  const choose = el("div", "testlab-results-by");
  choose.setAttribute("role", "group");
  choose.setAttribute("aria-label", "Colour the part by");
  for (const [value, text] of [
    ["stress", "Stress"],
    ["bend", "Bend"],
  ] as const) {
    const b = el("button", undefined, text);
    b.type = "button";
    b.dataset.testlabBy = value;
    b.setAttribute("aria-pressed", String(by === value));
    b.addEventListener("click", () => colourBy(value));
    choose.append(b);
  }
  const top = by === "stress" ? `${figure(r.answer.maxVonMises)} MPa` : `${figure(r.answer.maxDisplacement)} mm`;
  const legend = el("div", "testlab-results-legend");
  const bar = el("span", "testlab-results-bar");
  bar.style.background = `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => `rgb(${scaleColour(t).map((c) => Math.round(c * 255)).join(", ")})`).join(", ")})`;
  legend.append(el("span", undefined, by === "stress" ? "0 MPa" : "0 mm"), bar, el("span", undefined, top));
  box.append(choose, legend, el("p", "testlab-results-words", scaleWords(r.scale)), el("p", "testlab-results-estimate", ESTIMATE));
  const how = el("details", "testlab-results-how");
  how.append(el("summary", undefined, "How it was worked out"), el("p", undefined, methodWords(r)));
  box.append(how);
  return box;
}
