// The bed as DXF (dxf.ts), worked by hand. An outside reader's check (ezdxf) is recorded in docs/progress/laser.md, step L1a.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bulgeNumber, sheetDxf } from "../src/dxf.ts";
import type { Layout } from "../src/sheet.ts";

const BED = { width: 100, height: 50 };

test("hand-worked: a slot with a round hole is one closed POLYLINE with its bulges and one CIRCLE, in mm, on the CUT layer", () => {
  // The slot (10,0) (50,0) (50,20) (10,20), bulges 0, 1, 0, 1: the half circles start at the 2nd and 4th corners,
  // so only those VERTEX entries carry a 42 (a 0 bulge is left out). The hole: centre (30, 10), radius 4.
  const layout: Layout = {
    placed: [{ id: "s", label: "Slot", x: 0, y: 0, width: 60, height: 20, outline: { outer: { path: { corners: [10, 0, 50, 0, 50, 20, 10, 20], bulges: [0, 1, 0, 1] } }, holes: [{ circle: { center: [30, 10], radius: 4 } }] } }],
    left: [],
  };
  const dxf = sheetDxf(layout, BED);
  const entities = dxf.slice(dxf.indexOf("ENTITIES\n") + "ENTITIES\n".length, dxf.lastIndexOf("0\nENDSEC"));
  const v = (x: number, y: number) => `0\nVERTEX\n8\nCUT\n10\n${x}\n20\n${y}\n30\n0\n`;
  assert.equal(
    entities,
    "0\nPOLYLINE\n8\nCUT\n66\n1\n10\n0\n20\n0\n30\n0\n70\n1\n" + v(10, 0) + v(50, 0) + "42\n1\n" + v(50, 20) + v(10, 20) + "42\n1\n" + "0\nSEQEND\n8\nCUT\n" + "0\nCIRCLE\n8\nCUT\n10\n30\n20\n10\n30\n0\n40\n4\n",
  );
});

test("the header says R12 and millimetres, the extents are the bed, the CUT layer is in the table, and it ends with EOF", () => {
  const dxf = sheetDxf({ placed: [], left: [] }, BED);
  assert.ok(dxf.startsWith("0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n9\n$MEASUREMENT\n70\n1\n"));
  assert.match(dxf, /9\n\$EXTMAX\n10\n100\n20\n50\n30\n0\n/);
  assert.match(dxf, /0\nLAYER\n2\nCUT\n70\n0\n62\n7\n6\nCONTINUOUS\n/);
  assert.ok(dxf.endsWith("0\nEOF\n"));
  // Every group code is followed by its value: an even number of lines before the final newline.
  assert.equal(dxf.trimEnd().split("\n").length % 2, 0);
});

test("bulges keep 15 decimals (a small one's rounding would move a long arc), points 6", () => {
  // tan(π/8) = √2 − 1 = 0.41421356237309504…, to 15 decimals 0.414213562373095.
  assert.equal(bulgeNumber(Math.tan(Math.PI / 8)), "0.414213562373095");
  assert.equal(bulgeNumber(1), "1");
  assert.equal(bulgeNumber(-1e-9), "-0.000000001");
  assert.equal(bulgeNumber(-1e-17), "0"); // never "-0"
  // A 100 mm chord with bulge 1.4e-6: the arc's height is b·c/2 = 70 nm. Six decimals would round b to 1e-6 and
  // move the arc 20 nm, twice the kernel's 10 nm; fifteen keep it.
  assert.equal(bulgeNumber(1.4e-6), "0.0000014");
  const layout: Layout = { placed: [{ id: "a", label: "a", x: 0, y: 0, width: 1, height: 1, outline: { outer: { path: { corners: [0.1234567, 0, 1, 0, 1, 1], bulges: [] } }, holes: [] } }], left: [] };
  assert.match(sheetDxf(layout, BED), /10\n0.123457\n/);
});
