// The Slice page's print panel (Slice as its own page, step 4b1): the beginner's choices (quality, walls, infill, supports),
// and a Slice button that slices the plate's bodies with them and says what it came to (layers, filament, time), the way
// Design's Slice for printing dialog does. The bodies' exact STL files come through the representation registry (Design
// hands them out as data), never from Design's code; the engine calls are @fission/print's. Styles: src/styles/slice-page.css.

import { GCODE_KIND } from "@fission/ui";
import type { BuildPlate, KernelCalls, SliceProgress, ListedObject, RepresentationRegistry } from "@fission/core";
import {
  costWords,
  fileCrawl,
  fitCalibration,
  fitsLine,
  FILE_DEFAULTS,
  FORMAT_OPTIONS,
  gcodeName,
  GRIP_KEY,
  INFILL_OPTIONS,
  NOZZLE_KEY,
  NOZZLE_OPTIONS,
  type NozzleType,
  P1S_KIND,
  type PrintFacts,
  type PrintFormat,
  progressWords,
  type PrintMade,
  presetBar,
  presetSettingsOf,
  PRICE_KEY,
  readPrice,
  rememberedPrice,
  settingsWords,
  WARM_UP_KEY,
  PLATE_OPTIONS,
  printFileName,
  gcodeOfPackage,
  printFileOfStls,
  printMovesOf,
  PRINT_DEFAULTS,
  QUALITY_OPTIONS,
  refusalOf,
  rememberedBetterGrip,
  rememberedNozzle,
  rememberedWarmUp,
  SliceDropped,
  sliceStls,
  stopSlices,
  SUPPORT_OPTIONS,
  unprintedWords,
  WALL_OPTIONS,
  printWords,
  type PrintChoices,
} from "@fission/print";

/** The exact STL file of every listed body, in order, read through the registry as data; a body that gives none stops the slice, in words. */
export async function plateFiles(registry: RepresentationRegistry, objects: readonly ListedObject[]): Promise<Uint8Array[]> {
  const files: Uint8Array[] = [];
  for (const o of objects) {
    const { representation } = await registry.deliver(o, ["data"]);
    const values = representation.kind === "data" ? representation.values : null;
    if (!values || values.format !== "stl" || !(values.bytes instanceof Uint8Array)) throw new Error(`${o.label} could not be turned into a print file`);
    files.push(values.bytes);
  }
  return files;
}

/** Said after a saved file goes into the print log. */
export const PRINT_LOGGED_WORDS = "Added to your print log.";

/** What a finished slice says: its layers, filament and time, a warning for plastic left out and the note on how the bodies sit. */
export function sliceWords(done: Parameters<typeof printWords>[0]): string {
  return [printWords(done), unprintedWords(done), done.levelNote].filter((x) => x).join(" ");
}

interface Choice<T> {
  label: string;
  options: readonly { label: string; value: T }[];
  current: T;
  /** What the state says now (read again when a preset is put in). */
  read(): T;
  pick(v: T): void;
}

/** What the panel needs of the page: where it is, how to read the plate and what the kernel is. */
export interface PrintPanelParts {
  kernel: KernelCalls;
  registry: RepresentationRegistry;
  /** The bodies on the plate now. */
  objects(): ListedObject[];
  storage: Pick<Storage, "getItem"> | null;
  /** Saves the print file the way the app saves files (the page passes `saveFile`): where the user picks, or a download. */
  save?(request: { suggestedName: string; kind: { description: string; mime: string; extension: string }; bytes: Uint8Array<ArrayBuffer> }): Promise<{ status: "saved"; name: string } | { status: "cancelled" } | { status: "failed"; message: string }>;
  /** Shows the print preview of a slice: its G-code and the words about it (the page passes the shared preview, over the view). */
  openPreview?(gcode: string, words: string): void;
  /** Adds a saved print file to the print log; true when it is kept (the page passes `logPrint`). */
  log?(made: PrintMade): boolean;
  /** Makes and saves the printer-fit test piece's print file for the choices (the page passes `testPieceFile` and `saveFile`); saved false when the save box was closed. `alive()` turns false once the panel is closed. */
  testPiece?(choices: PrintChoices, file: { format: PrintFormat; plate: BuildPlate; nozzle: NozzleType }, alive: () => boolean): Promise<{ saved: boolean; name: string }>;
  /** The slicing engine's reports while it works (the page passes the kernel's); returns the way to stop listening. */
  onProgress?(listener: (p: SliceProgress) => void): () => void;
  /** The design's name for the file's name (null: the default). */
  projectName?(): string | undefined;
}

export interface PrintPanel {
  element: HTMLElement;
  /** The choices as they stand. */
  choices(): PrintChoices;
  /** The file chosen: the P1S's print file or plain G-code, and for the P1S the build plate and nozzle. */
  file(): { format: PrintFormat; plate: BuildPlate; nozzle: NozzleType };
  /** Slices the plate with the choices; resolves when its words are on screen. */
  slice(): Promise<void>;
  /** Slices the plate as the P1S's file would be and opens the print preview of it; resolves once it is open (or its refusal is said). */
  preview(): Promise<void>;
  /** Slices the plate into the P1S's print file and saves it; resolves when its words are on screen. */
  download(): Promise<void>;
  destroy(): void;
}

export function printPanel(doc: Document, parts: PrintPanelParts): PrintPanel {
  let choices: PrintChoices = { ...PRINT_DEFAULTS, warmUp: rememberedWarmUp(parts.storage), betterGrip: rememberedBetterGrip(parts.storage) };
  let format: PrintFormat = FILE_DEFAULTS.format;
  let plate: BuildPlate = FILE_DEFAULTS.plate;
  let nozzle: NozzleType = rememberedNozzle(parts.storage);
  let live = true;
  let running = false;
  const element = doc.createElement("section");
  element.className = "slice-page slice-page-print";
  element.setAttribute("aria-label", "Print choices");
  const heading = doc.createElement("h2");
  heading.textContent = "Print";
  element.append(heading);

  const controls: HTMLSelectElement[] = [];
  /** Puts every control back to what the state says (a preset was picked); each choice and tick adds its own. */
  const syncs: (() => void)[] = [];
  /** Marks the preset picked as changed (set once the presets bar exists). */
  let presetsChanged = () => {};
  const addChoice = <T>(c: Choice<T>): HTMLSelectElement => {
    const label = doc.createElement("label");
    label.className = "slice-page-choice";
    label.append(doc.createTextNode(c.label));
    const select = doc.createElement("select");
    select.className = "dark-select";
    c.options.forEach((o, i) => {
      const opt = doc.createElement("option");
      opt.value = String(i);
      opt.textContent = o.label;
      select.append(opt);
    });
    select.value = String(Math.max(0, c.options.findIndex((o) => o.value === c.current)));
    select.addEventListener("change", () => {
      c.pick(c.options[Number(select.value)].value);
      presetsChanged();
    });
    syncs.push(() => (select.value = String(Math.max(0, c.options.findIndex((o) => o.value === c.read())))));
    label.append(select);
    controls.push(select);
    element.append(label);
    return select;
  };
  const numbers = (list: readonly number[], unit: string) => list.map((v) => ({ label: `${v}${unit}`, value: v }));
  addChoice({ label: "Quality", options: QUALITY_OPTIONS, current: choices.layerHeight, read: () => choices.layerHeight, pick: (v: number) => (choices = { ...choices, layerHeight: v }) });
  addChoice({ label: "Walls", options: numbers(WALL_OPTIONS, ""), current: choices.walls, read: () => choices.walls, pick: (v: number) => (choices = { ...choices, walls: v }) });
  addChoice({ label: "Infill", options: numbers(INFILL_OPTIONS, " %"), current: choices.infill, read: () => choices.infill, pick: (v: number) => (choices = { ...choices, infill: v }) });
  addChoice({ label: "Supports", options: SUPPORT_OPTIONS, current: choices.supports, read: () => choices.supports, pick: (v: PrintChoices["supports"]) => (choices = { ...choices, supports: v }) });

  // The file: the P1S's own print file (plate and nozzle matter to it only) or plain G-code for another printer.
  const plateSelect: { el: HTMLSelectElement | null } = { el: null };
  const nozzleSelect: { el: HTMLSelectElement | null } = { el: null };
  const plateAndNozzleMatter = () => {
    if (plateSelect.el) plateSelect.el.disabled = running || format !== "p1s";
    if (nozzleSelect.el) nozzleSelect.el.disabled = running || format !== "p1s";
  };
  addChoice({
    label: "File",
    options: FORMAT_OPTIONS,
    current: format,
    read: () => format,
    pick: (v: PrintFormat) => {
      format = v;
      plateAndNozzleMatter();
    },
  });
  plateSelect.el = addChoice({ label: "Build plate", options: PLATE_OPTIONS, current: plate, read: () => plate, pick: (v: BuildPlate) => (plate = v) });
  nozzleSelect.el = addChoice({
    label: "Nozzle",
    options: NOZZLE_OPTIONS,
    current: nozzle,
    read: () => nozzle,
    pick: (v: NozzleType) => {
      nozzle = v;
      try {
        (parts.storage as Storage | null)?.setItem?.(NOZZLE_KEY, v); // remembered like the dialog's
      } catch {
        // storage blocked: the choice still holds for this page
      }
    },
  });

  const button = doc.createElement("button");
  button.type = "button";
  button.id = "slice-page-slice";
  button.className = "slice-page-slice";
  button.textContent = "Slice";
  const download = doc.createElement("button");
  download.type = "button";
  download.id = "slice-page-download";
  download.className = "slice-page-slice slice-page-download";
  download.textContent = "Slice and download";
  download.title = "Slices the plate into a print file for a Bambu Lab P1S (0.4 mm nozzle, PLA) and saves it.";
  const previewButton = doc.createElement("button");
  previewButton.type = "button";
  previewButton.id = "slice-page-preview";
  previewButton.className = "slice-page-slice slice-page-preview";
  previewButton.textContent = "Preview";
  previewButton.title = "Watch it print: the slice in 3D, layer by layer, with a time-lapse of the nozzle laying it down.";
  // The warm-up loop and Better grip, ticked as remembered; they change the file, so they are part of the choices.
  const addCheck = (id: string, label: string, title: string, key: string, on: boolean, read: () => boolean, pick: (v: boolean) => void) => {
    const wrap = doc.createElement("label");
    wrap.className = "slice-page-choice slice-page-check";
    wrap.title = title;
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.id = id;
    box.checked = on;
    syncs.push(() => (box.checked = read()));
    box.addEventListener("change", () => {
      pick(box.checked);
      presetsChanged();
      try {
        (parts.storage as Storage | null)?.setItem?.(key, box.checked ? "on" : "off"); // remembered like the dialog's
      } catch {
        // storage blocked: the choice still holds for this page
      }
    });
    wrap.append(box, doc.createTextNode(label));
    controls.push(box as unknown as HTMLSelectElement);
    element.append(wrap);
  };
  addCheck("slice-page-warm-up", "Warm-up loop", "Prints two loops round the part's first layer before the part, so the nozzle's first, uneven plastic goes on a line you peel off afterwards instead of on the part. Helps when the start of the first layer doesn't stick. Your choice is remembered.", WARM_UP_KEY, choices.warmUp, () => choices.warmUp, (v) => (choices = { ...choices, warmUp: v }));
  addCheck("slice-page-grip", "Better grip", "Prints a 5 mm brim round the part's first layer, and prints that layer slower and 5 °C hotter, so parts whose first layer lifts or comes loose hold on to the plate. Peel the brim off afterwards. Your choice is remembered.", GRIP_KEY, choices.betterGrip, () => choices.betterGrip, (v) => (choices = { ...choices, betterGrip: v }));
  const status = doc.createElement("p");
  status.className = "slice-page-slice-words";
  status.setAttribute("role", "status");
  // The weight and cost line after a slice (print-cost.ts): plastic, money and time, with the price per kg the user's to change.
  const cost = doc.createElement("div");
  cost.className = "slice-page-cost";
  cost.hidden = true;
  const costText = doc.createElement("span");
  costText.className = "slice-page-cost-words";
  const priceWrap = doc.createElement("label");
  priceWrap.className = "slice-page-price";
  priceWrap.title = "What a 1 kg spool of your filament costs, in Australian dollars. Your price is remembered.";
  const price = doc.createElement("input");
  price.id = "slice-page-price";
  price.type = "text";
  price.inputMode = "decimal";
  price.autocomplete = "off";
  let pricePerKg = rememberedPrice(parts.storage);
  price.value = String(pricePerKg);
  priceWrap.append(doc.createTextNode("A$ per kg"), price);
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
    if (p === null) return; // the line keeps the last price that read
    pricePerKg = p;
    try {
      (parts.storage as Storage | null)?.setItem?.(PRICE_KEY, String(p));
    } catch {
      // storage blocked: the price still holds for this page
    }
    showCost(costOf);
  });
  // The bar while a slice runs: how far the engine has got from its own reports (no value until the first), and while it
  // writes the file, which it reports nothing of, it creeps on by itself (fileCrawl) saying how long it has been.
  const bar = doc.createElement("div");
  bar.className = "slice-page-progress";
  bar.hidden = true;
  const meter = doc.createElement("progress");
  meter.className = "slice-page-meter";
  meter.max = 1;
  const stage = doc.createElement("span");
  stage.className = "slice-page-stage";
  stage.setAttribute("role", "status");
  bar.append(meter, stage);
  element.append(button, previewButton, download, bar, status, cost);
  // Printer presets: the settings saved under a name in this browser (slice-presets.ts, shared with the dialog), picked
  // in the heading's line; picking one puts its settings in, and any change marks it changed.
  const applyPreset = (v: Parameters<typeof presetSettingsOf>[0] & object) => {
    const x = presetSettingsOf(v);
    if (!x) return;
    choices = { ...choices, layerHeight: x.layerHeight, walls: x.walls, infill: x.infill, supports: x.supports, warmUp: x.warmUp, betterGrip: x.betterGrip };
    format = x.format;
    plate = x.plate;
    nozzle = x.nozzle;
    for (const [key, value] of [[WARM_UP_KEY, x.warmUp], [GRIP_KEY, x.betterGrip]] as const) {
      try {
        (parts.storage as Storage | null)?.setItem?.(key, value ? "on" : "off"); // remembered as if ticked here
      } catch {
        // storage blocked: the choice still holds for this page
      }
    }
    try {
      (parts.storage as Storage | null)?.setItem?.(NOZZLE_KEY, x.nozzle);
    } catch {
      // storage blocked
    }
    for (const sync of syncs) sync();
    plateAndNozzleMatter();
    showFits();
    showCost(null);
  };
  const presets = presetBar(doc, parts.storage as Storage | null, {
    current: () => ({ ...choices, format, plate, nozzle }),
    apply: (settings) => applyPreset(settings),
    say: (text) => (status.textContent = text),
    settingsOf: presetSettingsOf,
  });
  presetsChanged = () => presets.changed();
  heading.after(presets.element);
  // Printer fits (P13): what the fits are for this nozzle, and the button that measures them (fit-calibration.ts).
  const fitsRow = doc.createElement("p");
  fitsRow.className = "slice-page-fits";
  const fitsWords = doc.createElement("span");
  fitsWords.className = "slice-page-fits-words";
  const fitsOpen = doc.createElement("button");
  fitsOpen.type = "button";
  fitsOpen.id = "slice-page-fits-open";
  fitsOpen.textContent = "Printer fits…";
  fitsOpen.title = "Print a small test piece, measure it, and holes and pegs come out the size you meant on your printer.";
  fitsRow.append(fitsWords, fitsOpen);
  function showFits() {
    fitsWords.textContent = fitsLine(parts.storage, nozzle);
  }
  showFits();
  nozzleSelect.el?.addEventListener("change", showFits);
  const fits = parts.testPiece
    ? fitCalibration(element, parts.storage as Storage | null, {
        nozzle: () => nozzle,
        testPiece: (alive) => parts.testPiece!(choices, { format, plate, nozzle }, alive),
        changed: showFits,
      })
    : null;
  fitsRow.hidden = fits === null;
  fitsOpen.addEventListener("click", () => fits?.ask());
  element.insertBefore(fitsRow, button);
  const showProgress = (): (() => void) => {
    meter.removeAttribute("value");
    stage.textContent = progressWords(null);
    bar.hidden = false;
    let best = 0;
    const win = doc.defaultView;
    const now = () => win?.performance?.now() ?? Date.now();
    const started = now();
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
    const stop = parts.onProgress?.((p) => {
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

  let endProgress: (() => void) | null = null;
  const busy = (on: boolean) => {
    running = on;
    if (on) endProgress = showProgress();
    else {
      endProgress?.();
      endProgress = null;
    }
    button.disabled = on;
    download.disabled = on;
    previewButton.disabled = on;
    for (const c of controls) c.disabled = on;
    plateAndNozzleMatter();
    button.textContent = on ? "Slicing…" : "Slice";
  };
  const previewPrint = async () => {
    if (running || !live) return;
    const objects = parts.objects();
    if (objects.length === 0) {
      status.textContent = "Nothing to slice: make or show a body in Design first.";
      return;
    }
    if (!parts.openPreview) {
      status.textContent = "The preview is not available here.";
      return;
    }
    busy(true);
    status.textContent = "";
    try {
      // The file the download would save: the P1S's own G-code (its time, filament and start routine), else the plain slice.
      const files = () => plateFiles(parts.registry, objects);
      const file = format === "p1s" ? await printFileOfStls(parts.kernel, files, choices, plate, nozzle) : null;
      const moves = file ? printMovesOf(gcodeOfPackage(file.package) ?? "") : null;
      const done = file && moves !== null ? { ...file, gcode: moves } : await sliceStls(parts.kernel, files, choices);
      if (!live) return;
      status.textContent = "";
      parts.openPreview(done.gcode, sliceWords(done));
    } catch (e) {
      if (live && !(e instanceof SliceDropped)) status.textContent = refusalOf(e);
    } finally {
      if (live) busy(false);
    }
  };
  const downloadFile = async () => {
    if (running || !live) return;
    const objects = parts.objects();
    if (objects.length === 0) {
      status.textContent = "Nothing to slice: make or show a body in Design first.";
      return;
    }
    if (!parts.save) {
      status.textContent = "Saving files is not available here.";
      return;
    }
    busy(true);
    status.textContent = "";
    showCost(null);
    try {
      const files = () => plateFiles(parts.registry, objects);
      const p1s = format === "p1s";
      const done = p1s ? await printFileOfStls(parts.kernel, files, choices, plate, nozzle) : await sliceStls(parts.kernel, files, choices);
      if (!live) return;
      const suggestedName = p1s ? printFileName(choices, plate, nozzle, parts.projectName?.()) : gcodeName(choices, parts.projectName?.());
      const bytes = p1s ? (done as { package: Uint8Array<ArrayBuffer> }).package : (new TextEncoder().encode((done as { gcode: string }).gcode) as Uint8Array<ArrayBuffer>);
      const r = await parts.save({ suggestedName, kind: p1s ? P1S_KIND : GCODE_KIND, bytes });
      if (!live) return;
      const saved = r.status === "saved" ? `Saved ${r.name}:` : r.status === "failed" ? `Sliced, but not saved (${r.message}):` : "Sliced, but not saved:";
      const logged = r.status === "saved" && parts.log?.({ name: parts.projectName?.() ?? "", settings: settingsWords(choices, nozzle), grams: done.filamentG, seconds: done.printTimeS });
      status.textContent = [saved, sliceWords(done), ...(logged ? [PRINT_LOGGED_WORDS] : [])].join(" ");
      showCost(done);
    } catch (e) {
      if (live && !(e instanceof SliceDropped)) status.textContent = refusalOf(e);
    } finally {
      if (live) busy(false);
    }
  };
  const slice = async () => {
    if (running || !live) return;
    const objects = parts.objects();
    if (objects.length === 0) {
      status.textContent = "Nothing to slice: make or show a body in Design first.";
      return;
    }
    busy(true);
    status.textContent = "";
    showCost(null);
    try {
      const done = await sliceStls(parts.kernel, () => plateFiles(parts.registry, objects), choices);
      if (live) {
        status.textContent = sliceWords(done);
        showCost(done);
      }
    } catch (e) {
      if (live && !(e instanceof SliceDropped)) status.textContent = refusalOf(e);
    } finally {
      if (live) busy(false);
    }
  };
  button.addEventListener("click", () => void slice());
  download.addEventListener("click", () => void downloadFile());
  previewButton.addEventListener("click", () => void previewPrint());
  return {
    element,
    choices: () => choices,
    file: () => ({ format, plate, nozzle }),
    slice,
    preview: previewPrint,
    download: downloadFile,
    destroy() {
      live = false;
      endProgress?.();
      endProgress = null;
      stopSlices(); // Close never leaves the engine working on a slice nobody will see
      element.remove();
    },
  };
}
