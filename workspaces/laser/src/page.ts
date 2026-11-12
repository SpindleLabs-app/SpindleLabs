// The Laser page (steps L1a and L1a2, behind `?laser`, flag.ts): Design's flat
// shapes (its sketches and ready-made profiles) laid out on the laser's bed,
// shown flat from above (flat-view.ts: laser cutting is 2D, so the view only
// slides and zooms), and saved as SVG or DXF at true size.
//
// The shapes are read through the representation registry (Design's
// "design:outlines" lister and its outline producer), never from Design's
// own code, and never copied into the project: every time the page shows
// it reads them again, so a sketch changed in Design is changed here. The
// project keeps only Laser's own choices (`LaserData`: the bed, the gap,
// the parts turned off). Styles: src/styles/laser-page.css.

import type { ListedObject, MountedWorkspace, Outline, RepresentationRegistry, WorkspaceContext } from "@fission/core";
import { saveFile, type SaveKind } from "@fission/ui";
import { sheetDxf } from "./dxf.ts";
import { createFlatView, type FlatScene } from "./flat-view.ts";
import { bedRefusal, DEFAULT_BED, DEFAULT_GAP, DEFAULT_THICKNESS, layOut, thicknessRefusal, mmWords, outlineBox, outlinePath, sheetSvg, type Bed, type Layout, type SheetPart } from "./sheet.ts";

/** Design's lister for flat shapes (Design's representations.ts DESIGN_OUTLINES). */
export const OUTLINES_LISTER = "design:outlines";

export const SVG_KIND: SaveKind = { description: "SVG drawing for a laser cutter", mime: "image/svg+xml", extension: ".svg" };
export const DXF_KIND: SaveKind = { description: "DXF drawing for a laser cutter", mime: "application/dxf", extension: ".dxf" };

/** What the project keeps for Laser: its own choices only, never Design's shapes. */
export interface LaserData {
  version: 1;
  bed: Bed;
  gap: number;
  /** The sheet's thickness, mm: kept for what engraving focuses on and joints are sized by later; nothing reads it yet, so the page has no box for it. */
  thickness: number;
  /** The parts turned off, by their id in Design. */
  off: string[];
}

export const defaultLaserData = (): LaserData => ({ version: 1, bed: { ...DEFAULT_BED }, gap: DEFAULT_GAP, thickness: DEFAULT_THICKNESS, off: [] });

/** The project's Laser data, read defensively: anything missing or not usable falls back to the default, never throws. */
export function readLaserData(data: unknown): LaserData {
  const out = defaultLaserData();
  if (typeof data !== "object" || data === null) return out;
  const d = data as Record<string, unknown>;
  const bed = d.bed as Record<string, unknown> | undefined;
  const width = typeof bed?.width === "number" ? bed.width : out.bed.width;
  const height = typeof bed?.height === "number" ? bed.height : out.bed.height;
  const gap = typeof d.gap === "number" ? d.gap : out.gap;
  if (bedRefusal({ width, height }, gap) === null) {
    out.bed = { width, height };
    out.gap = gap;
  }
  if (typeof d.thickness === "number" && thicknessRefusal(d.thickness) === null) out.thickness = d.thickness;
  if (Array.isArray(d.off)) out.off = d.off.filter((x): x is string => typeof x === "string");
  return out;
}

/** A shape Design offers: its outline when it has one, else why not, in words. */
export type OfferedPart = { id: string; label: string; outline: Outline } | { id: string; label: string; refused: string };

/** Reads every flat shape Design lists, as exact outlines, through the registry; one that can't be read says why. */
export async function readParts(registry: RepresentationRegistry, objects: readonly ListedObject[]): Promise<OfferedPart[]> {
  const out: OfferedPart[] = [];
  for (const o of objects) {
    try {
      const { representation } = await registry.deliver(o, ["outline"]);
      if (representation.kind !== "outline") throw new Error(`it came as ${representation.kind}, not an outline`);
      outlineBox(representation.outline); // a malformed outline is refused here, in words
      out.push({ id: o.id, label: o.label, outline: representation.outline });
    } catch (e) {
      out.push({ id: o.id, label: o.label, refused: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** The parts to lay out: those with an outline and not turned off. */
export const partsOn = (offered: readonly OfferedPart[], off: readonly string[]): SheetPart[] =>
  offered.flatMap((p) => ("outline" in p && !off.includes(p.id) ? [{ id: p.id, label: p.label, outline: p.outline }] : []));

/** The words under the bed: how many parts are on it, and each one left off with why. */
export function layoutWords(layout: Layout, offered: number): string {
  if (offered === 0) return "Nothing to cut yet: draw a closed sketch in Design and it appears here.";
  const n = layout.placed.length;
  const on = n === 0 ? "No parts on the bed." : `${n} ${n === 1 ? "part" : "parts"} on the bed.`;
  return [on, ...layout.left.map((l) => `${l.label} is left off: ${l.why}.`)].join(" ");
}

/** Words for the middle of a bed with nothing on it, a line each; none when a part is on it. */
export function emptyBedNote(layout: Layout, offered: number): string[] {
  if (layout.placed.length > 0) return [];
  return offered === 0 ? ["Nothing to cut yet.", "Closed sketches from Design appear here."] : ["No parts on the bed."];
}

/**
 * What the flat view draws: the bed, and each placed part by the path data
 * the saved SVG file gets (sheet.ts `outlinePath`, core's writer), so the
 * screen and the file can't differ, and no arc is worked out here.
 */
export function flatScene(layout: Layout, bed: Bed, offered: number): FlatScene {
  return {
    bed,
    parts: layout.placed.map((p) => ({ id: p.id, label: p.label, d: outlinePath(p.outline).d, box: { minX: p.x, minY: p.y, maxX: p.x + p.width, maxY: p.y + p.height } })),
    note: emptyBedNote(layout, offered),
  };
}

/** Hands a file to the person (the browser's save box); a test passes its own. */
export type SaveText = (text: string, name: string, kind: SaveKind) => Promise<string | false>;

const browserSave =
  (doc: Document): SaveText =>
  async (text, name, kind) => {
    const r = await saveFile(doc, { suggestedName: name, kind, bytes: text });
    if (r.status === "failed") throw new Error(r.message);
    return r.status === "saved" ? r.name : false;
  };

/** The page's mounting; `save` replaces the browser's save box (tests). */
export function mountLaserPage(ctx: WorkspaceContext, save?: SaveText): MountedWorkspace {
  const doc = ctx.toolbar.ownerDocument;
  const saveText = save ?? browserSave(doc);
  let live = true;
  let awake = true;
  let reading = 0;
  let offered: OfferedPart[] = [];
  let layout: Layout = { placed: [], left: [] };

  const data = () => readLaserData(ctx.project.workspaces.laser);
  const store = (next: LaserData, label: string) => {
    ctx.project.workspaces.laser = next;
    ctx.projectChanged(label);
  };

  // The parts, in the browser.
  const list = doc.createElement("section");
  list.className = "laser-page";
  list.setAttribute("aria-label", "Parts");
  list.innerHTML = `<h2>Parts</h2>`;
  const items = doc.createElement("ul");
  items.className = "laser-page-parts";
  list.append(items);
  ctx.browser.append(list);

  // The bed and the files, in the properties.
  const panel = doc.createElement("section");
  panel.className = "laser-page";
  panel.setAttribute("aria-label", "Laser bed");
  panel.innerHTML = `<h2>Laser bed</h2>
<label class="laser-page-field">Width <input name="width" type="number" min="1" max="3000" step="any" inputmode="decimal"> mm</label>
<label class="laser-page-field">Height <input name="height" type="number" min="1" max="3000" step="any" inputmode="decimal"> mm</label>
<label class="laser-page-field">Gap between parts <input name="gap" type="number" min="0" step="any" inputmode="decimal"> mm</label>
<p class="laser-page-words" role="status"></p>
<div class="laser-page-files"><button type="button" data-save="svg">Save SVG</button><button type="button" data-save="dxf">Save DXF</button></div>
<p class="laser-page-note">Sizes are exact, in mm, with arcs kept as arcs. Kerf, power and speed are set in your laser program for now.</p>`;
  ctx.properties.append(panel);
  const input = (name: string) => panel.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const words = panel.querySelector<HTMLElement>(".laser-page-words")!;
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button[data-save]")];

  const fill = () => {
    const d = data();
    input("width").value = String(d.bed.width);
    input("height").value = String(d.bed.height);
    input("gap").value = String(d.gap);
  };

  // The view: flat, over the shared viewport's empty 2D view (the body, the 3D grid and the view cube are away meanwhile).
  const flat = createFlatView(doc, { cards: () => [ctx.browser, ctx.properties] });
  const showView = () => {
    ctx.viewport.showImage(null);
    flat.attach(ctx.viewport.element);
  };
  const hideView = () => {
    flat.detach();
    ctx.viewport.clearImage(); // the body and the 3D camera come back as they were
  };
  flat.show({ bed: data().bed, parts: [] }, true); // the project's own bed at once, empty until Design's shapes have been read
  showView();

  const draw = (frame: boolean): void => {
    const d = data();
    layout = layOut(partsOn(offered, d.off), d.bed, d.gap);
    items.replaceChildren(
      ...offered.map((p) => {
        const li = doc.createElement("li");
        if ("refused" in p) {
          li.className = "laser-page-refused";
          li.textContent = `${p.label}: can't be cut: ${p.refused}`;
          return li;
        }
        const label = doc.createElement("label");
        const box = doc.createElement("input");
        box.type = "checkbox";
        box.checked = !d.off.includes(p.id);
        box.dataset.part = p.id;
        box.addEventListener("change", () => {
          const now = data();
          store({ ...now, off: box.checked ? now.off.filter((x) => x !== p.id) : [...now.off, p.id] }, box.checked ? `Put ${p.label} on the laser bed` : `Take ${p.label} off the laser bed`);
          draw(false);
        });
        const b = outlineBox(p.outline);
        label.append(box, ` ${p.label}, ${mmWords(b.maxX - b.minX)} × ${mmWords(b.maxY - b.minY)} mm`);
        li.append(label);
        return li;
      }),
    );
    words.textContent = layoutWords(layout, offered.length);
    for (const b of buttons) b.disabled = layout.placed.length === 0;
    flat.show(flatScene(layout, d.bed, offered.length), frame);
  };

  const onBed = () => {
    const width = Number(input("width").value);
    const height = Number(input("height").value);
    const gap = Number(input("gap").value);
    const empty = ["width", "height", "gap"].some((n) => input(n).value.trim() === "");
    const why = empty ? "Type a number of mm in each box." : bedRefusal({ width, height }, gap);
    if (why) {
      words.textContent = why;
      for (const b of buttons) b.disabled = true;
      return;
    }
    const before = data();
    store({ ...before, bed: { width, height }, gap }, "Change the laser bed");
    draw(width !== before.bed.width || height !== before.bed.height); // a new bed is shown whole; a new gap moves the parts, not the view
  };
  for (const name of ["width", "height", "gap"]) input(name).addEventListener("change", onBed);

  const name = () => (ctx.project.name || "laser-sheet").replace(/[\\/:*?"<>|]+/g, "-");
  for (const b of buttons)
    b.addEventListener("click", async () => {
      const d = data();
      const svg = b.dataset.save === "svg";
      try {
        const saved = await saveText(svg ? sheetSvg(layout, d.bed, ctx.project.name || "Laser sheet") : sheetDxf(layout, d.bed), name(), svg ? SVG_KIND : DXF_KIND);
        if (live) words.textContent = saved === false ? `Save ${svg ? "SVG" : "DXF"} cancelled: nothing was saved.` : `Saved ${saved}: ${layoutWords(layout, offered.length)}`;
      } catch (e) {
        if (live) words.textContent = `Could not save the file: ${e instanceof Error ? e.message : String(e)}`;
      }
    });

  const show = async (frame: boolean) => {
    const mine = ++reading;
    const next = await readParts(ctx.representations, ctx.representations.objectsOf(OUTLINES_LISTER, ctx.project));
    if (!live || mine !== reading) return;
    offered = next;
    fill();
    draw(frame);
  };
  const ready = show(true);
  return {
    ready,
    sleep() {
      if (!awake) return;
      awake = false;
      hideView();
    },
    wake() {
      if (awake) return;
      awake = true;
      showView();
      void show(false); // the design may have changed while another workspace was on screen
    },
    unmount() {
      live = false;
      if (awake) hideView();
      awake = false;
      list.remove();
      panel.remove();
    },
  };
}
