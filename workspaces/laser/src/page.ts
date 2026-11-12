// The Laser page (step L1a, behind `?laser`, flag.ts): Design's flat shapes
// (its sketches and ready-made profiles) laid out on the laser's bed, drawn
// from above in the shared view, and saved as SVG or DXF at true size.
//
// The shapes are read through the representation registry (Design's
// "design:outlines" lister and its outline producer), never from Design's
// own code, and never copied into the project: every time the page shows
// it reads them again, so a sketch changed in Design is changed here. The
// project keeps only Laser's own choices (`LaserData`: the bed, the gap,
// the parts turned off). Styles: src/styles/laser-page.css.

import type { DisplayMesh, KernelCalls, ListedObject, MountedWorkspace, Outline, RepresentationRegistry, WorkspaceContext } from "@fission/core";
import { saveFile, type SaveKind } from "@fission/ui";
import { sheetDxf } from "./dxf.ts";
import { bedRefusal, DEFAULT_BED, DEFAULT_GAP, DEFAULT_THICKNESS, layOut, thicknessRefusal, mmWords, outlineBox, sheetSvg, type Bed, type Layout, type SheetPart } from "./sheet.ts";

/** Design's lister for flat shapes (Design's representations.ts DESIGN_OUTLINES). */
export const OUTLINES_LISTER = "design:outlines";

export const SVG_KIND: SaveKind = { description: "SVG drawing for a laser cutter", mime: "image/svg+xml", extension: ".svg" };
export const DXF_KIND: SaveKind = { description: "DXF drawing for a laser cutter", mime: "application/dxf", extension: ".dxf" };

/** What the project keeps for Laser: its own choices only, never Design's shapes. */
export interface LaserData {
  version: 1;
  bed: Bed;
  gap: number;
  /** The sheet's thickness, mm: how the parts are drawn now; what engraving focuses on and joints are sized by later. */
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
  if (offered === 0) return "Nothing to cut yet: draw a closed sketch in DesignLab and it appears here.";
  const n = layout.placed.length;
  const on = n === 0 ? "No parts on the bed." : `${n} ${n === 1 ? "part" : "parts"} on the bed.`;
  return [on, ...layout.left.map((l) => `${l.label} is left off: ${l.why}.`)].join(" ");
}

/** The parts as the kernel draws them: each placed outline made a sheet `thickness` thick (make_extrude), so the view is the
 * kernel's own tessellation of the exact arcs, never one worked out here (packages/CLAUDE.md: 2D curve maths lives in the
 * kernel). A part the kernel refuses is counted with why, never drawn wrong. */
export async function partMeshes(kernel: KernelCalls, layout: Layout, thickness: number): Promise<{ meshes: DisplayMesh[]; failed: { label: string; why: string }[] }> {
  const meshes: DisplayMesh[] = [];
  const failed: { label: string; why: string }[] = [];
  for (const p of layout.placed) {
    try {
      meshes.push((await kernel.call("make_extrude", p.outline, thickness)).mesh);
    } catch (e) {
      failed.push({ label: p.label, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { meshes, failed };
}

/** How far under the parts the bed is drawn, mm, so their bottoms never flicker against it. */
export const BED_DROP = 0.05;

/** The bed seen from above (two triangles just under z = 0, outlined) with the parts' meshes on it, as one mesh. Pure. */
export function bedMesh(bed: Bed, parts: readonly DisplayMesh[]): DisplayMesh {
  const { width: w, height: h } = bed;
  const z = -BED_DROP;
  const out: DisplayMesh = {
    positions: [0, 0, z, w, 0, z, w, h, z, 0, h, z],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
    triangle_faces: [0, 0],
    edge_lines: [0, 0, z, w, 0, z, w, 0, z, w, h, z, w, h, z, 0, h, z, 0, h, z, 0, 0, z],
    edge_line_edges: [0, 0, 0, 0],
  };
  let face = 1;
  for (const m of parts) {
    const base = out.positions.length / 3;
    out.positions.push(...m.positions);
    out.normals.push(...m.normals);
    out.indices.push(...m.indices.map((i) => i + base));
    const faces = m.triangle_faces.length === 0 ? 0 : Math.max(...m.triangle_faces) + 1;
    out.triangle_faces.push(...m.triangle_faces.map((f) => f + face));
    face += faces;
    out.edge_lines.push(...m.edge_lines);
    out.edge_line_edges.push(...m.edge_line_edges.map(() => 0));
  }
  return out;
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
<label class="laser-page-field">Sheet thickness <input name="thickness" type="number" min="0" max="50" step="any" inputmode="decimal"> mm</label>
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
    input("thickness").value = String(d.thickness);
  };

  /** Counts the view's builds: a later one replaces an earlier one still asking the kernel. */
  let drawing = 0;
  const draw = async (frame: boolean): Promise<void> => {
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
          void draw(false);
        });
        const b = outlineBox(p.outline);
        label.append(box, ` ${p.label}, ${mmWords(b.maxX - b.minX)} × ${mmWords(b.maxY - b.minY)} mm`);
        li.append(label);
        return li;
      }),
    );
    words.textContent = layoutWords(layout, offered.length);
    for (const b of buttons) b.disabled = layout.placed.length === 0;
    const mine = ++drawing;
    const { meshes, failed } = await partMeshes(ctx.kernel, layout, d.thickness);
    if (!live || mine !== drawing) return;
    if (failed.length > 0) words.textContent += ` ${failed.map((f) => `${f.label} could not be drawn: ${f.why}.`).join(" ")}`;
    if (awake) {
      ctx.viewport.showBody(bedMesh(d.bed, meshes));
      if (frame) ctx.viewport.setView("top"); // frames the bed from above (fit() would frame it from the home view)
    }
  };

  const onBed = () => {
    const width = Number(input("width").value);
    const height = Number(input("height").value);
    const gap = Number(input("gap").value);
    const thickness = Number(input("thickness").value);
    const empty = ["width", "height", "gap", "thickness"].some((n) => input(n).value.trim() === "");
    const why = empty ? "Type a number of mm in each box." : (bedRefusal({ width, height }, gap) ?? thicknessRefusal(thickness));
    if (why) {
      words.textContent = why;
      for (const b of buttons) b.disabled = true;
      return;
    }
    store({ ...data(), bed: { width, height }, gap, thickness }, "Change the laser bed");
    void draw(true);
  };
  for (const name of ["width", "height", "gap", "thickness"]) input(name).addEventListener("change", onBed);

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
    await draw(frame);
  };
  const ready = show(true);
  return {
    ready,
    sleep() {
      awake = false;
    },
    wake() {
      awake = true;
      void show(false); // the design may have changed while another workspace was on screen
    },
    unmount() {
      live = false;
      list.remove();
      panel.remove();
    },
  };
}
