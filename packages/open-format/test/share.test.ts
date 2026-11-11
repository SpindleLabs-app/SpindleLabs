import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPackage, writePackage } from '../src/package.ts';
import { PERSONAL_FIELDS, stripForShare } from '../src/share.ts';
import { brepJson, build, enc, historySha, json, SAVED } from './helpers.ts';

test('stripForShare removes every personal field and keeps history and geometry bytes', async () => {
  const sha = await historySha();
  const brep = json(brepJson(sha));
  const gears = enc('{"teeth": 12}');
  const bytes = await build({
    edit: (m) => {
      m.document.author = { displayName: 'Ben', accountId: 'acct-42' };
      m.extensionsUsed = ['spindlelabs.local.printer', 'acme.gears'];
      m.extensionsRequired = [];
    },
    parts: [
      { path: 'brep.json', role: 'brep', mediaType: 'application/json', data: brep, extra: { source: { historySha256: sha, kernel: '0.70.0' } } },
      { path: 'view.json', role: 'view', mediaType: 'application/json', data: json({ version: 1, device: "Ben's laptop" }) },
      { path: 'notes.txt', role: 'notes', mediaType: 'text/plain', data: enc('my notes'), extra: { personal: true } },
      { path: 'local/printer.json', role: 'extension', mediaType: 'application/json', data: enc('{"path":"C:/Users/ben"}'), extra: { extension: 'spindlelabs.local.printer' } },
      { path: 'gears.json', role: 'extension', mediaType: 'application/json', data: gears, extra: { extension: 'acme.gears' } },
    ],
  });
  const read = await readPackage(bytes);
  assert.deepEqual(read.warnings, []);
  // the test file holds an instance of every personal field the list names
  assert.equal(PERSONAL_FIELDS.length, 6);
  assert.equal(read.manifest.document.author?.accountId, 'acct-42');
  assert.ok(read.manifest.parts.some((p) => p.personal === true));
  assert.ok(read.manifest.parts.some((p) => p.role === 'view'));
  assert.ok(read.manifest.parts.some((p) => p.extension === 'spindlelabs.local.printer'));
  assert.ok(read.manifest.extensionsUsed?.includes('spindlelabs.local.printer'));

  // extensionsRequired naming a local extension: no reader knows one, so such a file cannot be
  // read at all; the strip is checked on the contents in memory
  const required = { ...read, manifest: { ...read.manifest, extensionsRequired: ['spindlelabs.local.printer'] } };
  assert.deepEqual(stripForShare(required).manifest.extensionsRequired, [], 'local extension names in extensionsRequired');

  const shared = stripForShare(read);
  const again = await readPackage(await writePackage(shared));
  const m = again.manifest;
  assert.equal(m.document.author?.accountId, undefined, 'document.author.accountId');
  assert.equal(m.document.author?.displayName, 'Ben', 'the display name is public');
  assert.equal(m.parts.some((p) => p.personal === true), false, 'personal parts');
  assert.equal(m.parts.some((p) => p.role === 'view'), false, 'view part');
  assert.equal(m.parts.some((p) => String(p.extension).startsWith('spindlelabs.local.')), false, 'local extension parts');
  assert.deepEqual(m.extensionsUsed, ['acme.gears'], 'local extension names');
  assert.deepEqual([...again.parts.keys()], ['project.json', 'brep.json', 'gears.json']);
  assert.deepEqual(again.parts.get('project.json'), SAVED);
  assert.deepEqual(again.parts.get('brep.json'), brep);
  assert.deepEqual(again.parts.get('gears.json'), gears);
  // the input is not changed
  assert.equal(read.manifest.document.author?.accountId, 'acct-42');
  assert.equal(read.parts.size, 6);
  // the library publishing under the account keeps it
  assert.equal(stripForShare(read, { keepAccountId: true }).manifest.document.author?.accountId, 'acct-42');
});
