// Whether two parts on the laser bed overlap, touch or lie apart, answered by
// the kernel (Laser step L1b). No DOM; no curve maths here: every question
// about lines, arcs and circles is put to the kernel, and this file only
// keeps count of which curve belongs to which part and adds up its answers.
//
// The answer is one of four words:
// - "apart": every edge of one part is at least CLEARANCE (0.001 mm, the
//   kernel's smallest feature) from every edge of the other, and neither
//   sits in the other's material. A part inside another's hole is apart.
// - "overlap": some area of the bed is material of both.
// - "touch": closer than CLEARANCE somewhere, but no area is material of both
//   (a shared edge, a corner on an edge, two tangent circles, a gap of half a
//   micron). When the kernel can't split the edges where they run along each
//   other, "touch" also covers a sliver thinner than 2 × NUDGE (below).
// - "unknown": the kernel refused, or its answers leave both of the others
//   open. `why` says so in words; `meet` is set when the parts are known to
//   be closer than CLEARANCE, so only "touch or overlap" is open.
//
// Three questions are put to the kernel, cheapest first.
//
// 1. Do they fit side by side? Both outer loops are given as the holes of one
//    big sheet (body_build of an extrude, freed at once). The kernel builds
//    it only if every two pieces are at least 0.001 mm apart and neither loop
//    is inside the other, so "built" is "apart". It names the two pieces
//    that are too close (they meet: go on to 3), or the two loops when one is
//    inside the other. Then the inner part is tried as the one hole of a
//    sheet shaped like each hole of the other part: built means it sits
//    clear inside that hole, which is apart too.
//
// 2. Which side of each curve is a part's material? sketch_regions of one
//    part alone gives its material as one region (its outer loop round the
//    outside, its holes as holes), each curve listed forwards when the region
//    is on its left and reversed when on its right. That flag is the curve's
//    material side. A part the kernel does not read that way is "unknown".
//
// 3. Is some region material of both? sketch_regions of both parts' curves
//    together cuts the bed into regions and lists the curves round each. A
//    region with a curve of part A on its boundary is in A's material when it
//    lists that curve with A's material flag, and out of it otherwise; the
//    same for B. A region with no curve of A at all is wholly in or wholly
//    out of A, and so is every region across any one of its curves (only a
//    curve of A could part them, and none runs there, or the kernel would
//    have said the curves lie along each other); with no region across, it
//    borders the open bed and is out. A region in both is the overlap. None,
//    after 1 found two pieces closer than 0.001 mm, is a touch.
//
// What the kernel can't answer yet: sketch_regions gives no regions at all
// when two curves lie along each other (two parts on one baseline that
// overlap, or that share an edge: "line 1 and line 5 lie along each other"),
// and says "the curves meet too closely" for a crossing within its 10 nm.
// Then the second part is asked about again moved by NUDGE (0.0001 mm) in a
// few directions, which is an exact move (sheet.ts) and not curve maths:
// - if a moved copy has no region in both, the true overlap holds no disc of
//   radius NUDGE (such a disc would survive the move), so it is a sliver
//   thinner than 2 × NUDGE at most: "touch";
// - a move by v can add at most |v| × (the part's edge length) of overlap
//   (each bit of edge sweeps a strip that long and at most |v| wide), so an
//   overlap area above twice that was there before the move: "overlap". The
//   edge length is the kernel's too: an extrude 1 mm tall has area − 2 ×
//   volume of side wall. Longer moves (NUDGE_STEPS) follow for this proof
//   only, since a part with edges in many directions keeps one lying along
//   its twin after a short move.
// - otherwise "unknown" with `meet`: an overlap smaller than that bound along
//   a shared line (two 10 mm squares on one baseline overlapping by 0.0001
//   to 0.0007 mm), or a part fitting another snugly on several sides.
//
// This is a way round a gap in the kernel, to go when sketch_regions splits
// curves that lie along each other, or the kernel answers the question itself.

import { type KernelCalls, type KernelInput, type Loop, type Outline, type OutlinePiece, type SketchArc, type SketchCircle, type SketchLine } from "@fission/core";
import { moveOutline, outlineBox } from "./sheet.ts";

/** Parts with every edge at least this far from the other's (mm) are apart: the kernel's smallest feature, which its profile check holds two loops to. */
export const CLEARANCE = 0.001;
/**
 * Boxes further apart than this (mm) are apart without asking the kernel: twice CLEARANCE, so the 1e-6 mm rounding of a
 * box's corner (sheet.ts, `outlinePath`) can never pass a pair the kernel would call closer than CLEARANCE.
 */
export const BOX_MARGIN = 0.002;
/** How far (mm) the second part is moved to ask again when the kernel can't tell (the file's comment): 10× its 10 nm, a tenth of CLEARANCE. */
export const NUDGE = 1e-4;
/**
 * The lengths of those moves (mm), tried in turn. A part with edges in many directions always has one nearly along a short
 * move, which then still lies along its twin within the kernel's 10 nm, so longer moves follow; they can only prove an
 * overlap (the bound grows with the move), never a touch, which only the first, NUDGE, may.
 */
const NUDGE_STEPS = [NUDGE, 10 * NUDGE, 100 * NUDGE];
/**
 * The directions of those moves, each shorter than 1, each with its opposite: about 15°, 75° and 105° from the x axis, at
 * least 6° from the directions drawn parts mostly have (0°, 30°, 45°, 60°, 90° and the 3-4-5 slopes), so a move of NUDGE
 * shifts such an edge sideways by more than the kernel's 10 nm, and into every quarter, so a part in a corner can come away.
 */
const NUDGES: readonly (readonly [number, number])[] = [
  [0.96, 0.26],
  [-0.96, -0.26],
  [-0.26, 0.96],
  [0.26, -0.96],
  [0.26, 0.96],
  [-0.26, -0.96],
];

/** An outline as the sketch curves sketch_regions takes, and the loop each came from. */
export interface OutlineCurves {
  lines: SketchLine[];
  circles: SketchCircle[];
  arcs: SketchArc[];
  /** The loop of each curve, in its list's order: 0 the outer loop, k the k-th hole (from 1). */
  loops: { line: number[]; circle: number[]; arc: number[] };
}

/**
 * The outline as sketch curves: a format conversion, piece for piece, with
 * no geometry worked out except an arc's centre, which a sketch arc names
 * and a bulge implies. A straight piece is a line from its corner to the
 * next. A piece with bulge b is the arc between the two corners round the
 * chord's midpoint moved c(1 − b²)/(4b) along the chord's left normal (c the
 * chord's length; the kernel's own bulge rule, as core's svg.ts): for the
 * chord (ax, ay) → (bx, by) and k = (1 − b²)/(4b), the centre is
 * ((ax + bx)/2 − (by − ay)k, (ay + by)/2 + (bx − ax)k). A sketch arc runs
 * counter-clockwise from start to end, so for b < 0 (clockwise) the ends
 * swap. A circle loop is a sketch circle. Never throws: numbers the kernel
 * can't use (not finite, an arc flatter than its 1 km radius limit) are for
 * the kernel to refuse, in its words.
 */
export function outlineCurves(outline: Outline): OutlineCurves {
  const out: OutlineCurves = { lines: [], circles: [], arcs: [], loops: { line: [], circle: [], arc: [] } };
  [outline.outer, ...outline.holes].forEach((loop: Loop, which) => {
    if ("circle" in loop) {
      out.circles.push({ centre: [loop.circle.center[0], loop.circle.center[1]], radius: loop.circle.radius });
      out.loops.circle.push(which);
      return;
    }
    const { corners, bulges } = loop.path;
    const n = Math.floor(corners.length / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ax, ay, bx, by] = [corners[2 * i], corners[2 * i + 1], corners[2 * j], corners[2 * j + 1]];
      const b = bulges[i] ?? 0;
      if (b === 0) {
        out.lines.push({ a: [ax, ay], b: [bx, by] });
        out.loops.line.push(which);
        continue;
      }
      const k = (1 - b * b) / (4 * b);
      const centre: [number, number] = [(ax + bx) / 2 - (by - ay) * k, (ay + by) / 2 + (bx - ax) * k];
      out.arcs.push(b > 0 ? { start: [ax, ay], end: [bx, by], centre } : { start: [bx, by], end: [ax, ay], centre });
      out.loops.arc.push(which);
    }
  });
  return out;
}

/** How two parts lie (the file's comment). `why` in plain words with "unknown"; `meet` when they are known to be closer than CLEARANCE all the same. */
export interface PartsRelation {
  relation: "apart" | "overlap" | "touch" | "unknown";
  why?: string;
  meet?: true;
}

type Kind = OutlinePiece["curve"];
type Named = { curve: Kind; index: number };
const key = (p: Named) => `${p.curve} ${p.index}`;
const words = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A reason to answer "unknown", thrown inside this file only. */
class Unknown extends Error {}

/** A part as question 2 reads it: its curves, and for each (by `key`) the flag its material region lists it with. */
interface Part {
  curves: OutlineCurves;
  material: Map<string, boolean>;
}

/** Question 2: each curve's material flag, from the part's own regions. Throws Unknown unless they are its material and its holes, nothing else. */
async function readPart(kernel: KernelCalls, outline: Outline, name: string): Promise<Part> {
  const curves = outlineCurves(outline);
  const bad = (why: string) => new Unknown(`the kernel does not read the ${name} part as one closed shape with its holes: ${why}`);
  const found = await kernel.call("sketch_regions", curves.lines, curves.circles, curves.arcs);
  const loopOf = (p: Named) => curves.loops[p.curve][p.index];
  const body = found.regions.filter((r) => r.outer.some((p) => loopOf(p) === 0));
  if (found.why !== undefined || found.loose.length > 0 || body.length !== 1 || found.regions.length !== 1 + outline.holes.length) throw bad(found.why ?? "its curves make other regions");
  const region = body[0];
  if (!region.extrudes) throw bad(region.refused ?? "its region can't be cut out");
  const material = new Map<string, boolean>();
  const take = (pieces: readonly OutlinePiece[], loops: Set<number>) => {
    for (const p of pieces) {
      const before = material.get(key(p));
      if (loopOf(p) === undefined || (before !== undefined && before !== p.reversed)) throw bad("a curve runs both ways round it");
      material.set(key(p), p.reversed);
      loops.add(loopOf(p));
    }
  };
  const outer = new Set<number>();
  take(region.outer, outer);
  const holes = new Set<number>();
  for (const hole of region.holes) {
    const one = new Set<number>();
    take(hole, one);
    if (one.size !== 1) throw bad("two of its holes run into each other");
    holes.add([...one][0]);
  }
  const all = curves.lines.length + curves.circles.length + curves.arcs.length;
  if (outer.size !== 1 || holes.has(0) || holes.size !== outline.holes.length || material.size !== all) throw bad("its holes are not all inside it");
  return { curves, material };
}

/** What question 3 found: an overlap and its area, none (every region placed), curves of the two parts lying along each other, or a doubt in words. */
type Study = { is: "overlap"; area: number } | { is: "clear" } | { is: "along" } | { is: "doubt"; why: string };

const isCurve = (i: KernelInput): i is KernelInput & { input: Kind; index: number } => i.input === "line" || i.input === "arc" || i.input === "circle";

/** Question 3 (the file's comment): the regions of both parts' curves together, each placed in or out of each part's material. */
async function study(kernel: KernelCalls, a: Part, b: Part): Promise<Study> {
  const count = { line: a.curves.lines.length, circle: a.curves.circles.length, arc: a.curves.arcs.length };
  const owner = (p: Named): 0 | 1 => (p.index < count[p.curve] ? 0 : 1);
  const flag = (p: Named) => (owner(p) === 0 ? a.material.get(key(p)) : b.material.get(key({ curve: p.curve, index: p.index - count[p.curve] })));
  const found = await kernel.call("sketch_regions", [...a.curves.lines, ...b.curves.lines], [...a.curves.circles, ...b.curves.circles], [...a.curves.arcs, ...b.curves.arcs]);
  if (found.why !== undefined || found.regions.length === 0) {
    // No regions, and the two curves it names (by kind and index, never by its words) are one of each part: they lie along each other.
    const named = (found.invalid ?? []).filter(isCurve).map((i) => ({ curve: i.input, index: i.index }));
    if (named.length === 2 && owner(named[0]) !== owner(named[1])) return { is: "along" };
    return { is: "doubt", why: found.why ?? "the kernel found no closed shape" };
  }
  type Side = "in" | "out" | null;
  const sides: [Side, Side][] = [];
  const listed = new Map<string, number[]>(); // a curve and a sense → the regions listing it so
  const pieces = found.regions.map((r) => [...r.outer, ...r.holes.flat()]);
  for (const [i, region] of found.regions.entries()) {
    // A region the kernel is unsure of ("the curves meet too closely ... to tell the regions apart") names no curves to mark and promises no list.
    if (!region.extrudes && !region.invalid?.length) return { is: "doubt", why: region.refused ?? "the kernel is unsure of a region" };
    const side: [Side, Side] = [null, null];
    for (const p of pieces[i]) {
      const material = flag(p);
      if (material === undefined) return { is: "doubt", why: "the kernel named a curve neither part has" };
      const here: Side = p.reversed === material ? "in" : "out";
      const o = owner(p);
      if (side[o] !== null && side[o] !== here) return { is: "doubt", why: "the kernel listed a region on both sides of one part's edge" };
      side[o] = here;
      const at = `${key(p)} ${p.reversed}`;
      listed.set(at, [...(listed.get(at) ?? []), i]);
    }
    sides.push(side);
  }
  // A region with no curve of a part takes its side from the regions across its own curves, or is out when one of them has none across.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [i, side] of sides.entries()) {
      for (const o of [0, 1] as const) {
        if (side[o] !== null) continue;
        let seen: Side = null;
        for (const p of pieces[i]) {
          const across = listed.get(`${key(p)} ${!p.reversed}`) ?? [];
          for (const there of across.length === 0 ? (["out"] as const) : across.map((j) => sides[j][o])) {
            if (there === null) continue;
            if (seen !== null && seen !== there) return { is: "doubt", why: "the kernel's regions disagree about which part one lies in" };
            seen = there;
          }
        }
        if (seen !== null) {
          side[o] = seen;
          changed = true;
        }
      }
    }
  }
  if (sides.some((s) => s[0] === null || s[1] === null)) return { is: "doubt", why: "a region could not be placed in or out of a part" };
  const both = found.regions.filter((_, i) => sides[i][0] === "in" && sides[i][1] === "in");
  return both.length === 0 ? { is: "clear" } : { is: "overlap", area: both.reduce((sum, r) => sum + r.area, 0) };
}

/**
 * Question 1: whether the kernel builds a sheet with these loops as its holes. "fits": built, so every two pieces are
 * at least CLEARANCE apart. "close": it names two pieces of different loops as too close. "nested": it names two loops, one inside
 * the other. "outside": it names one loop, a hole not inside the sheet. Read from the refusal's kind and inputs, never its words; any other failure is thrown.
 */
async function fits(kernel: KernelCalls, sheet: Loop, holes: Loop[]): Promise<"fits" | "close" | "nested" | "outside"> {
  let body: number;
  try {
    body = await kernel.call("body_build", { extrude: { profile: { outer: sheet, holes }, distance: 1 } });
  } catch (e) {
    const { kind, inputs } = e as { kind?: unknown; inputs?: KernelInput[] };
    if (kind !== "invalid-input" || !Array.isArray(inputs)) throw e;
    const [p, q] = inputs;
    if (inputs.length === 2 && p.input === "piece" && q.input === "piece" && p.boundary !== q.boundary) return "close";
    if (inputs.length === 2 && p.input === "loop" && q.input === "loop" && p.boundary !== q.boundary) return "nested";
    if (inputs.length === 1 && p.input === "loop" && p.boundary > 0) return "outside";
    throw e;
  }
  await kernel.call("body_free", body);
  return "fits";
}

/** The length of all the part's edges (mm), from the kernel: an extrude 1 mm tall has two caps of its volume's area, and the rest of its area is side wall. */
async function edgeLength(kernel: KernelCalls, outline: Outline): Promise<number> {
  const view = await kernel.call("make_extrude", outline, 1);
  return view.area - 2 * view.volume;
}

async function relate(kernel: KernelCalls, a: Outline, b: Outline): Promise<PartsRelation> {
  const [p, q] = [outlineBox(a), outlineBox(b)]; // a malformed outline throws here, in core's words
  if (q.minX - p.maxX > BOX_MARGIN || p.minX - q.maxX > BOX_MARGIN || q.minY - p.maxY > BOX_MARGIN || p.minY - q.maxY > BOX_MARGIN) return { relation: "apart" };

  // 1. Side by side as two holes of one sheet, 1 mm bigger all round than both boxes; then the inner one in each hole of the other.
  const [x0, y0, x1, y1] = [Math.min(p.minX, q.minX) - 1, Math.min(p.minY, q.minY) - 1, Math.max(p.maxX, q.maxX) + 1, Math.max(p.maxY, q.maxY) + 1];
  const beside = await fits(kernel, { path: { corners: [x0, y0, x1, y0, x1, y1, x0, y1], bulges: [] } }, [a.outer, b.outer]).catch(async (e) => {
    // A refusal of anything else: which part it is, when one is no closed shape on its own; else the kernel's words.
    for (const [outline, name] of [
      [a, "first"],
      [b, "second"],
    ] as const) {
      await readPart(kernel, outline, name).catch((bad) => {
        if (bad instanceof Unknown) throw bad;
      });
    }
    throw new Unknown(`the kernel can't cut the two parts out of one sheet: ${words(e)}`);
  });
  if (beside === "fits") return { relation: "apart" };
  if (beside === "outside") throw new Unknown("the kernel placed a part outside its own box");
  let close = beside === "close";
  if (beside === "nested") {
    for (const [inner, outer] of [
      [b, a],
      [a, b],
    ]) {
      for (const hole of outer.holes) {
        const inside = await fits(kernel, hole, [inner.outer]).catch(() => "outside" as const);
        if (inside === "fits") return { relation: "apart" };
        if (inside === "close") close = true;
      }
    }
  }

  // 2 and 3. The material side of each curve, then the regions of both together.
  const first = await readPart(kernel, a, "first");
  const second = await readPart(kernel, b, "second");
  const found = await study(kernel, first, second);
  if (found.is === "overlap") return { relation: "overlap" };
  const meet = close || found.is === "along";
  const unknown = (why: string): PartsRelation => (meet ? { relation: "unknown", why, meet } : { relation: "unknown", why });
  if (found.is === "clear") return close ? { relation: "touch" } : unknown("one part is inside the other's outline, yet the kernel finds it neither clear inside a hole nor in its material");

  // The kernel couldn't tell: the second part again, moved by NUDGE (the file's comment).
  const length = await edgeLength(kernel, b).catch(() => Infinity);
  for (const step of NUDGE_STEPS) {
    for (const [dx, dy] of NUDGES) {
      const moved = { curves: outlineCurves(moveOutline(b, dx * step, dy * step)), material: second.material };
      const again = await study(kernel, first, moved).catch((e): Study => ({ is: "doubt", why: words(e) }));
      if (again.is === "clear" && meet && step === NUDGE) return { relation: "touch" };
      if (again.is === "overlap" && again.area > 2 * step * length) return { relation: "overlap" };
    }
  }
  return unknown(
    found.is === "along"
      ? "an edge of one part lies along an edge of the other, and the kernel can't yet tell a shared edge from a thin overlap there"
      : `the parts' edges meet too closely for the kernel to tell a touch from an overlap (${found.why})`,
  );
}

/**
 * How parts `a` and `b` lie on the bed (the file's comment): "apart",
 * "overlap", "touch", or "unknown" with why in words. Never throws, and
 * never says "apart" unless the kernel built both as separate cut-outs at
 * least CLEARANCE from each other (or their boxes are further apart than
 * BOX_MARGIN). `kernel` is the app's kernel client.
 */
export async function partsRelation(kernel: KernelCalls, a: Outline, b: Outline): Promise<PartsRelation> {
  try {
    return await relate(kernel, a, b);
  } catch (e) {
    return { relation: "unknown", why: words(e) };
  }
}
