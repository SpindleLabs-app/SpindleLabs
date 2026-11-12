// Slice for printing (H2a, the slicer's first step into the app): every
// body shown, sliced by the slicing engine with the owner's printer's
// defaults (Bambu Lab P1S, 0.4 mm nozzle, PLA) and the beginner's four
// choices (quality, walls, infill, supports), downloaded as the P1S's own
// print file (.gcode.3mf, W6c: its start and end routines, for the build
// plate chosen) or, for another printer, plain G-code. The workspace offers it as File ▾
// > Slice for printing; its dialog holds the choices, says what the slice
// came to (layers, filament) and warns about any part too thin to print.
// Nothing is saved into the project: choices, never results (decision 6,
// docs/progress/slice.md). Styles: src/styles/slice-print.css.

import type { BuildPlate, Feature, KernelCalls, SliceProgress, StlFile, SupportStyle } from "@fission/core";
import { repeatGuard } from "@fission/ui";
import { bodyIdOf, type DesignDocument } from "./document.ts";
import { endStls } from "./move-tool.ts";
import { costWords, FILE_DEFAULTS, type FileChoices, fileCrawl, type FirstLayerExtras, fitCalibration, fitsLine, FORMAT_OPTIONS, GRIP_KEY, INFILL_OPTIONS, NOZZLE_KEY, NOZZLE_OPTIONS, type NozzleType, PLATE_OPTIONS, presetBar, type PresetSettings, presetSettingsOf, PRICE_KEY, PRINT_DEFAULTS, type PrintChoices, type PrintFacts, printFileOfStls, printWords, progressWords, QUALITY_OPTIONS, readPrice, refusalOf, rememberedBetterGrip, rememberedNozzle, rememberedPrice, rememberedWarmUp, SLICE_EARLIER, SliceDropped, sliceStls, stopSlices, SUPPORT_OPTIONS, supportsHint, supportStyle, unprintedWords, WALL_OPTIONS, WARM_UP_KEY } from "@fission/print";


/** The bodies' STL files from the kernel, one per body (the design's own export, in build order). */
function bodyFiles(kernel: KernelCalls, doc: DesignDocument, features: readonly SliceBody[]): () => Promise<Uint8Array[]> {
  return async () => {
    if (features.length === 0) throw new Error("There is no body to slice: make or show one first.");
    const files: StlFile[] = await endStls(kernel, doc, features.map((f) => ("body" in f ? { ...f, name: "body" } : { body: bodyIdOf(f.id), feature: f, name: "body" })));
    return files.map((f) => f.bytes);
  };
}

/** A body to slice: an item's own (by the item), or any body by its id and the item its row stands for (35f1: a Combine's piece). */
export type SliceBody = Feature | { body: string; feature: Feature };

/** Slices `features` (bodies, in build order) as they are shown: each body's STL from the kernel, then the engine. */
export const sliceBodies = (kernel: KernelCalls, doc: DesignDocument, features: readonly SliceBody[], choices: PrintChoices) => sliceStls(kernel, bodyFiles(kernel, doc, features), choices);

/** The same slice as the P1S's print file for `plate` and the `nozzle` fitted. */
export const printFileOf = (kernel: KernelCalls, doc: DesignDocument, features: readonly SliceBody[], choices: PrintChoices, plate: BuildPlate, nozzle: NozzleType = FILE_DEFAULTS.nozzle) => printFileOfStls(kernel, bodyFiles(kernel, doc, features), choices, plate, nozzle);

export interface SlicePrintEvents {
  /** Slices the bodies shown with these choices and saves the file chosen (`alive()` turns false once the dialog is closed: then throw SliceDropped before saving or showing anything); saved false when the user closed the save box, with the name it was saved under. */
  slice(choices: PrintChoices, file: FileChoices, alive: () => boolean): Promise<{ print: PrintFacts; saved: boolean; name: string }>;
  /**
   * Slices the bodies shown, as the file chosen (what Slice and download would save), and opens the print preview (H2b,
   * H2c); nothing is saved. `changed()` turns true once a choice is changed while it slices: the preview then says it
   * shows the earlier choices (PREVIEW_EARLIER).
   */
  preview(choices: PrintChoices, file: FileChoices, alive: () => boolean, changed: () => boolean): Promise<void>;
  /**
   * What the print leaves out of the design, in plain words: the timeline items the last rebuild failed and the bodies
   * hidden by their eyes (actions.ts `printMissingNote`, SL #675 item 3), or "" when nothing is left out. Said on its own line as the dialog opens, and again with each
   * slice's result, as a warning (export hunt 2026-11-12 D: a failed hole was printed away without a word). Left out: nothing.
   */
  missing?(): string;
  /** Calls `listener` as a slice reports how far it has got (KernelCalls.onProgress); returns the way to stop. Left out: the bar just says it is slicing. */
  onProgress?(listener: (progress: SliceProgress) => void): () => void;
  /** Called when the warm-up loop or Better grip is ticked or unticked (the build area counts them). */
  extrasChanged?(extras: FirstLayerExtras): void;
  /** The clock that tells a double press from two presses, in ms (the tests' own); left out, performance.now(). */
  now?(): number;
  /** Makes and saves the fit test piece's print file with these choices (Printer fits, fit-calibration.ts); left out, Printer fits is not offered. */
  testPiece?(choices: PrintChoices, file: FileChoices, alive: () => boolean): Promise<{ saved: boolean; name: string }>;
}

export interface SlicePrint {
  /** Opens the dialog. */
  ask(): void;
  /** Whether the dialog is open. */
  readonly open: boolean;
}

/**
 * The choices each toolbar slot's dialog had last, by the page and the slot's id (slicer hunt 2026-11-04, ui 1): Undo
 * and Redo put Design away and mount it again, which builds a new toolbar (#toolbar, or #split-toolbar in the split
 * view) with a new dialog in it, so the new dialog starts from these instead of the defaults. A page loaded again
 * starts fresh, and a slot with no id keeps nothing.
 */
const keptChoices = new WeakMap<Document, Map<string, PresetSettings>>();

export const SLICE_PRINT_TITLE = "Slice for printing: turn the bodies shown into a print file for a Bambu Lab P1S (0.4 mm nozzle, PLA).";

/**
 * The dialog, in the toolbar slot's page, modal (native <dialog>) like
 * Start fresh's: Close or Escape close it; keys pressed in it never reach
 * the app's shortcuts. Slice and download slices and saves, then says what
 * the slice came to; a refusal says why, in the engine's words.
 */
export function slicePrint(slot: HTMLElement, events: SlicePrintEvents): SlicePrint {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, text = "") => {
    const e = document.createElement(tag);
    e.id = id;
    if (text) e.textContent = text;
    return e;
  };
  const dialog = el("dialog", "slice-print-dialog");
  dialog.className = "slice-print";
  dialog.setAttribute("aria-labelledby", "slice-print-heading");
  const heading = el("h2", "slice-print-heading", "Slice for printing");
  const printer = el("p", "slice-print-printer", "For a Bambu Lab P1S with a 0.4 mm nozzle and PLA. Every body shown is printed, placed in the middle of the plate.");
  // Placeholders never pretend to work: until a real test print passes (H3a), the dialog says so.
  const untested = el("p", "slice-print-untested", "First version: these files haven't been test-printed yet, so open one in Bambu Studio or a G-code viewer to check it before printing it.");
  // What the print leaves out (failed timeline items): filled each time the dialog opens, hidden when nothing.
  const missingNote = el("p", "slice-print-missing");
  missingNote.hidden = true;
  const showMissing = () => {
    const words = events.missing?.() ?? "";
    missingNote.textContent = words;
    missingNote.hidden = words === "";
    return words;
  };
  const choice = <T extends string | number>(id: string, label: string, options: readonly { label: string; value: T }[], value: T) => {
    const wrap = document.createElement("label");
    wrap.className = "slice-print-choice";
    wrap.textContent = label;
    const select = el("select", id);
    select.classList.add("dark-select"); // styles/dark-select.css (packages/ui)
    for (const o of options) {
      const option = document.createElement("option");
      option.value = String(o.value);
      option.textContent = o.label;
      select.append(option);
    }
    select.value = String(value);
    wrap.append(select);
    return { wrap, select };
  };
  const quality = choice("slice-print-quality", "Quality", QUALITY_OPTIONS, PRINT_DEFAULTS.layerHeight);
  const walls = choice("slice-print-walls", "Walls", WALL_OPTIONS.map((n) => ({ label: `${n} ${n === 1 ? "wall" : "walls"}`, value: n })), PRINT_DEFAULTS.walls);
  const infill = choice("slice-print-infill", "Infill", INFILL_OPTIONS.map((n) => ({ label: `${n} %`, value: n })), PRINT_DEFAULTS.infill);
  // Supports: off by default, as most parts made to print need none; otherwise the engine props up every overhang steeper than 45° from upright, as columns or as trees.
  const supports = choice("slice-print-supports", "Supports", SUPPORT_OPTIONS, PRINT_DEFAULTS.supports);
  supports.wrap.title = "Prints break-away supports under parts that hang out too far (more than 45° from upright) to print on thin air. Normal: columns straight down under the whole overhang. Tree: branches that merge on the way down, usually less plastic and easier to snap off.";
  const format = choice("slice-print-format", "File", FORMAT_OPTIONS, FILE_DEFAULTS.format);
  format.wrap.title = "The P1S's own print file, with its start and end routines, ready to send to the printer; or plain G-code for another printer.";
  const plate = choice("slice-print-plate", "Build plate", PLATE_OPTIONS, FILE_DEFAULTS.plate);
  plate.wrap.title = "The plate on the printer's bed. The bed is heated for PLA on it: 55 °C on the textured and smooth plates, 35 °C on the Cool Plate, 45 °C on the SuperTack. The textured plate's first layer prints 0.04 mm lower, as its bumps stop the nozzle when the printer finds the bed.";
  const storage = (() => {
    try {
      return slot.ownerDocument.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  const nozzle = choice("slice-print-nozzle", "Nozzle", NOZZLE_OPTIONS, rememberedNozzle(storage));
  nozzle.wrap.title = "The nozzle on your P1S. Bambu Studio won't send a file made for the other kind (Standard is the one it comes with; High Flow is Bambu's faster hotend). Your choice is remembered.";
  // The warm-up loop: a tick box, on unless turned off here before (remembered like the nozzle).
  const warmUpWrap = document.createElement("label");
  warmUpWrap.className = "slice-print-choice slice-print-check";
  const warmUp = el("input", "slice-print-warm-up");
  warmUp.type = "checkbox";
  warmUp.checked = rememberedWarmUp(storage);
  warmUpWrap.append(warmUp, document.createTextNode("Warm-up loop"));
  warmUpWrap.title =
    "Prints two loops round the part's first layer before the part, so the nozzle's first, uneven plastic goes on a line you peel off afterwards instead of on the part. Helps when the start of the first layer doesn't stick. Your choice is remembered.";
  warmUp.addEventListener("change", () => {
    try {
      storage?.setItem(WARM_UP_KEY, warmUp.checked ? "on" : "off");
    } catch {
      // Storage blocked: the choice still holds for this dialog.
    }
    events.extrasChanged?.({ warmUp: warmUp.checked, betterGrip: grip.checked });
  });
  nozzle.select.addEventListener("change", () => {
    try {
      storage?.setItem(NOZZLE_KEY, nozzle.select.value);
    } catch {
      // Storage blocked: the choice still holds for this dialog.
    }
  });
  // The plate and the nozzle matter to the P1S's file only.
  const plateFor = () => {
    plate.select.disabled = format.select.value !== "p1s";
    nozzle.select.disabled = format.select.value !== "p1s";
  };
  format.select.addEventListener("change", plateFor);
  const status = el("p", "slice-print-status");
  status.setAttribute("role", "status");
  // The supports hint after a slice (Ben, 2026-11-04): recommended or not, by the bodies' overhangs (overhang.ts), and
  // one button that flips the Supports choice when it disagrees. Hidden until a slice, and again on any change.
  const hint = el("div", "slice-print-supports-hint");
  hint.className = "slice-print-supports-hint";
  hint.hidden = true;
  const hintWords = el("span", "slice-print-supports-hint-words");
  const flip = el("button", "slice-print-supports-flip");
  flip.type = "button";
  hint.append(hintWords, flip);
  let flipTo: SupportStyle | null = null;
  const showHint = (overhangMm2: number | undefined) => {
    const h = overhangMm2 === undefined ? null : supportsHint(overhangMm2, supports.select.value !== "off");
    hint.hidden = h === null;
    hint.dataset.recommended = String(h?.recommended ?? false);
    hintWords.textContent = h?.words ?? "";
    flipTo = h?.flip?.to ?? null;
    flip.hidden = h?.flip == null;
    flip.textContent = h?.flip?.label ?? "";
  };
  // The weight and cost badge after a slice (Ben, 2026-11-04, print-cost.ts): plastic, money and time in one line,
  // with the price per kg the user's to change (remembered); the words follow the box as it is typed. Hidden like the hint.
  const cost = el("div", "slice-print-cost");
  cost.className = "slice-print-cost";
  cost.hidden = true;
  const costText = el("span", "slice-print-cost-words");
  const priceWrap = document.createElement("label");
  priceWrap.className = "slice-print-cost-price";
  priceWrap.title = "What a 1 kg spool of your filament costs, in Australian dollars. Your price is remembered.";
  const price = el("input", "slice-print-price");
  price.type = "text";
  price.inputMode = "decimal";
  price.autocomplete = "off";
  let pricePerKg = rememberedPrice(storage);
  price.value = String(pricePerKg);
  priceWrap.append(document.createTextNode("A$ per kg"), price);
  cost.append(costText, priceWrap);
  let costOf: PrintFacts | null = null;
  const showCost = (print: PrintFacts | null) => {
    costOf = print;
    const words = print === null ? null : costWords(print, pricePerKg);
    cost.hidden = words === null;
    costText.textContent = words ?? "";
  };
  price.addEventListener("input", () => {
    const p = readPrice(price.value);
    price.setAttribute("aria-invalid", String(p === null));
    if (p === null) return; // the badge keeps the last price that read
    pricePerKg = p;
    try {
      storage?.setItem(PRICE_KEY, String(p));
    } catch {
      // Storage blocked: the price still holds for this dialog.
    }
    showCost(costOf);
  });
  // The bar while a slice runs (Ben, 2026-11-01): how far the engine has got, from its own reports; no value (the
  // browser's moving bar) until the first one, and hidden when nothing runs.
  const bar = el("div", "slice-print-progress");
  bar.hidden = true;
  const meter = el("progress", "slice-print-meter");
  meter.max = 1;
  meter.setAttribute("aria-labelledby", "slice-print-stage");
  const stage = el("span", "slice-print-stage");
  bar.append(meter, stage);
  const actions = el("div", "slice-print-actions");
  actions.className = "slice-print-actions";
  const close = el("button", "slice-print-close", "Close");
  close.type = "button";
  const preview = el("button", "slice-print-preview", "Preview");
  preview.type = "button";
  preview.title = "Watch it print: the slice in 3D, layer by layer, with a time-lapse of the nozzle laying it down.";
  const go = el("button", "slice-print-go", "Slice and download");
  go.title = "Slices the bodies shown and saves the file chosen above.";
  go.type = "button";
  // Better grip: a tick box, off unless turned on here before (remembered like the warm-up loop).
  const gripWrap = document.createElement("label");
  gripWrap.className = "slice-print-choice slice-print-check";
  const grip = el("input", "slice-print-grip");
  grip.type = "checkbox";
  grip.checked = rememberedBetterGrip(storage);
  gripWrap.append(grip, document.createTextNode("Better grip"));
  gripWrap.title =
    "Prints a 5 mm brim round the part's first layer, and prints that layer slower and 5 °C hotter, so parts whose first layer lifts or comes loose hold on to the plate. Peel the brim off afterwards. Your choice is remembered.";
  grip.addEventListener("change", () => {
    try {
      storage?.setItem(GRIP_KEY, grip.checked ? "on" : "off");
    } catch {
      // Storage blocked: the choice still holds for this dialog.
    }
    events.extrasChanged?.({ warmUp: warmUp.checked, betterGrip: grip.checked });
  });
  actions.append(close, preview, go);
  // The choices in one block: two columns where there is room, so the dialog fits a laptop's height (Ben 10-31: Supports was cut off).
  // Printer fits (P13): what the fits are for this nozzle, and the button that measures them (fit-calibration.ts).
  const fitsRow = el("p", "slice-print-fits");
  fitsRow.className = "slice-print-fits";
  const fitsWords = el("span", "slice-print-fits-words");
  const fitsOpen = el("button", "slice-print-fits-open", "Printer fits…");
  fitsOpen.type = "button";
  fitsOpen.title = "Print a small test piece, measure it, and holes and pegs come out the size you meant on your printer.";
  fitsRow.append(fitsWords, fitsOpen);
  const showFits = () => (fitsWords.textContent = fitsLine(storage, nozzle.select.value === "high-flow" ? "high-flow" : "standard"));
  showFits();
  nozzle.select.addEventListener("change", showFits);
  const fits = events.testPiece
    ? fitCalibration(slot, storage, {
        nozzle: () => (nozzle.select.value === "high-flow" ? "high-flow" : "standard"),
        testPiece: (alive) => events.testPiece!(choices(), file(), alive),
        changed: showFits,
      })
    : null;
  fitsRow.hidden = fits === null;
  fitsOpen.addEventListener("click", () => fits?.ask());
  const choices6 = document.createElement("div");
  choices6.className = "slice-print-choices";
  choices6.append(format.wrap, plate.wrap, nozzle.wrap, quality.wrap, walls.wrap, infill.wrap, supports.wrap, warmUpWrap, gripWrap);

  const say = (text: string, bad: boolean) => {
    status.textContent = text;
    status.classList.toggle("slice-print-bad", bad);
    // On a phone the dialog scrolls and the buttons stick to its bottom: bring the words into view, not under them.
    if (text) status.scrollIntoView?.({ block: "nearest" });
  };
  const choices = (): PrintChoices => ({ layerHeight: Number(quality.select.value), walls: Number(walls.select.value), infill: Number(infill.select.value), supports: supportStyle(supports.select.value), warmUp: warmUp.checked, betterGrip: grip.checked });
  const file = (): FileChoices => ({ format: format.select.value === "gcode" ? "gcode" : "p1s", plate: PLATE_OPTIONS.find((o) => o.value === plate.select.value)?.value ?? "textured", nozzle: nozzle.select.value === "high-flow" ? "high-flow" : "standard" });
  // Presets (Ben, 2026-11-04): the settings saved under a name, picked in the heading line (slice-presets.ts). Putting
  // one in goes through each choice's own change, so the nozzle, warm-up loop and Better grip are remembered as if picked.
  const inputs = { layerHeight: quality.select, walls: walls.select, infill: infill.select, supports: supports.select, format: format.select, plate: plate.select, nozzle: nozzle.select };
  const presets = presetBar(document, storage, {
    current: () => ({ ...choices(), ...file() }),
    apply(s) {
      for (const [k, select] of Object.entries(inputs)) {
        select.value = String(s[k as keyof typeof inputs]);
        select.dispatchEvent(new (document.defaultView?.Event ?? Event)("change"));
      }
      for (const [box, on] of [[warmUp, s.warmUp], [grip, s.betterGrip]] as const) {
        box.checked = on;
        box.dispatchEvent(new (document.defaultView?.Event ?? Event)("change"));
      }
    },
    say,
    settingsOf: presetSettingsOf,
  });
  // Mounted again (Undo, Redo): the choices the last dialog in this slot had, the preset picked marked as changed if they differ.
  if (slot.id && !keptChoices.has(document)) keptChoices.set(document, new Map());
  const keptHere = slot.id ? keptChoices.get(document) : undefined;
  const kept = keptHere?.get(slot.id);
  if (kept) {
    for (const [k, select] of Object.entries(inputs)) select.value = String(kept[k as keyof typeof inputs]);
    warmUp.checked = kept.warmUp;
    grip.checked = kept.betterGrip;
    plateFor();
    presets.changed();
  }
  const keep = () => keptHere?.set(slot.id, { ...choices(), ...file() });
  keep();
  // The heading and the presets share one line where there is room, so the dialog grows no taller.
  const top = document.createElement("div");
  top.className = "slice-print-top";
  top.append(heading, presets.element);
  dialog.append(top, printer, untested, missingNote, choices6, fitsRow, bar, status, cost, hint, actions);
  slot.append(dialog);
  let busy = false;
  /** Shows the bar from now until `end` is called, following the engine's reports. */
  const showProgress = () => {
    meter.removeAttribute("value");
    stage.textContent = progressWords(null);
    bar.hidden = false;
    let best = 0;
    const win = document.defaultView;
    const now = () => win?.performance?.now() ?? Date.now();
    const started = now();
    // While the engine writes the file it tells nothing: the bar creeps on by itself (fileCrawl), saying how long.
    let creep: ReturnType<typeof setInterval> | null = null;
    const stopCreep = () => {
      if (creep !== null) win?.clearInterval(creep);
      creep = null;
    };
    const startCreep = () => {
      const fileAt = now();
      const from = best;
      creep =
        win?.setInterval(() => {
          const inFile = now() - fileAt;
          meter.value = Math.max(meter.value, fileCrawl(from, fileAt - started, inFile));
          if (inFile >= 1000) stage.textContent = `Still writing the file… ${Math.floor(inFile / 1000)} s so far`;
        }, 250) ?? null;
    };
    const stop = events.onProgress?.((p) => {
      // Forward only: two calls (the plain slice after the file) each start from 0.
      if (!(p.fraction >= best)) return;
      best = p.fraction;
      meter.value = Math.max(creep === null ? 0 : meter.value, Math.min(1, Math.max(0, p.fraction)));
      if (creep === null || p.stage !== "file" || p.fraction >= 1) stage.textContent = progressWords(p);
      if (p.fraction >= 1) stopCreep();
      else if (p.stage === "file" && creep === null) startCreep();
    });
    return () => {
      stopCreep();
      stop?.();
      bar.hidden = true;
    };
  };
  // Closing the dialog drops a slice still running: its file is not saved and its preview not opened (slicer hunt
  // 2026-10-31), and the engine is stopped, so the design's edits don't wait behind it (slicer hunt 2026-11-04, ui 3).
  // While a slice runs, Close says Stop ("Cancel" is wider, and wraps the buttons onto two lines at 375 px): it stops
  // the slice and closes the dialog, whose choices stay for next time.
  let generation = 0;
  dialog.addEventListener("close", () => {
    generation++;
    if (busy) stopSlices();
    // The keyboard goes back to File ▾, where the dialog was opened from, as the print preview's does (slicer hunt 2026-11-04, ui 7).
    document.getElementById("file-menu")?.focus();
  });
  // A choice focused by Tab (or a phone keyboard's Next) under the buttons stuck to the dialog's bottom is scrolled up
  // clear of them (slicer hunt 2026-11-04, ui 6: Infill and Supports were hidden under them at 375 × 667).
  dialog.addEventListener("focusin", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || actions.contains(target)) return;
    const covered = target.getBoundingClientRect().bottom + 8 - actions.getBoundingClientRect().top;
    if (covered > 0 && actions.getBoundingClientRect().height > 0) dialog.scrollTop += covered;
  });
  const working = (on: boolean) => {
    busy = on;
    go.disabled = preview.disabled = on;
    close.textContent = on ? "Stop" : "Close";
    close.title = on ? "Stops the slice; nothing is saved." : "";
  };
  const alive = () => {
    const mine = generation;
    return () => mine === generation && dialog.open;
  };
  // A result stays displayed next to choices it no longer matches: any change clears it, and one made while a slice
  // runs is said with its result (slicer hunt 2026-11-04, ui 5).
  let changedWhileBusy = false;
  for (const c of [quality, walls, infill, supports, format, plate, nozzle, { select: warmUp }, { select: grip }])
    c.select.addEventListener("change", () => {
      if (busy) changedWhileBusy = true;
      else {
        say("", false);
        showHint(undefined);
        showCost(null);
      }
      presets.changed();
      keep();
    });
  // A double press, or presses while it slices and just after, are one slice and one file (clumsy-user hunt 11-04).
  // A disabled button hears no press, so the end of a slice counts as one: a tap that came during it waits again.
  // A changed choice (or a preset picked) asks for a new file, so its press is meant however soon.
  const clock = events.now ? () => events.now!() : undefined;
  const goRepeats = repeatGuard(clock);
  const previewRepeats = repeatGuard(clock);
  dialog.addEventListener("change", () => (goRepeats.reset(), previewRepeats.reset()));
  // One tap switches Supports to what the hint says; the next slice uses it.
  flip.addEventListener("click", () => {
    if (busy || flipTo === null) return;
    const on = flipTo !== "off";
    supports.select.value = flipTo;
    // Bubbling, as a person's pick does: the dialog hears a changed choice, so the next press of Slice is never taken for a repeat.
    supports.select.dispatchEvent(new (document.defaultView?.Event ?? Event)("change", { bubbles: true }));
    say(on ? "Supports turned on (Normal). Slice again to make the file with them." : "Supports turned off. Slice again to make the file without them.", false);
    go.focus();
  });
  go.addEventListener("click", async () => {
    if (goRepeats() || busy) return;
    working(true);
    changedWhileBusy = false;
    const mine = alive();
    say("Slicing…", false);
    showHint(undefined);
    showCost(null);
    const end = showProgress();
    try {
      const { print, saved, name } = await events.slice(choices(), file(), mine);
      end();
      const earlier = changedWhileBusy ? SLICE_EARLIER : null;
      const missing = showMissing() || null;
      const warnings = [missing, unprintedWords(print), print.levelNote || null, earlier].filter((w): w is string => w !== null);
      say([saved ? `Saved ${name}:` : "Sliced, but not saved:", printWords(print), ...warnings].join(" "), warnings.length > 0);
      showHint(print.overhangMm2);
      showCost(print);
    } catch (e) {
      end();
      // Dropped (closed, or stopped by Stop): nothing to say, the engine's "stopped" included.
      if (e instanceof SliceDropped || !mine()) say("", false);
      else say(refusalOf(e), true);
    } finally {
      working(false);
      goRepeats();
    }
  });
  preview.addEventListener("click", async () => {
    if (previewRepeats() || busy) return;
    working(true);
    changedWhileBusy = false;
    const mine = alive();
    say("Slicing…", false);
    showHint(undefined);
    showCost(null);
    const end = showProgress();
    try {
      await events.preview(choices(), file(), mine, () => changedWhileBusy);
      end();
      say("", false);
      dialog.close();
    } catch (e) {
      end();
      // Dropped (closed, or stopped by Stop): nothing to say, the engine's "stopped" included.
      if (e instanceof SliceDropped || !mine()) say("", false);
      else say(refusalOf(e), true);
    } finally {
      working(false);
      previewRepeats();
    }
  });
  close.addEventListener("click", () => dialog.close());
  // Its keys stay in it: a sketch tool key can't act behind the dialog.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  return {
    ask() {
      if (dialog.open) return;
      if (!busy) {
        say("", false); // a slice still running keeps saying so
        showHint(undefined);
        showCost(null);
      }
      presets.refresh(); // another tab may have changed them
      showMissing(); // the design may have changed since it last opened
      dialog.showModal();
      go.focus();
    },
    get open() {
      return dialog.open;
    },
  };
}
