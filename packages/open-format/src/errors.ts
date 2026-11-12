// One error class for every refusal, each with a stable code.
// A caller decides by `code`, never by reading the message.

/** Every refusal rule of draft 0.1, one code each. */
export const ERROR_CODES = [
  // container (zip)
  'not-package', // first bytes are not "PK\x03\x04"
  'truncated', // a structure runs past the end of the file
  'bad-zip', // a signature, count or offset that does not add up
  'zip64', // zip64 records or sizes (refused in draft 0.1)
  'encrypted', // an encrypted entry
  'compression-method', // a method other than STORE (0) or DEFLATE (8)
  'header-mismatch', // a local header disagrees with its central directory entry
  'overlapping-entries', // two entries' bytes overlap, or one overlaps the directory
  'too-many-entries', // more than 10,000 entries
  'part-too-large', // one entry over 256 MiB uncompressed
  'total-too-large', // all entries together over 1 GiB uncompressed
  'zip-bomb', // compression ratio above 1000:1
  'size-mismatch', // stored data whose size differs from the size the zip declares
  'bad-deflate', // DEFLATE data that does not decompress
  'crc-mismatch', // CRC-32 of the data differs from the declared one
  'path-traversal', // "..", a leading "/", a "\" or a drive letter in a name
  'bad-name', // empty, over 255 bytes, control characters, empty or "." segment, invalid UTF-8
  'duplicate-entry', // two entries with the same name, ignoring case
  // the two fixed entries
  'mimetype-not-first',
  'mimetype-compressed',
  'mimetype-extra-field',
  'mimetype-data-descriptor',
  'mimetype-wrong',
  'manifest-not-second',
  // text and JSON
  'invalid-utf8',
  'bom',
  'bad-json',
  'duplicate-key',
  'too-deep', // nesting over 256
  'number-out-of-range', // a JSON number that is not a finite double (1e400)
  // manifest
  'bad-manifest', // a required field missing or of the wrong JSON type
  'wrong-format', // "format" is not "spindlelabs-project"
  'bad-version', // a version string that is not MAJOR.MINOR
  'unknown-major',
  'reader-too-old', // minReaderVersion above this reader's version
  'units',
  'bad-document-id',
  'bad-date',
  'licence',
  'display-name',
  'required-not-used', // extensionsRequired names one missing from extensionsUsed
  'required-extension', // a required extension this reader does not know
  'extension-not-declared', // an extension part whose namespace is not in extensionsUsed
  'duplicate-part', // two parts with the same path, ignoring case
  'reserved-path', // a part named "mimetype" or "manifest.json"
  'history-missing',
  'duplicate-role', // two parts of a role allowed at most once
  'bad-media-type',
  'thumbnail-too-large', // over 32 KiB
  'bad-sha256', // not 64 lowercase hex digits
  'bad-cache-source', // a brep/mesh part without a valid "source"
  // manifest against the zip
  'missing-part', // listed in the manifest, not in the zip
  'stray-entry', // in the zip, not listed in the manifest
  'size-mismatch-manifest', // the manifest's size differs from the entry's
  'sha-mismatch-history', // the history part's SHA-256 differs from the manifest's
  'bad-history', // the history part is not a project JSON object
  // plain files
  'not-plain', // plainToPackage given something that is not a plain project
] as const;

export type FormatErrorCode = (typeof ERROR_CODES)[number];

export class FormatError extends Error {
  readonly code: FormatErrorCode;
  constructor(code: FormatErrorCode, message: string) {
    super(message);
    this.name = 'FormatError';
    this.code = code;
  }
}

/** Codes of warnings: an optional part dropped while reading, never a refusal. */
export const WARNING_CODES = [
  'sha-mismatch', // an optional part's SHA-256 differs from the manifest's: dropped
  'stale-cache', // a cache made from another history: dropped
  'bad-cache', // a cache whose structure is invalid: dropped
  'bad-view', // a view part that is not a JSON object with "version": 1: dropped
  'bad-thumbnail', // a thumbnail whose bytes are not the image its media type names: dropped
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export interface Warning {
  code: WarningCode;
  /** The part that was dropped. */
  path: string;
  message: string;
}
