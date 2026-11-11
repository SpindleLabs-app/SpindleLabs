// @fission/open-format: the reference reader, writer and validator of the
// open SpindleLabs package format (draft 0.1). No dependencies; web-standard
// APIs only, so it runs in Node 22 and in browsers.

export { ERROR_CODES, FormatError, WARNING_CODES } from './errors.ts';
export type { FormatErrorCode, Warning, WarningCode } from './errors.ts';
export { crc32 } from './crc32.ts';
export { decodeUtf8Strict, MAX_NESTING, parseStrictJson, parseStrictJsonBytes } from './strict-json.ts';
export {
  assembleZip, checkEntryName, MAX_ENTRIES, MAX_NAME_BYTES, MAX_PART_BYTES, MAX_RATIO, MAX_TOTAL_BYTES,
  readEntryData, readZipDirectory, writeZip,
} from './zip.ts';
export type { RawZipEntry, ZipEntry, ZipInput } from './zip.ts';
export {
  DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, FORMAT_NAME, KNOWN_EXTENSIONS, LICENCES, MAX_THUMBNAIL_BYTES,
  MAX_TITLE, PACKAGE_MEDIA_TYPE, PLAIN_MEDIA_TYPE, PLAIN_MEDIA_TYPES, READER_VERSION, ROLE_MEDIA_TYPES, UNITS, validateManifest,
} from './manifest.ts';
export type { Author, CacheSource, DerivedFrom, DocumentInfo, Manifest, PartEntry } from './manifest.ts';
export { brepProblem, MAX_COORDINATE, meshProblem, sourceProblem, thumbnailProblem } from './caches.ts';
export type { SourceProblem } from './caches.ts';
export { canonicalJson, identify, MAX_PLAIN_BYTES, nowRfc3339, plainToPackage, readAny, readPackage, sha256Hex, writePackage } from './package.ts';
export type { AnyRead, ConvertOptions, PackageContents, ReadResult } from './package.ts';
export { LOCAL_EXTENSION_PREFIX, PERSONAL_FIELDS, stripForShare } from './share.ts';
export type { ShareOptions } from './share.ts';
