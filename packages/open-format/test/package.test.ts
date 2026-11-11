// Reading and writing whole packages: round trips, then one broken file per
// refusal rule, each made from a good one changed in exactly one way.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAIN_MEDIA_TYPE } from '../src/manifest.ts';
import { identify, plainToPackage, readAny, readPackage, sha256Hex, writePackage } from '../src/package.ts';
import { stored } from './helpers.ts';
import { brepJson, build, COMBINED, dec, enc, historySha, json, png, refuses, SAVED } from './helpers.ts';

const at = '2026-11-11T09:00:00Z';

test('identify tells the two flavours apart by the first bytes', async () => {
  assert.equal(identify(SAVED), 'plain');
  assert.equal(identify(await plainToPackage(SAVED, { created: at })), 'package');
  assert.equal(identify(enc('PK')), 'plain');
});

test('plain -> package is lossless: the history is the plain file, byte for byte', async () => {
  for (const plain of [SAVED, COMBINED]) {
    const packed = await plainToPackage(plain, { created: at });
    const read = await readPackage(packed);
    assert.deepEqual(read.parts.get('project.json'), plain);
    assert.equal(read.history, dec(plain));
    assert.deepEqual(read.historyJson, JSON.parse(dec(plain)));
    assert.deepEqual(read.warnings, []);
    assert.equal(read.manifest.parts[0]!.sha256, await sha256Hex(plain));
  }
  // the title comes from the project's name: combined-part's
  const read = await readPackage(await plainToPackage(COMBINED, { created: at }));
  assert.equal(read.manifest.document.title, (JSON.parse(dec(COMBINED)) as { name: string }).name);
});

test('writePackage(readPackage(x)) is byte-identical, and the same input writes the same bytes', async () => {
  const a = await plainToPackage(COMBINED, { created: at });
  assert.deepEqual(await plainToPackage(COMBINED, { created: at }), a);
  assert.deepEqual(await writePackage(await readPackage(a)), a);
  // with every kind of optional part as well
  const sha = await historySha();
  const rich = await build({
    parts: [
      { path: 'view.json', role: 'view', mediaType: 'application/json', data: json({ version: 1, camera: [1, 2, 3] }) },
      { path: 'brep.json', role: 'brep', mediaType: 'application/json', data: json(brepJson(sha)), extra: { source: { historySha256: sha, kernel: '0.70.0' } } },
      { path: 'thumb.png', role: 'thumbnail', mediaType: 'image/png', data: png(100) },
    ],
  });
  const once = await writePackage(await readPackage(rich));
  assert.deepEqual(await writePackage(await readPackage(once)), once);
});

test('plain files: readAny reads both; plainToPackage refuses what is not a project', async () => {
  assert.equal((await readAny(SAVED)).kind, 'plain');
  assert.equal((await readAny(await plainToPackage(SAVED, { created: at }))).kind, 'package');
  await refuses(plainToPackage('[1]'), 'not-plain');
  await refuses(plainToPackage('{"formatVersion": 0}'), 'not-plain');
  await refuses(plainToPackage('{"a":1,"a":2}'), 'duplicate-key');
  await refuses(plainToPackage(await plainToPackage(SAVED, { created: at })), 'not-plain');
  await refuses(readPackage(SAVED), 'not-package');
});

test('a good hand-built package reads', async () => {
  const read = await readPackage(await build());
  assert.equal(read.manifest.document.title, 'Bracket');
});

// ------------------------------------------------------------ the two fixed entries

test('mimetype must be first, stored, without extra field or data descriptor, exact', async () => {
  await refuses(readPackage(await build({ raw: (e) => e.reverse() })), 'mimetype-not-first');
  // the right bytes, wrong name
  await refuses(readPackage(await build({ raw: (e) => { e[0]!.name = 'mimetypf'; } })), 'mimetype-not-first');
  await refuses(readPackage(await build({ raw: (e) => { e[0]!.method = 8; } })), 'mimetype-compressed');
  await refuses(readPackage(await build({ raw: (e) => { e[0]!.localExtra = new Uint8Array([0x99, 0x99, 0, 0]); } })), 'mimetype-extra-field');
  await refuses(readPackage(await build({ raw: (e) => { e[0]!.centralExtra = new Uint8Array([0x99, 0x99, 0, 0]); } })), 'mimetype-extra-field');
  const withDescriptor = (e: Parameters<NonNullable<Parameters<typeof build>[0]>['raw']>[0]): void => {
    const m = e[0]!;
    const t = new Uint8Array(12);
    const v = new DataView(t.buffer);
    v.setUint32(0, m.crc, true);
    v.setUint32(4, m.data.length, true);
    v.setUint32(8, m.data.length, true);
    m.flags = 0x0008;
    m.trailer = t;
  };
  await refuses(readPackage(await build({ raw: withDescriptor })), 'mimetype-data-descriptor');
  // a trailing newline, as a text editor would add
  await refuses(readPackage(await build({ raw: (e) => { e[0] = stored('mimetype', enc('application/vnd.spindlelabs.project+zip\n')); } })), 'mimetype-wrong');
});

test('manifest.json must be second', async () => {
  await refuses(readPackage(await build({ raw: (e) => { [e[1], e[2]] = [e[2]!, e[1]!]; } })), 'manifest-not-second');
});

// ------------------------------------------------------------------ manifest text

test('manifest text: duplicate key, invalid UTF-8, a BOM, too deep, not JSON', async () => {
  await refuses(readPackage(await build({ text: (t) => t.replace('"version": "0.1"', '"version": "0.1", "version": "0.1"') })), 'duplicate-key');
  await refuses(readPackage(await build({ raw: (e) => { e[1] = stored('manifest.json', new Uint8Array([...e[1]!.data.subarray(0, 20), 0xff, ...e[1]!.data.subarray(20)])); } })), 'invalid-utf8');
  await refuses(readPackage(await build({ raw: (e) => { e[1] = stored('manifest.json', new Uint8Array([0xef, 0xbb, 0xbf, ...e[1]!.data])); } })), 'bom');
  await refuses(readPackage(await build({ edit: (m) => { m.deep = JSON.parse('['.repeat(256) + ']'.repeat(256)); } })), 'too-deep');
  await readPackage(await build({ edit: (m) => { m.deep = JSON.parse('['.repeat(255) + ']'.repeat(255)); } })); // 1 + 255 = 256 levels
  await refuses(readPackage(await build({ text: (t) => t.slice(0, -1) })), 'bad-json');
});

// ------------------------------------------------------------------ manifest fields

test('format, versions and units', async () => {
  await refuses(readPackage(await build({ edit: (m) => { m.format = 'other'; } })), 'wrong-format');
  await refuses(readPackage(await build({ edit: (m) => { m.version = '1.0'; } })), 'unknown-major');
  // minReaderVersion is checked before the major number (spec 6.1)
  await refuses(readPackage(await build({ edit: (m) => { m.version = '1.0'; m.minReaderVersion = '1.0'; } })), 'reader-too-old');
  await refuses(readPackage(await build({ edit: (m) => { m.version = '0.01'; } })), 'bad-version');
  await refuses(readPackage(await build({ edit: (m) => { m.version = '0.1.2'; } })), 'bad-version');
  await refuses(readPackage(await build({ edit: (m) => { m.version = '0.3'; m.minReaderVersion = '0.2'; } })), 'reader-too-old');
  await refuses(readPackage(await build({ edit: (m) => { m.version = '0.0'; } })), 'bad-version'); // minReaderVersion 0.1 newer than its own version
  await refuses(readPackage(await build({ edit: (m) => { m.units.length = 'in'; } })), 'units');
  await refuses(readPackage(await build({ edit: (m) => { m.units.angle = 'rad'; } })), 'units'); // degrees, as the history
  await refuses(readPackage(await build({ edit: (m) => { delete m.extensionsUsed; } })), 'bad-manifest');
  await refuses(readPackage(await build({ edit: (m) => { delete m.extensionsRequired; } })), 'bad-manifest');
  await refuses(readPackage(await build({ edit: (m) => { m.units.time = 's'; } })), 'units');
  await refuses(readPackage(await build({ edit: (m) => { delete m.generator; } })), 'bad-manifest');
});

test('a newer minor version reads, and its unknown fields are kept on re-save', async () => {
  const bytes = await build({
    edit: (m) => {
      m.version = '0.7';
      m.futureTopLevel = { nested: [1, 'two'] };
      m.document.futureField = 'kept';
      m.parts[0].futurePartField = true;
    },
  });
  const read = await readPackage(bytes);
  const again = await readPackage(await writePackage(read));
  const m = again.manifest as Record<string, any>;
  assert.equal(m.version, '0.7');
  assert.deepEqual(m.futureTopLevel, { nested: [1, 'two'] });
  assert.equal(m.document.futureField, 'kept');
  assert.equal(m.parts[0].futurePartField, true);
});

test('document: id, dates, licence', async () => {
  for (const id of ['', 'has space', 'x'.repeat(129), 'slash/no']) {
    await refuses(readPackage(await build({ edit: (m) => { m.document.id = id; } })), 'bad-document-id');
  }
  await readPackage(await build({ edit: (m) => { m.document.id = 'A-z_0.9:' + 'x'.repeat(120); } })); // 128 chars
  for (const d of ['2026-11-11', '2026-11-11T09:00:00+01:00', '2026-02-30T00:00:00Z', '2026-11-11T24:00:00Z', '2026-11-11 09:00:00Z']) {
    await refuses(readPackage(await build({ edit: (m) => { m.document.created = d; } })), 'bad-date');
  }
  await readPackage(await build({ edit: (m) => { m.document.modified = '2026-11-11T09:00:00.123Z'; } }));
  await refuses(readPackage(await build({ edit: (m) => { m.document.licence = 'MIT'; } })), 'licence');
  await refuses(readPackage(await build({ edit: (m) => { m.document.licence = 'cc-by-4.0'; } })), 'licence');
  for (const l of ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC0-1.0', 'none']) {
    await readPackage(await build({ edit: (m) => { m.document.licence = l; } }));
  }
  const source = { where: 'library:7', documentId: 'd-9', revision: 'r', title: 'T', licence: 'CC0-1.0' };
  await readPackage(await build({ edit: (m) => { m.document.derivedFrom = [{ ...source, author: 'Ben' }, { ...source, where: 'file' }, { ...source, where: 'link' }]; } }));
  await refuses(readPackage(await build({ edit: (m) => { m.document.derivedFrom = [{ ...source, licence: 'GPL' }]; } })), 'licence');
  await refuses(readPackage(await build({ edit: (m) => { m.document.derivedFrom = [{ ...source, where: 'email' }]; } })), 'bad-manifest');
  await refuses(readPackage(await build({ edit: (m) => { m.document.derivedFrom = [{ ...source, title: undefined }]; } })), 'bad-manifest');
  await refuses(readPackage(await build({ edit: (m) => { m.document.derivedFrom = [{ ...source, documentId: 'a b' }]; } })), 'bad-document-id');
  await refuses(readPackage(await build({ edit: (m) => { m.document.derivedFrom = [{ ...source, author: 'Bo' }]; } })), 'display-name');
  await refuses(readPackage(await build({ edit: (m) => { m.document.revision = 'r 1'; } })), 'bad-document-id');
  // title: 1 to 200 characters
  await readPackage(await build({ edit: (m) => { m.document.title = 'x'.repeat(200); } }));
  await refuses(readPackage(await build({ edit: (m) => { m.document.title = 'x'.repeat(201); } })), 'bad-manifest');
  await refuses(readPackage(await build({ edit: (m) => { m.document.title = ''; } })), 'bad-manifest');
});

test('author display name: 3 and 30 characters read, 2 and 31 refused (boundary)', async () => {
  const withName = (n: string) => build({ edit: (m) => { m.document.author = { displayName: n }; } });
  await readPackage(await withName('Ben'));
  await readPackage(await withName('x'.repeat(30)));
  await refuses(readPackage(await withName('Bo')), 'display-name');
  await refuses(readPackage(await withName('x'.repeat(31))), 'display-name');
  // counted as characters (code points), not UTF-16 units or bytes: three emoji are 3
  await readPackage(await withName('😀😀😀'));
  await readPackage(await build({ edit: (m) => { m.document.author = {}; } })); // both inner fields optional
});

test('extensions: required must be used; unknown required refused; unknown optional kept', async () => {
  await refuses(readPackage(await build({ edit: (m) => { m.extensionsUsed = []; m.extensionsRequired = ['acme.gears']; } })), 'required-not-used');
  await refuses(readPackage(await build({ edit: (m) => { m.extensionsUsed = ['acme.gears']; m.extensionsRequired = ['acme.gears']; } })), 'required-extension');
  const data = enc('{"teeth": 12}');
  const bytes = await build({
    edit: (m) => { m.extensionsUsed = ['acme.gears']; },
    parts: [{ path: 'ext/acme.gears/g.json', role: 'extension', mediaType: 'application/json', data, extra: { extension: 'acme.gears', theirs: 1 } }],
  });
  const read = await readPackage(bytes);
  assert.deepEqual(read.parts.get('ext/acme.gears/g.json'), data);
  const again = await readPackage(await writePackage(read));
  assert.deepEqual(again.parts.get('ext/acme.gears/g.json'), data);
  assert.equal((again.manifest.parts[1] as Record<string, unknown>).theirs, 1);
  await refuses(readPackage(await build({
    parts: [{ path: 'g.json', role: 'extension', mediaType: 'application/json', data, extra: { extension: 'acme.gears' } }],
  })), 'extension-not-declared');
});

test('an unknown role is read and kept', async () => {
  const data = enc('later');
  const read = await readPackage(await build({ parts: [{ path: 'notes.txt', role: 'notes', mediaType: 'text/plain', data }] }));
  assert.deepEqual(read.parts.get('notes.txt'), data);
});

test('parts: roles, paths, media types, hashes', async () => {
  await refuses(readPackage(await build({ edit: (m) => { m.parts[0].role = 'notes'; } })), 'history-missing');
  await refuses(readPackage(await build({ parts: [{ path: 'b.json', role: 'history', mediaType: PLAIN_MEDIA_TYPE, data: SAVED }] })), 'duplicate-role');
  await refuses(readPackage(await build({ parts: [1, 2].map((k) => ({ path: `v${k}.json`, role: 'view', mediaType: 'application/json', data: json({ version: 1 }) })) })), 'duplicate-role');
  await refuses(readPackage(await build({ edit: (m) => { m.parts[0].mediaType = 'text/plain'; } })), 'bad-media-type');
  await refuses(readPackage(await build({ parts: [{ path: 'view.json', role: 'view', mediaType: 'text/plain', data: json({ version: 1 }) }] })), 'bad-media-type');
  await refuses(readPackage(await build({ edit: (m) => { m.extensionsUsed = ['acme.gears']; m.parts[0].extension = 'acme.gears'; } })), 'bad-manifest');
  await readPackage(await build({ edit: (m) => { m.parts[0].mediaType = 'application/json'; } })); // what the app writes today
  await refuses(readPackage(await build({ edit: (m) => { m.parts[0].sha256 = m.parts[0].sha256.toUpperCase(); } })), 'bad-sha256');
  await refuses(readPackage(await build({ edit: (m) => { m.parts.push({ ...m.parts[0], path: 'PROJECT.json', role: 'x' }); } })), 'duplicate-part');
  await refuses(readPackage(await build({ edit: (m) => { m.parts.push({ ...m.parts[0], path: 'manifest.json', role: 'x' }); } })), 'reserved-path');
  await refuses(readPackage(await build({ edit: (m) => { m.parts.push({ ...m.parts[0], path: '../evil', role: 'x' }); } })), 'path-traversal');
});

test('thumbnail: 32 KiB reads, one byte more refused; 0.9× reads, 1.1× refused (boundary)', async () => {
  const thumb = (size: number) => build({ parts: [{ path: 'thumb.png', role: 'thumbnail', mediaType: 'image/png', data: png(size) }] });
  await readPackage(await thumb(32 * 1024));
  await readPackage(await thumb(Math.floor(0.9 * 32 * 1024)));
  await refuses(readPackage(await thumb(32 * 1024 + 1)), 'thumbnail-too-large');
  await refuses(readPackage(await thumb(Math.ceil(1.1 * 32 * 1024))), 'thumbnail-too-large');
  await refuses(readPackage(await build({ parts: [{ path: 't.gif', role: 'thumbnail', mediaType: 'image/gif', data: png(10) }] })), 'bad-media-type');
  // a thumbnail whose bytes are no PNG is dropped, not refused
  const read = await readPackage(await build({ parts: [{ path: 't.png', role: 'thumbnail', mediaType: 'image/png', data: enc('not a png') }] }));
  assert.deepEqual(read.warnings.map((w) => w.code), ['bad-thumbnail']);
  assert.equal(read.parts.has('t.png'), false);
});

// ------------------------------------------------------------ manifest against the zip

test('every listed part must exist, every entry must be listed, sizes must match', async () => {
  await refuses(readPackage(await build({ raw: (e) => { e.pop(); } })), 'missing-part');
  await refuses(readPackage(await build({ raw: (e) => { e.push(stored('extra.bin', enc('hidden'))); } })), 'stray-entry');
  await refuses(readPackage(await build({ edit: (m) => { m.parts[0].size += 1; } })), 'size-mismatch-manifest');
  // a directory entry is ignored, but must hold nothing
  await readPackage(await build({ raw: (e) => { e.push(stored('dir/', new Uint8Array(0))); } }));
  await refuses(readPackage(await build({ raw: (e) => { e.push(stored('dir/', enc('x'))); } })), 'stray-entry');
  // a case-insensitive twin of the history in the zip
  await refuses(readPackage(await build({ raw: (e) => { e.push(stored('Project.json', SAVED)); } })), 'duplicate-entry');
});

test('history: SHA-256 mismatch refused; a history that is not a project refused', async () => {
  await refuses(readPackage(await build({ edit: (m) => { m.parts[0].sha256 = '0'.repeat(64); } })), 'sha-mismatch-history');
  await refuses(readPackage(await build({ history: enc('[1, 2]') })), 'bad-history');
  await refuses(readPackage(await build({ history: enc('{"formatVersion": 2, "a": 1, "a": 2}') })), 'duplicate-key');
  await refuses(readPackage(await build({ history: new Uint8Array([0x7b, 0xff, 0x7d]) })), 'invalid-utf8');
});

test('a CRC mismatch in a part is refused', async () => {
  await refuses(readPackage(await build({ raw: (e) => { e[2]!.crc ^= 0x10; } })), 'crc-mismatch');
});

test('writePackage refuses to write what a reader would refuse', async () => {
  const read = await readPackage(await build());
  await refuses(writePackage({ ...read, parts: new Map() }), 'missing-part');
  await refuses(writePackage({ ...read, parts: new Map([...read.parts, ['x', enc('x')]]) }), 'stray-entry');
  await refuses(writePackage({ ...read, manifest: { ...read.manifest, units: { length: 'cm', angle: 'rad', axes: 'right-handed, Z up' } } }), 'units');
  await refuses(writePackage({ ...read, parts: new Map([['project.json', enc('{}')]]) }), 'bad-history');
});
