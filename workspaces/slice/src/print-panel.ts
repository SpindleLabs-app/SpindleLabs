// The Slice page's print panel (Slice as its own page, step 4b1): the beginner's choices (quality, walls, infill, supports),
// and a Slice button that slices the plate's bodies with them and says what it came to (layers, filament, time), the way
// Design's Slice for printing dialog does. The bodies' exact STL files come through the representation registry (Design
// hands them out as data), never from Design's code; the engine calls are @fission/print's. Styles: src/styles/slice-page.css.

import type { KernelCalls, ListedObject, RepresentationRegistry } from "@fission/core";
import {
  INFILL_OPTIONS,
  PRINT_DEFAULTS,
  QUALITY_OPTIONS,
  refusalOf,
  rememberedBetterGrip,
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
}

export interface PrintPanel {
  element: HTMLElement;
  /** The choices as they stand. */
  choices(): PrintChoices;
  /** Slices the plate with the choices; resolves when its words are on screen. */
  slice(): Promise<void>;
  destroy(): void;
}

export function printPanel(doc: Document, parts: PrintPanelParts): PrintPanel {
  let choices: PrintChoices = { ...PRINT_DEFAULTS, warmUp: rememberedWarmUp(parts.storage), betterGrip: rememberedBetterGrip(parts.storage) };
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

  const button = doc.createElement("button");
  button.type = "button";
  button.id = "slice-page-slice";
  button.className = "slice-page-slice";
  button.textContent = "Slice";
  const status = doc.createElement("p");
  status.className = "slice-page-slice-words";
  status.setAttribute("role", "status");
  element.append(button, status);

  const busy = (on: boolean) => {
    running = on;
    button.disabled = on;
    for (const c of controls) c.disabled = on;
    button.textContent = on ? "Slicing…" : "Slice";
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
    try {
      const done = await sliceStls(parts.kernel, () => plateFiles(parts.registry, objects), choices);
      if (live) status.textContent = sliceWords(done);
    } catch (e) {
      if (live && !(e instanceof SliceDropped)) status.textContent = refusalOf(e);
    } finally {
      if (live) busy(false);
    }
  };
  button.addEventListener("click", () => void slice());
  return {
    element,
    choices: () => choices,
    slice,
    destroy() {
      live = false;
      stopSlices(); // Close never leaves the engine working on a slice nobody will see
      element.remove();
    },
  };
}
