// Parts placed by hand on the laser's bed (Laser step L1b). Pure: no DOM, no kernel.
//
// A part the person has dragged or turned has a `Placement`: the angle it
// is turned by, and where the lower-left corner of its box then sits on the
// bed. That, and nothing of the shape itself, is what the project keeps
// (by the part's id in Design), so a sketch edited in Design is still the
// part here, in the same place.
//
// Turning is a rigid motion of the outline's own numbers: every corner and
// circle centre (x, y) goes to (x·cos − y·sin, x·sin + y·cos). A bulge is
// the tangent of a quarter of its arc's turn, and a turn of the whole
// outline changes no arc's own turn, so bulges and radii stay the same
// numbers: nothing is approximated and no curve is worked out here (the
// turned outline's box is read from core's writer, as every box is:
// sheet.ts `outlineBox`). Quarter turns use cos and sin of exactly 0, 1
// and −1, so a rectangle turned 90° has corners on whole numbers still.
//
// Parts without a placement are laid out in rows as before (sheet.ts
// `layOut`'s rule), stepping round the parts placed by hand: a spot that
// would come within `gap` of a hand-placed part's box is passed over.
//
// Hand-placed parts may be put anywhere, so two things are checked and said
// in words, never silently mended: a part reaching past the bed's edge, and
// two parts whose boxes overlap (`overlapCandidates`: whether the shapes
// themselves overlap is the kernel's to say, in step L1b2; boxes that are
// clear of each other settle it at once).

import type { Loop, Outline } from "@fission/core";
import { mmWords, moveOutline, outlineBox, type Bed, type Layout, type OutlineBox, type PlacedPart, type SheetPart } from "./sheet.ts";

/** Where a hand-placed part sits: turned `angle` degrees counter-clockwise, then moved so its box's lower-left corner is at (x, y), mm. */
export interface Placement {
  x: number;
  y: number;
  angle: number;
}

/** The furthest from the bed's corner a part may be put, mm (10 m: far past any bed, and small enough that every number stays exact to a nanometre). */
export const MAX_REACH = 10_000;
/**
 * How finely a box's edge is known, mm: core's writer gives a box's corner
 * rounded to 1e-6 mm (a nanometre, a tenth of the kernel's 10 nm). A part
 * is off the bed, and two boxes overlap, only by more than this.
 */
export const EDGE_SLACK = 1e-6;

/** A number of mm cleaned of floating-point dust below a nanometre (0.1 + 0.2 becomes 0.3), never −0. */
export const cleanMm = (v: number) => Number(v.toFixed(6)) + 0;

/** An angle brought into 0 ≤ a < 360 degrees; 360 and −0 are 0. */
export function normalAngle(degrees: number): number {
  const a = ((degrees % 360) + 360) % 360;
  return a === 360 ? 0 : a + 0;
}

/** Why this placement can't be used, in words, or null when it can. */
export function placementRefusal(p: Placement): string | null {
  if (![p.x, p.y, p.angle].every(Number.isFinite)) return "A part's place and angle must be numbers.";
  if (Math.abs(p.x) > MAX_REACH || Math.abs(p.y) > MAX_REACH) return `A part can be put at most ${MAX_REACH} mm from the bed's corner.`;
  return null;
}

/** cos and sin of a turn in degrees; exactly 0, 1 or −1 at quarter turns. */
function turnOf(degrees: number): [number, number] {
  const a = normalAngle(degrees);
  if (a === 0) return [1, 0];
  if (a === 90) return [0, 1];
  if (a === 180) return [-1, 0];
  if (a === 270) return [0, -1];
  const r = (a * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

function turnLoop(loop: Loop, c: number, s: number): Loop {
  const turn = (x: number, y: number): [number, number] => [x * c - y * s + 0, x * s + y * c + 0];
  if ("circle" in loop) return { circle: { center: turn(loop.circle.center[0], loop.circle.center[1]), radius: loop.circle.radius } };
  const corners: number[] = [];
  for (let i = 0; i + 1 < loop.path.corners.length; i += 2) corners.push(...turn(loop.path.corners[i], loop.path.corners[i + 1]));
  if (loop.path.corners.length % 2 === 1) corners.push(loop.path.corners[loop.path.corners.length - 1]); // malformed: kept so, for the box to refuse in words
  return { path: { corners, bulges: [...loop.path.bulges] } };
}

/** The outline turned `degrees` counter-clockwise about the origin (the file's comment): corners and centres turn, bulges and radii unchanged. */
export function turnOutline(outline: Outline, degrees: number): Outline {
  const [c, s] = turnOf(degrees);
  return { outer: turnLoop(outline.outer, c, s), holes: outline.holes.map((h) => turnLoop(h, c, s)) };
}

/** The outline as it sits on the bed at `at`: turned, then moved so its box's lower-left corner is (at.x, at.y). Throws, in words, for a malformed outline. */
export function placeOutline(outline: Outline, at: Placement): { outline: Outline; box: OutlineBox } {
  const turned = turnOutline(outline, at.angle);
  const box = outlineBox(turned);
  const [width, height] = [box.maxX - box.minX, box.maxY - box.minY];
  return { outline: moveOutline(turned, at.x - box.minX, at.y - box.minY), box: { minX: at.x, minY: at.y, maxX: at.x + width, maxY: at.y + height } };
}

/**
 * The placement that turns a part to `angle` about the middle of its box as
 * it sits now (`now`, with the box's size), so it turns on the spot: the
 * new box has the same middle. Throws, in words, for a malformed outline.
 */
export function turnedOnTheSpot(outline: Outline, now: { x: number; y: number; width: number; height: number }, angle: number): Placement {
  const a = normalAngle(angle);
  const { box } = placeOutline(outline, { x: 0, y: 0, angle: a });
  return { x: cleanMm(now.x + now.width / 2 - box.maxX / 2), y: cleanMm(now.y + now.height / 2 - box.maxY / 2), angle: a };
}

/** The placements a project holds, read defensively: an entry that is not a usable placement is dropped, never thrown on. */
export function readPlacements(data: unknown): Record<string, Placement> {
  const out: Record<string, Placement> = {};
  if (typeof data !== "object" || data === null || Array.isArray(data)) return out;
  for (const [id, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const { x, y, angle } = v as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number") continue;
    const p = { x, y, angle: typeof angle === "number" ? angle : 0 };
    if (placementRefusal(p) === null) out[id] = { x: p.x, y: p.y, angle: normalAngle(p.angle) };
  }
  return out;
}

/** A part on the bed, with the angle it is turned by and whether the person placed it ("hand") or the rows did ("rows"). */
export interface LaidPart extends PlacedPart {
  angle: number;
  by: "hand" | "rows";
}

/** `layOutPlaced`'s answer: `Layout` with each placed part's angle and who placed it. */
export interface LaidLayout extends Layout {
  placed: LaidPart[];
}

/** Whether the box at (x, y) sized (w, h) comes within `gap` of `other` (touching the gap's line is clear, as between row parts). */
const within = (x: number, y: number, w: number, h: number, other: PlacedPart, gap: number) =>
  x < other.x + other.width + gap && x + w > other.x - gap && y < other.y + other.height + gap && y + h > other.y - gap;

/**
 * Lays the parts on the bed (the file's comment): each part with a
 * placement where the person put it, the rest in rows from the lower-left
 * corner in the order given, `gap` apart and from the edges, stepping
 * round the hand-placed ones. With no placements this is sheet.ts
 * `layOut` exactly. A hand-placed part is placed even off the bed
 * (`offBed` says so); a row part that fits nowhere is left off with why.
 * `bed` and `gap` must pass `bedRefusal`. The answer keeps the parts' order.
 */
export function layOutPlaced(parts: readonly SheetPart[], bed: Bed, gap: number, placements: Readonly<Record<string, Placement>> = {}): LaidLayout {
  const slots: (LaidPart | null)[] = parts.map(() => null);
  const left: Layout["left"] = [];
  const leftAt: number[] = [];
  const leave = (i: number, why: string) => {
    left.push({ id: parts[i].id, label: parts[i].label, why });
    leftAt.push(i);
  };
  const hand: LaidPart[] = [];
  parts.forEach((part, i) => {
    const at = Object.hasOwn(placements, part.id) ? placements[part.id] : undefined;
    if (!at) return;
    try {
      const { outline, box } = placeOutline(part.outline, at);
      const laid: LaidPart = { id: part.id, label: part.label, outline, x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY, angle: normalAngle(at.angle), by: "hand" };
      slots[i] = laid;
      hand.push(laid);
    } catch (e) {
      leave(i, e instanceof Error ? e.message : String(e));
    }
  });
  let x = gap;
  let y = gap;
  let row = 0; // the tallest part in this row
  let clear = Infinity; // the lowest line above this row's blockers: where a row that placed nothing moves up to
  parts.forEach((part, i) => {
    if (slots[i] !== null || leftAt.includes(i)) return;
    let box: OutlineBox;
    try {
      box = outlineBox(part.outline);
    } catch (e) {
      return leave(i, e instanceof Error ? e.message : String(e));
    }
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (width > bed.width - 2 * gap || height > bed.height - 2 * gap)
      return leave(i, `it is ${mmWords(width)} × ${mmWords(height)} mm, bigger than the bed (${mmWords(bed.width)} × ${mmWords(bed.height)} mm, ${mmWords(gap)} mm in from each edge)`);
    for (;;) {
      if (x + width > bed.width - gap) {
        // A new row: above the tallest part of this one, or, when hand-placed parts left it empty, above the lowest of them.
        y = row > 0 ? y + row + gap : Number.isFinite(clear) ? clear : y + gap;
        x = gap;
        row = 0;
        clear = Infinity;
      }
      if (y + height > bed.height - gap) return leave(i, "there is no room left on the bed: make the bed bigger, or turn off another part");
      const blocker = hand.find((h) => within(x, y, width, height, h, gap));
      if (!blocker) break;
      clear = Math.min(clear, blocker.y + blocker.height + gap);
      x = blocker.x + blocker.width + gap; // on, past the part in the way
    }
    slots[i] = { id: part.id, label: part.label, outline: moveOutline(part.outline, x - box.minX, y - box.minY), x, y, width, height, angle: 0, by: "rows" };
    x += width + gap;
    row = Math.max(row, height);
  });
  // Left-off parts in the order given, as the placed ones are.
  const order = leftAt.map((at, k) => [at, k]).sort((a, b) => a[0] - b[0]);
  return { placed: slots.filter((s): s is LaidPart => s !== null), left: order.map(([, k]) => left[k]) };
}

/** How far a part's box reaches past each side of the bed, mm (0 where it doesn't), or null when it is wholly on the bed (to within `EDGE_SLACK`). */
export function offBed(part: PlacedPart, bed: Bed): { left: number; right: number; bottom: number; top: number } | null {
  const past = (v: number) => (v > EDGE_SLACK ? v : 0);
  const out = { left: past(-part.x), right: past(part.x + part.width - bed.width), bottom: past(-part.y), top: past(part.y + part.height - bed.height) };
  return out.left || out.right || out.bottom || out.top ? out : null;
}

/** "Sketch 1 is off the bed: 12.5 mm past the right side and 3 mm past the top.", or null when the part is on the bed. */
export function offBedWords(part: PlacedPart, bed: Bed): string | null {
  const off = offBed(part, bed);
  if (!off) return null;
  const sides = [
    ["the left side", off.left],
    ["the right side", off.right],
    ["the bottom", off.bottom],
    ["the top", off.top],
  ] as const;
  const said = sides.filter(([, v]) => v > 0).map(([name, v]) => `${mmWords(v)} mm past ${name}`);
  return `${part.label} is off the bed: ${said.join(" and ")}.`;
}

/** Whether two parts' boxes overlap by more than `EDGE_SLACK` both ways (boxes that only touch do not). */
export function boxesOverlap(a: PlacedPart, b: PlacedPart): boolean {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EDGE_SLACK && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EDGE_SLACK;
}

/**
 * The pairs of placed parts whose shapes might overlap or touch: their boxes
 * overlap, or come within `within` mm of each other (0: overlap only), and
 * at least one was placed by hand (two row parts never meet: the rows keep
 * them `gap` apart). Each pair as its two places in `placed`, lower first.
 * How the shapes themselves lie is the kernel's to say.
 */
export function overlapCandidates(placed: readonly LaidPart[], within = 0): [number, number][] {
  const near = (a: PlacedPart, b: PlacedPart) =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EDGE_SLACK - within && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EDGE_SLACK - within;
  const out: [number, number][] = [];
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) if ((placed[i].by === "hand" || placed[j].by === "hand") && near(placed[i], placed[j])) out.push([i, j]);
  return out;
}

/** A position snapped to whole steps of `step` mm (1 mm when dragging; a step that is not above 0 snaps nothing). */
export function snapMm(v: number, step = 1): number {
  return step > 0 && Number.isFinite(step) ? cleanMm(Math.round(v / step) * step) : cleanMm(v);
}
