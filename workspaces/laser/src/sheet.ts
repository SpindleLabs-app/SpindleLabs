// The laser bed and the parts laid out on it (Laser step L1a). Pure: no DOM, no kernel.
//
// Coordinates are the bed's, in mm, with the origin at the bed's lower-left
// corner and y up, as the model's (Design's sketches) are; the SVG file
// flips y when it writes (core svg.ts), the DXF file does not need to.
//
// A part is an exact outline (lines, arcs and circles, as the kernel gives
// it), moved onto the bed by adding the same (dx, dy) to every corner and
// circle centre. Bulges don't change under a move, so nothing is
// approximated: what is cut is the shape drawn.
//
// Layout (until parts can be dragged): rows from the lower-left corner, in
// the order Design lists them, `gap` mm between parts and from the bed's
// edges. A part goes right of the one before; one that would cross the
// right edge starts a new row above the tallest part of the row. A part
// bigger than the bed, or one with no room left above, is left off and
// said so in words, never placed over the edge or over another part.

import { outlineToSvg, svgNumber, type Loop, type Outline } from "@fission/core";
import { OP_LOOK, opOf, OPS, type LaserOp } from "./ops.ts";

/** An outline's box in model coordinates (y up). */
export interface OutlineBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The outline's path data as core's `outlineToSvg` writes it (outer loop then
 * holes, y flipped, arcs as quarter-turn pieces) and its exact box, read from
 * that file: its viewBox starts at (min x, −max y), rounded to 1e-6 mm as the
 * file writes it, and its width and height are the box's exact size. Read from core's public writer rather than
 * worked out again here, so the arc maths stays in one place (it moves to
 * the kernel's 2D curve library with K1). A malformed outline throws, in words.
 */
export function outlinePath(outline: Outline): { d: string; box: OutlineBox } {
  const svg = outlineToSvg(outline);
  const d = /<path d="([^"]*)"/.exec(svg.text)?.[1];
  const view = /viewBox="(\S+) (\S+) /.exec(svg.text);
  if (d === undefined || view === null) throw new Error("core's SVG writer gave no path");
  const minX = Number(view[1]);
  const maxY = -Number(view[2]) + 0; // never −0 (a top edge on y = 0)
  return { d, box: { minX, minY: maxY - svg.height, maxX: minX + svg.width, maxY } };
}

/** A flat shape offered to the laser: its id and type (to find it again in Design), its name, its exact outline. */
export interface SheetPart {
  id: string;
  label: string;
  outline: Outline;
}

/** The laser's work area, mm. */
export interface Bed {
  width: number;
  height: number;
}

/** A part on the bed: its outline moved there, and where its box sits (lower-left corner, size). */
export interface PlacedPart {
  id: string;
  label: string;
  outline: Outline;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What `layOut` made: the parts placed, and those left off with why, in words. */
export interface Layout {
  placed: PlacedPart[];
  left: { id: string; label: string; why: string }[];
}

/** A bed most hobby and school lasers cover (a 400 × 400 mm diode frame, larger CO2 beds). Changed in the page. */
export const DEFAULT_BED: Bed = { width: 400, height: 400 };
/** mm between parts, and from the bed's edges. */
export const DEFAULT_GAP = 3;
/** The largest bed side accepted, mm (3 m: past every desktop and school machine). */
export const MAX_BED = 3000;

/** The sheet thickness used until a material sets it, mm (3 mm plywood or acrylic: the commonest school sheet). */
export const DEFAULT_THICKNESS = 3;
/** The thickest sheet accepted, mm: past what any hobby or school laser cuts. */
export const MAX_THICKNESS = 50;

/** Why this sheet thickness can't be used, in words, or null when it can. */
export function thicknessRefusal(t: number): string | null {
  if (!Number.isFinite(t) || t <= 0) return "The sheet's thickness must be a number of mm above 0.";
  if (t > MAX_THICKNESS) return `The sheet's thickness can be at most ${MAX_THICKNESS} mm.`;
  return null;
}

/** Why these bed numbers can't be used, in words, or null when they can. */
export function bedRefusal(bed: Bed, gap: number): string | null {
  for (const [name, v] of [
    ["width", bed.width],
    ["height", bed.height],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0) return `The bed's ${name} must be a number of mm above 0.`;
    if (v > MAX_BED) return `The bed's ${name} can be at most ${MAX_BED} mm.`;
  }
  if (!Number.isFinite(gap) || gap < 0) return "The gap between parts must be 0 mm or more.";
  if (2 * gap >= Math.min(bed.width, bed.height)) return "The gap is too big for the bed: nothing would fit between the edges.";
  return null;
}

/** The outline's box (y up): corners, circles and each arc's extremes, its corner to 1e-6 mm (outlinePath). Throws, in words, for a malformed outline. */
export function outlineBox(outline: Outline): OutlineBox {
  return outlinePath(outline).box;
}

function moveLoop(loop: Loop, dx: number, dy: number): Loop {
  if ("circle" in loop) return { circle: { center: [loop.circle.center[0] + dx, loop.circle.center[1] + dy], radius: loop.circle.radius } };
  const corners = loop.path.corners.map((v, i) => v + (i % 2 === 0 ? dx : dy));
  return { path: { corners, bulges: [...loop.path.bulges] } };
}

/** The outline moved by (dx, dy): every corner and circle centre, bulges and radii unchanged. Holes stay holes. */
export function moveOutline(outline: Outline, dx: number, dy: number): Outline {
  return { outer: moveLoop(outline.outer, dx, dy), holes: outline.holes.map((h) => moveLoop(h, dx, dy)) };
}

/** A length in words: at most 4 decimals, no trailing zeros. */
export const mmWords = (v: number) => `${Number(v.toFixed(4))}`;

/** Lays the parts on the bed in rows (the file's comment). `bed` and `gap` must pass `bedRefusal`. */
export function layOut(parts: readonly SheetPart[], bed: Bed, gap: number): Layout {
  const placed: PlacedPart[] = [];
  const left: Layout["left"] = [];
  let x = gap;
  let y = gap;
  let row = 0; // the tallest part in this row
  for (const part of parts) {
    let box: OutlineBox;
    try {
      box = outlineBox(part.outline);
    } catch (e) {
      left.push({ id: part.id, label: part.label, why: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (width > bed.width - 2 * gap || height > bed.height - 2 * gap) {
      left.push({ id: part.id, label: part.label, why: `it is ${mmWords(width)} × ${mmWords(height)} mm, bigger than the bed (${mmWords(bed.width)} × ${mmWords(bed.height)} mm, ${mmWords(gap)} mm in from each edge)` });
      continue;
    }
    if (x + width > bed.width - gap) {
      x = gap;
      y += row + gap;
      row = 0;
    }
    if (y + height > bed.height - gap) {
      left.push({ id: part.id, label: part.label, why: "there is no room left on the bed: make the bed bigger, or turn off another part" });
      continue;
    }
    placed.push({ id: part.id, label: part.label, outline: moveOutline(part.outline, x - box.minX, y - box.minY), x, y, width, height });
    x += width + gap;
    row = Math.max(row, height);
  }
  return { placed, left };
}

/** Escapes text for an SVG element's content or attribute. */
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");


/**
 * The bed as an SVG file: the page is the bed (width and height in mm, so
 * one user unit is one mm, and a laser program places every part where it
 * sits on the bed), one <path> per part (its outer loop and holes, closed),
 * titled with the part's name. Parts are grouped by layer (ops.ts), engrave
 * first, then score, then cut, each group named and painted as laser
 * programs read colours: cut a red hairline, score a blue hairline, engrave
 * filled black (even-odd, so holes stay clear). A group with no part is
 * left out. `ops` gives each part's layer by its id; a part not in it is cut.
 */
export function sheetSvg(layout: Layout, bed: Bed, title = "Laser sheet", ops: Readonly<Record<string, LaserOp>> = {}): string {
  const [w, h] = [svgNumber(bed.width), svgNumber(bed.height)];
  const groups = OPS.flatMap((op) => {
    const parts = layout.placed.filter((p) => opOf(ops, p.id) === op);
    if (parts.length === 0) return [];
    const look = OP_LOOK[op];
    return [
      `<g id="${op}"><title>${look.name}</title>`,
      ...parts.map((p) => `<path id="part-${escape(p.id)}" d="${outlinePath(p.outline).d}" fill-rule="evenodd" ${look.svgPaint}><title>${escape(p.label)}</title></path>`),
      "</g>",
    ];
  });
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 -${h} ${w} ${h}">`,
    `<title>${escape(title)}</title>`,
    ...groups,
    "</svg>",
    "",
  ];
  return lines.join("\n");
}
