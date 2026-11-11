// The zip layer on its own: names, limits, structure, CRC, DEFLATE.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32 } from '../src/crc32.ts';
import {
  assembleZip, checkEntryName, deflateRaw, FLAG_DATA_DESCRIPTOR, FLAG_ENCRYPTED, MAX_ENTRIES, MAX_PART_BYTES,
  MAX_RATIO, readEntryData, readZipDirectory, writeZip,
} from '../src/zip.ts';
import type { RawZipEntry } from '../src/zip.ts';
import { dec, enc, refuses, stored } from './helpers.ts';

const two = (): RawZipEntry[] => [stored('a.txt', enc('hello')), stored('b.txt', enc('world'))];

test('a stored zip reads back, entry by entry', async () => {
  const zip = assembleZip(two());
  const entries = readZipDirectory(zip);
  assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'b.txt']);
  assert.equal(dec(await readEntryData(zip, entries[1]!)), 'world');
});

test('writeZip is deterministic and DEFLATE round-trips', async () => {
  const text = enc('the quick brown fox '.repeat(200));
  const inputs = [{ name: 'x.json', data: text, method: 8 as const }, { name: 'dir/é.bin', data: new Uint8Array([1, 2, 3]), method: 0 as const }];
  const a = await writeZip(inputs);
  const b = await writeZip(inputs);
  assert.deepEqual(a, b);
  const entries = readZipDirectory(a);
  assert.equal(entries[0]!.method, 8);
  assert.ok(entries[0]!.compressedSize < text.length);
  assert.deepEqual(await readEntryData(a, entries[0]!), text);
  assert.deepEqual(await readEntryData(a, entries[1]!), new Uint8Array([1, 2, 3]));
  // data that DEFLATE cannot shrink is stored
  const tiny = await writeZip([{ name: 't', data: enc('ab'), method: 8 }]);
  assert.equal(readZipDirectory(tiny)[0]!.method, 0);
});

test('path traversal names are refused: "../x", "/x", "a\\b", "C:x", "a/../b"', async () => {
  for (const name of ['../x', '/x', 'a\\b', 'C:x', 'c:/x', 'a/../b', '..']) {
    await refuses(() => checkEntryName(name), 'path-traversal');
    await refuses(() => readZipDirectory(assembleZip([stored(name, enc('x'))])), 'path-traversal');
  }
  // dots inside a segment are fine
  checkEntryName('a..b/c.d');
});

test('other bad names: empty, empty or "." segment, control characters, over 255 bytes, invalid UTF-8', async () => {
  for (const name of ['', 'a//b', './a', 'a/./b', 'a\u0000b', 'a\nb', 'a\u001fb', 'a\u007fb']) {
    await refuses(() => checkEntryName(name), 'bad-name');
  }
  // only U+0000 to U+001F and U+007F are control characters here (spec 4.3)
  checkEntryName('a\u0085b');
  // 255 bytes allowed, 256 refused (boundary), counted in UTF-8 bytes: "é" is 2 bytes
  checkEntryName('a'.repeat(255));
  await refuses(() => checkEntryName('a'.repeat(256)), 'bad-name');
  checkEntryName('é'.repeat(127) + 'a'); // 254 + 1 = 255 bytes
  await refuses(() => checkEntryName('é'.repeat(128)), 'bad-name'); // 256 bytes
  await refuses(() => readZipDirectory(assembleZip([stored(new Uint8Array([0x61, 0xff]), enc('x'))])), 'bad-name');
});

test('duplicate names are refused, ignoring case', async () => {
  await refuses(() => readZipDirectory(assembleZip([stored('a.txt', enc('1')), stored('a.txt', enc('2'))])), 'duplicate-entry');
  await refuses(() => readZipDirectory(assembleZip([stored('Part.JSON', enc('1')), stored('part.json', enc('2'))])), 'duplicate-entry');
  await refuses(() => readZipDirectory(assembleZip([stored('Ébauche', enc('1')), stored('ébauche', enc('2'))])), 'duplicate-entry');
  await refuses(() => writeZip([{ name: 'A', data: enc('1'), method: 0 }, { name: 'a', data: enc('2'), method: 0 }]), 'duplicate-entry');
});

/** One DEFLATE entry declaring `uncompressed` bytes from `compressed` stored bytes; never inflated. */
const forged = (compressed: number, uncompressed: number, name = 'z'): RawZipEntry => ({
  name, method: 8, crc: 0, uncompressedSize: uncompressed, data: new Uint8Array(compressed),
});

test('zip-bomb ratio: 1000:1 and 900:1 read, 1001:1 and 1100:1 refused (boundary)', async () => {
  assert.equal(MAX_RATIO, 1000);
  readZipDirectory(assembleZip([forged(1000, 1000 * 1000)]));
  readZipDirectory(assembleZip([forged(1000, 900 * 1000)])); // 0.9×
  await refuses(() => readZipDirectory(assembleZip([forged(1000, 1000 * 1000 + 1000)])), 'zip-bomb'); // 1001:1
  await refuses(() => readZipDirectory(assembleZip([forged(1000, 1100 * 1000)])), 'zip-bomb'); // 1.1×
  // nothing stored at all, yet it claims bytes
  await refuses(() => readZipDirectory(assembleZip([forged(0, 1)])), 'zip-bomb');
});

test('a real zip bomb: 8 MiB of zeros genuinely deflated is refused', async () => {
  const zeros = new Uint8Array(8 * 1024 * 1024);
  const data = await deflateRaw(zeros);
  assert.ok(zeros.length > MAX_RATIO * data.length, `ratio ${zeros.length / data.length}`);
  const zip = assembleZip([{ name: 'zeros', method: 8, crc: crc32(zeros), uncompressedSize: zeros.length, data }]);
  await refuses(() => readZipDirectory(zip), 'zip-bomb');
  // and our writer stores such data instead of writing a file readers refuse
  const written = await writeZip([{ name: 'zeros', data: zeros, method: 8 }]);
  assert.equal(readZipDirectory(written)[0]!.method, 0);
});

test('size limits: one part over 256 MiB, all parts over 1 GiB, over 10,000 entries', async () => {
  // each declares 256 MiB from 270,000 bytes (ratio ~994:1, under the bomb limit)
  readZipDirectory(assembleZip([forged(270_000, MAX_PART_BYTES)]));
  await refuses(() => readZipDirectory(assembleZip([forged(270_000, MAX_PART_BYTES + 1)])), 'part-too-large');
  const four = [1, 2, 3, 4].map((k) => forged(270_000, MAX_PART_BYTES, `p${k}`));
  readZipDirectory(assembleZip(four)); // exactly 1 GiB
  await refuses(() => readZipDirectory(assembleZip([...four, forged(1, 1, 'p5')])), 'total-too-large');
  const many = (n: number): RawZipEntry[] => Array.from({ length: n }, (_, k) => stored(`e${k}`, new Uint8Array(0)));
  assert.equal(readZipDirectory(assembleZip(many(MAX_ENTRIES))).length, MAX_ENTRIES);
  await refuses(() => readZipDirectory(assembleZip(many(MAX_ENTRIES + 1))), 'too-many-entries');
});

test('CRC-32 mismatch is refused', async () => {
  const entries = two();
  entries[0]!.crc ^= 1; // same wrong CRC in the local header and the directory
  const zip = assembleZip(entries);
  const e = readZipDirectory(zip);
  await refuses(readEntryData(zip, e[0]!), 'crc-mismatch');
});

test('the local header must agree with the central directory', async () => {
  const zip = assembleZip(two());
  const broken = zip.slice();
  broken[14] ^= 0xff; // the local header's CRC of the first entry only
  await refuses(() => readZipDirectory(broken), 'header-mismatch');
  const renamed = zip.slice();
  renamed[30] = 0x41; // "a.txt" -> "A.txt" in the local header only
  await refuses(() => readZipDirectory(renamed), 'header-mismatch');
});

test('methods other than STORE and DEFLATE, encryption and zip64 are refused', async () => {
  await refuses(() => readZipDirectory(assembleZip([{ ...stored('a', enc('x')), method: 12 }])), 'compression-method');
  await refuses(() => readZipDirectory(assembleZip([{ ...stored('a', enc('x')), flags: FLAG_ENCRYPTED }])), 'encrypted');
  await refuses(() => readZipDirectory(assembleZip([{ ...stored('a', enc('x')), uncompressedSize: 0xffffffff, compressedSize: 0xffffffff }])), 'zip64');
  const zip64Extra = new Uint8Array([0x01, 0x00, 0x00, 0x00]); // header id 0x0001, size 0
  await refuses(() => readZipDirectory(assembleZip([{ ...stored('a', enc('x')), centralExtra: zip64Extra }])), 'zip64');
});

test('structure: truncated, trailing bytes, hidden bytes between entries, overlapping entries', async () => {
  const zip = assembleZip(two());
  await refuses(() => readZipDirectory(zip.subarray(0, 10)), 'truncated');
  await refuses(() => readZipDirectory(zip.subarray(0, zip.length - 1)), 'bad-zip');
  const trailing = new Uint8Array(zip.length + 1);
  trailing.set(zip);
  await refuses(() => readZipDirectory(trailing), 'bad-zip');
  // a hidden byte after the first entry's data: one extra stored byte the sizes don't count
  await refuses(() => readZipDirectory(assembleZip([{ ...stored('a', enc('xy')), compressedSize: 1, uncompressedSize: 1, crc: crc32(enc('x')) }])), 'bad-zip');
  // the first entry claims 45 stored bytes: its own 5 plus the second entry's 40 (30 + "b.txt" + "world")
  const covering = two();
  const first = covering[0]!;
  const whole = assembleZip(covering);
  const claimed = whole.subarray(35, 80);
  first.compressedSize = 45;
  first.uncompressedSize = 45;
  first.crc = crc32(claimed);
  await refuses(() => readZipDirectory(assembleZip(covering)), 'overlapping-entries');
});

test('DEFLATE data: lying sizes and damaged data are refused', async () => {
  const text = enc('abcabcabcabcabcabcabcabcabcabc'.repeat(10));
  const data = await deflateRaw(text);
  const ok = { name: 'd', method: 8, crc: crc32(text), uncompressedSize: text.length, data };
  const good = assembleZip([ok]);
  assert.deepEqual(await readEntryData(good, readZipDirectory(good)[0]!), text);
  const short = assembleZip([{ ...ok, uncompressedSize: text.length - 1 }]);
  await refuses(readEntryData(short, readZipDirectory(short)[0]!), 'size-mismatch');
  const long = assembleZip([{ ...ok, uncompressedSize: text.length + 1 }]);
  await refuses(readEntryData(long, readZipDirectory(long)[0]!), 'size-mismatch');
  const damaged = assembleZip([{ ...ok, data: new Uint8Array([0xff, 0xff, 0xff, 0xff]) }]);
  await refuses(readEntryData(damaged, readZipDirectory(damaged)[0]!), 'bad-deflate');
  // a stored entry whose two sizes differ
  await refuses(() => readZipDirectory(assembleZip([{ ...stored('s', enc('xy')), uncompressedSize: 3 }])), 'size-mismatch');
});

test('an entry with a data descriptor (as streaming zip writers make) reads', async () => {
  const data = enc('streamed');
  const trailer = new Uint8Array(16);
  const v = new DataView(trailer.buffer);
  v.setUint32(0, 0x08074b50, true);
  v.setUint32(4, crc32(data), true);
  v.setUint32(8, data.length, true);
  v.setUint32(12, data.length, true);
  const zip = assembleZip([{ ...stored('s', data), flags: FLAG_DATA_DESCRIPTOR, trailer }]);
  // the local header's CRC and sizes are zero; the directory and descriptor carry them
  zip.fill(0, 14, 26);
  assert.equal(dec(await readEntryData(zip, readZipDirectory(zip)[0]!)), 'streamed');
  const wrong = zip.slice();
  wrong[38 + data.length + 4] ^= 1; // the descriptor's CRC
  await refuses(() => readZipDirectory(wrong), 'header-mismatch');
});
