// TestLab's results (step T5b): a checked answer from the kernel turned into
// what the view and the panel show. The view draws the part bent, `scale`
// times its real bend (said in words), coloured by its stress or its bend
// on one scale from zero to the largest; the panel says the biggest bend
// and stress, the safety factor in a colour and a sentence, and always that
// it is an estimate. Results are never saved in the file: a Run makes them,
// and a design edit marks them out of date. Styles: styles/testlab-results.css.
//
// The panel leads with a card a person reads at a glance and can screenshot
// or copy as text: the verdict, the set-up as it was run (the part, what it is
// made of, where it is pushed and held) and the load at which it would start
// to break. Every other number is behind "How it was worked out". Past
// breaking, the linear answer's stress and bend are not what a real part
// would do, so the card never shows them and the details say so.

import type { AnalysisOverlay, DisplayMesh, Mechanical, StressTestResult } from "@fission/core";
import { weakerWay } from "@fission/core";
import { mpaWords } from "./materials.ts";
import { bends, bentMesh, boxDiagonal, drawnScale, ESTIMATE, figure, safetyBand, safetyWords, scaleColour, vertexColours, type SafetyBand } from "./run.ts";
import { DIRECTION_WORDS, newtons, newtonWords, type Load, type Study } from "./study.ts";

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
  /** The set-up as it was when Run was pressed, so the card says what was tested even once the study changes. */
  setUp: RunSetUp;
}

/** What was tested: the body's name, the held faces' names and the loads, copied at Run. */
export interface RunSetUp {
  body: string;
  held: string[];
  loads: Load[];
}

/** A study's set-up as Run tests it (a copy: later edits to the study never change it). */
export function setUpOf(study: Pick<Study, "body" | "fixtures" | "loads">): RunSetUp {
  return {
    body: study.body?.label ?? "the part",
    held: study.fixtures.flatMap((f) => f.faces.map((face) => face.label)),
    loads: study.loads.map((l) => ({ ...l, faces: l.faces.map((face) => ({ ...face })) })),
  };
}

/** The overlay that marks where the biggest stress and the biggest bend are. */
export const RESULT_OVERLAY = "testlab-result";

/** A checked answer ready to draw. */
export function resultOf(answer: StressTestResult, material: Result["material"], setUp: RunSetUp): Result {
  const scale = drawnScale(answer.maxDisplacement, boxDiagonal(answer.points));
  const { mesh, vertexPoint } = bentMesh(answer, scale);
  return { answer, scale, mesh, vertexPoint, bend: bends(answer), material, setUp };
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
    { label: "Biggest stress", words: `${figure(r.answer.maxVonMises)} MPa, the highest found anywhere in the part (${r.material.name}'s ${kind}: ${mpaWords(strength)}${m.printed ? ", across the layers" : ""})` },
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

/** Names in a list: "A", "A and B", "A, B and C". */
function listWords(names: readonly string[]): string {
  if (names.length === 0) return "nothing";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A number to three significant figures with thousands commas ("1,780", "117", "0.182"). */
function threeFigures(x: number): string {
  return Number(x.toPrecision(3)).toLocaleString("en", { maximumSignificantDigits: 3 });
}

/** What breaking means for the material: a metal starts to bend for good at its yield, a plastic breaks. */
const brokenVerb = (m: Mechanical) => (m.strengthKind === "yield" ? "bend for good" : "break");

/** A load as the card says it, with its faces by name: "9,800 N down on Top face", "20 kPa pressing square into Top face". */
export function pushedWords(load: Load): string {
  const faces = listWords(load.faces.map((f) => f.label));
  const amount = load.amount.toLocaleString("en", { maximumFractionDigits: 6 });
  if (load.unit === "kPa") return `${amount} kPa pressing square into ${faces}`;
  const force = load.unit === "kg" ? `${amount} kg hanging (${newtonWords(newtons(load)!)})` : `${amount} N`;
  return load.direction === "into" ? `${force} square into ${faces}` : `${force} ${DIRECTION_WORDS[load.direction]} on ${faces}`;
}

/** The card's one-word verdict, from the safety factor's band. */
export function verdictWords(r: Result): string {
  const band = safetyBand(r.answer.safetyFactor);
  if (band === "fails") return r.material.mechanical.strengthKind === "yield" ? "Would bend for good" : "Would break";
  return band === "close" ? "Holds, just" : "Holds";
}

/**
 * Where it would start to break, or null when nothing is stressed. The answer is linear, so every stress grows in step
 * with the loads, and the biggest reaches the strength when the loads are the safety factor times what they are. One
 * load is said in its own unit; more than one as a multiple of them all.
 */
export function limitWords(r: Result): string | null {
  const factor = r.answer.safetyFactor;
  if (factor === null) return null;
  const verb = brokenVerb(r.material.mechanical);
  const loads = r.setUp.loads;
  if (factor > 1000) return `It could take over 1,000 times these loads before it starts to ${verb}.`;
  const at = loads.length === 1 ? `${threeFigures(loads[0].amount * factor)} ${loads[0].unit}` : `${threeFigures(factor)} times these loads`;
  return factor < 1 ? `It would start to ${verb} at about ${at}.` : `It could take about ${at} before it starts to ${verb}.`;
}

/** The card's set-up lines, each a label and its words: the part, what it is made of, each load, what holds it. */
export function cardLines(r: Result): { label: string; words: string }[] {
  const m = r.material.mechanical;
  return [
    { label: "Part", words: r.setUp.body },
    { label: "Made of", words: m.printed ? `${r.material.name}, printed` : r.material.name },
    ...r.setUp.loads.map((l) => ({ label: "Pushed", words: pushedWords(l) })),
    { label: "Held", words: listWords(r.setUp.held) },
  ];
}

/** The card as plain text, for Copy summary. */
export function summaryText(r: Result): string {
  const limit = limitWords(r);
  return [
    `TestLab result: ${verdictWords(r)} (safety factor ${factorWords(r.answer.safetyFactor)})`,
    ...cardLines(r).map((l) => `${l.label}: ${l.words}`),
    ...(limit === null ? [] : [limit]),
    "An estimate, not a promise.",
  ].join("\n");
}

/** Said in the details when the part would break: the linear numbers past breaking are not what a real part does. */
export function brokenWords(r: Result): string | null {
  if (safetyBand(r.answer.safetyFactor) !== "fails") return null;
  return `Worked out as if the part stayed in one piece: it would ${brokenVerb(r.material.mechanical)} before these loads are reached, so the bend and stress below are bigger than a real part would show.`;
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
  // The card: the verdict and the set-up that was tested, at a glance (and screenshot or copied as it is).
  const card = el("div", "testlab-results-card");
  card.dataset.band = band;
  const verdict = el("strong", "testlab-results-verdict", verdictWords(r));
  verdict.dataset.band = band;
  const factor = el("p", "testlab-results-factor");
  factor.dataset.band = band;
  factor.append(el("span", "testlab-results-factor-label", "Safety factor"), el("strong", "testlab-results-factor-value", factorWords(r.answer.safetyFactor)));
  const head = el("div", "testlab-results-head");
  head.append(verdict, factor);
  const setUp = el("dl", "testlab-results-setup");
  for (const line of cardLines(r)) setUp.append(el("dt", undefined, line.label), el("dd", undefined, line.words));
  card.append(head, setUp);
  const limit = limitWords(r);
  if (limit !== null) card.append(el("p", "testlab-results-limit", limit));
  if (band !== "fails") card.append(el("p", "testlab-results-bend", `Bends at most ${figure(r.answer.maxDisplacement)} mm.`));
  const foot = el("div", "testlab-results-foot");
  const copied = el("span", "testlab-results-copied");
  copied.setAttribute("role", "status");
  const copy = el("button", undefined, "Copy summary");
  copy.type = "button";
  copy.dataset.testlab = "copy-summary";
  copy.addEventListener("click", () => {
    const failed = () => void (copied.textContent = "Couldn't copy: select the card's words and copy them instead.");
    const clip = doc.defaultView?.navigator.clipboard;
    if (!clip) return failed();
    clip.writeText(summaryText(r)).then(() => void (copied.textContent = "Copied."), failed);
  });
  foot.append(el("span", "testlab-results-estimate", "An estimate, not a promise."), copy, copied);
  card.append(foot);
  box.append(card);
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
  box.append(choose, legend);
  // Everything else, behind "How it was worked out": past breaking, first that the numbers are not real.
  const how = el("details", "testlab-results-how");
  how.append(el("summary", undefined, "How it was worked out"));
  const broken = brokenWords(r);
  if (broken !== null) how.append(el("p", "testlab-results-broken", broken));
  how.append(el("p", "testlab-results-words", safetyWords(r.answer.safetyFactor, r.material.mechanical.strengthKind)));
  const facts = el("dl", "testlab-results-facts");
  for (const line of resultLines(r)) facts.append(el("dt", undefined, line.label), el("dd", undefined, line.words));
  how.append(facts, el("p", "testlab-results-words", scaleWords(r.scale)), el("p", "testlab-results-words", ESTIMATE), el("p", undefined, methodWords(r)));
  box.append(how);
  return box;
}
