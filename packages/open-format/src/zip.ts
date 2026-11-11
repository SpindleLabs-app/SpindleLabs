// A small strict zip reader and a deterministic zip writer (PKWARE APPNOTE
// 6.3.x subset): STORE and DEFLATE only, no encryption, no zip64.
//
// Layouts (all numbers little-endian):
//   local header, 30 bytes + name + extra:
//     0 signature 0x04034b50 | 4 version needed | 6 flags | 8 method | 10 time | 12 date
//     14 crc-32 | 18 compressed size | 22 uncompressed size | 26 name length | 28 extra length
//   central directory entry, 46 bytes + name + extra + comment:
//     0 signature 0x02014b50 | 4 version made by | 6 version needed | 8 flags | 10 method
//     12 time | 14 date | 16 crc-32 | 20 compressed size | 24 uncompressed size
//     28 name length | 30 extra length | 32 comment length | 34 disk | 36 internal attributes
//     38 external attributes | 42 local header offset
//   end of central directory, 22 bytes + comment:
//     0 signature 0x06054b50 | 4 disk | 6 directory disk | 8 entries on this disk
//     10 entries | 12 directory size | 16 directory offset | 20 comment length
//
// The reader accounts for every byte: entries lie back to back from offset 0,
// the central directory follows the last one, the end record ends the file.

import { crc32 } from './crc32.ts';
import { FormatError } from './errors.ts';

export const MAX_ENTRIES = 10_000;
export const MAX_PART_BYTES = 256 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export const MAX_RATIO = 1000;
export const MAX_NAME_BYTES = 255;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const DESCRIPTOR_SIG = 0x08074b50;

/** Flag bits. */
export const FLAG_ENCRYPTED = 0x0001;
export const FLAG_DATA_DESCRIPTOR = 0x0008;
export const FLAG_STRONG_ENCRYPTION = 0x0040;
export const FLAG_UTF8 = 0x0800;
export const FLAG_MASKED_HEADERS = 0x2000;

/** DOS date of 1980-01-01: (year-1980) << 9 | month << 5 | day = 0 | 32 | 1. */
export const DOS_DATE_1980 = 0x0021;
export const DOS_TIME_MIDNIGHT = 0x0000;

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  /** Where the (compressed) data starts. */
  dataOffset: number;
  localExtraLength: number;
  centralExtraLength: number;
  isDirectory: boolean;
}

const u16 = (b: Uint8Array, p: number): number => b[p]! | (b[p + 1]! << 8);
const u32 = (b: Uint8Array, p: number): number =>
  (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;

const utf8 = new TextEncoder();

/** Checks an entry name against the draft 0.1 rules; throws FormatError. */
export function checkEntryName(name: string): void {
  const byteLength = utf8.encode(name).length;
  if (name.length === 0) throw new FormatError('bad-name', 'an entry has an empty name');
  if (byteLength > MAX_NAME_BYTES) {
    throw new FormatError('bad-name', `entry name over ${MAX_NAME_BYTES} bytes (${byteLength})`);
  }
  const shown = JSON.stringify(name.slice(0, 80));
  if (name.includes('\\')) throw new FormatError('path-traversal', `entry name ${shown} contains "\\"`);
  if (name.startsWith('/')) throw new FormatError('path-traversal', `entry name ${shown} is absolute`);
  if (/^[A-Za-z]:/.test(name)) throw new FormatError('path-traversal', `entry name ${shown} starts with a drive letter`);
  // U+0000 to U+001F and U+007F (spec 4.3)
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new FormatError('bad-name', `entry name ${shown} contains a control character`);
  }
  const segments = name.split('/');
  // a trailing "/" (a directory entry) leaves one empty last segment, allowed
  const inner = name.endsWith('/') ? segments.slice(0, -1) : segments;
  for (const s of inner) {
    if (s === '..') throw new FormatError('path-traversal', `entry name ${shown} contains ".."`);
    if (s === '' || s === '.') throw new FormatError('bad-name', `entry name ${shown} has an empty or "." segment`);
  }
}

/**
 * The key two names are compared by, ignoring case. The spec names Unicode
 * simple case folding; JavaScript has no case-fold function, and lower-casing
 * folds the same pairs for nearly every letter (the rare differences, such as
 * the long s "ſ", are listed in this package's CLAUDE.md).
 */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

function checkExtra(b: Uint8Array, start: number, length: number, where: string): void {
  let p = start;
  const end = start + length;
  while (p + 4 <= end) {
    const id = u16(b, p);
    const size = u16(b, p + 2);
    if (id === 0x0001) throw new FormatError('zip64', `${where} has a zip64 extra field`);
    p += 4 + size;
  }
}

/** Reads and checks the zip structure; does not decompress anything. */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const len = bytes.length;
  if (len < 22) throw new FormatError('truncated', 'too short to be a zip file');
  // find the end record: the one whose comment ends exactly at the end of the file
  let end = -1;
  const lowest = Math.max(0, len - 22 - 0xffff);
  for (let p = len - 22; p >= lowest; p--) {
    if (u32(bytes, p) === END_SIG && p + 22 + u16(bytes, p + 20) === len) {
      end = p;
      break;
    }
  }
  if (end < 0) throw new FormatError('bad-zip', 'no end of central directory record at the end of the file');
  if (end >= 20 && u32(bytes, end - 20) === ZIP64_LOCATOR_SIG) {
    throw new FormatError('zip64', 'zip64 end record (not allowed in draft 0.1)');
  }
  const disk = u16(bytes, end + 4);
  const cdDisk = u16(bytes, end + 6);
  const onDisk = u16(bytes, end + 8);
  const total = u16(bytes, end + 10);
  const cdSize = u32(bytes, end + 12);
  const cdOffset = u32(bytes, end + 16);
  if (total === 0xffff || onDisk === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new FormatError('zip64', 'zip64 marker values in the end record');
  }
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw new FormatError('bad-zip', 'multi-disk zip files are not allowed');
  if (total > MAX_ENTRIES) throw new FormatError('too-many-entries', `${total} entries (at most ${MAX_ENTRIES})`);
  if (cdOffset + cdSize !== end) {
    throw new FormatError('bad-zip', 'the central directory does not end where the end record starts');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const entries: ZipEntry[] = [];
  const keys = new Set<string>();
  let totalBytes = 0;
  let p = cdOffset;
  for (let k = 0; k < total; k++) {
    if (p + 46 > end) throw new FormatError('bad-zip', 'the central directory is shorter than its entry count');
    if (u32(bytes, p) !== CENTRAL_SIG) throw new FormatError('bad-zip', `bad central directory signature at ${p}`);
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    const compressedSize = u32(bytes, p + 20);
    const uncompressedSize = u32(bytes, p + 24);
    const nameLength = u16(bytes, p + 28);
    const extraLength = u16(bytes, p + 30);
    const commentLength = u16(bytes, p + 32);
    const diskStart = u16(bytes, p + 34);
    const localOffset = u32(bytes, p + 42);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new FormatError('bad-zip', 'a central directory entry runs past the directory');
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength);
    let name: string;
    try {
      name = decoder.decode(nameBytes);
    } catch {
      throw new FormatError('bad-name', `entry ${k} has a name that is not valid UTF-8`);
    }
    checkEntryName(name);
    const where = `entry ${JSON.stringify(name.slice(0, 80))}`;
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION | FLAG_MASKED_HEADERS)) {
      throw new FormatError('encrypted', `${where} is encrypted`);
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff || diskStart === 0xffff) {
      throw new FormatError('zip64', `${where} has zip64 marker values`);
    }
    checkExtra(bytes, p + 46 + nameLength, extraLength, where);
    if (diskStart !== 0) throw new FormatError('bad-zip', `${where} is on another disk`);
    if (method !== 0 && method !== 8) {
      throw new FormatError('compression-method', `${where} uses compression method ${method} (only 0 and 8 allowed)`);
    }
    const key = nameKey(name);
    if (keys.has(key)) throw new FormatError('duplicate-entry', `${where} appears twice (names compared ignoring case)`);
    keys.add(key);
    if (uncompressedSize > MAX_PART_BYTES) {
      throw new FormatError('part-too-large', `${where} is ${uncompressedSize} bytes uncompressed (at most ${MAX_PART_BYTES})`);
    }
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_TOTAL_BYTES) throw new FormatError('total-too-large', `entries total over ${MAX_TOTAL_BYTES} bytes`);
    if (uncompressedSize > MAX_RATIO * compressedSize) {
      throw new FormatError('zip-bomb', `${where} expands ${uncompressedSize} bytes from ${compressedSize} (ratio over ${MAX_RATIO}:1)`);
    }
    if (method === 0 && compressedSize !== uncompressedSize) {
      throw new FormatError('size-mismatch', `${where} is stored but its two sizes differ`);
    }
    // the local header
    if (localOffset + 30 > cdOffset) throw new FormatError('truncated', `${where}'s local header lies past the entries`);
    if (u32(bytes, localOffset) !== LOCAL_SIG) throw new FormatError('bad-zip', `${where} has no local header at ${localOffset}`);
    const lFlags = u16(bytes, localOffset + 6);
    const lMethod = u16(bytes, localOffset + 8);
    const lCrc = u32(bytes, localOffset + 14);
    const lCompressed = u32(bytes, localOffset + 18);
    const lUncompressed = u32(bytes, localOffset + 22);
    const lNameLength = u16(bytes, localOffset + 26);
    const lExtraLength = u16(bytes, localOffset + 28);
    const dataOffset = localOffset + 30 + lNameLength + lExtraLength;
    if (dataOffset > cdOffset) throw new FormatError('truncated', `${where}'s local header runs past the entries`);
    const lName = bytes.subarray(localOffset + 30, localOffset + 30 + lNameLength);
    if (lNameLength !== nameLength || !lName.every((b, i) => b === nameBytes[i])) {
      throw new FormatError('header-mismatch', `${where}: the local header names another file`);
    }
    if (lFlags !== flags || lMethod !== method) {
      throw new FormatError('header-mismatch', `${where}: the local header's flags or method differ`);
    }
    checkExtra(bytes, localOffset + 30 + lNameLength, lExtraLength, where);
    const descriptor = (flags & FLAG_DATA_DESCRIPTOR) !== 0;
    if (descriptor) {
      // the local values may be zero; if not, they must agree
      const ok = (lCrc === 0 || lCrc === crc) && (lCompressed === 0 || lCompressed === compressedSize) &&
        (lUncompressed === 0 || lUncompressed === uncompressedSize);
      if (!ok) throw new FormatError('header-mismatch', `${where}: the local header's sizes or CRC differ`);
    } else if (lCrc !== crc || lCompressed !== compressedSize || lUncompressed !== uncompressedSize) {
      throw new FormatError('header-mismatch', `${where}: the local header's sizes or CRC differ`);
    }
    entries.push({
      name, method, flags, crc, compressedSize, uncompressedSize, localOffset, dataOffset,
      localExtraLength: lExtraLength, centralExtraLength: extraLength, isDirectory: name.endsWith('/'),
    });
    p = next;
  }
  if (p !== end) throw new FormatError('bad-zip', 'the central directory is longer than its entries');
  // every byte accounted for: entries back to back from 0, then the directory
  const byOffset = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  let at = 0;
  for (const e of byOffset) {
    const where = `entry ${JSON.stringify(e.name.slice(0, 80))}`;
    if (e.localOffset < at) throw new FormatError('overlapping-entries', `${where} overlaps the entry before it`);
    if (e.localOffset > at) throw new FormatError('bad-zip', `unaccounted bytes before ${where}`);
    let stop = e.dataOffset + e.compressedSize;
    if (stop > cdOffset) throw new FormatError('overlapping-entries', `${where}'s data runs into the central directory`);
    if (e.flags & FLAG_DATA_DESCRIPTOR) {
      const signed = stop + 4 <= cdOffset && u32(bytes, stop) === DESCRIPTOR_SIG;
      const q = signed ? stop + 4 : stop;
      if (q + 12 > cdOffset) throw new FormatError('truncated', `${where}'s data descriptor is missing`);
      if (u32(bytes, q) !== e.crc || u32(bytes, q + 4) !== e.compressedSize || u32(bytes, q + 8) !== e.uncompressedSize) {
        throw new FormatError('header-mismatch', `${where}: the data descriptor differs from the central directory`);
      }
      stop = q + 12;
    }
    at = stop;
  }
  if (at !== cdOffset) throw new FormatError('bad-zip', 'unaccounted bytes before the central directory');
  return entries;
}

async function inflateRaw(data: Uint8Array, expected: number, where: string): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  // errors surface on the reading side; these two only must not go unhandled
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  const out = new Uint8Array(expected);
  let n = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > expected) {
        reader.cancel().catch(() => {});
        throw new FormatError('size-mismatch', `${where} decompresses to more than its declared ${expected} bytes`);
      }
      out.set(value, n);
      n += value.length;
    }
  } catch (e) {
    if (e instanceof FormatError) throw e;
    throw new FormatError('bad-deflate', `${where} is not valid DEFLATE data`);
  }
  if (n !== expected) throw new FormatError('size-mismatch', `${where} decompresses to ${n} bytes, not the declared ${expected}`);
  return out;
}

/** The entry's uncompressed bytes, CRC-32 checked. */
export async function readEntryData(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const where = `entry ${JSON.stringify(entry.name.slice(0, 80))}`;
  const raw = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  const data = entry.method === 0 ? raw : await inflateRaw(raw, entry.uncompressedSize, where);
  if (crc32(data) !== entry.crc) throw new FormatError('crc-mismatch', `${where}: CRC-32 does not match`);
  return data;
}

// ---------------------------------------------------------------- writing

/** One entry exactly as it goes into the file (tests use it to build broken files). */
export interface RawZipEntry {
  name: string | Uint8Array;
  method: number;
  flags?: number;
  crc: number;
  uncompressedSize: number;
  /** The bytes as stored (already compressed for method 8). */
  data: Uint8Array;
  /** Defaults to data.length. */
  compressedSize?: number;
  localExtra?: Uint8Array;
  centralExtra?: Uint8Array;
  /** Bytes written after the data (a data descriptor). */
  trailer?: Uint8Array;
  versionNeeded?: number;
}

/** Lays raw entries out as a zip file: local headers back to back, then the directory. */
export function assembleZip(entries: RawZipEntry[], comment: Uint8Array = new Uint8Array(0)): Uint8Array {
  const names = entries.map((e) => (typeof e.name === 'string' ? utf8.encode(e.name) : e.name));
  let size = 22 + comment.length;
  entries.forEach((e, k) => {
    const n = names[k]!.length;
    size += 30 + n + (e.localExtra?.length ?? 0) + e.data.length + (e.trailer?.length ?? 0);
    size += 46 + n + (e.centralExtra?.length ?? 0);
  });
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let p = 0;
  const offsets: number[] = [];
  entries.forEach((e, k) => {
    const name = names[k]!;
    const extra = e.localExtra ?? new Uint8Array(0);
    offsets.push(p);
    view.setUint32(p, LOCAL_SIG, true);
    view.setUint16(p + 4, e.versionNeeded ?? (e.method === 8 ? 20 : 10), true);
    view.setUint16(p + 6, e.flags ?? 0, true);
    view.setUint16(p + 8, e.method, true);
    view.setUint16(p + 10, DOS_TIME_MIDNIGHT, true);
    view.setUint16(p + 12, DOS_DATE_1980, true);
    view.setUint32(p + 14, e.crc >>> 0, true);
    view.setUint32(p + 18, e.compressedSize ?? e.data.length, true);
    view.setUint32(p + 22, e.uncompressedSize, true);
    view.setUint16(p + 26, name.length, true);
    view.setUint16(p + 28, extra.length, true);
    out.set(name, p + 30);
    out.set(extra, p + 30 + name.length);
    p += 30 + name.length + extra.length;
    out.set(e.data, p);
    p += e.data.length;
    if (e.trailer) {
      out.set(e.trailer, p);
      p += e.trailer.length;
    }
  });
  const cdOffset = p;
  entries.forEach((e, k) => {
    const name = names[k]!;
    const extra = e.centralExtra ?? new Uint8Array(0);
    view.setUint32(p, CENTRAL_SIG, true);
    view.setUint16(p + 4, 20, true); // made by: MS-DOS host, spec 2.0
    view.setUint16(p + 6, e.versionNeeded ?? (e.method === 8 ? 20 : 10), true);
    view.setUint16(p + 8, e.flags ?? 0, true);
    view.setUint16(p + 10, e.method, true);
    view.setUint16(p + 12, DOS_TIME_MIDNIGHT, true);
    view.setUint16(p + 14, DOS_DATE_1980, true);
    view.setUint32(p + 16, e.crc >>> 0, true);
    view.setUint32(p + 20, e.compressedSize ?? e.data.length, true);
    view.setUint32(p + 24, e.uncompressedSize, true);
    view.setUint16(p + 28, name.length, true);
    view.setUint16(p + 30, extra.length, true);
    // 32 comment length, 34 disk, 36 internal, 38 external attributes: all 0
    view.setUint32(p + 42, offsets[k]!, true);
    out.set(name, p + 46);
    out.set(extra, p + 46 + name.length);
    p += 46 + name.length + extra.length;
  });
  const cdSize = p - cdOffset;
  view.setUint32(p, END_SIG, true);
  view.setUint16(p + 8, entries.length, true);
  view.setUint16(p + 10, entries.length, true);
  view.setUint32(p + 12, cdSize, true);
  view.setUint32(p + 16, cdOffset, true);
  view.setUint16(p + 20, comment.length, true);
  out.set(comment, p + 22);
  return out;
}

/** DEFLATE (raw, no zlib header) with the platform's compressor. */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  let n = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
  }
  const out = new Uint8Array(n);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export interface ZipInput {
  name: string;
  data: Uint8Array;
  /** 0 STORE, 8 DEFLATE. DEFLATE falls back to STORE when it saves nothing. */
  method: 0 | 8;
}

/**
 * Writes a zip deterministically: entries in the given order, DOS time
 * 1980-01-01 00:00, no extra fields, no comment, no data descriptors. The same
 * entries give the same bytes on the same platform compressor.
 */
export async function writeZip(inputs: ZipInput[]): Promise<Uint8Array> {
  if (inputs.length > MAX_ENTRIES) throw new FormatError('too-many-entries', `${inputs.length} entries (at most ${MAX_ENTRIES})`);
  const keys = new Set<string>();
  const raw: RawZipEntry[] = [];
  let total = 0;
  for (const input of inputs) {
    checkEntryName(input.name);
    const key = nameKey(input.name);
    if (keys.has(key)) throw new FormatError('duplicate-entry', `entry ${JSON.stringify(input.name)} given twice`);
    keys.add(key);
    if (input.data.length > MAX_PART_BYTES) throw new FormatError('part-too-large', `entry ${JSON.stringify(input.name)} is over ${MAX_PART_BYTES} bytes`);
    total += input.data.length;
    if (total > MAX_TOTAL_BYTES) throw new FormatError('total-too-large', `entries total over ${MAX_TOTAL_BYTES} bytes`);
    let method: number = input.method;
    let stored = input.data;
    if (method === 8) {
      const deflated = await deflateRaw(input.data);
      if (deflated.length < input.data.length) stored = deflated;
      else method = 0;
    }
    if (input.data.length > MAX_RATIO * stored.length) {
      // so well compressed a reader would take it for a zip bomb: store it
      stored = input.data;
      method = 0;
    }
    const ascii = /^[\u0000-\u007f]*$/.test(input.name);
    raw.push({ name: input.name, method, flags: ascii ? 0 : FLAG_UTF8, crc: crc32(input.data), uncompressedSize: input.data.length, data: stored });
  }
  return assembleZip(raw);
}
