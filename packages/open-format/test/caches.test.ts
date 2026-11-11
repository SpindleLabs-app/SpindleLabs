// The optional caches: kept when sound and current, dropped with a warning
// otherwise, never a refusal of the file.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brepProblem, meshProblem } from '../src/caches.ts';
import { readPackage } from '../src/package.ts';
import { brepJson, build, enc, historySha, json, meshFiles, refuses } from './helpers.ts';
import type { PartSpec } from './helpers.ts';

const source = (sha: string) => ({ source: { historySha256: sha, kernel: '0.70.0' } });

async function brepPart(edit?: (b: any) => void, sourceSha?: string): Promise<PartSpec> {
  const sha = await historySha();
  const b = brepJson(sha) as any;
  edit?.(b);
  return { path: 'brep.json', role: 'brep', mediaType: 'application/json', data: json(b), extra: source(sourceSha ?? sha) };
}

async function meshParts(edit?: (bin: DataView) => void, jsonEdit?: (j: any) => void): Promise<PartSpec[]> {
  const sha = await historySha();
  const files = meshFiles(sha, edit);
  jsonEdit?.(files.json);
  return [
    { path: 'mesh.json', role: 'mesh', mediaType: 'application/json', data: json(files.json), extra: source(sha) },
    { path: 'mesh.bin', role: 'mesh-data', mediaType: 'application/octet-stream', data: files.bin },
  ];
}

const codes = (r: { warnings: { code: string }[] }) => r.warnings.map((w) => w.code);

test('sound, current caches are kept', async () => {
  const read = await readPackage(await build({ parts: [await brepPart(), ...(await meshParts())] }));
  assert.deepEqual(read.warnings, []);
  assert.deepEqual(read.manifest.parts.map((p) => p.role), ['history', 'brep', 'mesh', 'mesh-data']);
});

test('a stale cache (historySha256 of another history) is dropped with a warning', async () => {
  const read = await readPackage(await build({ parts: [await brepPart(undefined, 'a'.repeat(64))] }));
  assert.deepEqual(codes(read), ['stale-cache']);
  assert.equal(read.parts.has('brep.json'), false);
  assert.equal(read.manifest.parts.some((p) => p.role === 'brep'), false);
  // the cache's own copy of "source" disagreeing counts as stale too
  const own = await readPackage(await build({ parts: [await brepPart((b) => { b.source.historySha256 = 'b'.repeat(64); })] }));
  assert.deepEqual(codes(own), ['stale-cache']);
  // its own source naming another kernel, or none at all: dropped as bad
  const kernel = await readPackage(await build({ parts: [await brepPart((b) => { b.source.kernel = '0.1.0'; })] }));
  assert.deepEqual(codes(kernel), ['bad-cache']);
  const none = await readPackage(await build({ parts: [await brepPart((b) => { delete b.source; })] }));
  assert.deepEqual(codes(none), ['bad-cache']);
});

test('cache SHA-256 mismatch: dropped with a warning (the history mismatch is refused, package.test.ts)', async () => {
  const part = await brepPart();
  const read = await readPackage(await build({ parts: [part], edit: (m) => { m.parts[1].sha256 = 'c'.repeat(64); } }));
  assert.deepEqual(codes(read), ['sha-mismatch']);
  assert.equal(read.parts.has('brep.json'), false);
  // mesh-data mismatch takes the mesh with it
  const mesh = await readPackage(await build({ parts: await meshParts(), edit: (m) => { m.parts[2].sha256 = 'c'.repeat(64); } }));
  assert.deepEqual(codes(mesh), ['sha-mismatch', 'bad-cache']);
  assert.equal(mesh.parts.size, 1);
});

test('a cache without a valid source in the manifest is refused (the manifest is malformed)', async () => {
  const part = await brepPart();
  delete part.extra;
  await refuses(readPackage(await build({ parts: [part] })), 'bad-cache-source');
});

test('brep structure: each kind of damage is found', async () => {
  const sha = await historySha();
  const good = () => brepJson(sha) as any;
  assert.equal(brepProblem(good()), null);
  const cases: [string, (b: any) => void][] = [
    ['version', (b) => { b.version = 2; }],
    ['body id', (b) => { b.bodies[0].id = 'feature-1'; }],
    ['body number', (b) => { b.bodies[0].number = 0; }],
    ['vertex', (b) => { b.bodies[0].vertices[1] = [1, 2]; }],
    ['vertex beyond 1 km', (b) => { b.bodies[0].vertices[1] = [1_000_001, 0, 0]; }],
    ['edge name', (b) => { b.bodies[0].edges[0].name = 'face:x'; }],
    ['curve type', (b) => { b.bodies[0].edges[0].curve.type = 'nurbs'; }],
    ['edge end out of range', (b) => { b.bodies[0].edges[3].end = 4; }],
    ['face name', (b) => { b.bodies[0].faces[0].name = 'x'; }],
    ['surface type', (b) => { b.bodies[0].faces[0].surface.type = 'torus'; }],
    ['surface number beyond 1 km', (b) => { b.bodies[0].faces[0].surface.origin = [0, 0, -2e6]; }],
    ['loop index out of range', (b) => { b.bodies[0].faces[0].loops[0].push(4); }],
    ['loop index not whole', (b) => { b.bodies[0].faces[0].loops[0][0] = 0.5; }],
    ['backwards loop index out of range', (b) => { b.bodies[0].faces[0].loops[0].push(-5); }],
    ['plane without xAxis', (b) => { delete b.bodies[0].faces[0].surface.xAxis; }],
    ['circle without radius', (b) => { b.bodies[0].edges[0].curve = { type: 'circle', centre: [0, 0, 0], normal: [0, 0, 1] }; }],
    ['circle radius 0', (b) => { b.bodies[0].edges[0].curve = { type: 'circle', centre: [0, 0, 0], normal: [0, 0, 1], radius: 0 }; }],
    ['ellipse without majorAxis', (b) => { b.bodies[0].edges[0].curve = { type: 'ellipse', centre: [0, 0, 0], normal: [0, 0, 1], minorRadius: 1 }; }],
    ['cylinder radius beyond 1 km', (b) => { b.bodies[0].faces[0].surface = { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 1_000_001 }; }],
  ];
  for (const [what, edit] of cases) {
    const b = good();
    edit(b);
    assert.notEqual(brepProblem(b), null, what);
  }
  // every allowed shape, and edges used backwards (-(i + 1)), are fine
  const shapes = good();
  shapes.bodies[0].faces[0].loops[0] = [-1, -4, -3, -2];
  shapes.bodies[0].edges[0].curve = { type: 'circle', centre: [0, 0, 0], normal: [0, 0, 1], radius: 5 };
  shapes.bodies[0].edges[1].curve = { type: 'ellipse', centre: [0, 0, 0], normal: [0, 0, 1], majorAxis: [5, 0, 0], minorRadius: 2 };
  shapes.bodies[0].faces.push({ name: 'face:feature-1/side', surface: { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 5 }, loops: [] });
  shapes.bodies[0].faces.push({ name: 'face:feature-1/ball', surface: { type: 'sphere', centre: [0, 0, 0], radius: 5 }, loops: [] });
  assert.equal(brepProblem(shapes), null);
  // 1 km exactly is allowed
  const edge = good();
  edge.bodies[0].vertices[0] = [1_000_000, -1_000_000, 0];
  assert.equal(brepProblem(edge), null);
  // in a file: dropped, not refused
  const read = await readPackage(await build({ parts: [await brepPart((b) => { b.bodies[0].edges[0].start = 99; })] }));
  assert.deepEqual(codes(read), ['bad-cache']);
});

test('mesh structure: offsets, counts and indices in range', async () => {
  const sha = await historySha();
  const { json: j, bin } = meshFiles(sha);
  assert.equal(meshProblem(j, bin, 'mesh.bin'), null);
  assert.match(meshProblem(j, bin, 'other.bin')!, /"data"/);
  // index 3 with 3 vertices (0, 1, 2) is out of range
  assert.match(meshProblem(j, meshFiles(sha, (v) => v.setUint32(44, 3, true)).bin, 'mesh.bin')!, /not a vertex index/);
  assert.match(meshProblem(j, meshFiles(sha, (v) => v.setUint32(48, 1, true)).bin, 'mesh.bin')!, /not a face index/);
  assert.match(meshProblem(j, meshFiles(sha, (v) => v.setFloat32(0, NaN, true)).bin, 'mesh.bin')!, /not finite/);
  assert.match(meshProblem(j, bin.subarray(0, 51), 'mesh.bin')!, /runs past/);
  const edit = (f: (b: any) => void) => {
    const c = structuredClone(j) as any;
    f(c.bodies[0]);
    return meshProblem(c, bin, 'mesh.bin');
  };
  assert.notEqual(edit((b) => { b.max = [-1, 10, 0]; }), null); // max below min
  assert.notEqual(edit((b) => { delete b.min; }), null);
  assert.notEqual(edit((b) => { delete b.number; }), null);
  assert.notEqual(edit((b) => { b.indices.count = 4; }), null);
  assert.notEqual(edit((b) => { b.positions.offset = 2; }), null); // not 4-aligned
  assert.notEqual(edit((b) => { b.triangleFaces.count = 2; }), null);
  assert.notEqual(edit((b) => { b.faces = ['edge:x']; }), null);
  const read = await readPackage(await build({ parts: await meshParts((v) => v.setUint32(40, 7, true)) }));
  assert.deepEqual(codes(read), ['bad-cache', 'bad-cache']); // the mesh, then its data with it
  assert.equal(read.parts.size, 1);
});

test('a view part that is not JSON with version 1 is dropped', async () => {
  const view = (data: Uint8Array) => build({ parts: [{ path: 'view.json', role: 'view', mediaType: 'application/json', data }] });
  assert.deepEqual(codes(await readPackage(await view(json({ version: 1 })))), []);
  assert.deepEqual(codes(await readPackage(await view(json({ version: 2 })))), ['bad-view']);
  assert.deepEqual(codes(await readPackage(await view(enc('{"a":1,"a":1}')))), ['bad-view']);
});
