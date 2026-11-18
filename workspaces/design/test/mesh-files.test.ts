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

// The 3MF package checked as a strict reader checks it (export hunt F2, issue #552), in Python with only its own
// library: every local zip header walked from the start of the file (not the central directory alone, which is all
// zipfile trusts), its CRC-32 and both sizes compared with the bytes that follow, and the central directory's copy
// with the local one; [Content_Types].xml giving exactly the OPC and 3MF types for .rels and .model; _rels/.rels
// naming a part that is there, with the 3MF relationship type; the model parsed as namespaced XML in the 3MF core
// namespace, in millimetres, each object a mesh of at least 3 vertices and 1 triangle (the core schema's minimums)
// whose indices are all corners it has, and each build item naming an object. The constants are the specs' own.
const STRICT = String.raw`
import sys, struct, zlib
import xml.etree.ElementTree as ET
data = open(sys.argv[1], 'rb').read()
local, at = {}, 0
while data[at:at+4] == b'PK\x03\x04':
    ver, flags, method, t, d, crc, csize, usize, nlen, xlen = struct.unpack('<HHHHHIIIHH', data[at+4:at+30])
    name = data[at+30:at+30+nlen].decode('utf-8')
    body = data[at+30+nlen+xlen:at+30+nlen+xlen+csize]
    assert method == 0 and not flags & 8, f'{name}: not stored with sizes in its header'
    assert csize == usize == len(body), f'{name}: local sizes {csize}/{usize}, {len(body)} bytes'
    assert zlib.crc32(body) == crc, f'{name}: local CRC'
    local[name] = (at, crc, csize, body)
    at += 30 + nlen + xlen + csize
central = data.rfind(b'PK\x05\x06')
assert central >= 0, 'no end of central directory'
count, size, start = struct.unpack('<HII', data[central+10:central+20])
assert start == at, 'central directory not straight after the last local file'
c = start
for _ in range(count):
    assert data[c:c+4] == b'PK\x01\x02', 'central header'
    crc, csize, usize, nlen, xlen, clen = struct.unpack('<IIIHHH', data[c+16:c+34])
    off = struct.unpack('<I', data[c+42:c+46])[0]
    name = data[c+46:c+46+nlen].decode('utf-8')
    assert name in local and local[name][:3] == (off, crc, csize) and usize == csize, f'{name}: central and local differ'
    c += 46 + nlen + xlen + clen
assert c == central and len(local) == count, 'entry count'
part = lambda n: local[n][3]
CT = '{http://schemas.openxmlformats.org/package/2006/content-types}'
types = {e.get('Extension').lower(): e.get('ContentType') for e in ET.fromstring(part('[Content_Types].xml')) if e.tag == CT + 'Default'}
assert types.get('rels') == 'application/vnd.openxmlformats-package.relationships+xml', types
assert types.get('model') == 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', types
RL = '{http://schemas.openxmlformats.org/package/2006/relationships}'
rels = [r for r in ET.fromstring(part('_rels/.rels')) if r.tag == RL + 'Relationship' and r.get('Type') == 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel']
assert len(rels) == 1, 'one 3D model relationship'
target = rels[0].get('Target').lstrip('/')
assert target in local, f'relationship names {target}, not in the package'
M = '{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}'
model = ET.fromstring(part(target))
assert model.tag == M + 'model' and model.get('unit') == 'millimeter', model.tag
ids, out = set(), []
for o in model.find(M + 'resources').findall(M + 'object'):
    v = o.find(M + 'mesh').find(M + 'vertices').findall(M + 'vertex')
    t = [[int(x.get(k)) for k in ('v1', 'v2', 'v3')] for x in o.find(M + 'mesh').find(M + 'triangles').findall(M + 'triangle')]
    assert len(v) >= 3 and len(t) >= 1, f'object {o.get("id")}: {len(v)} vertices, {len(t)} triangles'
    assert all(0 <= i < len(v) for tri in t for i in tri), 'triangle index out of range'
    ids.add(o.get('id'))
    out.append(f'{o.get("name")}: {len(v)} {len(t)}')
items = [i.get('objectid') for i in model.find(M + 'build').findall(M + 'item')]
assert items and all(i in ids for i in items), 'build items'
print('\n'.join(out))
`;

function strictReads(bytes: Uint8Array): string {
  const file = join(mkdtempSync(join(tmpdir(), "strict-3mf-")), "part.3mf");
  writeFileSync(file, bytes);
  return execFileSync("python3", ["-I", "-c", STRICT, file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("a strict reader opens the 3MF: local zip headers, content types, the relationship, the namespaced model", () => {
  const two: Mesh[] = [meshOfStl(tetra, "Body 1"), { ...meshOfStl(tetra, "Body \"2\" <&>") }];
  assert.equal(strictReads(threeMf(two)), 'Body 1: 4 4\nBody "2" <&>: 4 4');
});

test("the strict reader refuses each break a 3MF reader refuses (the check can fail)", () => {
  const utf8 = new TextEncoder();
  const good = threeMf([meshOfStl(tetra, "Body 1")]);
  // The package's two small parts as the good file stores them (stored, so their text is there as it is).
  const text = new TextDecoder().decode(good);
  const types = text.slice(text.indexOf("<?xml"), text.indexOf("</Types>") + 9);
  const relsStart = text.indexOf("<?xml", text.indexOf("</Types>"));
  const rels = text.slice(relsStart, text.indexOf("</Relationships>") + 17);
  const partsOf = (model = modelXml([meshOfStl(tetra, "Body 1")]), t = types, r = rels) =>
    zipStored([
      { path: "[Content_Types].xml", bytes: utf8.encode(t) },
      { path: "_rels/.rels", bytes: utf8.encode(r) },
      { path: "3D/3dmodel.model", bytes: utf8.encode(model) },
    ]);
  // The control: put together the same way, the reader opens it, byte for byte the app's file.
  assert.deepEqual(partsOf(), good);
  assert.equal(strictReads(partsOf()), "Body 1: 4 4");
  const breaks: [string, Uint8Array][] = [
    ["namespace", partsOf(modelXml([meshOfStl(tetra, "Body 1")]).replace("core/2015/02", "core/2015/03"))],
    ["content type", partsOf(undefined, types.replace("3dmanufacturing-3dmodel+xml", "3dmanufacturing-model+xml"))],
    ["relationship target", partsOf(undefined, undefined, rels.replace("/3D/3dmodel.model", "/3D/model.model"))],
    ["relationship type", partsOf(undefined, undefined, rels.replace("2013/01/3dmodel", "2013/01/model"))],
    ["unescaped quote", partsOf(modelXml([meshOfStl(tetra, "Body 1")]).replace('name="Body 1"', 'name="Body "1""'))],
    ["empty object", partsOf(modelXml([meshOfStl(tetra, "Body 1"), { name: "Body 2", corners: [1, 1, 1], triangles: [] }]))],
  ];
  // The first local header's CRC (bytes 14–17) and its sizes (18–25), each broken in the file's own bytes.
  const crc = new Uint8Array(good);
  crc[14] ^= 1;
  const sizes = new Uint8Array(good);
  sizes.fill(0, 18, 26);
  breaks.push(["local CRC", crc], ["local sizes", sizes]);
  for (const [what, bytes] of breaks) assert.throws(() => strictReads(bytes), undefined, `${what} was not refused`);
});

test("a zip with more entries than it can count without its 64-bit extension is refused in words", () => {
  const files = Array.from({ length: 65536 }, (_, i) => ({ path: `f${i}`, bytes: new Uint8Array(0) }));
  assert.throws(() => zipStored(files), /at most 65535 files .* this one has 65536/);
  assert.doesNotThrow(() => zipStored(files.slice(0, 65535)));
});

test("the files made a piece at a time are byte for byte the whole text encoded at once, across piece boundaries", async () => {
  const { linesToBytes, modelBytes, objBytes } = await import("../src/mesh-files.ts");
  // 40,000 copies of the tetrahedron's triangles over its 4 corners: about 50 bytes a triangle line, so some 2 MB of
  // model text, crossing the 1 MiB piece boundary at least once; a name with a 3-byte and a 4-byte UTF-8 character.
  const t = meshOfStl(tetra, "Bödy € 😀");
  const big: Mesh = { ...t, triangles: Array.from({ length: 40000 }, () => t.triangles).flat() };
  const utf8 = new TextEncoder();
  assert.ok(utf8.encode(modelXml([big])).length > 2 * (1 << 20) - 1);
  assert.deepEqual(modelBytes([big, t]), utf8.encode(modelXml([big, t])));
  assert.deepEqual(objBytes([big, t]), utf8.encode(objText([big, t])));
  assert.deepEqual(linesToBytes([]), new Uint8Array(0));
});
