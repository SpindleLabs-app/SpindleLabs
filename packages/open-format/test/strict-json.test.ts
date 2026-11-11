import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeUtf8Strict, MAX_NESTING, parseStrictJson } from '../src/strict-json.ts';
import { COMBINED, dec, enc, refuses, SAVED } from './helpers.ts';

const nested = (depth: number): string => '['.repeat(depth) + ']'.repeat(depth);

test('agrees with JSON.parse on valid JSON (real project files and edge cases)', () => {
  const samples = [
    dec(SAVED), dec(COMBINED),
    '0', '-0', '1.5e-300', '"\\u00e9\\ud83d\\ude00\\n\\t\\"\\\\\\/"', '[]', '{}', ' [1, true, false, null, "x"] ',
    '{"a":{"b":[{"c":1e3}]}}', '1E+2', '-12.5E-1',
  ];
  for (const s of samples) assert.deepEqual(parseStrictJson(s, 't'), JSON.parse(s), s.slice(0, 40));
});

test('refuses what JSON grammar refuses', async () => {
  for (const s of ['', '01', '1.', '.5', '+1', '[1,]', '{"a":1,}', "{'a':1}", 'tru', 'NaN', 'Infinity',
    '"a\u0001"', '"\\x"', '"\\u12g4"', '[1] x', '{"a" 1}', '"open', ' []']) {
    await refuses(() => parseStrictJson(s, 't'), 'bad-json');
  }
});

test('duplicate keys are refused, even when spelled with escapes', async () => {
  await refuses(() => parseStrictJson('{"a":1,"a":2}', 't'), 'duplicate-key');
  // "a" is "a"
  await refuses(() => parseStrictJson('{"a":1,"\\u0061":2}', 't'), 'duplicate-key');
  await refuses(() => parseStrictJson('[{"x":{"k":1,"k":1}}]', 't'), 'duplicate-key');
  // the same key in two different objects is fine
  assert.deepEqual(parseStrictJson('[{"a":1},{"a":2}]', 't'), [{ a: 1 }, { a: 2 }]);
});

test('nesting: 256 levels read, 257 refused (boundary)', async () => {
  assert.equal(MAX_NESTING, 256);
  assert.ok(Array.isArray(parseStrictJson(nested(256), 't')));
  await refuses(() => parseStrictJson(nested(257), 't'), 'too-deep');
  // objects count the same as arrays: 256 objects deep
  const objects = (d: number): string => '{"a":'.repeat(d - 1) + '{}' + '}'.repeat(d - 1);
  parseStrictJson(objects(256), 't');
  await refuses(() => parseStrictJson(objects(257), 't'), 'too-deep');
  // far deeper input fails the same way, without a stack overflow
  await refuses(() => parseStrictJson(nested(100_000), 't'), 'too-deep');
});

test('numbers that overflow a double are refused, not read as Infinity', async () => {
  await refuses(() => parseStrictJson('1e400', 't'), 'number-out-of-range');
  await refuses(() => parseStrictJson('[-1e309]', 't'), 'number-out-of-range');
  assert.equal(parseStrictJson('1.7976931348623157e308', 't'), Number.MAX_VALUE);
});

test('"__proto__" is an ordinary key', () => {
  const v = parseStrictJson('{"__proto__":{"polluted":1}}', 't') as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.deepEqual(Object.keys(v), ['__proto__']);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('UTF-8: invalid bytes and a byte order mark are refused', async () => {
  // 0xC3 0x28: a two-byte lead followed by a non-continuation byte
  await refuses(() => decodeUtf8Strict(new Uint8Array([0x22, 0xc3, 0x28, 0x22]), 't'), 'invalid-utf8');
  // an overlong "/" (0xC0 0xAF) and a lone surrogate encoded (0xED 0xA0 0x80)
  await refuses(() => decodeUtf8Strict(new Uint8Array([0xc0, 0xaf]), 't'), 'invalid-utf8');
  await refuses(() => decodeUtf8Strict(new Uint8Array([0xed, 0xa0, 0x80]), 't'), 'invalid-utf8');
  await refuses(() => decodeUtf8Strict(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), 't'), 'bom');
  assert.equal(decodeUtf8Strict(enc('"é😀"'), 't'), '"é😀"');
});
