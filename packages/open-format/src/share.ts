// What a share export takes out of a package: the personal fields.

import type { Manifest } from './manifest.ts';
import type { PackageContents } from './package.ts';

/** The namespace prefix of extensions that hold this device's own data. */
export const LOCAL_EXTENSION_PREFIX = 'spindlelabs.local.';

/**
 * Every personal field of draft 0.1, as a path into the package and why.
 * Undo history is personal too but is never in the file at all.
 */
export const PERSONAL_FIELDS: readonly { path: string; why: string }[] = [
  { path: 'manifest.json: document.author.accountId', why: 'links the file to an account (kept only by the library when it publishes)' },
  { path: 'parts[personal = true]', why: 'a part its writer marked personal' },
  { path: 'parts[role = "view"]', why: 'view state, which may hold device names' },
  { path: 'parts[extension starts "spindlelabs.local."]', why: 'local paths, printer, AMS and fit settings, AI chats' },
  { path: 'manifest.json: extensionsUsed[*] starting "spindlelabs.local."', why: 'names of the local extensions removed above' },
  { path: 'manifest.json: extensionsRequired[*] starting "spindlelabs.local."', why: 'names of the local extensions removed above' },
];

const isLocal = (namespace: unknown): boolean => typeof namespace === 'string' && namespace.startsWith(LOCAL_EXTENSION_PREFIX);

export interface ShareOptions {
  /** True only for the library publishing the file under the author's account. */
  keepAccountId?: boolean;
}

/**
 * A copy of the package with every personal field removed. The history and
 * every other part keep their exact bytes; the input is not changed.
 */
export function stripForShare(contents: PackageContents, options: ShareOptions = {}): PackageContents {
  const manifest = structuredClone(contents.manifest) as Manifest;
  const author = manifest.document.author;
  if (author && !options.keepAccountId && 'accountId' in author) {
    delete author.accountId;
  }
  const personal = (p: Manifest['parts'][number]): boolean =>
    p.personal === true || p.role === 'view' || isLocal(p.extension);
  const kept = manifest.parts.filter((p) => !personal(p));
  manifest.parts = kept;
  manifest.extensionsUsed = manifest.extensionsUsed.filter((n) => !isLocal(n));
  manifest.extensionsRequired = manifest.extensionsRequired.filter((n) => !isLocal(n));
  const parts = new Map<string, Uint8Array>();
  for (const p of kept) {
    const bytes = contents.parts.get(p.path);
    if (bytes) parts.set(p.path, bytes);
  }
  return { manifest, parts };
}
