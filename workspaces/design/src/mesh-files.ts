// 3MF and OBJ files made from the kernel's binary STL (step 77). The
// triangles are the STL's own, corner for corner (the same single-precision
// numbers, so the solid check of the STL holds for these files too); only
// the packaging differs. A corner shared by several triangles is written
// once (corners match when their three numbers are exactly equal, which
// the kernel's STL gives for every shared corner), so the files say which
// triangles join, as 3MF requires. Each body is its own object, so a
// slicer never has to split touching bodies apart. 3MF is a zip; this one
// stores its three parts uncompressed (allowed by the zip format and by
// 3MF), with a fixed date, so the same bodies always make the same bytes.

const STL_HEADER = 80;
const STL_TRIANGLE = 50;

/** One body's mesh: its corners (x, y, z in mm, three numbers each) and its triangles (three corner indices each, counter-clockwise seen from outside). */
export interface Mesh {
  name: string;
  corners: number[];
  triangles: number[];
}

/**
 * The mesh in a binary STL file, shared corners merged. A triangle whose
 * corners are not three different points (no area) is left out: 3MF
 * refuses one, and it covers nothing. Refuses a file whose length does not
 * match its triangle count.
 */
export function meshOfStl(bytes: Uint8Array, name: string): Mesh {
  if (bytes.length < STL_HEADER + 4) throw new Error(`${name}: the STL is ${bytes.length} bytes, too short for a binary STL`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(STL_HEADER, true);
  if (bytes.length !== STL_HEADER + 4 + count * STL_TRIANGLE) throw new Error(`${name}: the STL says ${count} triangles but is ${bytes.length} bytes long`);
  const corners: number[] = [];
  const triangles: number[] = [];
  const index = new Map<string, number>();
  const at = (offset: number): number => {
    const x = view.getFloat32(offset, true);
    const y = view.getFloat32(offset + 4, true);
    const z = view.getFloat32(offset + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`${name}: the STL has a corner that is not a number`);
    // -0 and 0 are the same place.
    const key = `${x + 0},${y + 0},${z + 0}`;
    let i = index.get(key);
    if (i === undefined) {
      i = corners.length / 3;
      index.set(key, i);
      corners.push(x + 0, y + 0, z + 0);
    }
    return i;
  };
  for (let t = 0; t < count; t++) {
    // 12 bytes of normal first: the corners' order says which way the triangle faces, so the normal is not needed.
    const base = STL_HEADER + 4 + t * STL_TRIANGLE + 12;
    const a = at(base);
    const b = at(base + 12);
    const c = at(base + 24);
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  }
  return { name, corners, triangles };
}

/** The shortest decimal that reads back as exactly this single-precision number. */
export function shortFloat(v: number): string {
  for (let p = 1; p < 9; p++) {
    const s = Number(v.toPrecision(p));
    if (Math.fround(s) === v) return String(s);
  }
  return String(Number(v.toPrecision(9)));
}

/**
 * A name as XML attribute text. XML 1.0 allows no U+0000–U+0008, U+000B,
 * U+000C, U+000E–U+001F, U+FFFE, U+FFFF or lone surrogate at all, not even
 * as a reference: each becomes U+FFFD. A line feed, carriage return or tab
 * is written as a space: XML reads a raw one in an attribute back as a space
 * anyway, and written as a character reference the 3MF consortium's own
 * reader refuses the whole file (export hunt 2026-11-12 B, #640 3). A name
 * is a label, so the space loses nothing a slicer shows.
 */
export function xmlText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\n\r\t]/g, " ");
}

/** The 3MF model part line by line: every body an object in millimetres, each placed once on the plate as modelled. */
function* modelLines(meshes: readonly Mesh[]): Generator<string> {
  yield '<?xml version="1.0" encoding="UTF-8"?>';
  yield '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">';
  yield '<metadata name="Application">SpindleLabs</metadata>';
  yield "<resources>";
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    yield `<object id="${i + 1}" type="model" name="${xmlText(m.name)}"><mesh><vertices>`;
    for (let v = 0; v < m.corners.length; v += 3) yield `<vertex x="${shortFloat(m.corners[v])}" y="${shortFloat(m.corners[v + 1])}" z="${shortFloat(m.corners[v + 2])}"/>`;
    yield "</vertices><triangles>";
    for (let t = 0; t < m.triangles.length; t += 3) yield `<triangle v1="${m.triangles[t]}" v2="${m.triangles[t + 1]}" v3="${m.triangles[t + 2]}"/>`;
    yield "</triangles></mesh></object>";
  }
  yield "</resources>";
  yield "<build>";
  for (let i = 0; i < meshes.length; i++) yield `<item objectid="${i + 1}"/>`;
  yield "</build>";
  yield "</model>";
}

/** The 3MF model part as text (for tests and small parts; the file itself is made by `modelBytes`). */
export function modelXml(meshes: readonly Mesh[]): string {
  return [...modelLines(meshes)].join("\n") + "\n";
}

/** About 1 MiB of text per piece: far under the longest string a browser makes (2^29 characters), so a big mesh never meets that limit. */
const PIECE = 1 << 20;

/** Lines as UTF-8 bytes, each ending in a line feed, encoded a piece at a time so no one string holds the whole file. */
export function linesToBytes(lines: Iterable<string>): Uint8Array<ArrayBuffer> {
  const utf8 = new TextEncoder();
  const pieces: Uint8Array[] = [];
  let text: string[] = [];
  let length = 0;
  let total = 0;
  const flush = () => {
    if (text.length === 0) return;
    const b = utf8.encode(text.join("\n") + "\n");
    pieces.push(b);
    total += b.length;
    text = [];
    length = 0;
  };
  for (const line of lines) {
    text.push(line);
    length += line.length + 1;
    if (length >= PIECE) flush();
  }
  flush();
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The 3MF model part's bytes. */
export function modelBytes(meshes: readonly Mesh[]): Uint8Array<ArrayBuffer> {
  return linesToBytes(modelLines(meshes));
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n';
const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n';

/** A 3MF file holding these meshes. */
export function threeMf(meshes: readonly Mesh[]): Uint8Array<ArrayBuffer> {
  const utf8 = new TextEncoder();
  return zipStored([
    { path: "[Content_Types].xml", bytes: utf8.encode(CONTENT_TYPES) },
    { path: "_rels/.rels", bytes: utf8.encode(RELS) },
    { path: "3D/3dmodel.model", bytes: modelBytes(meshes) },
  ]);
}

/** A Wavefront OBJ file line by line, one named object per mesh (OBJ has no units: the numbers are millimetres, said in its first line). */
function* objLines(meshes: readonly Mesh[]): Generator<string> {
  yield "# SpindleLabs OBJ, units: millimetres";
  let first = 1; // OBJ counts corners from 1, across the whole file
  for (const m of meshes) {
    yield `o ${m.name.replace(/\s+/g, "_") || "body"}`;
    for (let v = 0; v < m.corners.length; v += 3) yield `v ${shortFloat(m.corners[v])} ${shortFloat(m.corners[v + 1])} ${shortFloat(m.corners[v + 2])}`;
    for (let t = 0; t < m.triangles.length; t += 3) yield `f ${m.triangles[t] + first} ${m.triangles[t + 1] + first} ${m.triangles[t + 2] + first}`;
    first += m.corners.length / 3;
  }
}

/** The OBJ file as text (for tests and small parts). */
export function objText(meshes: readonly Mesh[]): string {
  return [...objLines(meshes)].join("\n") + "\n";
}

/** The OBJ file's bytes, made a piece at a time. */
export function objBytes(meshes: readonly Mesh[]): Uint8Array<ArrayBuffer> {
  return linesToBytes(objLines(meshes));
}

let crcTable: Uint32Array | null = null;

/** The zip format's CRC-32 (the reflected 0xEDB88320 polynomial). */
export function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00, the earliest date a zip can hold: fixed, so the bytes never depend on the clock. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Zip's own size limit without its 64-bit extension, which this writer does not make: a bigger file is refused in words. */
const ZIP_LIMIT = 0xffffffff;
/** Zip's own entry count limit without the 64-bit extension (a 3MF has three). */
const ZIP_ENTRIES = 0xffff;

/** A zip archive of these files, stored without compression. */
export function zipStored(files: readonly { path: string; bytes: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  if (files.length > ZIP_ENTRIES) throw new Error(`A zip holds at most ${ZIP_ENTRIES} files without its 64-bit extension, and this one has ${files.length}`);
  const utf8 = new TextEncoder();
  const parts = files.map((f) => ({ name: utf8.encode(f.path), bytes: f.bytes, crc: crc32(f.bytes) }));
  const local = parts.reduce((n, p) => n + 30 + p.name.length + p.bytes.length, 0);
  const central = parts.reduce((n, p) => n + 46 + p.name.length, 0);
  if (local + central + 22 > ZIP_LIMIT) throw new Error("The 3MF file would be over 4 GB, more than a plain zip holds");
  const out = new Uint8Array(local + central + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const p of parts) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true); // local file header
    view.setUint16(at + 4, 20, true); // version needed: 2.0
    view.setUint16(at + 6, 0x0800, true); // names are UTF-8
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, DOS_TIME, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, p.crc, true);
    view.setUint32(at + 18, p.bytes.length, true);
    view.setUint32(at + 22, p.bytes.length, true);
    view.setUint16(at + 26, p.name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(p.name, at + 30);
    out.set(p.bytes, at + 30 + p.name.length);
    at += 30 + p.name.length + p.bytes.length;
  }
  const centralStart = at;
  parts.forEach((p, i) => {
    view.setUint32(at, 0x02014b50, true); // central directory header
    view.setUint16(at + 4, 20, true); // made by: 2.0
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, p.crc, true);
    view.setUint32(at + 20, p.bytes.length, true);
    view.setUint32(at + 24, p.bytes.length, true);
    view.setUint16(at + 28, p.name.length, true);
    // extra, comment, disk, internal and external attributes: 0
    view.setUint32(at + 42, offsets[i], true);
    out.set(p.name, at + 46);
    at += 46 + p.name.length;
  });
  view.setUint32(at, 0x06054b50, true); // end of central directory
  view.setUint16(at + 8, parts.length, true);
  view.setUint16(at + 10, parts.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}
