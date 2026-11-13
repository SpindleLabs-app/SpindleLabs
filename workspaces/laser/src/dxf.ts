// The bed as a DXF file (Laser step L1a), for laser programs that prefer
// DXF (LightBurn, RDWorks, LaserGRBL, CAD programs).
//
// Written as the oldest common DXF (R12, "AC1009"): every program that reads
// DXF reads it. Units are millimetres ($INSUNITS 4, $MEASUREMENT 1). DXF's y
// points up, as the bed's does, so points are written as they are.
//
// - A circle is a CIRCLE (centre, radius).
// - A path is a closed POLYLINE (flag 70 = 1) of VERTEX entries, each with
//   the bulge of the piece that starts at it (group 42; left out when 0).
//   DXF's bulge is the kernel's: tan of a quarter of the arc's turn,
//   counter-clockwise when positive. So arcs are exact, never chopped
//   into short lines.
// - Points are rounded to 1e-6 mm (100× below the kernel's 10 nm); bulges
//   keep 15 decimals, since a small bulge's rounding is multiplied by the
//   chord (a 100 mm chord with b rounded by 1e-6 would move the arc 50 nm).
// - Every part's loops sit on its layer (ops.ts, step L1c): ENGRAVE (colour
//   7, black/white), SCORE (5, blue) or CUT (1, red), all three named in the
//   LAYER table so readers that check find them, and the parts written in
//   the beam's order: engrave, then score, then cut. R12 has no filled
//   areas, so an engraved part is its outline on ENGRAVE (the laser program
//   fills that layer).

import { svgNumber, type Loop } from "@fission/core";
import { OP_LOOK, opOf, OPS, type LaserOp } from "./ops.ts";
import type { Bed, Layout } from "./sheet.ts";

/** The layer a cut part's outline is on. */
export const CUT_LAYER = OP_LOOK.cut.dxfLayer;

/** A bulge as DXF writes it: 15 decimals, no trailing zeros, never "-0" or an exponent. */
export function bulgeNumber(b: number): string {
  const s = b.toFixed(15).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

/** Group code / value pairs as DXF lines. */
const pairs = (...p: (string | number)[]) => {
  const out: string[] = [];
  for (let i = 0; i < p.length; i += 2) out.push(String(p[i]), String(p[i + 1]));
  return out;
};

function loopEntities(loop: Loop, layer: string): string[] {
  const n = svgNumber;
  if ("circle" in loop) {
    const { center, radius } = loop.circle;
    return pairs(0, "CIRCLE", 8, layer, 10, n(center[0]), 20, n(center[1]), 30, 0, 40, n(radius));
  }
  const { corners, bulges } = loop.path;
  const out = pairs(0, "POLYLINE", 8, layer, 66, 1, 10, 0, 20, 0, 30, 0, 70, 1);
  for (let i = 0; i < corners.length / 2; i++) {
    out.push(...pairs(0, "VERTEX", 8, layer, 10, n(corners[2 * i]), 20, n(corners[2 * i + 1]), 30, 0));
    const b = bulges[i] ?? 0;
    if (b !== 0) out.push(...pairs(42, bulgeNumber(b)));
  }
  out.push(...pairs(0, "SEQEND", 8, layer));
  return out;
}

/** The bed as a DXF file (the file's comment): every placed part's outer loop and holes on its layer (`ops` by the part's id; a part not in it is cut), engrave first, then score, then cut. */
export function sheetDxf(layout: Layout, bed: Bed, ops: Readonly<Record<string, LaserOp>> = {}): string {
  const n = svgNumber;
  const lines = [
    ...pairs(0, "SECTION", 2, "HEADER"),
    ...pairs(9, "$ACADVER", 1, "AC1009"),
    ...pairs(9, "$INSUNITS", 70, 4),
    ...pairs(9, "$MEASUREMENT", 70, 1),
    ...pairs(9, "$EXTMIN", 10, 0, 20, 0, 30, 0),
    ...pairs(9, "$EXTMAX", 10, n(bed.width), 20, n(bed.height), 30, 0),
    ...pairs(0, "ENDSEC"),
    ...pairs(0, "SECTION", 2, "TABLES"),
    ...pairs(0, "TABLE", 2, "LAYER", 70, OPS.length),
    ...OPS.flatMap((op) => pairs(0, "LAYER", 2, OP_LOOK[op].dxfLayer, 70, 0, 62, OP_LOOK[op].dxfColour, 6, "CONTINUOUS")),
    ...pairs(0, "ENDTAB"),
    ...pairs(0, "ENDSEC"),
    ...pairs(0, "SECTION", 2, "ENTITIES"),
    ...OPS.flatMap((op) => layout.placed.filter((p) => opOf(ops, p.id) === op).flatMap((p) => [p.outline.outer, ...p.outline.holes].flatMap((l) => loopEntities(l, OP_LOOK[op].dxfLayer)))),
    ...pairs(0, "ENDSEC"),
    ...pairs(0, "EOF"),
  ];
  return `${lines.join("\n")}\n`;
}
