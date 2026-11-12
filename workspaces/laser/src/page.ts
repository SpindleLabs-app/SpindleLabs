// The Laser page (steps L1a, L1a2 and L1b, behind `?laser`, flag.ts): Design's flat
// shapes (its sketches and ready-made profiles) laid out on the laser's bed,
// shown flat from above (flat-view.ts: laser cutting is 2D, so the view only
// slides and zooms), and saved as SVG or DXF at true size.
//
// The shapes are read through the representation registry (Design's
// "design:outlines" lister and its outline producer), never from Design's
// own code, and never copied into the project: every time the page shows
// it reads them again, so a sketch changed in Design is changed here. The
// project keeps only Laser's own choices (`LaserData`: the bed, the gap,
// the parts turned off, where parts were put by hand).
//
// Parts start in rows. Once the person moves or turns one (a drag on the
// bed, the arrows, the Turn button, or numbers typed under "Part"), every
// part on the bed keeps the place it has (`LaserData.placed`, by the part's
// id in Design), so nothing else shifts; parts drawn later find room in rows
// round them, and "Arrange in rows" forgets every place. A part may be put
// anywhere, so one reaching past the bed's edge is said so in words and
// marked on the bed, never moved back silently. Styles: src/styles/laser-page.css.

import type { ListedObject, MountedWorkspace, Outline, RepresentationRegistry, WorkspaceContext } from "@fission/core";
import { saveFile, type SaveKind } from "@fission/ui";
import { sheetDxf } from "./dxf.ts";
import { createFlatView, type FlatScene } from "./flat-view.ts";
import { cleanMm, layOutPlaced, normalAngle, offBedWords, placementRefusal, readPlacements, turnedOnTheSpot, type LaidLayout, type LaidPart, type Placement } from "./place.ts";
import { bedRefusal, DEFAULT_BED, DEFAULT_GAP, DEFAULT_THICKNESS, thicknessRefusal, mmWords, outlineBox, outlinePath, sheetSvg, type Bed, type Layout, type SheetPart } from "./sheet.ts";

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
  /** Where parts were put by hand (place.ts), by their id in Design; a part not here is laid out in rows. */
  placed: Record<string, Placement>;
}

export const defaultLaserData = (): LaserData => ({ version: 1, bed: { ...DEFAULT_BED }, gap: DEFAULT_GAP, thickness: DEFAULT_THICKNESS, off: [], placed: {} });

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
  out.placed = readPlacements(d.placed);
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

/** The words under the bed: how many parts are on it, each one left off with why, and (given the bed) each one reaching past its edge. */
export function layoutWords(layout: Layout, offered: number, bed?: Bed): string {
  if (offered === 0) return "Nothing to cut yet: draw a closed sketch in Design and it appears here.";
  const n = layout.placed.length;
  const on = n === 0 ? "No parts on the bed." : `${n} ${n === 1 ? "part" : "parts"} on the bed.`;
  const off = bed ? layout.placed.flatMap((p) => offBedWords(p, bed) ?? []) : [];
  return [on, ...layout.left.map((l) => `${l.label} is left off: ${l.why}.`), ...off].join(" ");
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
export function flatScene(layout: Layout, bed: Bed, offered: number, picked: string | null = null): FlatScene {
  return {
    bed,
    parts: layout.placed.map((p) => {
      const off = offBedWords(p, bed);
      // The warning without the part's name ("off the bed: 5 mm past the right side"): it is said on the part itself.
      return { id: p.id, label: p.label, d: outlinePath(p.outline).d, box: { minX: p.x, minY: p.y, maxX: p.x + p.width, maxY: p.y + p.height }, ...(off && { warn: off.slice(p.label.length + 4, -1) }) };
    }),
    note: emptyBedNote(layout, offered),
    picked,
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
  let layout: LaidLayout = { placed: [], left: [] };
  /** The part picked on the bed, by id: the one "Part" in the properties is about. */
  let picked: string | null = null;

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
<button type="button" class="laser-page-arrange" data-arrange>Arrange in rows</button>
<fieldset class="laser-page-part" hidden>
<legend></legend>
<label class="laser-page-field">X <input name="x" type="number" step="any" inputmode="decimal"> mm</label>
<label class="laser-page-field">Y <input name="y" type="number" step="any" inputmode="decimal"> mm</label>
<label class="laser-page-field">Angle <input name="angle" type="number" step="any" inputmode="decimal"> °</label>
<p class="laser-page-part-words" role="status"></p>
<div class="laser-page-turns"><button type="button" data-turn="90">Turn left</button><button type="button" data-turn="-90">Turn right</button><button type="button" data-rows>Back in the rows</button></div>
</fieldset>
<div class="laser-page-files"><button type="button" data-save="svg">Save SVG</button><button type="button" data-save="dxf">Save DXF</button></div>
<p class="laser-page-note">Drag a part on the bed to move it; X and Y are its lower-left corner from the bed's. Sizes are exact, in mm, with arcs kept as arcs. Kerf, power and speed are set in your laser program for now.</p>`;
  ctx.properties.append(panel);
  const input = (name: string) => panel.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const words = panel.querySelector<HTMLElement>(".laser-page-words")!;
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button[data-save]")];
  const arrange = panel.querySelector<HTMLButtonElement>("button[data-arrange]")!;
  const partBox = panel.querySelector<HTMLFieldSetElement>(".laser-page-part")!;
  const partWords = panel.querySelector<HTMLElement>(".laser-page-part-words")!;

  const fill = () => {
    const d = data();
    input("width").value = String(d.bed.width);
    input("height").value = String(d.bed.height);
    input("gap").value = String(d.gap);
  };

  // The view: flat, over the shared viewport's empty 2D view (the body, the 3D grid and the view cube are away meanwhile).
  const flat = createFlatView(doc, {
    cards: () => [ctx.browser, ctx.properties],
    onPick: (id) => {
      picked = id;
      draw(false);
    },
    onMove: (id, dx, dy, key) => {
      const p = layout.placed.find((x) => x.id === id);
      if (p) put(p, { x: cleanMm(p.x + dx), y: cleanMm(p.y + dy), angle: p.angle }, `Move ${p.label} on the laser bed`, key ? `laser-move-${id}` : undefined);
    },
    onTurn: (id, degrees) => turn(id, degrees),
  });
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

  /**
   * Puts part `p` at `at` (said in words and left alone when it can't be). The first part put by hand fixes every part
   * on the bed where it is now, so nothing else shifts as the rows close up behind it.
   */
  const put = (p: LaidPart, at: Placement, label: string, mergeKey?: string): boolean => {
    const why = placementRefusal(at);
    picked = p.id;
    if (why) {
      draw(false);
      partWords.textContent = why;
      return false;
    }
    const now = data();
    const placed: Record<string, Placement> = { ...now.placed };
    for (const q of layout.placed) if (!Object.hasOwn(placed, q.id)) placed[q.id] = { x: q.x, y: q.y, angle: q.angle };
    placed[p.id] = { x: at.x, y: at.y, angle: normalAngle(at.angle) };
    ctx.project.workspaces.laser = { ...now, placed };
    ctx.projectChanged(label, mergeKey);
    draw(false);
    return true;
  };
  /** Turns part `id` to `angle` degrees (or by `by`) about the middle of its box, so it turns on the spot. */
  const turn = (id: string, by: number, to?: number) => {
    const p = layout.placed.find((x) => x.id === id);
    const source = offered.find((o) => o.id === id);
    if (!p || !source || !("outline" in source)) return;
    const angle = to ?? p.angle + by;
    if (!Number.isFinite(angle)) {
      partWords.textContent = "A part's place and angle must be numbers.";
      return;
    }
    put(p, turnedOnTheSpot(source.outline, p, angle), `Turn ${p.label} on the laser bed`);
  };

  const draw = (frame: boolean): void => {
    const d = data();
    layout = layOutPlaced(partsOn(offered, d.off), d.bed, d.gap, d.placed);
    const part = layout.placed.find((p) => p.id === picked) ?? null;
    if (!part) picked = null;
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
    words.textContent = layoutWords(layout, offered.length, d.bed);
    for (const b of buttons) b.disabled = layout.placed.length === 0;
    arrange.hidden = Object.keys(d.placed).length === 0;
    partBox.hidden = part === null;
    if (part) {
      partBox.querySelector("legend")!.textContent = part.label;
      input("x").value = String(part.x);
      input("y").value = String(part.y);
      input("angle").value = String(part.angle);
      partWords.textContent = offBedWords(part, d.bed) ?? (part.by === "rows" ? "In the rows. Move or turn it and every part stays where it is." : "");
      partBox.querySelector<HTMLButtonElement>("button[data-rows]")!.hidden = part.by === "rows";
    }
    flat.show(flatScene(layout, d.bed, offered.length, picked), frame);
  };

  // The picked part's numbers, typed.
  const onPart = (name: string) => {
    const p = layout.placed.find((x) => x.id === picked);
    if (!p) return;
    const typed = input(name).value.trim() === "" ? NaN : Number(input(name).value);
    if (name === "angle") return turn(p.id, 0, typed);
    put(p, { x: name === "x" ? typed : p.x, y: name === "y" ? typed : p.y, angle: p.angle }, `Move ${p.label} on the laser bed`);
  };
  for (const name of ["x", "y", "angle"]) input(name).addEventListener("change", () => onPart(name));
  for (const b of panel.querySelectorAll<HTMLButtonElement>("button[data-turn]")) b.addEventListener("click", () => picked !== null && turn(picked, Number(b.dataset.turn)));
  panel.querySelector<HTMLButtonElement>("button[data-rows]")!.addEventListener("click", () => {
    const p = layout.placed.find((x) => x.id === picked);
    const now = data();
    if (!p || !Object.hasOwn(now.placed, p.id)) return;
    const { [p.id]: _gone, ...placed } = now.placed;
    store({ ...now, placed }, `Put ${p.label} back in the rows`);
    draw(false);
  });
  arrange.addEventListener("click", () => {
    store({ ...data(), placed: {} }, "Arrange the laser parts in rows");
    draw(false);
  });

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
        if (live) words.textContent = saved === false ? `Save ${svg ? "SVG" : "DXF"} cancelled: nothing was saved.` : `Saved ${saved}: ${layoutWords(layout, offered.length, d.bed)}`;
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
