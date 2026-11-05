// Printer fits (P13, Ben 2026-11-05): the dialog, opened from Slice for
// printing, that measures the printer for fits.ts. Step 1 downloads the test
// piece's print file (fit-piece.ts, sliced by the engine like any body);
// step 2 takes the seven caliper numbers, says at once what they mean or
// why they can't be right, and keeps them in this browser for the nozzle
// chosen (no account, works offline). Sizes in the design never change:
// the examples show the size typed, the size it should come out and the
// size the printer is asked for, side by side.

import { FIT_CELL, FIT_CELLS } from "./fit-piece.ts";
import { fitSizes, forgetMeasures, keepMeasures, keptMeasures, PIECE, profileFor, profileOf, profileWords, sizesWords, type Fit, type FitMeasures, type FitProfile } from "./fits.ts";
import type { NozzleType } from "./slice-print.ts";

export interface FitCalibrationEvents {
  /** The nozzle the fits are for: Slice for printing's choice. */
  nozzle(): NozzleType;
  /** Makes and saves the test piece's print file; saved false when the save box was closed. `alive()` turns false once the dialog is closed. */
  testPiece(alive: () => boolean): Promise<{ saved: boolean; name: string }>;
  /** Called when the fits kept change (saved or forgotten), so Slice for printing's line can say so. */
  changed?(): void;
  /** Today, for when a piece was measured (the tests' own); left out, new Date(). */
  now?(): Date;
}

export interface FitCalibration {
  ask(): void;
  readonly open: boolean;
}

/** The examples shown under a result: what three common fits print at. */
export const FIT_EXAMPLES: readonly (readonly [Fit, number])[] = [
  [{ role: "hole", kind: "bolt-normal" }, 3],
  [{ role: "hole", kind: "slide", partner: "bought" }, 6],
  [{ role: "peg", kind: "slide", partner: "printed" }, 8],
];

/** The seven boxes in order: what each is, and where its number goes in FitMeasures. */
export const FIT_BOXES: readonly { id: string; label: string; size: number; put: (m: { length: number; pegs: number[]; holes: number[] }, v: number) => void; get: (m: FitMeasures) => number }[] = [
  { id: "fit-cal-length", label: "Plate length", size: PIECE.length, put: (m, v) => (m.length = v), get: (m) => m.length },
  ...PIECE.sizes.map((d, i) => ({ id: `fit-cal-peg-${d}`, label: `${d} mm peg`, size: d, put: (m: { pegs: number[] }, v: number) => void (m.pegs[i] = v), get: (m: FitMeasures) => m.pegs[i]! })),
  ...PIECE.sizes.map((d, i) => ({ id: `fit-cal-hole-${d}`, label: `${d} mm hole`, size: d, put: (m: { holes: number[] }, v: number) => void (m.holes[i] = v), get: (m: FitMeasures) => m.holes[i]! })),
];

/** A typed number: "15.18", " 15,18 " (a comma for the point, as many keyboards type it); anything else NaN. */
export function typedMm(text: string): number {
  const t = text.trim().replace(",", ".");
  return /^\d+(\.\d+)?$|^\.\d+$/.test(t) ? Number(t) : NaN;
}

/** The fits line in Slice for printing: measured (and when) or typical, for `nozzle`. */
export function fitsLine(storage: Pick<Storage, "getItem"> | null, nozzle: NozzleType): string {
  const kept = keptMeasures(storage, nozzle);
  const which = nozzle === "high-flow" ? "High Flow" : "Standard";
  if (!kept) return `Fits: typical sizes for the ${which} nozzle (not measured yet).`;
  const day = new Date(kept.at);
  const when = Number.isNaN(day.getTime()) ? "" : ` on ${day.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Perth" })}`;
  return `Fits: measured on your printer${when} (${which} nozzle).`;
}

/** The piece from above, as a small drawing: holes as rings, pegs filled, each named under it. */
function pieceDrawing(document: Document): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `-1 -7 ${PIECE.length + 2} ${FIT_CELL + 15}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `The test piece from above: a ${PIECE.length} mm plate with 5, 10 and 15 mm holes and 15, 10 and 5 mm pegs`);
  svg.classList.add("fit-cal-drawing");
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.append(e);
  };
  add("rect", { x: 0, y: 0, width: PIECE.length, height: FIT_CELL, rx: 0.5, class: "fit-cal-plate" });
  add("text", { x: PIECE.length / 2, y: -2, "text-anchor": "middle", class: "fit-cal-note" }, `plate length ${PIECE.length} mm`);
  FIT_CELLS.forEach(([d, kind], i) => {
    const cx = FIT_CELL / 2 + i * FIT_CELL;
    add("circle", { cx, cy: FIT_CELL / 2, r: d / 2, class: kind === "hole" ? "fit-cal-hole" : "fit-cal-peg" });
    add("text", { x: cx, y: FIT_CELL + 5.5, "text-anchor": "middle", class: "fit-cal-note" }, `${d} ${kind}`);
  });
  return svg;
}

/**
 * The dialog, in the toolbar slot's page, modal (native <dialog>, over Slice for printing's): Close or Escape close
 * it; keys pressed in it never reach the app's shortcuts.
 */
export function fitCalibration(slot: HTMLElement, storage: Storage | null, events: FitCalibrationEvents): FitCalibration {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, text = "") => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (text) e.textContent = text;
    return e;
  };
  const dialog = el("dialog", "fit-cal-dialog");
  dialog.className = "fit-cal";
  dialog.setAttribute("aria-labelledby", "fit-cal-heading");
  const heading = el("h2", "fit-cal-heading", "Printer fits");
  const intro = el(
    "p",
    "fit-cal-intro",
    "Every printer prints holes a little small and outsides a little big. Print this test piece once, measure it, and SpindleLabs knows by how much. The sizes in your design never change; only the size sent to the printer does.",
  );
  // Placeholders never pretend to work: tagging a hole with its fit comes next (P10), so this says so.
  const soon = el("p", "fit-cal-soon", "Coming next: tag a hole or peg with what it's for (an M3 bolt, a 6 mm pin) and it prints at the size that fits. For now this measures your printer and shows what those sizes would be.");
  const step1 = el("h3", "fit-cal-step1", "1. Print the test piece");
  const step1Words = el("p", "fit-cal-step1-words", "A plate 120 × 20 × 2 mm with three holes and three pegs, about 25 minutes in PLA, with the quality and walls chosen in Slice for printing.");
  const download = el("button", "fit-cal-download", "Download test piece");
  download.type = "button";
  const step2 = el("h3", "fit-cal-step2", "2. Measure it with calipers");
  const step2Words = el("p", "fit-cal-step2-words", "Let it cool first. Measure each peg halfway up and each hole across its widest, to 0.01 mm.");
  const boxes = el("div", "fit-cal-boxes");
  boxes.className = "fit-cal-boxes";
  const inputs = FIT_BOXES.map((b) => {
    const wrap = document.createElement("label");
    wrap.className = "fit-cal-box";
    wrap.append(document.createTextNode(b.label));
    const input = el("input", b.id);
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.placeholder = b.size.toFixed(2);
    input.setAttribute("aria-label", `${b.label} in mm, as measured (meant to be ${b.size} mm)`);
    wrap.append(input);
    boxes.append(wrap);
    return input;
  });
  const result = el("p", "fit-cal-result");
  result.setAttribute("role", "status");
  const examples = el("ul", "fit-cal-examples");
  const actions = el("div", "fit-cal-actions");
  actions.className = "fit-cal-actions";
  const close = el("button", "fit-cal-close", "Close");
  close.type = "button";
  const forget = el("button", "fit-cal-forget", "Use typical");
  forget.type = "button";
  forget.title = "Forgets the measured test piece for this nozzle, so the typical sizes are used again.";
  const save = el("button", "fit-cal-save", "Save my fits");
  save.type = "button";
  actions.append(close, forget, save);
  dialog.append(heading, intro, soon, step1, step1Words, pieceDrawing(document), download, step2, step2Words, boxes, result, examples, actions);
  slot.append(dialog);

  const measures = (): FitMeasures => {
    const m = { length: NaN, pegs: [NaN, NaN, NaN], holes: [NaN, NaN, NaN] };
    FIT_BOXES.forEach((b, i) => b.put(m, typedMm(inputs[i]!.value)));
    return { length: m.length, pegs: m.pegs as [number, number, number], holes: m.holes as [number, number, number] };
  };
  const say = (text: string, bad: boolean) => {
    result.textContent = text;
    result.classList.toggle("fit-cal-bad", bad);
  };
  const showExamples = (p: FitProfile | null) => {
    examples.replaceChildren();
    if (!p) return;
    for (const [fit, d] of FIT_EXAMPLES) {
      const s = fitSizes(p, fit, d);
      if ("refused" in s) continue;
      const li = document.createElement("li");
      li.textContent = sizesWords(fit, s);
      examples.append(li);
    }
  };
  /** What the boxes say now: nothing typed shows the profile in use; all seven typed shows what they mean; some typed says what's missing. */
  const refresh = () => {
    const typed = inputs.filter((i) => i.value.trim() !== "").length;
    const inUse = profileFor(storage, events.nozzle());
    forget.disabled = keptMeasures(storage, events.nozzle()) === null;
    if (typed === 0) {
      save.disabled = true;
      say(profileWords(inUse), false);
      showExamples(inUse);
      return;
    }
    const p = profileOf(measures());
    if ("refused" in p) {
      save.disabled = true;
      say(typed < inputs.length ? `Type all seven numbers (${typed} of ${inputs.length} so far). ${p.refused}` : p.refused, typed === inputs.length);
      showExamples(null);
      return;
    }
    save.disabled = false;
    say(`${profileWords(p)} Not saved yet.`, false);
    showExamples(p);
  };
  for (const input of inputs) input.addEventListener("input", refresh);
  const fill = () => {
    const kept = keptMeasures(storage, events.nozzle());
    FIT_BOXES.forEach((b, i) => (inputs[i]!.value = kept ? String(Number(b.get(kept.measured).toFixed(3))) : ""));
  };
  save.addEventListener("click", () => {
    const r = keepMeasures(storage, events.nozzle(), measures(), events.now?.() ?? new Date());
    if ("refused" in r) {
      say(r.refused, true);
      return;
    }
    events.changed?.();
    refresh();
    say(`Saved. ${profileWords(r)}`, false);
    save.disabled = true;
  });
  forget.addEventListener("click", () => {
    forgetMeasures(storage, events.nozzle());
    events.changed?.();
    fill();
    refresh();
  });
  let generation = 0;
  let busy = false;
  download.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    download.disabled = true;
    const mine = generation;
    const alive = () => mine === generation && dialog.open;
    say("Slicing the test piece…", false);
    try {
      const r = await events.testPiece(alive);
      if (alive()) say(r.saved ? `Saved ${r.name}. Print it, then type what you measure below.` : "Sliced, but not saved.", false);
    } catch (e) {
      if (alive()) say(e instanceof Error ? e.message : String(e), true);
    } finally {
      busy = false;
      download.disabled = false;
    }
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    generation++;
    document.getElementById("slice-print-fits-open")?.focus();
  });
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  return {
    ask() {
      if (dialog.open) return;
      fill();
      refresh();
      dialog.showModal();
      (inputs.find((i) => i.value === "") ?? download).focus();
    },
    get open() {
      return dialog.open;
    },
  };
}
