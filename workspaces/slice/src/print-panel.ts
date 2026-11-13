// The Slice page's print panel (Slice as its own page, step 4b1): the beginner's choices (quality, walls, infill, supports),
// and a Slice button that slices the plate's bodies with them and says what it came to (layers, filament, time), the way
// Design's Slice for printing dialog does. The bodies' exact STL files come through the representation registry (Design
// hands them out as data), never from Design's code; the engine calls are @fission/print's. Styles: src/styles/slice-page.css.

import type { BuildPlate, KernelCalls, ListedObject, RepresentationRegistry } from "@fission/core";
import {
  costWords,
  FILE_DEFAULTS,
  GRIP_KEY,
  INFILL_OPTIONS,
  NOZZLE_KEY,
  NOZZLE_OPTIONS,
  type NozzleType,
  P1S_KIND,
  type PrintFacts,
  type PrintMade,
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
  save?(request: { suggestedName: string; kind: typeof P1S_KIND; bytes: Uint8Array<ArrayBuffer> }): Promise<{ status: "saved"; name: string } | { status: "cancelled" } | { status: "failed"; message: string }>;
  /** Shows the print preview of a slice: its G-code and the words about it (the page passes the shared preview, over the view). */
  openPreview?(gcode: string, words: string): void;
  /** Adds a saved print file to the print log; true when it is kept (the page passes `logPrint`). */
  log?(made: PrintMade): boolean;
  /** The design's name for the file's name (null: the default). */
  projectName?(): string | undefined;
}

export interface PrintPanel {
  element: HTMLElement;
  /** The choices as they stand. */
  choices(): PrintChoices;
  /** The build plate and nozzle chosen. */
  file(): { plate: BuildPlate; nozzle: NozzleType };
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
  const addChoice = <T>(c: Choice<T>) => {
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
    select.addEventListener("change", () => c.pick(c.options[Number(select.value)].value));
    label.append(select);
    controls.push(select);
    element.append(label);
  };
  const numbers = (list: readonly number[], unit: string) => list.map((v) => ({ label: `${v}${unit}`, value: v }));
  addChoice({ label: "Quality", options: QUALITY_OPTIONS, current: choices.layerHeight, pick: (v: number) => (choices = { ...choices, layerHeight: v }) });
  addChoice({ label: "Walls", options: numbers(WALL_OPTIONS, ""), current: choices.walls, pick: (v: number) => (choices = { ...choices, walls: v }) });
  addChoice({ label: "Infill", options: numbers(INFILL_OPTIONS, " %"), current: choices.infill, pick: (v: number) => (choices = { ...choices, infill: v }) });
  addChoice({ label: "Supports", options: SUPPORT_OPTIONS, current: choices.supports, pick: (v: PrintChoices["supports"]) => (choices = { ...choices, supports: v }) });

  addChoice({ label: "Build plate", options: PLATE_OPTIONS, current: plate, pick: (v: BuildPlate) => (plate = v) });
  addChoice({
    label: "Nozzle",
    options: NOZZLE_OPTIONS,
    current: nozzle,
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
  const addCheck = (id: string, label: string, title: string, key: string, on: boolean, pick: (v: boolean) => void) => {
    const wrap = doc.createElement("label");
    wrap.className = "slice-page-choice slice-page-check";
    wrap.title = title;
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.id = id;
    box.checked = on;
    box.addEventListener("change", () => {
      pick(box.checked);
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
  addCheck("slice-page-warm-up", "Warm-up loop", "Prints two loops round the part's first layer before the part, so the nozzle's first, uneven plastic goes on a line you peel off afterwards instead of on the part. Helps when the start of the first layer doesn't stick. Your choice is remembered.", WARM_UP_KEY, choices.warmUp, (v) => (choices = { ...choices, warmUp: v }));
  addCheck("slice-page-grip", "Better grip", "Prints a 5 mm brim round the part's first layer, and prints that layer slower and 5 °C hotter, so parts whose first layer lifts or comes loose hold on to the plate. Peel the brim off afterwards. Your choice is remembered.", GRIP_KEY, choices.betterGrip, (v) => (choices = { ...choices, betterGrip: v }));
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
  element.append(button, previewButton, download, status, cost);

  const busy = (on: boolean) => {
    running = on;
    button.disabled = on;
    download.disabled = on;
    previewButton.disabled = on;
    for (const c of controls) c.disabled = on;
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
      const file = await printFileOfStls(parts.kernel, files, choices, plate, nozzle);
      const moves = printMovesOf(gcodeOfPackage(file.package) ?? "");
      const done = moves !== null ? { ...file, gcode: moves } : await sliceStls(parts.kernel, files, choices);
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
      const done = await printFileOfStls(parts.kernel, () => plateFiles(parts.registry, objects), choices, plate, nozzle);
      if (!live) return;
      const suggestedName = printFileName(choices, plate, nozzle, parts.projectName?.());
      const r = await parts.save({ suggestedName, kind: P1S_KIND, bytes: done.package });
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
    file: () => ({ plate, nozzle }),
    slice,
    preview: previewPrint,
    download: downloadFile,
    destroy() {
      live = false;
      stopSlices(); // Close never leaves the engine working on a slice nobody will see
      element.remove();
    },
  };
}
