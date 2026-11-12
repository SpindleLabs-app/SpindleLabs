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
// marked on the bed, never moved back silently. So are two parts that
// overlap: for each pair whose boxes overlap the kernel is asked whether the
// shapes themselves do (overlap.ts), and the answer is said in words and
// marked on both parts. Styles: src/styles/laser-page.css.

import { NewerFormatError, type GeometryReference, type ListedObject, type MountedWorkspace, type Outline, type RepresentationRegistry, type WorkspaceContext } from "@fission/core";
import { saveFile, type SaveKind } from "@fission/ui";
import { planeSeenAs } from "@fission/viewport";
import { sheetDxf } from "./dxf.ts";
import { createFlatView, type FlatScene } from "./flat-view.ts";
import { OP_LOOK, opOf, overlapMatters, readOps, withOp, type LaserOp } from "./ops.ts";
import { BOX_MARGIN, partsRelation, type PartsRelation } from "./overlap.ts";
import { cleanMm, flippedOnTheSpot, layOutPlaced, mirrorOutline, normalAngle, offBedWords, overlapCandidates, placementRefusal, readPlacements, turnedOnTheSpot, type LaidLayout, type LaidPart, type Placement } from "./place.ts";
import { bedRefusal, DEFAULT_BED, DEFAULT_GAP, DEFAULT_THICKNESS, thicknessRefusal, mmWords, outlineBox, outlinePath, sheetSvg, type Bed, type Layout, type SheetPart } from "./sheet.ts";

/** Design's lister for flat shapes (Design's representations.ts DESIGN_OUTLINES). */
export const OUTLINES_LISTER = "design:outlines";

export const SVG_KIND: SaveKind = { description: "SVG drawing for a laser cutter", mime: "image/svg+xml", extension: ".svg" };
export const DXF_KIND: SaveKind = { description: "DXF drawing for a laser cutter", mime: "application/dxf", extension: ".dxf" };

/** What the project keeps for Laser: its own choices only, never Design's shapes. */
export interface LaserData {
  version: 4;
  bed: Bed;
  gap: number;
  /** The sheet's thickness, mm: kept for what engraving focuses on and joints are sized by later; nothing reads it yet, so the page has no box for it. */
  thickness: number;
  /** The parts turned off, by their id in Design. */
  off: string[];
  /** Where parts were put by hand (place.ts), by their id in Design; a part not here is laid out in rows. */
  placed: Record<string, Placement>;
  /** What the beam does to each part (ops.ts), by its id in Design; a part not here is cut. */
  ops: Record<string, LaserOp>;
}

/**
 * The version of Laser's data this build writes. 1: bed, gap, thickness, off. 2: `placed` (parts placed by hand, L1b1).
 * 3: `ops` (cut, score or engrave per part, L1c). 4: a placement may hold `flip` (mirrored left to right, L1b4).
 * A change to what the data holds takes the next number and a step in `readLaserProjectData`, so a build from before
 * it refuses the data instead of storing it again without the new part.
 */
export const LASER_DATA_VERSION = 4;

export const defaultLaserData = (): LaserData => ({ version: LASER_DATA_VERSION, bed: { ...DEFAULT_BED }, gap: DEFAULT_GAP, thickness: DEFAULT_THICKNESS, off: [], placed: {}, ops: {} });

/**
 * Laser's part of a project as it is opened (the plugin's `readData`, asked by core's `projectFromJson`): brought up to
 * the version this build writes, one step at a time, with everything else it holds kept. Data from a later Laser is
 * refused as newer (core's `NewerFormatError`: the project is then kept for a build that reads it, never stored again
 * with the unknown parts dropped); data that is not Laser's is refused in words.
 */
export function readLaserProjectData(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("Laser data must be an object");
  let d = data as Record<string, unknown>;
  const v = d.version;
  if (typeof v !== "number") throw new Error("Laser data has no version");
  if (!Number.isInteger(v) || v < 1) throw new Error(`Laser data version ${v} is not one this SpindleLabs reads`);
  if (v > LASER_DATA_VERSION) throw new NewerFormatError(`it was saved by a newer SpindleLabs (Laser data version ${v}; this one reads up to ${LASER_DATA_VERSION})`);
  // 1 → 2: parts placed by hand arrive (L1b1). Version 1 had none.
  if (d.version === 1) d = { ...d, version: 2, placed: {} };
  // 2 → 3: layers arrive (L1c). Every part of version 2 was cut, which is what no entry says.
  if (d.version === 2) d = { ...d, version: 3, ops: {} };
  // 3 → 4: a part may be flipped (L1b4). Version 3 flipped none, which is what no `flip` says; the number goes up so a
  // build from before refuses data with a flip instead of storing it again without it.
  if (d.version === 3) d = { ...d, version: 4 };
  return d;
}

/** The project's Laser data as the page uses it, read defensively: anything missing or not usable falls back to the default, never throws. */
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
  out.ops = readOps(d.ops);
  return out;
}

/** A shape Design offers: its outline when it has one, else why not, in words. */
/** A part Design offers: its outline, or why it can't be cut; `selectAs` is what the one selection holds when it is picked (L1b3). */
export type OfferedPart = ({ id: string; label: string; outline: Outline } | { id: string; label: string; refused: string }) & { selectAs?: GeometryReference };

/** Reads every flat shape Design lists, as exact outlines, through the registry; one that can't be read says why. */
export async function readParts(registry: RepresentationRegistry, objects: readonly ListedObject[]): Promise<OfferedPart[]> {
  const out: OfferedPart[] = [];
  for (const o of objects) {
    try {
      const { representation } = await registry.deliver(o, ["outline"]);
      if (representation.kind !== "outline") throw new Error(`it came as ${representation.kind}, not an outline`);
      // A sketch seen from behind its plane (a bottom, back or left face: `side` −1) was drawn looking at the face from
      // outside, where its own x and y run mirrored; it is laid out as it was seen, by the rule Design's Look At uses
      // (viewport `planeSeenAs`), so the part on the bed and in the files is what was drawn, never its mirror (L1b4).
      const outline = representation.side === -1 ? mirrorOutline(representation.outline, planeSeenAs(representation.plane, -1)) : representation.outline;
      outlineBox(outline); // a malformed outline is refused here, in words
      out.push({ id: o.id, label: o.label, outline, ...(o.selectAs && { selectAs: o.selectAs }) });
    } catch (e) {
      out.push({ id: o.id, label: o.label, refused: e instanceof Error ? e.message : String(e), ...(o.selectAs && { selectAs: o.selectAs }) });
    }
  }
  return out;
}

/** The parts to lay out: those with an outline and not turned off. */
export const partsOn = (offered: readonly OfferedPart[], off: readonly string[]): SheetPart[] =>
  offered.flatMap((p) => ("outline" in p && !off.includes(p.id) ? [{ id: p.id, label: p.label, outline: p.outline }] : []));

/** How two parts on the bed lie, as the page keeps it: their places in `layout.placed`, and the kernel's answer (overlap.ts). */
export interface PairRelation {
  a: number;
  b: number;
  relation: PartsRelation;
}

/**
 * What a pair's answer means for the person, or null when there is nothing to say (the parts lie apart). `mark` is set
 * when both parts are marked on the bed: they overlap, or they are too close to tell a touch from an overlap. Parts
 * that only touch are said, not marked: their cuts would share a line, which is the person's to judge.
 */
export function pairWords(aLabel: string, bLabel: string, r: PartsRelation): { words: string; mark: boolean } | null {
  if (r.relation === "apart") return null;
  if (r.relation === "overlap") return { words: `${aLabel} and ${bLabel} overlap.`, mark: true };
  if (r.relation === "touch") return { words: `${aLabel} and ${bLabel} touch: their cuts would share a line.`, mark: false };
  if (r.meet) return { words: `${aLabel} and ${bLabel} touch or overlap: they are too close to tell which.`, mark: true };
  return { words: `Couldn't check whether ${aLabel} and ${bLabel} overlap: ${r.why ?? "the kernel gave no answer"}.`, mark: false };
}

/** The words under the bed: how many parts are on it, each one left off with why, and (given the bed) each one reaching past its edge and each pair that overlaps or touches. */
export function layoutWords(layout: Layout, offered: number, bed?: Bed, pairs: readonly PairRelation[] = []): string {
  if (offered === 0) return "Nothing to cut yet: draw a closed sketch in DesignLab and it appears here.";
  const n = layout.placed.length;
  const on = n === 0 ? "No parts on the bed." : `${n} ${n === 1 ? "part" : "parts"} on the bed.`;
  const off = bed ? layout.placed.flatMap((p) => offBedWords(p, bed) ?? []) : [];
  const meet = pairs.flatMap((p) => pairWords(layout.placed[p.a]?.label ?? "?", layout.placed[p.b]?.label ?? "?", p.relation)?.words ?? []);
  return [on, ...layout.left.map((l) => `${l.label} is left off: ${l.why}.`), ...off, ...meet].join(" ");
}

/** Words for the middle of a bed with nothing on it, a line each; none when a part is on it. */
export function emptyBedNote(layout: Layout, offered: number): string[] {
  if (layout.placed.length > 0) return [];
  return offered === 0 ? ["Nothing to cut yet.", "Closed sketches from DesignLab appear here."] : ["No parts on the bed."];
}

/**
 * What the flat view draws: the bed, and each placed part by the path data
 * the saved SVG file gets (sheet.ts `outlinePath`, core's writer), so the
 * screen and the file can't differ, and no arc is worked out here.
 */
export function flatScene(layout: Layout, bed: Bed, offered: number, picked: string | null = null, pairs: readonly PairRelation[] = [], ops: Readonly<Record<string, LaserOp>> = {}): FlatScene {
  return {
    bed,
    parts: layout.placed.map((p, i) => {
      const off = offBedWords(p, bed);
      // The warnings without the part's own name ("off the bed: 5 mm past the right side", "overlaps Sketch 2"): they are said on the part itself.
      const warns = off ? [off.slice(p.label.length + 4, -1)] : [];
      for (const pair of pairs) {
        if (pair.a !== i && pair.b !== i) continue;
        const other = layout.placed[pair.a === i ? pair.b : pair.a];
        if (other && pairWords(p.label, other.label, pair.relation)?.mark) warns.push(pair.relation.relation === "overlap" ? `overlaps ${other.label}` : `touches or overlaps ${other.label}`);
      }
      return { id: p.id, label: p.label, op: opOf(ops, p.id), d: outlinePath(p.outline).d, box: { minX: p.x, minY: p.y, maxX: p.x + p.width, maxY: p.y + p.height }, ...(warns.length > 0 && { warn: warns.join("; ") }) };
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

/** Asks how two parts lie (overlap.ts `partsRelation`, the kernel's answer); a test passes its own. */
export type Relate = (a: Outline, b: Outline) => Promise<PartsRelation>;

/** The most answers about pairs of parts kept at once (each a pair of outlines as text and a word): past it the oldest go. */
const ANSWERS_KEPT = 400;

/** The page's mounting; `save` replaces the browser's save box and `relate` the kernel's answer about two parts (tests). */
export function mountLaserPage(ctx: WorkspaceContext, save?: SaveText, relate?: Relate): MountedWorkspace {
  const doc = ctx.toolbar.ownerDocument;
  const saveText = save ?? browserSave(doc);
  const relation: Relate = relate ?? ((a, b) => partsRelation(ctx.kernel, a, b));
  /** The kernel's answers about pairs of parts as they sit (both outlines, as text), so a redraw that moved neither asks nothing again. */
  const answers = new Map<string, PartsRelation>();
  /** The pairs being asked about now, by the same text. */
  const asking = new Set<string>();
  /** The pairs of the layout drawn whose answer is known. */
  let pairs: PairRelation[] = [];
  let live = true;
  let awake = true;
  let reading = 0;
  let offered: OfferedPart[] = [];
  let layout: LaidLayout = { placed: [], left: [] };
  /**
   * The part picked on the bed, by id: the one "Part" in the properties is about. It is the one selection's (L1b3): the
   * first selected thing that is a part on the bed now, so a sketch picked in Design is picked here and back. A part its
   * owner gives no reference for is picked here alone (`loose`), while nothing is selected.
   */
  let picked: string | null = null;
  let loose: string | null = null;
  /** True while this page changes the selection itself, so its own change draws once. */
  let selecting = false;
  const pickedNow = (): string | null => {
    const items = ctx.selection.items;
    for (const r of items) {
      const p = offered.find((o) => o.selectAs?.kind === r.kind && o.selectAs.id === r.id);
      if (p && layout.placed.some((q) => q.id === p.id)) return p.id; // one Design picked that isn't on the bed is passed over
    }
    return items.length === 0 ? loose : null;
  };
  /** Makes part `id` (or nothing) the selection; draws nothing. */
  const select = (id: string | null) => {
    const ref = id === null ? undefined : offered.find((o) => o.id === id)?.selectAs;
    loose = ref || id === null ? null : id;
    selecting = true;
    try {
      if (ref) ctx.selection.set([ref]);
      else ctx.selection.clear();
    } finally {
      selecting = false;
    }
    picked = pickedNow();
  };
  // Heard for as long as the page is mounted; drawn only while on screen (waking draws what was picked meanwhile).
  const stopFollowing = ctx.selection.onChange((items) => {
    if (items.length > 0) loose = null;
    if (!selecting && awake) draw(false);
  });

  const data = () => readLaserData(ctx.project.workspaces.laser);
  const store = (next: LaserData, label: string, mergeKey?: string) => {
    // Over what the project holds, so anything there beside the fields this page knows stays in the project.
    const held = ctx.project.workspaces.laser;
    ctx.project.workspaces.laser = typeof held === "object" && held !== null && !Array.isArray(held) ? { ...held, ...next } : next;
    ctx.projectChanged(label, mergeKey);
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
<div class="laser-page-turns"><button type="button" data-turn="90">Turn left</button><button type="button" data-turn="-90">Turn right</button><button type="button" data-flip>Flip</button><button type="button" data-rows>Back in the rows</button></div>
</fieldset>
<div class="laser-page-files"><button type="button" data-save="svg">Save SVG</button><button type="button" data-save="dxf">Save DXF</button></div>
<p class="laser-page-note">Drag a part on the bed to move it; X and Y are its lower-left corner from the bed's. Sizes are exact, in mm, with arcs kept as arcs. Each part is cut, scored or engraved: in the files cut is red, score blue and engrave black, done in the order engrave, score, cut. A DXF can't hold a filled shape, so an engraving is its outline on the ENGRAVE layer: set that layer to fill in your laser program. Kerf, power and speed are set in your laser program for now.</p>`;
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
      select(id);
      draw(false);
    },
    onMove: (id, dx, dy, key) => {
      const p = layout.placed.find((x) => x.id === id);
      if (p) put(p, { x: cleanMm(p.x + dx), y: cleanMm(p.y + dy), angle: p.angle, ...(p.flip && { flip: true as const }) }, `Move ${p.label} on the laser bed`, key ? `laser-move-${id}` : undefined);
    },
    onTurn: (id, degrees) => turn(id, degrees),
    onFlip: (id) => flip(id),
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
    select(p.id);
    if (why) {
      draw(false);
      partWords.textContent = why;
      return false;
    }
    const now = data();
    const placed: Record<string, Placement> = { ...now.placed };
    for (const q of layout.placed) if (!Object.hasOwn(placed, q.id)) placed[q.id] = { x: q.x, y: q.y, angle: q.angle }; // a part not yet in `placed` is in the rows: unturned, unflipped
    placed[p.id] = { x: at.x, y: at.y, angle: normalAngle(at.angle), ...(at.flip && { flip: true as const }) };
    store({ ...now, placed }, label, mergeKey);
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
    put(p, turnedOnTheSpot(source.outline, p, angle, p.flip), `Turn ${p.label} on the laser bed`);
  };
  /** Mirrors part `id` left to right where it sits (L1b4): what was drawn on a sheet's other side, or a part wanted the other way round. */
  const flip = (id: string) => {
    const p = layout.placed.find((x) => x.id === id);
    const source = offered.find((o) => o.id === id);
    if (!p || !source || !("outline" in source)) return;
    put(p, flippedOnTheSpot(source.outline, p), `Flip ${p.label} on the laser bed`);
  };

  const draw = (frame: boolean): void => {
    const d = data();
    layout = layOutPlaced(partsOn(offered, d.off), d.bed, d.gap, d.placed);
    picked = pickedNow();
    const part = layout.placed.find((p) => p.id === picked) ?? null;
    if (!part) {
      if (picked === loose) loose = null; // a part picked here alone that is gone from the bed is let go
      picked = null; // one picked elsewhere stays in the selection: it is just not on the bed
    }
    // Pairs whose boxes overlap or all but touch (further apart, the parts are apart and nothing is asked): the answer kept
    // for them as they sit, or the kernel asked (the page is drawn again when it answers).
    pairs = [];
    for (const [a, b] of overlapCandidates(layout.placed, BOX_MARGIN)) {
      if (!overlapMatters(opOf(d.ops, layout.placed[a].id), opOf(d.ops, layout.placed[b].id))) continue; // an engraving or a score on a part is what it is for
      const key = JSON.stringify([layout.placed[a].outline, layout.placed[b].outline]);
      const known = answers.get(key);
      if (known) pairs.push({ a, b, relation: known });
      else if (!asking.has(key)) {
        asking.add(key);
        void relation(layout.placed[a].outline, layout.placed[b].outline)
          .catch((e): PartsRelation => ({ relation: "unknown", why: e instanceof Error ? e.message : String(e) }))
          .then((answer) => {
            asking.delete(key);
            if (answers.size >= ANSWERS_KEPT) answers.delete(answers.keys().next().value!);
            answers.set(key, answer);
            if (live) draw(false);
          });
      }
    }
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
          if (!box.checked && picked === p.id) select(null); // taken off the bed, it is let go
          const now = data();
          store({ ...now, off: box.checked ? now.off.filter((x) => x !== p.id) : [...now.off, p.id] }, box.checked ? `Put ${p.label} on the laser bed` : `Take ${p.label} off the laser bed`);
          draw(false);
        });
        const b = outlineBox(p.outline);
        label.append(box, ` ${p.label}, ${mmWords(b.maxX - b.minX)} × ${mmWords(b.maxY - b.minY)} mm`);
        // What the beam does to it (L1c): cut unless said.
        const op = doc.createElement("select");
        op.className = "laser-page-op dark-select";
        op.dataset.op = p.id;
        op.setAttribute("aria-label", `What the laser does to ${p.label}`);
        for (const o of ["cut", "score", "engrave"] as const) {
          const choice = op.appendChild(doc.createElement("option"));
          choice.value = o;
          choice.textContent = OP_LOOK[o].name;
        }
        op.value = opOf(d.ops, p.id);
        op.addEventListener("change", () => {
          const now = data();
          const next = op.value as LaserOp;
          store({ ...now, ops: withOp(now.ops, p.id, next) }, `${OP_LOOK[next].name} ${p.label} on the laser`);
          draw(false);
        });
        li.append(label, op);
        return li;
      }),
    );
    words.textContent = layoutWords(layout, offered.length, d.bed, pairs);
    for (const b of buttons) b.disabled = layout.placed.length === 0;
    arrange.hidden = Object.keys(d.placed).length === 0;
    partBox.hidden = part === null;
    if (part) {
      partBox.querySelector("legend")!.textContent = part.label;
      input("x").value = String(part.x);
      input("y").value = String(part.y);
      input("angle").value = String(part.angle);
      const at = layout.placed.indexOf(part);
      const meets = pairs.flatMap((p) => (p.a === at || p.b === at ? (pairWords(layout.placed[p.a].label, layout.placed[p.b].label, p.relation)?.words ?? []) : []));
      const said = [offBedWords(part, d.bed) ?? [], meets].flat();
      partWords.textContent = said.length > 0 ? said.join(" ") : part.by === "rows" ? "In the rows. Move or turn it and every part stays where it is." : "";
      partBox.querySelector<HTMLButtonElement>("button[data-rows]")!.hidden = part.by === "rows";
    }
    flat.show(flatScene(layout, d.bed, offered.length, picked, pairs, d.ops), frame);
  };

  // The picked part's numbers, typed.
  const onPart = (name: string) => {
    const p = layout.placed.find((x) => x.id === picked);
    if (!p) return;
    const typed = input(name).value.trim() === "" ? NaN : Number(input(name).value);
    if (name === "angle") return turn(p.id, 0, typed);
    put(p, { x: name === "x" ? typed : p.x, y: name === "y" ? typed : p.y, angle: p.angle, ...(p.flip && { flip: true as const }) }, `Move ${p.label} on the laser bed`);
  };
  for (const name of ["x", "y", "angle"]) input(name).addEventListener("change", () => onPart(name));
  for (const b of panel.querySelectorAll<HTMLButtonElement>("button[data-turn]")) b.addEventListener("click", () => picked !== null && turn(picked, Number(b.dataset.turn)));
  panel.querySelector<HTMLButtonElement>("button[data-flip]")!.addEventListener("click", () => picked !== null && flip(picked));
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
        const saved = await saveText(svg ? sheetSvg(layout, d.bed, ctx.project.name || "Laser sheet", d.ops) : sheetDxf(layout, d.bed, d.ops), name(), svg ? SVG_KIND : DXF_KIND);
        if (live) words.textContent = saved === false ? `Save ${svg ? "SVG" : "DXF"} cancelled: nothing was saved.` : `Saved ${saved}: ${layoutWords(layout, offered.length, d.bed, pairs)}`;
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
      stopFollowing();
      if (awake) hideView();
      awake = false;
      list.remove();
      panel.remove();
    },
  };
}
