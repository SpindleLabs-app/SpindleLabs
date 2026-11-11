// Builders for good packages and for broken ones (each broken in exactly one way).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32 } from '../src/crc32.ts';
import { FormatError } from '../src/errors.ts';
import type { FormatErrorCode } from '../src/errors.ts';
import { PACKAGE_MEDIA_TYPE, PLAIN_MEDIA_TYPE } from '../src/manifest.ts';
import { sha256Hex } from '../src/package.ts';
import { assembleZip } from '../src/zip.ts';
import type { RawZipEntry } from '../src/zip.ts';

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
export const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

const repo = fileURLToPath(new URL('../../../', import.meta.url));
/** A real saved project from the repo (git ls-files '*.spindle'). */
export const SAVED = new Uint8Array(readFileSync(`${repo}apps/fission/e2e/saved.spindle`));
export const COMBINED = new Uint8Array(readFileSync(`${repo}workspaces/design/test/regressions/combined-part.spindle`));

export interface PartSpec {
  path: string;
  role: string;
  mediaType: string;
  data: Uint8Array;
  /** More manifest fields of this part (source, extension, personal, unknown ones). */
  extra?: Record<string, unknown>;
}

export interface Build {
  history?: Uint8Array;
  parts?: PartSpec[];
  /** Change the manifest object after sizes and hashes are filled in. */
  edit?: (m: Record<string, any>) => void;
  /** Change the manifest's text. */
  text?: (t: string) => string;
  /** Change the zip entries just before they are laid out. */
  raw?: (entries: RawZipEntry[]) => void;
}

export function baseManifest(): Record<string, any> {
  return {
    format: 'spindlelabs-project',
    version: '0.1',
    minReaderVersion: '0.1',
    generator: { name: 'SpindleLabs', version: '0.70.0' },
    units: { length: 'mm', angle: 'deg', axes: 'right-handed, Z up' },
    document: {
      id: 'doc-1',
      revision: 'r1',
      title: 'Bracket',
      created: '2026-11-11T09:00:00Z',
      modified: '2026-11-11T09:30:00Z',
      licence: 'CC-BY-4.0',
    },
    extensionsUsed: [],
    extensionsRequired: [],
    parts: [],
  };
}

export const stored = (name: string | Uint8Array, data: Uint8Array): RawZipEntry => ({
  name, method: 0, crc: crc32(data), uncompressedSize: data.length, data,
});

/** A package, every entry stored, so tests can find and change bytes by position. */
export async function build(b: Build = {}): Promise<Uint8Array> {
  const history = b.history ?? SAVED;
  const specs: PartSpec[] = [
    { path: 'project.json', role: 'history', mediaType: PLAIN_MEDIA_TYPE, data: history },
    ...(b.parts ?? []),
  ];
  const m = baseManifest();
  for (const s of specs) {
    m.parts.push({ path: s.path, role: s.role, mediaType: s.mediaType, size: s.data.length, sha256: await sha256Hex(s.data), ...s.extra });
  }
  b.edit?.(m);
  let text = JSON.stringify(m, null, 2);
  if (b.text) text = b.text(text);
  const entries: RawZipEntry[] = [
    stored('mimetype', enc(PACKAGE_MEDIA_TYPE)),
    stored('manifest.json', enc(text)),
    ...specs.map((s) => stored(s.path, s.data)),
  ];
  b.raw?.(entries);
  return assembleZip(entries);
}

export async function historySha(history: Uint8Array = SAVED): Promise<string> {
  return sha256Hex(history);
}

/** Asserts the promise rejects with a FormatError of exactly this code. */
export async function refuses(p: Promise<unknown> | (() => unknown), code: FormatErrorCode): Promise<void> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    assert.ok(e instanceof FormatError, `expected FormatError ${code}, got ${String(e)}`);
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    return;
  }
  assert.fail(`expected FormatError ${code}, but it succeeded`);
}

// ------------------------------------------------------------------ fixtures

/** One square face of side 10 mm at z = 0: 4 vertices, 4 line edges, one loop. */
export function brepJson(historySha256: string): unknown {
  return {
    version: 1,
    source: { historySha256, kernel: '0.70.0' },
    bodies: [{
      id: 'body:feature-1',
      number: 1,
      faces: [{ name: 'face:feature-1/bottom', surface: { type: 'plane', origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, -1] }, loops: [[0, 1, 2, 3]] }],
      edges: [
        { name: 'edge:feature-1/a', curve: { type: 'line' }, start: 0, end: 1 },
        { name: 'edge:feature-1/b', curve: { type: 'line' }, start: 1, end: 2 },
        { name: 'edge:feature-1/c', curve: { type: 'line' }, start: 2, end: 3 },
        { name: 'edge:feature-1/d', curve: { type: 'line' }, start: 3, end: 0 },
      ],
      vertices: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
    }],
  };
}

/** One triangle: positions at 0 (3 × 12 bytes), indices at 36 (3 × 4), triangleFaces at 48 (1 × 4): 52 bytes. */
export function meshFiles(historySha256: string, edit?: (bin: DataView) => void): { json: unknown; bin: Uint8Array } {
  const bin = new Uint8Array(52);
  const v = new DataView(bin.buffer);
  [0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((x, k) => v.setFloat32(4 * k, x, true));
  [0, 1, 2].forEach((x, k) => v.setUint32(36 + 4 * k, x, true));
  v.setUint32(48, 0, true);
  edit?.(v);
  return {
    json: {
      version: 1,
      source: { historySha256, kernel: '0.70.0' },
      data: 'mesh.bin',
      bodies: [{
        id: 'body:feature-1', number: 1, faces: ['face:feature-1/bottom'], min: [0, 0, 0], max: [10, 10, 0],
        positions: { offset: 0, count: 3 }, indices: { offset: 36, count: 3 }, triangleFaces: { offset: 48, count: 1 },
      }],
    },
    bin,
  };
}

/** The smallest PNG signature plus padding to the given size. */
export function png(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
}

export const json = (v: unknown): Uint8Array => enc(JSON.stringify(v));
