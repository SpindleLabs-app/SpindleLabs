// manifest.json: its types and its checks (draft 0.1). Unknown fields are
// allowed anywhere except in "units" (fixed in 0.x) and are kept untouched:
// validation never rewrites the object it is given.

import { FormatError } from './errors.ts';
import { checkEntryName, MAX_PART_BYTES, nameKey } from './zip.ts';

export const PACKAGE_MEDIA_TYPE = 'application/vnd.spindlelabs.project+zip';
export const PLAIN_MEDIA_TYPE = 'application/vnd.spindlelabs.project+json';
/** What the app writes for a plain project today; readers accept both. */
export const PLAIN_MEDIA_TYPES: readonly string[] = [PLAIN_MEDIA_TYPE, 'application/json'];
export const FORMAT_NAME = 'spindlelabs-project';
/** The package format version this reader implements. */
export const READER_VERSION = { major: 0, minor: 1 } as const;
export const LICENCES: readonly string[] = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC0-1.0', 'none'];
// Angles are degrees, as the history part has always stored them (spec section 7).
export const UNITS = { length: 'mm', angle: 'deg', axes: 'right-handed, Z up' } as const;
export const MAX_TITLE = 200;
/** The media type each role uses (spec section 9); history and thumbnail have their own lists. */
export const ROLE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  view: 'application/json', brep: 'application/json', mesh: 'application/json', 'mesh-data': 'application/octet-stream',
};
export const MAX_THUMBNAIL_BYTES = 32 * 1024;
export const THUMBNAIL_MEDIA_TYPES: readonly string[] = ['image/png', 'image/webp'];
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 30;
/** Extensions this reader understands. None in draft 0.1. */
export const KNOWN_EXTENSIONS: readonly string[] = [];
/** Roles allowed at most once (history: exactly once). */
export const SINGLE_ROLES: readonly string[] = ['history', 'view', 'brep', 'mesh', 'mesh-data', 'thumbnail'];
export const CACHE_ROLES: readonly string[] = ['brep', 'mesh'];

const DOCUMENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?Z$/;
const NAMESPACE = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

export interface CacheSource {
  historySha256: string;
  kernel: string;
  [unknown: string]: unknown;
}

export interface PartEntry {
  path: string;
  role: string;
  mediaType: string;
  size: number;
  sha256: string;
  personal?: boolean;
  extension?: string;
  source?: CacheSource;
  [unknown: string]: unknown;
}

export interface Author {
  displayName?: string;
  accountId?: string;
  [unknown: string]: unknown;
}

export interface DerivedFrom {
  where: string;
  documentId: string;
  revision: string;
  title: string;
  licence: string;
  author?: string;
  [unknown: string]: unknown;
}

export interface DocumentInfo {
  id: string;
  revision: string;
  title: string;
  created: string;
  modified: string;
  licence: string;
  author?: Author;
  derivedFrom?: DerivedFrom[];
  [unknown: string]: unknown;
}

export interface Manifest {
  format: string;
  version: string;
  minReaderVersion: string;
  generator: { name: string; version: string; [unknown: string]: unknown };
  units: { length: string; angle: string; axes: string };
  document: DocumentInfo;
  extensionsUsed: string[];
  extensionsRequired: string[];
  parts: PartEntry[];
  [unknown: string]: unknown;
}

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function bad(message: string): never {
  throw new FormatError('bad-manifest', `manifest: ${message}`);
}

function object(v: unknown, where: string): Obj {
  if (!isObject(v)) bad(`${where} must be an object`);
  return v as Obj;
}

function string(v: unknown, where: string, max = 1024): string {
  if (typeof v !== 'string') bad(`${where} must be a string`);
  const s = v as string;
  if (s.length > max) bad(`${where} is over ${max} characters`);
  return s;
}

function optionalString(o: Obj, key: string, where: string, max = 1024): string | undefined {
  return o[key] === undefined ? undefined : string(o[key], `${where}.${key}`, max);
}

/** "MAJOR.MINOR" as two numbers. */
export function parseVersion(v: unknown, where: string): { major: number; minor: number } {
  if (typeof v !== 'string') bad(`${where} must be a string`);
  const m = VERSION.exec(v as string);
  if (!m) throw new FormatError('bad-version', `manifest: ${where} ${JSON.stringify(v)} is not MAJOR.MINOR`);
  return { major: Number(m[1]), minor: Number(m[2]) };
}

function checkDate(v: unknown, where: string): void {
  const s = string(v, where, 64);
  const m = RFC3339_UTC.exec(s);
  const valid = m !== null && (() => {
    const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
    const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
    // Date.UTC rolls 2026-02-30 over to March; a real date comes back unchanged
    return mo >= 1 && mo <= 12 && h <= 23 && mi <= 59 && se <= 59 &&
      t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  })();
  if (!valid) throw new FormatError('bad-date', `manifest: ${where} ${JSON.stringify(s.slice(0, 40))} is not an RFC 3339 UTC time`);
}

function checkLicence(v: unknown, where: string): void {
  if (typeof v !== 'string' || !LICENCES.includes(v)) {
    throw new FormatError('licence', `manifest: ${where} ${JSON.stringify(v)} is not one of ${LICENCES.join(', ')}`);
  }
}

/** Display names count characters as Unicode code points. */
export function checkDisplayName(v: unknown, where: string): void {
  if (typeof v !== 'string') bad(`${where} must be a string`);
  const n = [...(v as string)].length;
  if (n < DISPLAY_NAME_MIN || n > DISPLAY_NAME_MAX) {
    throw new FormatError('display-name', `manifest: ${where} is ${n} characters (${DISPLAY_NAME_MIN} to ${DISPLAY_NAME_MAX})`);
  }
}

function checkDocumentId(v: unknown, where: string): void {
  if (typeof v !== 'string' || !DOCUMENT_ID.test(v)) {
    throw new FormatError('bad-document-id', `manifest: ${where} must be 1 to 128 of A-Z a-z 0-9 . _ : -`);
  }
}

function namespaces(v: unknown, where: string): string[] {
  if (!Array.isArray(v)) bad(`${where} must be a list (empty when none)`);
  const list = v as unknown[];
  if (list.length > 1000) bad(`${where} has over 1000 entries`);
  const seen = new Set<string>();
  for (const n of list) {
    if (typeof n !== 'string' || n.length > 128 || !NAMESPACE.test(n)) bad(`${where} has a bad namespace ${JSON.stringify(n)}`);
    if (seen.has(n as string)) bad(`${where} names ${n} twice`);
    seen.add(n as string);
  }
  return list as string[];
}

function checkSource(v: unknown, where: string): void {
  if (!isObject(v) || typeof v.historySha256 !== 'string' || !SHA256.test(v.historySha256) ||
    typeof v.kernel !== 'string' || v.kernel.length === 0 || v.kernel.length > 256) {
    throw new FormatError('bad-cache-source', `manifest: ${where} needs "source": { "historySha256": <64 hex>, "kernel": <text> }`);
  }
}

/**
 * Checks a parsed manifest against draft 0.1 and returns it, typed. Throws
 * FormatError with the first rule it breaks.
 */
export function validateManifest(value: unknown): Manifest {
  const m = object(value, 'the manifest');
  if (m.format !== FORMAT_NAME) {
    throw new FormatError('wrong-format', `manifest: "format" is ${JSON.stringify(m.format)}, not "${FORMAT_NAME}"`);
  }
  // the order of the spec (6.1): format, minReaderVersion against this reader, the major number, the rest
  const min = parseVersion(m.minReaderVersion, '"minReaderVersion"');
  if (min.major > READER_VERSION.major || (min.major === READER_VERSION.major && min.minor > READER_VERSION.minor)) {
    throw new FormatError('reader-too-old', `the file needs a reader of version ${m.minReaderVersion as string}; this one is ${READER_VERSION.major}.${READER_VERSION.minor}`);
  }
  const version = parseVersion(m.version, '"version"');
  if (version.major !== READER_VERSION.major) {
    throw new FormatError('unknown-major', `package format ${m.version as string}: this reader reads major version ${READER_VERSION.major} only`);
  }
  if (min.major > version.major || (min.major === version.major && min.minor > version.minor)) {
    throw new FormatError('bad-version', 'manifest: "minReaderVersion" is newer than "version"');
  }
  const generator = object(m.generator, '"generator"');
  string(generator.name, 'generator.name', 256);
  string(generator.version, 'generator.version', 256);
  const units = object(m.units, '"units"');
  const unitKeys = Object.keys(units);
  if (unitKeys.length !== 3 || units.length !== UNITS.length || units.angle !== UNITS.angle || units.axes !== UNITS.axes) {
    throw new FormatError('units', `manifest: "units" must be exactly ${JSON.stringify(UNITS)} in 0.x`);
  }
  const doc = object(m.document, '"document"');
  checkDocumentId(doc.id, 'document.id');
  checkDocumentId(doc.revision, 'document.revision');
  const titleLength = [...string(doc.title, 'document.title', 2 * MAX_TITLE)].length;
  if (titleLength < 1 || titleLength > MAX_TITLE) bad(`document.title must be 1 to ${MAX_TITLE} characters`);
  checkDate(doc.created, 'document.created');
  checkDate(doc.modified, 'document.modified');
  checkLicence(doc.licence, 'document.licence');
  if (doc.author !== undefined) {
    const author = object(doc.author, 'document.author');
    if (author.displayName !== undefined) checkDisplayName(author.displayName, 'document.author.displayName');
    const account = optionalString(author, 'accountId', 'document.author', 256);
    if (account !== undefined && account.length === 0) bad('document.author.accountId is empty');
  }
  if (doc.derivedFrom !== undefined) {
    if (!Array.isArray(doc.derivedFrom)) bad('document.derivedFrom must be a list');
    const list = doc.derivedFrom as unknown[];
    if (list.length > 1000) bad('document.derivedFrom has over 1000 entries');
    list.forEach((item, k) => {
      const where = `document.derivedFrom[${k}]`;
      const d = object(item, where);
      const w = string(d.where, `${where}.where`, 256);
      if (!(w === 'link' || w === 'file' || /^library:.+$/.test(w))) bad(`${where}.where must be "library:<id>", "link" or "file"`);
      checkDocumentId(d.documentId, `${where}.documentId`);
      checkDocumentId(d.revision, `${where}.revision`);
      string(d.title, `${where}.title`);
      checkLicence(d.licence, `${where}.licence`);
      if (d.author !== undefined) checkDisplayName(d.author, `${where}.author`);
    });
  }
  const used = namespaces(m.extensionsUsed, '"extensionsUsed"');
  const required = namespaces(m.extensionsRequired, '"extensionsRequired"');
  for (const r of required) {
    if (!used.includes(r)) throw new FormatError('required-not-used', `manifest: required extension ${r} is not in "extensionsUsed"`);
    if (!KNOWN_EXTENSIONS.includes(r)) {
      throw new FormatError('required-extension', `the file needs the extension ${r}, which this reader does not know`);
    }
  }
  if (!Array.isArray(m.parts)) bad('"parts" must be a list');
  const parts = m.parts as unknown[];
  const paths = new Set<string>();
  const roleCount = new Map<string, number>();
  parts.forEach((item, k) => {
    const where = `parts[${k}]`;
    const p = object(item, where);
    const path = string(p.path, `${where}.path`, 1024);
    checkEntryName(path);
    if (path.endsWith('/')) bad(`${where}.path names a directory`);
    if (path === 'mimetype' || path === 'manifest.json') {
      throw new FormatError('reserved-path', `manifest: ${where}.path ${path} is reserved`);
    }
    const key = nameKey(path);
    if (paths.has(key)) throw new FormatError('duplicate-part', `manifest: ${path} is listed twice (paths compared ignoring case)`);
    paths.add(key);
    const role = string(p.role, `${where}.role`, 128);
    const mediaType = string(p.mediaType, `${where}.mediaType`, 256);
    if (typeof p.size !== 'number' || !Number.isInteger(p.size) || p.size < 0 || p.size > MAX_PART_BYTES) {
      bad(`${where}.size must be a whole number of bytes, at most ${MAX_PART_BYTES}`);
    }
    if (typeof p.sha256 !== 'string' || !SHA256.test(p.sha256)) {
      throw new FormatError('bad-sha256', `manifest: ${where}.sha256 must be 64 lowercase hex digits`);
    }
    if (p.personal !== undefined && typeof p.personal !== 'boolean') bad(`${where}.personal must be true or false`);
    roleCount.set(role, (roleCount.get(role) ?? 0) + 1);
    if (SINGLE_ROLES.includes(role) && roleCount.get(role)! > 1) {
      throw new FormatError('duplicate-role', `manifest: more than one part with role ${role}`);
    }
    if (role === 'history' && !PLAIN_MEDIA_TYPES.includes(mediaType)) {
      throw new FormatError('bad-media-type', `manifest: the history part's media type must be ${PLAIN_MEDIA_TYPE}`);
    }
    if (role === 'thumbnail') {
      if (!THUMBNAIL_MEDIA_TYPES.includes(mediaType)) {
        throw new FormatError('bad-media-type', 'manifest: a thumbnail must be image/png or image/webp');
      }
      if ((p.size as number) > MAX_THUMBNAIL_BYTES) {
        throw new FormatError('thumbnail-too-large', `manifest: the thumbnail is ${p.size as number} bytes (at most ${MAX_THUMBNAIL_BYTES})`);
      }
    }
    const expected = ROLE_MEDIA_TYPES[role];
    if (expected !== undefined && mediaType !== expected) {
      throw new FormatError('bad-media-type', `manifest: a ${role} part's media type must be ${expected}`);
    }
    if (CACHE_ROLES.includes(role)) checkSource(p.source, `${where}.source`);
    if (role !== 'extension' && p.extension !== undefined) bad(`${where} has "extension" but its role is ${role}`);
    if (role === 'extension') {
      if (typeof p.extension !== 'string' || !used.includes(p.extension)) {
        throw new FormatError('extension-not-declared', `manifest: ${where} belongs to an extension not listed in "extensionsUsed"`);
      }
    }
  });
  if ((roleCount.get('history') ?? 0) !== 1) throw new FormatError('history-missing', 'manifest: no part with role history');
  if ((roleCount.get('mesh-data') ?? 0) > 0 && (roleCount.get('mesh') ?? 0) === 0) {
    bad('a mesh-data part needs a mesh part');
  }
  return m as unknown as Manifest;
}
