import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, meshOfStl, modelXml, objText, shortFloat, threeMf, zipStored, type Mesh } from "../src/mesh-files.ts";

/** A binary STL written by hand: an 80-byte header, the count, then each triangle (normal 0, three corners, 2 spare bytes). */
function stl(triangles: number[][][]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(84 + triangles.length * 50);
  const v = new DataView(out.buffer);
  v.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => t.forEach((p, k) => p.forEach((c, j) => v.setFloat32(84 + i * 50 + 12 + k * 12 + j * 4, c, true))));
  return out;
}

// A corner tetrahedron with legs of 10 mm along x, y and z: corners O(0,0,0), X(10,0,0), Y(0,10,0), Z(0,0,10), each face
// counter-clockwise seen from outside (the bottom O-Y-X looks down, the back O-Z-Y looks along -x, O-X-Z along -y, X-Y-Z out).
const O = [0, 0, 0], X = [10, 0, 0], Y = [0, 10, 0], Z = [0, 0, 10];
const tetra = stl([[O, Y, X], [O, Z, Y], [O, X, Z], [X, Y, Z]]);

test("a tetrahedron's STL becomes 4 corners and 4 triangles, each shared corner once", () => {
  const m = meshOfStl(tetra, "Body 1");
  // Corners numbered in the order first met: O (0), Y (1), X (2) from the first triangle, then Z (3).
  assert.deepEqual(m.corners, [...O, ...Y, ...X, ...Z]);
  assert.deepEqual(m.triangles, [0, 1, 2, 0, 3, 1, 0, 2, 3, 2, 1, 3]);
  // Every edge of a closed mesh is used twice, once each way: 6 edges, 12 uses, each (a, b) met with its (b, a).
  const uses = new Set<string>();
  for (let t = 0; t < 12; t += 3) for (let k = 0; k < 3; k++) uses.add(`${m.triangles[t + k]},${m.triangles[t + ((k + 1) % 3)]}`);
  assert.equal(uses.size, 12);
  for (const u of uses) assert.ok(uses.has(u.split(",").reverse().join(",")), `edge ${u} has no partner`);
});

test("-0 and 0 are one corner, a triangle with no area is left out, a bad file is refused", () => {
  const m = meshOfStl(stl([[O, Y, X], [[-0, 0, 0], X, X]]), "b");
  assert.equal(m.corners.length / 3, 3);
  assert.deepEqual(m.triangles, [0, 1, 2]);
  assert.throws(() => meshOfStl(tetra.slice(0, 83), "short"), /too short/);
  assert.throws(() => meshOfStl(tetra.slice(0, tetra.length - 1), "cut"), /says 4 triangles but is 283 bytes/);
  const nan = stl([[O, Y, [Number.NaN, 0, 0]]]);
  assert.throws(() => meshOfStl(nan, "nan"), /not a number/);
});

test("numbers are written as the shortest decimal that reads back to the same single-precision number", () => {
  // 0.1 in single precision is 0.100000001490116…; "0.1" reads back to it, so that is what is written.
  assert.equal(shortFloat(Math.fround(0.1)), "0.1");
  assert.equal(shortFloat(40), "40");
  assert.equal(shortFloat(-12.5), "-12.5");
  // 1/3 needs all 8 or 9 digits: 0.33333334 is the single-precision nearest.
  assert.equal(shortFloat(Math.fround(1 / 3)), "0.33333334");
  for (let i = 0; i < 2000; i++) {
    const v = Math.fround((Math.sin(i * 12.9898) * 43758.5453) % 1000);
    assert.equal(Math.fround(Number(shortFloat(v))), v);
  }
});

test("CRC-32 gives the zip format's published check value", () => {
  // The standard check: the CRC-32 of the nine bytes "123456789" is 0xCBF43926.
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("the model part names millimetres and lists each body as its own object on the plate", () => {
  const a = meshOfStl(tetra, "Body 1 <&>");
  const b: Mesh = { ...a, name: "Body 2" };
  const xml = modelXml([a, b]);
  assert.match(xml, /<model unit="millimeter"/);
  assert.match(xml, /<object id="1" type="model" name="Body 1 &lt;&amp;&gt;">/);
  assert.match(xml, /<object id="2" type="model" name="Body 2">/);
  assert.match(xml, /<vertex x="0" y="10" z="0"\/>/);
  assert.match(xml, /<triangle v1="2" v2="1" v3="3"\/>/);
  assert.match(xml, /<build>\n<item objectid="1"\/>\n<item objectid="2"\/>\n<\/build>/);
  assert.equal(xml.match(/<vertex /g)?.length, 8);
  assert.equal(xml.match(/<triangle /g)?.length, 8);
});

test("OBJ counts corners from 1 across the whole file", () => {
  const m = meshOfStl(tetra, "Body 1");
  const lines = objText([m, { ...m, name: "Body 2" }]).trim().split("\n");
  assert.equal(lines[0], "# SpindleLabs OBJ, units: millimetres");
  assert.equal(lines[1], "o Body_1");
  assert.equal(lines[6], "f 1 2 3");
  // The second body's corners are 5 to 8, so its first triangle (0, 1, 2 in its own numbers) is 5 6 7.
  assert.equal(lines[10], "o Body_2");
  assert.equal(lines[15], "f 5 6 7");
  assert.equal(lines.length, 1 + 2 * (1 + 4 + 4));
});

test("the same bodies always make the same 3MF bytes", () => {
  const m = meshOfStl(tetra, "Body 1");
  assert.deepEqual(threeMf([m]), threeMf([m]));
});

test("Python's own zip reader opens the 3MF, its CRCs check, and the parts are the 3MF ones", () => {
  // An independent reader: Python's zipfile checks every CRC (testzip) and reads the parts back.
  const dir = mkdtempSync(join(tmpdir(), "mesh-files-"));
  const file = join(dir, "part.3mf");
  writeFileSync(file, threeMf([meshOfStl(tetra, "Body 1")]));
  const said = execFileSync("python3", ["-I", "-c", [
    "import sys, zipfile",
    "z = zipfile.ZipFile(sys.argv[1])",
    "assert z.testzip() is None",
    "print(','.join(z.namelist()))",
    "m = z.read('3D/3dmodel.model').decode()",
    "print(m.count('<vertex '), m.count('<triangle '))",
  ].join("\n"), file], { encoding: "utf8" });
  assert.equal(said, "[Content_Types].xml,_rels/.rels,3D/3dmodel.model\n4 4\n");
});

test("a broken zip is caught by the same reader (the check can fail)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mesh-files-"));
  const file = join(dir, "bad.3mf");
  const bytes = zipStored([{ path: "a.txt", bytes: new TextEncoder().encode("hello") }]);
  bytes[30 + 5] ^= 1; // one bit of the stored "hello" flipped: its CRC no longer matches
  writeFileSync(file, bytes);
  const said = execFileSync("python3", ["-I", "-c", "import sys, zipfile\nprint(zipfile.ZipFile(sys.argv[1]).testzip())", file], { encoding: "utf8" });
  assert.equal(said, "a.txt\n");
});
