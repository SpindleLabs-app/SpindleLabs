// Seeded random damage: every damaged file either reads or throws FormatError,
// never any other exception and never a hang. Seeds print on failure.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FormatError } from '../src/errors.ts';
import { readAny, readPackage, writePackage } from '../src/package.ts';
import { brepJson, build, COMBINED, historySha, json, meshFiles, png, SAVED } from './helpers.ts';

/** mulberry32: a small 32-bit PRNG, the same sequence for the same seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261111;
const CASES = 3000;
const LIMIT_MS = 2000;

function damage(bytes: Uint8Array, rand: () => number): Uint8Array {
  const pick = (n: number) => Math.floor(rand() * n);
  // half the damage lands in the headers at either end, where the structure is
  const at = (): number => {
    const r = rand();
    if (r < 0.25) return pick(Math.min(120, bytes.length));
    if (r < 0.5) return Math.max(0, bytes.length - 1 - pick(Math.min(300, bytes.length)));
    return pick(bytes.length);
  };
  const kind = pick(5);
  if (kind === 0) return bytes.subarray(0, pick(bytes.length)); // truncate
  if (kind === 1) {
    const p = at(); // insert a byte
    return new Uint8Array([...bytes.subarray(0, p), pick(256), ...bytes.subarray(p)]);
  }
  if (kind === 2) {
    const p = at(); // delete a byte
    return new Uint8Array([...bytes.subarray(0, p), ...bytes.subarray(p + 1)]);
  }
  const out = bytes.slice();
  const flips = kind === 3 ? 1 : 1 + pick(8);
  for (let k = 0; k < flips; k++) {
    const p = at();
    out[p] = rand() < 0.5 ? out[p]! ^ (1 << pick(8)) : pick(256);
  }
  return out;
}

async function bounded(p: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hang = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${LIMIT_MS} ms`)), LIMIT_MS);
  });
  try {
    return await Promise.race([p, hang]);
  } finally {
    clearTimeout(timer);
  }
}

test(`random damage to good files: reads or FormatError (seed ${SEED}, ${CASES} cases)`, async () => {
  const sha = await historySha();
  const mesh = meshFiles(sha);
  const storedPkg = await build({
    parts: [
      { path: 'brep.json', role: 'brep', mediaType: 'application/json', data: json(brepJson(sha)), extra: { source: { historySha256: sha, kernel: '0.70.0' } } },
      { path: 'mesh.json', role: 'mesh', mediaType: 'application/json', data: json(mesh.json), extra: { source: { historySha256: sha, kernel: '0.70.0' } } },
      { path: 'mesh.bin', role: 'mesh-data', mediaType: 'application/octet-stream', data: mesh.bin },
      { path: 'view.json', role: 'view', mediaType: 'application/json', data: json({ version: 1 }) },
      { path: 'thumbnail.png', role: 'thumbnail', mediaType: 'image/png', data: png(64) },
    ],
  });
  // the same contents written by writePackage: DEFLATE entries
  const deflated = await writePackage(await readPackage(storedPkg));
  const bases = [storedPkg, deflated, SAVED, COMBINED];
  const rand = mulberry32(SEED);
  const tally = { read: 0, refused: 0, warned: 0 };
  const codes = new Map<string, number>();
  for (let k = 0; k < CASES; k++) {
    const base = bases[k % bases.length]!;
    const bytes = damage(base, rand);
    try {
      const result = (await bounded(k % 2 === 0 ? readAny(bytes) : readPackage(bytes))) as { warnings: unknown[] };
      tally.read++;
      if (result.warnings.length > 0) tally.warned++;
    } catch (e) {
      if (!(e instanceof FormatError)) {
        assert.fail(`seed ${SEED}, case ${k} (base ${k % bases.length}, ${bytes.length} bytes): ${e instanceof Error ? e.stack : String(e)}`);
      }
      tally.refused++;
      codes.set(e.code, (codes.get(e.code) ?? 0) + 1);
    }
  }
  // the damage must reach many different checks, or the test proves little
  assert.ok(codes.size >= 15, `only ${codes.size} different refusals: ${[...codes.keys()].join(', ')}`);
  assert.ok(tally.refused > CASES / 2, JSON.stringify(tally));
});
