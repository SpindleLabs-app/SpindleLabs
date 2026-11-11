// Values worked out by hand or taken from the standards, independent of the code.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32 } from '../src/crc32.ts';
import { plainToPackage, sha256Hex } from '../src/package.ts';
import { dec, enc, SAVED } from './helpers.ts';

test('CRC-32 standard check values', () => {
  // The CRC-32 catalogue's check value: CRC-32 of the nine ASCII bytes "123456789" is 0xCBF43926.
  assert.equal(crc32(enc('123456789')), 0xcbf43926);
  // No bytes: the register stays 0xFFFFFFFF, and the final XOR with 0xFFFFFFFF gives 0.
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('SHA-256 of "abc" is the FIPS 180-2 example digest', async () => {
  // FIPS 180-2, appendix B.1, one-block message "abc".
  assert.equal(await sha256Hex(enc('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('mimetype entry: its name at offset 30 and the media type at 38', async () => {
  const bytes = await plainToPackage(SAVED, { created: '2026-11-11T09:00:00Z' });
  const u16 = (p: number): number => bytes[p]! | (bytes[p + 1]! << 8);
  // The local header is 30 fixed bytes: signature (4) version (2) flags (2) method (2)
  // time (2) date (2) crc (4) compressed (4) uncompressed (4) name length (2) extra length (2).
  // 4+2+2+2+2+2+4+4+4+2+2 = 30, so the name starts at 30.
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
  assert.equal(u16(8), 0, 'method 0, STORE');
  assert.equal(u16(26), 8, '"mimetype" is 8 bytes');
  assert.equal(u16(28), 0, 'no extra field');
  // 1980-01-01 as a DOS date: (1980 - 1980) << 9 | 1 << 5 | 1 = 33 = 0x21; time 00:00 = 0
  assert.equal(u16(10), 0);
  assert.equal(u16(12), 0x21);
  assert.equal(dec(bytes.subarray(30, 38)), 'mimetype');
  // the data follows the 8-byte name at 30 + 8 = 38; "application/vnd.spindlelabs.project+zip"
  // is 11 + 1 + 4 + 11 + 8 + 4 = 39 bytes ("application" "/" "vnd." "spindlelabs" ".project" "+zip")
  assert.equal(dec(bytes.subarray(38, 38 + 39)), 'application/vnd.spindlelabs.project+zip');
  // so the second local header (manifest.json) starts at 38 + 39 = 77
  assert.deepEqual([...bytes.subarray(77, 81)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(dec(bytes.subarray(77 + 30, 77 + 30 + 13)), 'manifest.json');
});
