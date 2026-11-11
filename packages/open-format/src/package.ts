// Reading, writing and converting SpindleLabs package files (draft 0.1).

import { brepProblem, meshProblem, sourceProblem, thumbnailProblem } from './caches.ts';
import { FormatError } from './errors.ts';
import type { Warning } from './errors.ts';
import {
  FORMAT_NAME, MAX_TITLE, PACKAGE_MEDIA_TYPE, PLAIN_MEDIA_TYPE, READER_VERSION, UNITS, validateManifest,
} from './manifest.ts';
import type { Author, Manifest, PartEntry } from './manifest.ts';
import { decodeUtf8Strict, parseStrictJson, parseStrictJsonBytes } from './strict-json.ts';
import { FLAG_DATA_DESCRIPTOR, readEntryData, readZipDirectory, writeZip } from './zip.ts';
import type { ZipEntry, ZipInput } from './zip.ts';

/** What a package holds: its manifest and every listed part's bytes, by path. */
export interface PackageContents {
  manifest: Manifest;
  parts: Map<string, Uint8Array>;
}

export interface ReadResult extends PackageContents {
  /** The history part's text, decoded from its exact bytes. */
  history: string;
  historyJson: unknown;
  /** Optional parts dropped while reading (each also gone from manifest and parts). */
  warnings: Warning[];
}

const encoder = new TextEncoder();

/** A plain file's limit, as the app applies it today. */
export const MAX_PLAIN_BYTES = 64 * 1024 * 1024;

/** JSON with every object's keys sorted, 2-space indent and a final newline (spec 4.5). */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (typeof v === 'object' && v !== null) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        Object.defineProperty(out, k, { value: sort((v as Record<string, unknown>)[k]), enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** "package" when the bytes start "PK\x03\x04", otherwise "plain" (JSON). */
export function identify(bytes: Uint8Array): 'package' | 'plain' {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
    ? 'package'
    : 'plain';
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** The history (a plain project): strict UTF-8 and JSON, an object with a whole formatVersion >= 1. */
function readHistory(bytes: Uint8Array, code: 'bad-history' | 'not-plain', what: string): { text: string; json: unknown } {
  if (code === 'not-plain' && bytes.length > MAX_PLAIN_BYTES) {
    throw new FormatError('part-too-large', `${what} is over ${MAX_PLAIN_BYTES} bytes`);
  }
  const text = decodeUtf8Strict(bytes, what);
  const json = parseStrictJson(text, what);
  const ok = typeof json === 'object' && json !== null && !Array.isArray(json) &&
    Number.isInteger((json as Record<string, unknown>).formatVersion) &&
    ((json as Record<string, unknown>).formatVersion as number) >= 1;
  if (!ok) throw new FormatError(code, `${what} is not a SpindleLabs project (an object with a whole "formatVersion")`);
  return { text, json };
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Reads a package: refuses (FormatError) anything breaking a rule of draft
 * 0.1, drops (with a warning) an optional part that is damaged or stale.
 */
export async function readPackage(bytes: Uint8Array): Promise<ReadResult> {
  if (identify(bytes) !== 'package') throw new FormatError('not-package', 'the file does not start "PK\\x03\\x04"');
  const entries = readZipDirectory(bytes);
  const byOffset = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  const first = entries[0];
  if (!first || first.name !== 'mimetype' || byOffset[0] !== first) {
    throw new FormatError('mimetype-not-first', 'the first entry must be "mimetype"');
  }
  if (first.method !== 0) throw new FormatError('mimetype-compressed', '"mimetype" must be stored, not compressed');
  if (first.localExtraLength !== 0 || first.centralExtraLength !== 0) {
    throw new FormatError('mimetype-extra-field', '"mimetype" must have no extra field');
  }
  if (first.flags & FLAG_DATA_DESCRIPTOR) throw new FormatError('mimetype-data-descriptor', '"mimetype" must have no data descriptor');
  if (!sameBytes(await readEntryData(bytes, first), encoder.encode(PACKAGE_MEDIA_TYPE))) {
    throw new FormatError('mimetype-wrong', `"mimetype" must hold exactly ${PACKAGE_MEDIA_TYPE}`);
  }
  const second = entries[1];
  if (!second || second.name !== 'manifest.json' || byOffset[1] !== second) {
    throw new FormatError('manifest-not-second', 'the second entry must be "manifest.json"');
  }
  const parsed = validateManifest(parseStrictJsonBytes(await readEntryData(bytes, second), 'manifest.json'));

  // the manifest against the zip
  const byName = new Map<string, ZipEntry>();
  for (const e of entries.slice(2)) {
    if (e.isDirectory) {
      if (e.uncompressedSize !== 0) throw new FormatError('stray-entry', `directory entry ${e.name} holds data`);
      continue;
    }
    byName.set(e.name, e);
  }
  for (const part of parsed.parts) {
    const e = byName.get(part.path);
    if (!e) throw new FormatError('missing-part', `${part.path} is listed in the manifest but not in the file`);
    if (e.uncompressedSize !== part.size) {
      throw new FormatError('size-mismatch-manifest', `${part.path} is ${e.uncompressedSize} bytes; the manifest says ${part.size}`);
    }
  }
  const listed = new Set(parsed.parts.map((p) => p.path));
  for (const name of byName.keys()) {
    if (!listed.has(name)) throw new FormatError('stray-entry', `${name} is in the file but not listed in the manifest`);
  }

  // every part's bytes, CRC-32 then SHA-256 checked
  const warnings: Warning[] = [];
  const data = new Map<string, Uint8Array>();
  const dropped = new Set<string>();
  const drop = (part: PartEntry, code: Warning['code'], message: string): void => {
    if (dropped.has(part.path)) return;
    dropped.add(part.path);
    warnings.push({ code, path: part.path, message: `${part.path} (${part.role}) dropped: ${message}` });
  };
  let historySha = '';
  for (const part of parsed.parts) {
    const bytesOf = await readEntryData(bytes, byName.get(part.path)!);
    const sha = await sha256Hex(bytesOf);
    if (part.role === 'history') {
      if (sha !== part.sha256) throw new FormatError('sha-mismatch-history', `${part.path}: SHA-256 does not match the manifest`);
      historySha = sha;
    } else if (sha !== part.sha256) {
      drop(part, 'sha-mismatch', 'its SHA-256 does not match the manifest');
      continue;
    }
    data.set(part.path, bytesOf);
  }
  const historyPart = parsed.parts.find((p) => p.role === 'history')!;
  const history = readHistory(data.get(historyPart.path)!, 'bad-history', historyPart.path);

  const partOf = (role: string): PartEntry | undefined => parsed.parts.find((p) => p.role === role && !dropped.has(p.path));
  const jsonOf = (part: PartEntry): { json?: unknown; problem?: string } => {
    try {
      return { json: parseStrictJsonBytes(data.get(part.path)!, part.path) };
    } catch (e) {
      if (e instanceof FormatError) return { problem: e.message };
      throw e;
    }
  };
  // caches: stale first, then structure
  for (const role of ['brep', 'mesh']) {
    const part = partOf(role);
    if (!part) continue;
    if (part.source!.historySha256 !== historySha) {
      drop(part, 'stale-cache', 'it was made from another history (stale)');
      continue;
    }
    const { json, problem } = jsonOf(part);
    if (problem !== undefined) {
      drop(part, 'bad-cache', problem);
      continue;
    }
    const own = sourceProblem(json, part.source!);
    if (own !== null) {
      drop(part, own.code, own.message);
      continue;
    }
    let structure: string | null;
    if (role === 'brep') structure = brepProblem(json);
    else {
      const bin = partOf('mesh-data');
      structure = bin ? meshProblem(json, data.get(bin.path)!, bin.path) : 'its mesh-data part is missing or dropped';
    }
    if (structure !== null) drop(part, 'bad-cache', structure);
  }
  const meshData = partOf('mesh-data');
  if (meshData && !partOf('mesh')) drop(meshData, 'bad-cache', 'its mesh part is missing or dropped');
  const view = partOf('view');
  if (view) {
    const { json, problem } = jsonOf(view);
    if (problem !== undefined) drop(view, 'bad-view', problem);
    else if (typeof json !== 'object' || json === null || Array.isArray(json) || (json as Record<string, unknown>).version !== 1) {
      drop(view, 'bad-view', 'not a JSON object with "version": 1');
    }
  }
  const thumbnail = partOf('thumbnail');
  if (thumbnail) {
    const problem = thumbnailProblem(thumbnail.mediaType, data.get(thumbnail.path)!);
    if (problem !== null) drop(thumbnail, 'bad-thumbnail', problem);
  }

  for (const path of dropped) data.delete(path);
  const manifest: Manifest = { ...parsed, parts: parsed.parts.filter((p) => !dropped.has(p.path)) };
  return { manifest, parts: data, history: history.text, historyJson: history.json, warnings };
}

/** Media types already compressed: stored, not deflated. */
const STORED_MEDIA = /^image\//;

/**
 * Writes a package deterministically: mimetype, manifest.json, then the parts
 * in manifest order. Each part's size and sha256 are computed from its bytes;
 * every other manifest field, known or not, is written as given.
 */
export async function writePackage(contents: PackageContents): Promise<Uint8Array> {
  const manifest = structuredClone(contents.manifest) as Manifest;
  if (!Array.isArray(manifest.parts)) throw new FormatError('bad-manifest', 'manifest: "parts" must be a list');
  const listed = new Set<string>();
  for (const part of manifest.parts) {
    const bytes = contents.parts.get(part.path);
    if (!bytes) throw new FormatError('missing-part', `no bytes given for ${String(part.path)}`);
    listed.add(part.path);
    part.size = bytes.length;
    part.sha256 = await sha256Hex(bytes);
  }
  for (const path of contents.parts.keys()) {
    if (!listed.has(path)) throw new FormatError('stray-entry', `${path} is given but not listed in the manifest`);
  }
  validateManifest(manifest);
  const historyPart = manifest.parts.find((p) => p.role === 'history')!;
  readHistory(contents.parts.get(historyPart.path)!, 'bad-history', historyPart.path);
  const inputs: ZipInput[] = [
    { name: 'mimetype', data: encoder.encode(PACKAGE_MEDIA_TYPE), method: 0 },
    { name: 'manifest.json', data: encoder.encode(canonicalJson(manifest)), method: 8 },
    ...manifest.parts.map((p): ZipInput => ({
      name: p.path,
      data: contents.parts.get(p.path)!,
      method: STORED_MEDIA.test(p.mediaType) ? 0 : 8,
    })),
  ];
  return writeZip(inputs);
}

export interface ConvertOptions {
  documentId?: string;
  revision?: string;
  /** Defaults to the project's "name". */
  title?: string;
  /** RFC 3339 UTC; defaults to now (whole seconds). */
  created?: string;
  /** Defaults to created. */
  modified?: string;
  licence?: string;
  author?: Author;
  generator?: { name: string; version: string };
}

/** Now, as RFC 3339 UTC in whole seconds. */
export function nowRfc3339(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

/**
 * Wraps a plain project (the app's single-JSON .spindle file) in a package,
 * losslessly: the history part is the plain file's exact bytes. The default
 * document id and revision come from the history's SHA-256, so the same file
 * and options give the same package.
 */
export async function plainToPackage(plain: Uint8Array | string, options: ConvertOptions = {}): Promise<Uint8Array> {
  const bytes = typeof plain === 'string' ? encoder.encode(plain) : plain;
  if (identify(bytes) === 'package') throw new FormatError('not-plain', 'this is already a package');
  const { json } = readHistory(bytes, 'not-plain', 'the plain project');
  const sha = await sha256Hex(bytes);
  const name = (json as Record<string, unknown>).name;
  const created = options.created ?? nowRfc3339();
  const document: Manifest['document'] = {
    id: options.documentId ?? `sha256:${sha.slice(0, 32)}`,
    revision: options.revision ?? `sha256:${sha.slice(0, 16)}`,
    title: [...(options.title ?? (typeof name === 'string' && name.length > 0 ? name : 'Untitled'))].slice(0, MAX_TITLE).join(''),
    created,
    modified: options.modified ?? created,
    licence: options.licence ?? 'none',
  };
  if (options.author) document.author = options.author;
  const manifest: Manifest = {
    format: FORMAT_NAME,
    version: `${READER_VERSION.major}.${READER_VERSION.minor}`,
    minReaderVersion: `${READER_VERSION.major}.${READER_VERSION.minor}`,
    generator: options.generator ?? { name: 'SpindleLabs open-format reference', version: '0.1' },
    units: { ...UNITS },
    document,
    extensionsUsed: [],
    extensionsRequired: [],
    parts: [{ path: 'project.json', role: 'history', mediaType: PLAIN_MEDIA_TYPE, size: bytes.length, sha256: sha }],
  };
  return writePackage({ manifest, parts: new Map([['project.json', bytes]]) });
}

export type AnyRead =
  | ({ kind: 'package' } & ReadResult)
  | { kind: 'plain'; history: string; historyJson: unknown; warnings: Warning[] };

/** Reads either flavour, told apart by the first bytes. */
export async function readAny(bytes: Uint8Array): Promise<AnyRead> {
  if (identify(bytes) === 'package') return { kind: 'package', ...(await readPackage(bytes)) };
  const { text, json } = readHistory(bytes, 'not-plain', 'the plain project');
  return { kind: 'plain', history: text, historyJson: json, warnings: [] };
}
