// Layers (Laser step L1c): what the beam does to each part. Pure: no DOM, no kernel.
//
// - cut: right through the sheet along the outline (the part falls out).
// - score: a light line along the outline, not through (a fold or a drawn line).
// - engrave: the area inside the outline burnt (holes left clear), not through.
//
// A part is cut unless the person says otherwise; the project keeps only the parts that are not cut
// (`LaserData.ops`, by the part's id in Design), so a part never chosen takes no room.
//
// The files carry the layer the way laser programs read it:
// - SVG: a colour each, the commonest three a laser program's own colour layers start with (cut a red hairline, score
//   a blue hairline, engrave filled black with no stroke), one group each, in the order the beam should go: engrave,
//   then score, then cut, so nothing is cut loose (and may drop or shift) before what lies on it is done.
// - DXF: a layer each (ENGRAVE, SCORE, CUT, in that order), with the matching colour numbers of the DXF colour table
//   (7 black or white, 5 blue, 1 red). R12 has no filled areas, so an engraved part is its outline on ENGRAVE: the
//   laser program fills that layer.

/** What the beam does to a part. */
export type LaserOp = "cut" | "score" | "engrave";

/** Every op, in the order the beam goes and the files write them (engrave, score, cut). */
export const OPS: readonly LaserOp[] = ["engrave", "score", "cut"];

/** The op a part has when nothing is said. */
export const DEFAULT_OP: LaserOp = "cut";

/** How each op is written and named: its words, the SVG's paint, the DXF's layer and colour number. */
export const OP_LOOK: Readonly<Record<LaserOp, { name: string; svgPaint: string; dxfLayer: string; dxfColour: number }>> = {
  engrave: { name: "Engrave", svgPaint: `fill="#000" stroke="none"`, dxfLayer: "ENGRAVE", dxfColour: 7 },
  score: { name: "Score", svgPaint: `fill="none" stroke="#00f" stroke-width="0.1" vector-effect="non-scaling-stroke"`, dxfLayer: "SCORE", dxfColour: 5 },
  cut: { name: "Cut", svgPaint: `fill="none" stroke="#f00" stroke-width="0.1" vector-effect="non-scaling-stroke"`, dxfLayer: "CUT", dxfColour: 1 },
};

/** Whether `v` is an op's name. */
export const isOp = (v: unknown): v is LaserOp => v === "cut" || v === "score" || v === "engrave";

/** The op of part `id`: the one kept for it, else cut. */
export const opOf = (ops: Readonly<Record<string, LaserOp>>, id: string): LaserOp => (Object.hasOwn(ops, id) ? ops[id] : DEFAULT_OP);

/** The kept ops with part `id` set to `op` (a cut part is not kept: cut is what nothing says). */
export function withOp(ops: Readonly<Record<string, LaserOp>>, id: string, op: LaserOp): Record<string, LaserOp> {
  const { [id]: _was, ...rest } = ops;
  return op === DEFAULT_OP ? rest : { ...rest, [id]: op };
}

/** The project's ops read defensively: an entry that isn't an op's name, and a "cut" (the default), are dropped. Never throws. */
export function readOps(data: unknown): Record<string, LaserOp> {
  const out: Record<string, LaserOp> = {};
  if (typeof data !== "object" || data === null || Array.isArray(data)) return out;
  for (const [id, v] of Object.entries(data as Record<string, unknown>)) if (isOp(v) && v !== DEFAULT_OP) out[id] = v;
  return out;
}

/** Whether two parts' overlap is worth a warning: only two cut parts. An engraving or a score lying on a cut part is what they are for. */
export const overlapMatters = (a: LaserOp, b: LaserOp): boolean => a === "cut" && b === "cut";
