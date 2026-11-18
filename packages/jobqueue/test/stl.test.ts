// Reading a print job's STL (stl.ts): hand-worked meshes, each kind of damaged file refused in words, and the text and
// binary forms of one mesh agreeing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { binaryStlOf, isBinaryStl, openEdgeCount, readStl } from "../src/stl.ts";
import { boxMesh, textStl } from "./meshes.ts";


test("hand-worked: a box read as text and as binary", () => {
  const box = boxMesh(20, 10, 5);
  for (const bytes of [textStl(box), textStl(box, true), binaryStlOf(box)]) {
    const r = readStl(bytes);
    assert.ok(r.ok, JSON.stringify(r));
    // A box has 8 corners and 12 triangles (2 a face), and every edge is shared by exactly two triangles.
    assert.equal(r.mesh.positions.length, 8 * 3);
    assert.equal(r.mesh.indices.length, 12 * 3);
    assert.equal(r.mesh.openEdges, 0);
    assert.deepEqual([Math.max(...r.mesh.positions.filter((_, i) => i % 3 === 0)), Math.max(...r.mesh.positions.filter((_, i) => i % 3 === 2))], [20, 5]);
  }
  // A binary STL's 80-byte header may itself begin "solid": its length decides, so it is still read as binary.
  const bin = binaryStlOf(box);
  bin.set(new TextEncoder().encode("solid made by a program"), 0);
  assert.ok(isBinaryStl(bin));
  const r = readStl(bin);
  assert.ok(r.ok && !r.mesh.text);
});

test("hand-worked: open edges and triangles with no area", () => {
  const box = boxMesh(1, 1, 1);
  // Take one triangle off the top: its three edges are now used once each (the diagonal and two of the top's sides).
  const holed = { positions: box.positions, indices: box.indices.slice(0, 6).concat(box.indices.slice(9)) };
  assert.equal(openEdgeCount(holed.indices), 3);
  const r = readStl(binaryStlOf(holed));
  assert.ok(r.ok && r.mesh.openEdges === 3);
  // A triangle whose corners are not three different points covers nothing: counted in the file, left out of the mesh.
  const flat = { positions: box.positions, indices: box.indices.concat([0, 0, 1]) };
  const f = readStl(binaryStlOf(flat));
  assert.ok(f.ok);
  assert.equal(f.mesh.fileTriangles, 13);
  assert.equal(f.mesh.indices.length, 36);
});

test("every damaged file is refused in words", () => {
  const box = boxMesh(1, 1, 1);
  const cases: [string, Uint8Array, RegExp][] = [
    ["empty", new Uint8Array(0), /empty/],
    ["not an STL", new TextEncoder().encode("hello there"), /not an STL/],
    ["text cut short", new TextEncoder().encode("solid a\nfacet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 1 0 0\n"), /cut short/],
    ["two corners", new TextEncoder().encode("solid a\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nendloop\nendsolid"), /three corners/],
    ["a word for a number", new TextEncoder().encode("solid a\nouter loop\nvertex 0 zero 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendsolid"), /three numbers/],
    ["only flat triangles", binaryStlOf({ positions: box.positions, indices: [0, 0, 1] }), /no triangles with any area/],
    ["not text and wrong length", new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x81]), /neither a binary STL/],
  ];
  for (const [what, bytes, words] of cases) {
    const r = readStl(bytes);
    assert.ok(!r.ok, what);
    assert.match(r.reason, words, what);
  }
  // A corner that is not a number in a binary file (a deliberate break of a good file at one float).
  const bin = binaryStlOf(box);
  new DataView(bin.buffer).setFloat32(84 + 12, NaN, true);
  const r = readStl(bin);
  assert.ok(!r.ok && /not a number/.test(r.reason));
  // A binary file one byte short is no longer binary, and as text it is not an STL.
  const short = readStl(binaryStlOf(box).slice(0, -1));
  assert.ok(!short.ok);
});
