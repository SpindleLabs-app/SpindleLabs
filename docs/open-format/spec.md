# The SpindleLabs open file format

**Draft 0.1, not yet used by the app.** Written 2026-11-11. This draft can still change in any way. The app still saves the plain JSON project described in `docs/project-format.md`; nothing here changes that until phase 1 of the migration plan (section 21).

JSON Schemas for this draft: `schema/manifest.schema.json` (the package manifest) and `schema/design-16.schema.json` (the history part with Design data version 16).

## Contents

1. Purpose and status
2. Conformance words
3. Identifying a file: plain or package
4. The package (zip rules, limits, determinism)
5. The manifest
6. Versioning and extensions
7. Units, axes and tolerance
8. Document identity, licence, author and remix chain
9. Parts and roles
10. The history part
11. The view part
12. The B-rep cache part
13. The mesh cache parts
14. Stale cache detection
15. Integrity
16. Personal fields and the share export
17. Security considerations
18. File extension, media types, icon and double-click opening
19. Example package
20. Ideas from other formats
21. Migration plan and data version history
22. Open questions

## 1. Purpose and status

A SpindleLabs project holds a design as a recipe: sketches, features in a timeline, and the names that tie them together. The open format lets anyone read and write that recipe, and carry extra things beside it: a picture, a saved copy of the exact shape, a display mesh, and data from extensions.

Goals:

- Anyone can write a reader. Everything a reader needs is in this document and the schemas. No private code is needed to read a file, show it, or check it.
- A file opened and saved by an older program keeps what that program did not understand.
- Old files open for ever. The plain JSON project the app saves today stays a valid SpindleLabs file.
- A file is never code. Opening one can never run anything.
- Remixes keep their history: who made what, under which licence.

Status: draft 0.1. Version numbers starting with 0 promise nothing between drafts. Version 1.0 will be the first stable one. The reference reader is `packages/open-format/` in this repo.

What is out of scope in 0.1: signatures, encryption, several designs in one file, assemblies, drawings, and the data of workspaces other than Design (they are kept as they are, see 10.1).

## 2. Conformance words

MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119 and RFC 8174, and only when written in capitals.

- A **reader** is a program that opens files.
- A **writer** is a program that saves files.
- An **editor** is both: it opens a file, changes it, and saves it.
- **Refuse** means: do not open the file at all, show one clear message, and leave any open project as it was. A reader MUST NOT half-read a file it refuses.
- **Drop with a warning** means: open the rest of the file, leave out the named part, and tell the user which part was left out and why.
- **Ignore and keep** means: do not use the thing, but write it back unchanged when saving.

## 3. Identifying a file: plain or package

There are two flavours. Both use the extension `.spindle`.

| Flavour | What it is | First bytes | Media type |
|---|---|---|---|
| plain | one JSON document, the project itself | `{` (possibly after JSON whitespace) | `application/vnd.spindlelabs.project+json` |
| package | a zip archive holding the project and other parts | `PK` `0x03` `0x04` | `application/vnd.spindlelabs.project+zip` |

A reader tells them apart by the first four bytes:

1. If the file starts with the bytes `50 4B 03 04` ("PK\x03\x04"), it is a package. Section 4 applies.
2. Otherwise it is read as plain JSON. A plain file is the history part on its own (section 10), with the same rules and limits as the app applies today: at most 64 MiB, valid UTF-8, nesting at most 256 deep, no duplicate keys, and an object holding `formatVersion`.

A package also has a quick check that needs no zip library: in a valid package, the bytes from offset 30 to 37 are the ASCII text `mimetype`, and from offset 38 come the 39 ASCII bytes `application/vnd.spindlelabs.project+zip`. A reader SHOULD use this check to tell a SpindleLabs package from another zip before unpacking. A reader MUST refuse a zip whose first entry is not the `mimetype` entry described in 4.2.

Files saved by older SpindleLabs builds may end in `.spindlelabs.json`, `.panosolid.json` or `.fission.json`. They are plain files. A reader SHOULD open them too.

The app saves plain files with the media type `application/json` today. A reader MUST accept a plain file sent with `application/json`, `application/vnd.spindlelabs.project+json`, or no media type at all.

## 4. The package

### 4.1 Zip in general

A package is a zip archive (the PKWARE APPNOTE format) with these limits:

- Compression methods: only 0 (STORE) and 8 (DEFLATE). A reader MUST refuse any other.
- No encryption. A reader MUST refuse an entry with the encryption flag (bit 0 of the general purpose flags) set, or any strong-encryption header.
- No zip64 in draft 0.1. A reader MUST refuse a file that has a zip64 end-of-central-directory record or locator, a zip64 extra field, or a size, offset or count field set to its "see zip64" value (`0xFFFFFFFF` or `0xFFFF`).
- One disk only. A reader MUST refuse a split or spanned archive.
- The central directory is the list of entries. For every entry, the local header MUST agree with the central directory: same name, method, flags, CRC-32 and sizes (sizes may be zero in the local header only when a data descriptor follows). A reader MUST refuse a disagreement.
- The CRC-32 of every entry a reader unpacks MUST match. A reader MUST refuse a mismatch.
- Entries whose names end in `/` are directory entries. They are not needed, carry no data, and a reader ignores them (they still obey the name rules in 4.3 and still count towards the entry limit).
- An archive comment MAY be present. A reader ignores it. A writer writes none.
- A data descriptor MUST NOT follow the `mimetype` entry. Other entries MAY have one; writers of this spec do not write them (4.5).

### 4.2 The first two entries

1. The first entry in the archive (both first in the central directory and at offset 0) MUST be named `mimetype`. It MUST be stored (method 0), with no extra field, no data descriptor, and no encryption. Its content MUST be exactly the 39 ASCII bytes `application/vnd.spindlelabs.project+zip`, with no newline and no byte order mark. Because a local file header is 30 bytes long, this puts the name at offset 30 and the media type at offset 38.
2. The second entry MUST be named `manifest.json` (section 5). It MAY be stored or deflated.
   No byte of the archive may lie outside an entry: no bytes before the first entry, between entries, or between the last entry and the central directory. A reader MUST refuse a file with such hidden bytes, so nothing can be smuggled in a package that no reader shows.

Every other entry comes after these two, in any order.

### 4.3 Entry names

Every entry name MUST:

- be valid UTF-8 (a writer sets general purpose flag bit 11 when a name is not plain ASCII);
- be relative: no leading `/`, and no drive letter such as `C:`;
- use `/` as the only separator, and contain no `\`;
- contain no empty segment (`a//b`), no `.` segment and no `..` segment;
- contain no control characters (U+0000 to U+001F and U+007F);
- be at most 255 bytes long in UTF-8;
- be unique, and also unique when compared ignoring case (Unicode simple case folding).

A reader MUST refuse a file with an entry breaking any of these rules. These rules stop an entry from being written outside the folder a tool unpacks to.

### 4.4 Limits

| Limit | Value | When over |
|---|---|---|
| entries in the archive (all, including `mimetype`, `manifest.json` and directory entries) | 10,000 | refuse |
| one entry, unpacked | 256 MiB (268,435,456 bytes) | refuse |
| all entries together, unpacked | 1 GiB (1,073,741,824 bytes) | refuse |
| compression ratio of one entry (unpacked size divided by packed size) | 1000 : 1 | refuse when above |
| thumbnail part | 32 KiB (32,768 bytes) | refuse the file (its manifest is invalid) |

A reader MUST check the sizes in the central directory before unpacking anything, and MUST also stop unpacking an entry as soon as its output passes its declared size (a lying header must not get past the limits).

The `size` of every part in the manifest MUST equal the entry's unpacked size in the zip. A reader MUST refuse a mismatch.

### 4.5 Deterministic writing

The same project MUST give the same bytes every time a given writer saves it, so hashes are reproducible and files compare well. A writer:

- writes the entries in this order: `mimetype`, `manifest.json`, then the parts in the order of the manifest's `parts` list;
- sets every entry's DOS date and time to 1980-01-01 00:00:00 (date field `0x0021`, time field `0x0000`). Real times live in the manifest (`document.created`, `document.modified`);
- writes no extra fields, no data descriptors, no archive comment, and zero external attributes;
- sets general purpose flag bit 11 on an entry exactly when its name is not plain ASCII;
- writes JSON parts with sorted keys and fixed indentation (the history part's own rules, 10.1, apply to it).

DEFLATE output depends on the compressor and its settings. Byte-for-byte equality is promised only between saves by the same writer build. The manifest's `sha256` values cover unpacked bytes, so they stay equal whatever the compressor.

## 5. The manifest

`manifest.json` is a JSON document: UTF-8, no byte order mark, no duplicate keys (a reader MUST refuse a file with any), nesting at most 256 deep, and no number outside what a 64-bit float holds. The schema is `schema/manifest.schema.json`.

### 5.1 Fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | string | yes | Always `"spindlelabs-project"`. Anything else: refuse. |
| `version` | string `MAJOR.MINOR` | yes | The package format version this file is written to. `"0.1"` for this draft. |
| `minReaderVersion` | string `MAJOR.MINOR` | yes | The oldest package reader version that reads this file correctly. MUST NOT be above `version`. |
| `generator` | object | yes | `name` and `version`, both strings, of the program that wrote the file. For people and bug reports only: a reader MUST NOT change what it does because of it. |
| `units` | object | yes | Always `{ "length": "mm", "angle": "deg", "axes": "right-handed, Z up" }` in 0.x. Any other value: refuse. See section 7. |
| `document` | object | yes | Who and what this is: 5.2. |
| `extensionsUsed` | array of namespaces | yes | Every extension the file uses. Empty when none. |
| `extensionsRequired` | array of namespaces | yes | The extensions a reader MUST understand to read the file correctly. A subset of `extensionsUsed`. Empty when none. |
| `parts` | array of part entries | yes | Every part in the package: 5.3. |

### 5.2 `document`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string, 1 to 128 characters of `A-Z a-z 0-9 . _ : -` | yes | This design's own id. Opaque: a reader compares it, never parses it. It stays the same across saves and revisions of the same design. |
| `revision` | string, same characters | yes | This saved state of the design. Opaque and compare-only: two files with the same `id` and `revision` hold the same design state. A reader MUST NOT sort or parse revisions. |
| `title` | string, 1 to 200 characters | yes | The design's title. A writer SHOULD keep it equal to the history part's `name`. |
| `created` | RFC 3339 time in UTC, ending `Z` | yes | When the design was first made. |
| `modified` | RFC 3339 time in UTC, ending `Z` | yes | When this revision was saved. SHOULD NOT be before `created`. |
| `licence` | one of `CC-BY-4.0`, `CC-BY-SA-4.0`, `CC-BY-NC-4.0`, `CC0-1.0`, `none` | yes | The licence the author gives this design. `none` means all rights reserved. Section 8. |
| `author` | object | no | `displayName` (3 to 30 characters) and `accountId` (an opaque id, written only by the community library). Both optional. Section 8. |
| `derivedFrom` | array of sources | no | The remix chain, nearest source first. Section 8. |

### 5.3 Part entries

| Field | Type | Required | Meaning |
|---|---|---|---|
| `path` | string | yes | The zip entry name (section 4.3 rules). Not `mimetype` or `manifest.json`. |
| `role` | string | yes | What the part is for (section 9). |
| `mediaType` | string | yes | The part's media type (section 9 lists the one each role uses). |
| `size` | integer, 0 to 268,435,456 | yes | The part's unpacked size in bytes. |
| `sha256` | string of 64 lower-case hex digits | yes | The SHA-256 of the part's unpacked bytes. |
| `personal` | boolean | no, default `false` | `true` marks a part a share export removes (section 16). |
| `extension` | namespace | only for role `extension` | The extension that owns the part. MUST be listed in `extensionsUsed`. MUST NOT appear on other roles. |
| `source` | object | only for roles `brep` and `mesh` | What the cache was made from: `historySha256` (the history part's `sha256` when the cache was made) and `kernel` (the version string of the geometry engine that made it). Section 14. |

### 5.4 What makes a manifest invalid

A reader MUST refuse the file when:

- `manifest.json` is missing, not the second entry, not valid UTF-8 or JSON, or holds a duplicate key;
- any required field is missing or has the wrong type, or `format` or `units` differ from the fixed values;
- `version` has an unknown major number, or `minReaderVersion` is newer than the reader (section 6);
- `extensionsRequired` names an extension the reader does not support, or names one missing from `extensionsUsed`;
- there is not exactly one part with role `history`, or more than one part with role `view`, `brep`, `mesh`, `mesh-data` or `thumbnail`;
- two parts have the same `path` (also ignoring case), or a part's `path` breaks the name rules;
- a listed part is missing from the zip, or a zip entry other than `mimetype`, `manifest.json` and directory entries is not listed (a stray entry);
- a part's `size` differs from its entry's unpacked size;
- the history part's `sha256` does not match (section 15);
- a thumbnail is larger than 32 KiB or not `image/png` or `image/webp`;
- a `view`, `brep`, `mesh` or `mesh-data` part has a `mediaType` other than the one section 9 gives its role;
- a `brep` or `mesh` part has no `source`, or an `extension` part names no extension or one not in `extensionsUsed`.

Unknown fields in the manifest (at the top level, in `document`, in `generator`, in a part entry) are not errors in a file whose minor version is newer than the reader's. The reader ignores them and keeps them on re-save. In a file of the reader's own version or older, a reader MAY warn about them, and still keeps them.

## 6. Versioning and extensions

### 6.1 Package format version

The package format has a `MAJOR.MINOR` version in `version`.

- A **major** change is one an older reader cannot read safely. A reader MUST refuse a file whose major number it does not know.
- A **minor** change only adds things an older reader can skip. A reader MUST open a file with a known major and a newer minor. It ignores what it does not understand and keeps it on re-save.
- `minReaderVersion` is the writer's statement of the oldest reader that reads this file correctly, for when a minor addition matters more than usual. A reader whose own version is older than `minReaderVersion` MUST refuse the file. A writer sets it as low as it truthfully can.

The order of checks: `format`, then `minReaderVersion` against the reader's version, then the major number of `version`, then the rest.

While the major number is 0 (drafts), every minor change MAY break files. A 0.x reader only promises to read the exact 0.x versions it lists. From 1.0 the rules above hold strictly.

The package version is separate from the data versions inside the history part (section 10): the outer project's `formatVersion` and each workspace's own `version`. Those keep their own rules, which are stricter: a reader refuses workspace data newer than it knows.

### 6.2 Keep unknown on re-save

An editor that opens a file and saves it again MUST keep, unchanged:

- unknown fields in the manifest;
- parts with unknown roles, and parts of extensions it does not know (with their manifest entries);
- workspace data in the history part that no workspace in the program reads.

It MUST drop or rebuild what it can no longer vouch for: a cache whose `source.historySha256` no longer matches once it changed the history (section 14), and a thumbnail that no longer shows the design (SHOULD redraw or drop it).

### 6.3 Extensions

An extension is named by a **namespace**: a lower-case dotted name with at least two parts, letters, digits and inner hyphens only (`spindlelabs.print-fits`). Namespaces starting `spindlelabs.` belong to SpindleLabs. Anyone else uses a reversed domain name they control (`org.example.engraving`).

- Every extension used anywhere in the file is listed in `extensionsUsed`.
- An extension without which the design would build wrong or mean something else is also listed in `extensionsRequired`. A writer MUST NOT mark one required that a reader can safely skip.
- A reader MUST refuse a file listing a required extension it does not support.
- A reader MUST ignore and keep an optional extension it does not support.
- Extension data lives in parts with role `extension` and the extension's namespace in `extension`.
- The namespace `spindlelabs.local.` (and everything under it) is for personal, device-bound data: local file paths, printer and filament unit settings, fit measurements, AI chats. Every part of such an extension is personal (section 16), whether or not it says `"personal": true`.

No extension is defined in draft 0.1.

## 7. Units, axes and tolerance

These are fixed for the whole file. They are not choices.

- **Length:** millimetres, everywhere, in every part.
- **Angle:** degrees, everywhere in the package: the history part (a Move's turns, section 10.6) has always stored degrees, and any angle in a cache or later geometry part is in degrees too, so a reader meets one unit throughout.
- **Axes:** right-handed, Z up. X runs left to right, Y away from the viewer, Z up, seen from the default front view. The XY plane is the ground; its normal is +Z.
- **Linear tolerance:** 10 nm (0.00001 mm). Two points closer than this are the same point. Where this document says "within 10 nm", this is the value.
- **Sizes:** the smallest meaningful length is 1 µm (0.001 mm); the largest size of anything is 1 km (1,000,000 mm). A writer MUST NOT write a part size, feature length or coordinate outside those limits in a part this document gives limits for. The app refuses typed lengths outside 1 µm to 1 km.
- Sketch dimension values may go from 0.001 mm to 200,000,000 mm (10.4.4), wider than the size limit, so a dimension never has to be refused while a sketch is being solved.

The outer project's `units.length` (section 10.1) is stored and checked but does not change any stored number: every stored length is millimetres whatever it says. Display units are a user preference, not part of the design.

## 8. Document identity, licence, author and remix chain

### 8.1 Identity

`document.id` names the design. `document.revision` names one saved state of it. Both are opaque strings. A reader may compare them for equality and nothing else.

- A writer keeps `id` when saving the same design again, and gives a new `revision` on every save that changes the design.
- "Save as" a copy SHOULD give a new `id`.
- Two files with the same `id` and different revisions are two states of one design. Which is newer is told by `modified`, never by the revision text.

### 8.2 Licence

`document.licence` is one of:

| Value | Meaning |
|---|---|
| `CC-BY-4.0` | Creative Commons Attribution 4.0. The community library's default for shared designs. |
| `CC-BY-SA-4.0` | Creative Commons Attribution-ShareAlike 4.0. |
| `CC-BY-NC-4.0` | Creative Commons Attribution-NonCommercial 4.0. |
| `CC0-1.0` | Creative Commons Zero: no rights reserved. |
| `none` | All rights reserved. |

The values are SPDX licence identifiers, plus `none`. Whether one licence may be used for a remix of another is guidance for programs and people (for example, a remix of a ShareAlike design keeps ShareAlike). The file only records the choice; it does not enforce it.

### 8.3 Author

`document.author` is optional. Inside it:

- `displayName`: the public name the author chose, 3 to 30 characters. Never a real name or an email address unless the author typed it as their display name.
- `accountId`: written only by the community library, for designs it publishes. It is personal when a file is shared by link (section 16).

A design with no author says nothing about who made it.

### 8.4 Remix chain: `derivedFrom`

`document.derivedFrom` lists the designs this one was made from, **nearest source first**: the design this one was copied from, then the one that one was copied from, and so on. Each source is:

| Field | Required | Meaning |
|---|---|---|
| `where` | yes | Where it came from: `library:<id>` (a design in the community library, with its library id), `link` (opened from a sharing link) or `file` (opened from a file). Never the id or address of a sharing link. |
| `documentId` | yes | The source's `document.id`. |
| `revision` | yes | The source's `document.revision` at the time it was copied. |
| `title` | yes | The source's title at that time. |
| `licence` | yes | The source's licence at that time. |
| `author` | no | The source's author display name at that time. |

A writer copies the source's own `derivedFrom` after the new first entry, so the chain stays complete. It MAY shorten a chain longer than 1,000 entries by dropping the oldest. Entries never change after they are written.

## 9. Parts and roles

| Role | Number | Default path | Media type | Required | Section |
|---|---|---|---|---|---|
| `history` | exactly one | `project.json` | `application/vnd.spindlelabs.project+json` | yes | 10 |
| `view` | at most one | `view.json` | `application/json` | no | 11 |
| `brep` | at most one | `brep.json` | `application/json` | no (cache) | 12 |
| `mesh` | at most one | `mesh.json` | `application/json` | no (cache) | 13 |
| `mesh-data` | at most one, only with a `mesh` part | `mesh.bin` | `application/octet-stream` | no (cache) | 13 |
| `thumbnail` | at most one | `thumbnail.png` or `thumbnail.webp` | `image/png` or `image/webp` | no | 9.1 |
| `extension` | any number | under a folder named after the namespace | any | no | 6.3 |

A reader MUST find parts by their role in the manifest, never by guessing a path. A writer SHOULD use the default paths, so people looking inside the zip find things.

A part with a role this reader does not know is ignored and kept (6.2). In a 0.x file no unknown role can be required: a role that a reader must understand would come with a new major version.

The smallest valid package holds three entries: `mimetype`, `manifest.json`, and the history part.

### 9.1 Thumbnail

An optional picture of the design for file browsers and the library: PNG or WebP, at most 32 KiB. A reader MUST NOT need it to open the file. A reader SHOULD check that its first bytes match its media type (PNG starts `89 50 4E 47 0D 0A 1A 0A`; WebP starts `RIFF`, four bytes, then `WEBP`) and drop it with a warning when they do not. A writer SHOULD make it square, about 256 pixels wide.

## 10. The history part

The history part is the project itself: the recipe that builds the design. **Its bytes are exactly the plain project JSON the app saves today.** A plain `.spindle` file and the history part of a package are the same thing; converting one to the other changes no byte of it (section 21.1).

This section describes that JSON field by field, for outer format 2 with Design data version 16, the current versions. The schema is `schema/design-16.schema.json`. `docs/project-format.md` and `docs/document-model.md` (section 8, names) hold the full history and reasons behind each rule; this section states what a reader needs.

### 10.1 Outer layout (format 2)

```json
{
  "formatVersion": 2,
  "links": [],
  "materials": [],
  "name": "Bracket",
  "units": { "length": "mm" },
  "workspaces": { "design": { "version": 16, "...": "..." } }
}
```

| Field | Type | Meaning |
|---|---|---|
| `formatVersion` | integer | The outer layout's version, 2. A reader refuses a number above the one it knows, saying a newer SpindleLabs saved it. Version 1 files lack `links` and read as if it were empty. |
| `name` | string | The project's name. |
| `units` | `{ "length": "mm" \| "cm" \| "m" \| "in" }` | Stored and checked; changes no stored number (section 7). |
| `materials` | array of objects | Draft materials library. Nothing makes one yet; a reader checks each entry is an object and keeps it. |
| `links` | array of objects | Live links and frozen copies between workspaces. Nothing makes one yet; a reader checks each entry is an object and keeps it. |
| `workspaces` | object | Each workspace's own data under its id (`design`, `render`, `simulate`, `manufacture`, `laser`, `slice`, `circuit`, `vector`, `image`, `layout`), each with its own `version` inside. Only `design` has data today. A reader keeps the data of a workspace it does not read, byte for byte. |

How the app writes it, which every writer MUST follow so the same project gives the same bytes:

- keys sorted at every level (by UTF-16 code units, as JavaScript sorts them);
- two-space indentation, one key per line, and a newline at the end;
- keys whose value would be "nothing" are left out (never written as `null`);
- NaN and the infinities are never written; a writer refuses to save them.

Limits the app enforces on open: at most 64 MiB, nesting at most 256 deep, no non-finite numbers. A reader MUST also refuse duplicate keys (the app's own parser keeps the last one today; see open question 7).

### 10.2 Design data, version 16: top level

```json
{
  "version": 16,
  "nextId": 12,
  "profiles": [],
  "sketches": [ ],
  "timeline": { "features": [ ], "marker": "feature-11" },
  "kept": { },
  "bodies": [ { "id": "body:feature-1", "number": 1 } ],
  "nextBody": 2,
  "hidden": [ "sketch-2" ],
  "shownPlanes": [ "origin-xy" ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | 16. A reader refuses a version above the one it knows. An older version is upgraded on open by the steps in 21.3. |
| `nextId` | yes | The number the next new id gets. A whole number from 1 to 2^52 (4,503,599,627,370,496), above the number in every id in the data. |
| `profiles` | yes | Ready-made outlines (10.3). Empty in designs that use none. |
| `sketches` | yes | The content of each sketch item (10.4). |
| `timeline` | yes | `features`, the items in build order (10.5), and the optional `marker` (10.7). |
| `kept` | no | Each extrude's last shape while its sketch is lost (10.8). Left out when there is none. |
| `bodies` | no | Every body's id and number (10.9). A file the app saved always has it. |
| `nextBody` | no, with `bodies` | The number the next new body gets, above every number ever given. |
| `hidden` | no | **View state.** What the eyes hide (10.10). Left out when nothing is hidden. |
| `shownPlanes` | no | **View state.** Which origin planes are shown (10.10). Left out when none is. |

Limits (a reader MUST refuse a file over them): 5,000 timeline items; 5,000 profiles; 20,000 points and curves together in one sketch or one kept shape; 500,000 points and curves in all sketches and kept shapes together; 8,000 constraints in one sketch; 500,000 piece face names in `bodies` together.

### 10.3 Ids

Every id in Design data is a lower-case word, a dash, and a number from the one counter `nextId`: `sketch-2`, `point-3`, `line-7`, `circle-5`, `arc-6`, `feature-11`, `profile-1`, `constraint-12`, `projection-8`. Rules:

- Ids are unique across profiles, timeline items, sketch points, curves, constraints and projections. The one exception: a sketch's content shares its id with its timeline item.
- `nextId` is above every number in any id, including ids in kept shapes and ids of deleted items that Moves, Combines and extrudes with an operation still name.
- **Ids are never reused**, even after a delete. A writer adding something takes `nextId` and adds one.
- The word in front carries no meaning a reader may rely on. Display names ("Sketch 1", "Body 3") are not ids.
- A bare word without a number (`base`) appears only in data upgraded from Design version 1.

Ready-made profiles, `profiles[]`: `{ "id", "kind", "width", "depth", "plane" }`. `kind` is `l-bracket`, `plate`, `slot` or `star`; `width` and `depth` are mm; `plane` is a frame (10.4.6) the outline lies in. The outline, in the plane's own x and y, with `w` the width and `d` the depth:

- `plate`: the rectangle from (0, 0) to (w, d), with two round holes of radius 0.15 × min(w, d), centred at (w/4, d/2) and (3w/4, d/2).
- `l-bracket`: the L with corners (0, 0), (w, 0), (w, 0.3d), (0.3w, 0.3d), (0.3w, d), (0, d).
- `slot`: a stadium: straight sides from (d/2, 0) to (w − d/2, 0) and from (w − d/2, d) to (d/2, d), joined by half circles of radius d/2 at each end.
- `star`: ten corners round (w/2, d/2), alternating at radius R = 0.5 × min(w, d) and 0.4R, the first on the +x side at radius R, evenly spaced by a tenth of a turn.

### 10.4 Sketches

Each entry of `sketches` is the content of one sketch item of the timeline, joined to it by id. Each sketch item has exactly one entry, and each entry exactly one item.

```json
{ "id": "sketch-2", "points": [ ], "curves": [ ], "constraints": [ ], "face": { }, "pins": [ ], "projected": [ ] }
```

`points`, `curves` and `constraints` are required (each may be empty). `face`, `pins` and `projected` are optional, and when present `pins` and `projected` hold at least one entry.

#### 10.4.1 Points

`{ "id", "x", "y" }`: a point in mm, in the sketch plane's own 2D frame (never world coordinates). A point used by no curve is allowed (a sketch point). Points are **saved solved**: their coordinates already satisfy the sketch's constraints.

#### 10.4.2 Curves

Each curve names points of the same sketch by id. A point may be shared by several curves.

| Kind | Fields | Meaning |
|---|---|---|
| `line` | `start`, `end` | A straight line between two different points. |
| `circle` | `centre`, `radius` | A full circle round a point; `radius` in mm, above 0. |
| `arc` | `start`, `end`, `centre` | An arc running **counter-clockwise** round `centre` from `start` to `end` (three different points). The centre is within 10 nm of the line midway between the ends, so it is equally far from both; the radius is the mean of the two distances. |

Optional on every curve:

- `"construction": true`: a construction curve, drawn dashed and left out of the outline. It never makes or breaks a profile; constraints and dimensions treat it like any other curve. The key is only ever `true`; an ordinary curve leaves it out.

Optional on a circle that is not construction:

- `fit`: what the hole or peg it makes is for, so a printer can print it at a size that fits. Either `{ "role": "hole", "kind": "bolt-normal" | "bolt-close" | "screw-thread" }` (the circle's diameter is the bolt's metric size), or `{ "role": "hole" | "peg", "kind": "press" | "slide" | "loose", "partner": "bought" | "printed" }`. **A fit never changes the radius**: the design's size is always the circle's radius. No other keys or values.

Shapes such as centre rectangles, polygons and slots are not stored as such: they are ordinary points, lines, arcs and circles, plus horizontal and vertical constraints.

#### 10.4.3 Constraints

`constraints` lists the sketch's constraints, **oldest first**. Each has its own `id`.

| Kind | Fields | Meaning |
|---|---|---|
| `horizontal` | `a`, `b` | Points `a` and `b` have the same y. |
| `vertical` | `a`, `b` | Points `a` and `b` have the same x. |
| `coincident` | `a`, `b` | Points `a` and `b` are in the same place. |
| `fix` | `point` | The point stays where it is (its saved coordinates). |
| `distance` | `a`, `b`, `value` | A dimension: points `a` and `b` are `value` mm apart. Used for a line's length, two points' distance and an arc's radius (its centre and start). |
| `diameter` | `circle`, `value` | A dimension: the circle's diameter is `value` mm. The circle's `radius` MUST equal `value` / 2 exactly. At most one per circle. |

`a` and `b` are two different points of the same sketch. Dimension values are from 0.001 to 200,000,000 mm. A constraint MUST NOT name a point that is pinned or that a projection made (10.4.5), and a diameter MUST NOT size a projected circle: those points follow a body instead. (Design data version 17, SL #532, coming, relaxes this: a constraint may name such a point beside one of the sketch's own points.)

#### 10.4.4 What "saved solved" means for a reader

A reader that only shows a sketch uses the saved point coordinates as they are. A reader that edits a sketch must solve the constraints again after each change. The saved coordinates are a valid solution and the starting point; when the constraints have several solutions, the one nearest the saved coordinates is meant.

#### 10.4.5 Pins and projections

These tie sketch points to edges of bodies built earlier in the timeline, by name (10.11).

`pins`: `{ "point", "kind", "name", "feature"? }`. The point (one of the sketch's points, each pinned at most once) sits at a place on a body's edge: `kind` is `endpoint` (a corner; `name` is a vertex name, edge names joined by `&`), `midpoint` (the middle of an edge) or `centre` (the centre of a round edge); `name` is an edge name without `&` for the last two. `feature` is the item whose body the edge is on (a solid item before the sketch, or a deleted one). It is left out only on a sketch on a face, for the face's own item. On every rebuild a pinned point moves to where its named place now is, seen straight along the sketch's normal. When the name finds nothing, the point stays where it is and the sketch warns "point lost".

`projected`: `{ "id", "feature", "edge", "made" }`. `id` is `projection-N` from the counter; `feature` is the item whose body the edge is on; `edge` is the edge's name on that body (the part after `edge:<feature>/`, or a `design:` name); `made` is the curve (or, for an edge seen end on, the point) it made in this sketch. On every rebuild the made curve goes where the edge now is, seen along the sketch's normal; when the edge is lost, it stays where it is with a warning.

The sketch item's `dependsOn` includes every `feature` named here.

#### 10.4.6 Frames and sketches on faces

A **frame** is `{ "origin": [x, y, z], "xAxis": [x, y, z], "normal": [x, y, z] }`: world mm and unit vectors. The y axis is normal × xAxis. A frame MUST have a non-zero normal and an xAxis not along it.

The three origin planes as sketch planes:

| Plane | Origin | Sketch x | Sketch y | Normal |
|---|---|---|---|---|
| `XY` | (0, 0, 0) | world +X | world +Y | +Z |
| `XZ` | (0, 0, 0) | world +X | world +Z | −Y |
| `YZ` | (0, 0, 0) | world +Y | world +Z | +X |

A sketch on a face keeps `face`: `{ "frame", "side", "held"?, "body"? }`.

- `frame`: the frame the sketch was drawn in.
- `side`: 1 when the sketch faces along the frame's normal, −1 against it (a bottom or back face).
- `held`: present only while the face's name finds no face, or two. It is the frame the sketch stays at meanwhile.
- `body`: where earlier Moves had put the face's body when the sketch was drawn (the world frame when none had). On rebuild the drawn frame is carried by what Moves did to the body since.

A sketch on an origin plane MUST NOT have `face`.

### 10.5 Timeline items

Every entry of `timeline.features` is one item:

```json
{
  "id": "feature-1",
  "intent": { "type": "box", "parameters": { "width": 40, "depth": 30, "height": 20 }, "summary": "Box: 40 × 30 × 20 mm" },
  "provenance": { "self": { "workspace": "design", "id": "feature-1", "label": "Box 1" }, "from": [] },
  "dependsOn": [],
  "suppressed": false
}
```

| Field | Meaning |
|---|---|
| `id` | The item's id (10.3). |
| `intent.type` | What the item is: one of the eight types in 10.6. A reader refuses an unknown type. |
| `intent.parameters` | The item's numbers and references (10.6). Lengths in mm, angles in degrees. **This is the source of truth**: everything is built from it. A writer writes every parameter explicitly; nothing has a hidden default beyond what 10.6 states. |
| `intent.summary` | One line for people, lengths always in mm ("Extrude Sketch 1 by 10 mm"). Never read to build anything. |
| `intent.purpose` | Optional free text: why the item is there. |
| `provenance.self` | `{ workspace, id, label }`: the item itself. `label` is the item's name as people read it ("Box 1", "Extrude 2"); there is no other name field. Names are unique ignoring case and at most 40 characters. |
| `provenance.from` | A list of `{ workspace, id, label }`: what it was made from or applied to, in order. For people; never read to build anything. |
| `dependsOn` | The ids of the items it reads, as 10.6 says for each type, **exactly and in that order**. A reader refuses a list that does not match. Every id is an item before this one, or a deleted one. |
| `suppressed` | `true` or `false`. A suppressed item is kept but not built. |

### 10.6 Item types and their parameters

All lengths are mm, all angles degrees. Lengths and sizes are within 1 µm to 1 km (section 7); the app holds those limits when it builds, and an item outside them fails to build rather than refusing the file.

**`box`**: `{ "width", "depth", "height" }`. A solid box with one corner at the world origin and the opposite corner at (width, depth, height). `dependsOn` is empty.

**`cylinder`**: `{ "diameter", "height" }`. A solid cylinder on the Z axis, its bottom on z = 0 and its top at z = height. `dependsOn` is empty.

**`sphere`**: `{ "diameter", "centreZ"? }`. A solid sphere with its centre at (0, 0, centreZ). Without `centreZ` (files before 2026-10-28) the centre is the origin. `dependsOn` is empty.

**`extrude` of a ready-made profile**: `{ "profile", "distance" }`. Sweeps the profile's outline (10.3) along its plane's normal by `distance`. `dependsOn` is `[<profile id>]`. Nothing else is allowed in its parameters.

**`extrude` of a sketch**: `{ "sketch", "distance", "flip"?, "region"?, "operation"?, "bodies"? }`.

- `sketch`: the sketch item it extrudes, before it in the timeline (or deleted: then it builds from `kept`, 10.8, or fails).
- `distance`: how far, in mm. The extrude goes from the sketch's plane along side × normal (side and normal as in 10.4.6; on an origin plane side is 1); its start cap lies on the sketch plane and its end cap `distance` away.
- `flip`: only ever `true`: it goes the other way, its start cap still on the plane. Left out otherwise.
- `region`: which closed region of the sketch it extrudes: `{ "outer": [{ "curve", "reversed" }, ...], "centroid": [x, y] }`. `outer` lists the curves round the region's outside, counter-clockwise, `reversed` true where the region runs a curve from its end to its start; `centroid` is the region's centre of area when it was picked, in sketch mm. Regions inside it are its holes. Without `region` (files before version 9) the extrude takes the sketch's one closed outline. On rebuild the region is found again by its curves, in order from any start, the one with the nearest centroid if two match; failing that, the same curves the other way round; failing that, the one region whose centre is within 10 nm of `centroid` and that still has one of the curves. When none matches, the extrude keeps its last shape with a warning (10.8).
- `operation` and `bodies`, always together: `operation` is `join`, `cut` or `intersect`; `bodies` lists one or more body ids made before it, each once. Join puts the extrude together with those bodies; cut takes the extrude out of each; intersect keeps only what each shares with the extrude. Without them the extrude is a new body.
- `dependsOn`: the sketch, then (with an operation) the items that made the listed bodies, each once, in the order of `bodies`. Without an operation, exactly `[<sketch id>]`.
- Design data version 18 (SL #531, coming) adds `more`: further sketches (and their regions) extruded together into one body.

**`sketch`**: `{ "plane" }`. `plane` is `"XY"`, `"XZ"`, `"YZ"`, or the name of a flat face of a body made before it (`"face:feature-1/top"`, 10.11). The sketch's content is the `sketches` entry with the same id. `dependsOn` is the face's item (for a face sketch), then every item its pins and projections name, each once.

**`move`**: `{ "x", "y", "z", "turnX", "turnY", "turnZ", "pivotX", "pivotY", "pivotZ", "scale"?, "bodies" }`.

- `bodies`: the body ids it moves, at least one, each once, each made before it (or deleted: the Move then fails, naming it).
- The motion, applied to each body in this order: turn `turnX` degrees about the X axis through the pivot (`pivotX`, `pivotY`, `pivotZ`, mm), then `turnY` about Y, then `turnZ` about Z (each turn right-handed: counter-clockwise seen from the axis's positive end looking back); then scale by `scale` about the pivot; then shift by (`x`, `y`, `z`) mm. (Scaling evenly about the pivot gives the same result before or after the turns.)
- `scale`: only when it scales: a number above 0 and never 1. Left out, the scale is 1.
- All nine numbers are always present. No other parameters.
- `dependsOn`: the items that made its bodies, each once, in the order of `bodies`.

**`duplicate`**: `{ "body", "mirror"? }`. A copy of `body` (a body id made before it) as it is at this place in the timeline, as a new body `body:<this item>`. With `mirror` (`"XY"`, `"XZ"` or `"YZ"`) the copy is mirrored across that origin plane. No other parameters. `dependsOn` is exactly the item that made `body`.

**`combine`**: `{ "target", "tools", "operation", "keepTools" }`. `target` is a body id; `tools` a list of one or more body ids, each once, none the target; all made before it. `operation` is `join`, `cut` or `intersect`, applied with each tool in turn, in the order listed. `keepTools`: when `false` the tool bodies are used up (gone after it); when `true` they stay as they were. No other parameters. `dependsOn`: the items that made the target and tools, target first, each once.

Which items make a body of their own: `box`, `cylinder`, `sphere`, `extrude` without an operation, `duplicate` (its body is `body:<item id>`), and an extrude with `join` when a piece holds only the extrude (10.9). A `sketch`, `move`, `combine`, or a `cut` or `intersect` extrude makes no body of its own; Combines and operation extrudes may leave pieces with ids of their own.

### 10.7 What is built: marker and suppression

- `timeline.marker` is `"start"` (nothing is built) or the id of the last item built. Left out, everything is built. Items after the marker are "rolled back": kept, not built. A new item goes in just after the marker, and the marker moves onto it.
- A `suppressed` item is not built. Items built on it (a sketch on its face, an extrude of a suppressed sketch) do not build either and are shown greyed, not failed.
- A design with nothing built is valid.

### 10.8 Kept shapes

`kept` maps the id of an extrude of a sketch to `{ "points", "curves", "placement"? }`: the sketch's points and curves as they were just before the edit that lost the sketch (deleted it, or left it with no outline). While its sketch is lost, the extrude builds from this shape, by its distance now, with a warning. When the sketch makes an outline again, the entry is dropped. `placement`, `{ "plane": <frame>, "side": 1 | -1, "body"?: <frame> }`, is where a sketch not on XY lay, so the kept shape stays there. A kept shape's ids are the sketch's old ones (they may repeat ids still in the sketch; the counter is above them).

### 10.9 Bodies, numbers and pieces

`bodies` lists every body's id and number, in the order the numbers were given: `{ "id", "number", "faces"? }`.

- A body's id is `body:<the item that first made it>`, for example `body:feature-5`.
- A piece split off a body, or a second piece an item leaves, is `body:<the item that split it>/piece:<k>`, k counting from 1.
- An Extrude Join's piece holding only the new extrude is `body:<the extrude>` (from version 16).
- `number` is the number people read in "Body 3". It is **given once**, when the body first appears, and never worked out again: a reorder, a suppress, a rollback, or an earlier body failing leaves it alone. `nextBody` is above every number ever given, so no number is given twice. A deleted item's body loses its number.
- `faces`, only on a piece or an Extrude Join's own body: the sorted names of the body's faces (each face's first name) when it was first numbered. On a rebuild the id goes to the one piece with exactly those faces, so an edit earlier in the timeline never silently moves "Body 4" to another piece. When no piece has them, or two do, the piece gets its number by the item's own order of its pieces, with a warning.

A file edited elsewhere is settled on open as an edit would settle it: a body whose item is gone loses its number, and a body with no number gets the next one (bodies that build first, then the rest, in timeline order).

Which piece keeps which id after a cut, join or intersect, and how pieces are ranked, is defined in `docs/document-model.md`, section 8. A reader that rebuilds MUST follow those rules to give the same ids; a reader that only shows a design does not need them.

### 10.10 View state inside Design data

`hidden` and `shownPlanes` are view state. A reader that only rebuilds geometry MAY ignore them; an editor keeps them.

- `hidden`: what the browser's eyes hide, each once, at least one: body ids, sketch item ids, `origin-x`, `origin-y`, `origin-z`, and the folders `folder-bodies`, `folder-sketches`, `folder-origin`. Written in timeline order (each item's sketch, then its bodies), then axes, then folders; any order opens. A hidden body is still built and keeps its number, but is not drawn, picked or put in a whole-design export. A shut folder hides everything in it.
- `shownPlanes`: the origin planes shown, from `origin-xy`, `origin-xz`, `origin-yz`, each once, at least one. Planes are hidden by default.

A later Design version moves these to the view part (21.2, phase 3).

### 10.11 Names of faces, edges and bodies

References between items are **names**: strings that say which face or edge is meant by how it was made, never by coordinates or by a geometry engine's internal numbering. A sketch's `plane`, a pin's `name`, a projection's `edge`, and the bodies in Move, Combine, Duplicate and extrude parameters are all names or body ids. They are found again on every rebuild.

Ids inside names are escaped with JavaScript's `encodeURIComponent`, so the separators `/ : + > # , ; & ~ @` used below can never come from an id.

**Face names**: `face:<item>/<role>`.

| Item | Roles |
|---|---|
| box | `bottom` (z = 0), `top`, `front` (y = 0), `back`, `left` (x = 0), `right` |
| cylinder | `bottom`, `top`, `side` |
| sphere | `lower`, `upper` (the two halves) |
| extrude of a sketch | `start` (the cap on the sketch plane), `end` (the cap `distance` away), `side:<curve id>` (the side swept from that curve; `side:circle-3#2` for the second run of a curve that a region passes more than once, counted from 1 in `outer` order) |
| extrude of a ready-made profile | `start`, `end`, `side:<kind>-piece-<n>` (side n of the outline, from 0), `side:<kind>-hole-<i>-piece-<n>` (the side of hole i) |
| duplicate of a combined body | `<role>:<source item>`, and `side:<source item>~<curve id>` for a side |

**Split faces**: when a face is cut into several faces with the same name, each piece is written `<name>#<tag>`: the tag is the sorted, comma-joined names of the faces bordering that piece and no other piece of it. An empty tag is written `<name>#`. A reference holding a tag means that piece.

**Edge names**, two forms:

- The design-wide form: `edge:<face name>+<face name>`, the two faces' names (with their tags) sorted. When the same two faces meet more than once: `;ends:` and the sorted names of the faces at the edge's ends. When that still does not tell them apart: `;corner:` and the two faces' names each followed by `@start` or `@end`, sorted, joined by `,`.
- The older per-item form, still written for plain bodies, after `edge:<item>/`: `side:line-4+start` (the edge between two faces, unordered), `side:line-4>side:arc-6` (between two sides, ordered by which side comes first going round), or a corner form `side:line-4@end+side:arc-6@start`. A pin or projection holds only the part after `edge:<item>/`.
- A pin or projection on a combined body holds the design-wide name as `design:` followed by the escaped text after `edge:` (`design:face%3Afeature-1%2Ftop%2Bface%3Afeature-3%2Fside%3Aline-2`), with `feature` the item that made the body.

**Vertex names**: the names of the edges meeting there, joined by `&`.

**Body ids**: as in 10.9.

What a reader must do with names:

- **To display** a design from its caches (12, 13), a reader needs no name rules: the caches carry the names on faces and edges.
- **To rebuild** a design from its history, a reader MUST give every face and edge the name these rules give it, and resolve every reference by name. A name that finds nothing, or finds two, is never guessed: the item holding it keeps its last placement and shows a warning ("plane lost", "plane ambiguous", "point lost", "projection lost"). The full rules (merged faces, split faces, ties, old names) are in `docs/document-model.md`, section 8; every name form ever written still resolves.

### 10.12 What a reader needs, by job

| Job | Needs |
|---|---|
| List what is in a design (items, names, parameters) | Sections 10.1 to 10.7. No geometry. |
| Show a design | The B-rep or mesh cache (sections 12, 13), if present and not stale. Otherwise a rebuild. |
| Rebuild the geometry | All of section 10, the profile outlines (10.3), the placement rules (10.6), a sketch solver (10.4.4), outline and region finding from sketch curves, booleans, and the naming rules (10.11). |
| Edit and save | Everything above, plus the writing rules (10.1, 10.3) and keep-unknown (6.2). |

Stored things that are snapshots, not truth, and that a rebuild recomputes: `face.frame`, `held` and `body`; kept shapes; region centroids; `bodies[].faces`; solved point coordinates; a circle's radius beside its diameter dimension (these two must agree exactly); the summary text.

### 10.13 Other workspaces

Only Design has data in format 2 today. Each workspace's data has its own `version` and its own rules. A reader MUST keep, byte for byte, the data of a workspace it does not read, and SHOULD say that part of the project was not shown.

## 11. The view part

`view.json`, optional: how the design was last looked at. In draft 0.1 it is a free-form JSON object with `"version": 1` and anything else a writer wants to keep there: camera, display units, colours. A reader MAY ignore it. It MUST NOT change what the design is.

The view part is personal (section 16): it may hold device names. A share export leaves it out. See open question 2.

## 12. The B-rep cache part

> **Draft.** Shapes allowed today: planes, cylinders and spheres for faces; lines, circles and ellipses for edges. More shapes come with later minor versions.

`brep.json`, optional: the exact shape of every body, as last built, so a reader can show and measure a design without rebuilding it. It is our own documented format, not a copy of any program's internal data. It is a cache: the history is always the truth (section 14).

```json
{
  "version": 1,
  "source": { "historySha256": "<64 hex>", "kernel": "0.33.45" },
  "bodies": [
    {
      "id": "body:feature-1",
      "number": 1,
      "vertices": [[0, 0, 0], [40, 0, 0]],
      "edges": [ { "name": "edge:face:feature-1/bottom+face:feature-1/front", "curve": { "type": "line" }, "start": 0, "end": 1 } ],
      "faces": [ { "name": "face:feature-1/bottom", "surface": { "type": "plane", "origin": [0, 0, 0], "xAxis": [1, 0, 0], "normal": [0, 0, -1] }, "loops": [[0, 1, 2, 3]] } ]
    }
  ]
}
```

- `version`: 1. `source`: the same object as the part's `source` in the manifest.
- `bodies`: each built body, with its `id` and `number` from the history (10.9).
- `vertices`: points in world mm.
- `edges`: each with a `name` (starting `edge:`), a `curve`, and `start` and `end` vertex indices. Curve types: `line` (straight between its vertices), `circle` (`centre`, `normal`, `radius`), `ellipse` (`centre`, `normal`, `majorAxis` (a vector whose length is the major radius), `minorRadius`). A closed curve has `start` equal to `end`. Edge direction is from `start` to `end`; round curves run counter-clockwise about `normal`.
- `faces`: each with a `name` (starting `face:`), a `surface`, and `loops`. Surface types: `plane` (a frame as in 10.4.6; the face's outward normal is `normal`), `cylinder` (`origin`, `axis`, `radius`), `sphere` (`centre`, `radius`). `loops` lists edge loops by edge index, the outer loop first; a negative index `-(i + 1)` means edge i used backwards. Loops run counter-clockwise seen from outside the body.

Numbers are JSON numbers written in shortest round-trip form, so every 64-bit float survives exactly.

A reader validates the structure only: every index in range, every name starting `face:` or `edge:`, every number finite, every coordinate and radius at most 1,000,000 mm in size. A reader MUST drop the part with a warning when any check fails. It does not need to check that the shape is a valid solid; that is the job of the program that made it.

## 13. The mesh cache parts

`mesh.json` with `mesh.bin`, optional: a triangle mesh of every body for quick display. Like the B-rep part it is a cache.

```json
{
  "version": 1,
  "source": { "historySha256": "<64 hex>", "kernel": "0.33.45" },
  "data": "mesh.bin",
  "bodies": [
    {
      "id": "body:feature-1",
      "number": 1,
      "faces": ["face:feature-1/bottom", "face:feature-1/top"],
      "positions": { "offset": 0, "count": 8 },
      "indices": { "offset": 96, "count": 36 },
      "triangleFaces": { "offset": 240, "count": 12 },
      "min": [0, 0, 0],
      "max": [40, 30, 20]
    }
  ]
}
```

- `data`: the path of the `mesh-data` part (role `mesh-data`, media type `application/octet-stream`).
- `positions`: `count` vertices from byte `offset` of the data part, each three little-endian 32-bit floats x, y, z in world mm.
- `indices`: `count` little-endian unsigned 32-bit integers, three per triangle, counter-clockwise seen from outside. `count` is a multiple of 3.
- `triangleFaces`: one little-endian unsigned 32-bit integer per triangle, an index into this body's `faces` list, so each triangle keeps its face's name.
- `faces`: the face names, as in the history's naming (10.11).
- `min`, `max`: the body's bounding box in mm, so a viewer can frame it without reading the data.
- Offsets are multiples of 4.

A reader MUST check: every range inside the data part; every index below the body's vertex count; every face index below the length of `faces`; every float finite. It MUST drop both mesh parts with a warning when any check fails. The mesh-data part is stale whenever its mesh part is.

32-bit floats keep about seven significant digits: enough for display, not for measuring. A reader that measures uses the B-rep cache or a rebuild.

## 14. Stale cache detection

A cache is only true for the history it was made from. Each `brep` and `mesh` part carries `source.historySha256`, the history part's `sha256` when the cache was made, and `source.kernel`, the geometry engine's version.

- When `source.historySha256` differs from the history part's `sha256` in this manifest, the cache is **stale**. A reader MUST drop it with a warning and never show it as current. It MAY show it marked "out of date" while it rebuilds.
- When the hashes match, the cache shows the history as built by `source.kernel`. A reader that rebuilds MAY compare its own result with the cache, as a check that both programs built the same shape. A difference is a warning, never a reason to refuse the file.
- An editor that changes the history MUST drop or rebuild the caches before saving.

Because the history is written byte-for-byte deterministically (10.1), any change to the history, even only to formatting, changes its hash and makes the caches stale. This is on purpose: a cache is never trusted for a history it was not made from.

## 15. Integrity

Every part's `sha256` is the SHA-256 of its unpacked bytes, in 64 lower-case hex digits. A reader MUST check it when it opens the part.

| Part | On mismatch |
|---|---|
| `history` | Refuse the file ("this file is damaged"). |
| `brep`, `mesh`, `mesh-data` | Drop the part with a warning. |
| `view`, `thumbnail` | Drop the part with a warning. |
| `extension`, unknown roles | Drop with a warning (a writer MUST NOT write a part it knows is damaged as if it were fine). |

The hashes catch damage and mismatched parts. They do not prove who wrote a file. Signatures may come as a later extension.

## 16. Personal fields and the share export

Some data is about the person or their device, not the design. A **share export** (a copy made for someone else: a sharing link, the community library, "Export for sharing") removes it. The reference reader offers `stripForShare()`, and a list of the personal JSON paths, so a test can check each one is removed.

| What | Where | Removed by a share export | Note |
|---|---|---|---|
| Author's account id | manifest `document.author.accountId` | yes, when shared by link | The library itself keeps it on the designs it publishes. |
| Any part marked personal | a part entry with `"personal": true` | yes (the part and its manifest entry) | |
| The view part | the part with role `view` | yes (the part and its manifest entry) | May hold device names. |
| Personal extensions | every part whose `extension` starts `spindlelabs.local.`, and those namespaces in `extensionsUsed` and `extensionsRequired` | yes | Local file paths, printer and filament unit settings, fit measurements, AI chats and prompts. |
| Undo history | never in the file | nothing to remove | Kept only in the browser. |
| Earlier versions, unsaved-changes journal | never in the file | nothing to remove | Kept only in the browser. |

Personal JSON paths, for tests (`*` means every entry):

```
document.author.accountId
parts[*] where personal == true
parts[*] where role == "view"
parts[*] where extension starts with "spindlelabs.local."
extensionsUsed[*] starting with "spindlelabs.local."
extensionsRequired[*] starting with "spindlelabs.local."
```

A share export changes no byte of the history part, so the caches stay valid. If personal data is ever found to be needed inside the history part, it moves out to a personal extension first (open question 3).

## 17. Security considerations

A file may come from anyone. A reader MUST treat it as hostile.

- **No executable content.** The format holds data only: no scripts, macros, formulas that run, or links that are followed on open. The timeline is a list of declarative operations. A reader MUST NOT run anything from a file, and MUST NOT fetch anything from the network because of a file's content.
- **Zip bombs.** The limits in 4.4 (entry count, unpacked size per entry and in total, compression ratio) are checked before unpacking and while unpacking.
- **Path tricks.** The name rules in 4.3 stop entries from escaping the folder a tool unpacks to, and stop two entries from landing on one file on a case-insensitive disk. A reader never needs to write entries to disk at all.
- **Header tricks.** Local headers that disagree with the central directory, zip64, encryption, split archives and unknown compression methods are refused (4.1).
- **Duplicate JSON keys** are refused in every JSON part, so two readers can never see different values in the same file.
- **Nesting** of JSON is at most 256 deep; files at most the sizes in 4.4 (and 64 MiB for a plain file).
- **Numbers.** JSON cannot hold NaN or the infinities. A reader also refuses a number too large for a 64-bit float.
- **Text.** All text MUST be valid UTF-8. A reader MUST refuse invalid UTF-8 in any JSON part or entry name.
- **Messages.** A reader quoting a value from a file in a message turns it into text safely and never runs a method the file names.
- **Integrity** (section 15) catches damage, not forgery.
- **Privacy.** Personal fields are listed (section 16) so a shared copy never carries them by accident.

## 18. File extension, media types, icon and double-click opening

- **Extension:** `.spindle`, for both flavours. It clashes with no known file type. (`.spl` and `.slp` were considered and rejected: both are already used by other programs.) Readers also open the legacy names in section 3.
- **Media types:** `application/vnd.spindlelabs.project+zip` (package) and `application/vnd.spindlelabs.project+json` (plain). Both are in the vendor tree and not yet registered with IANA; registration is planned in phase 3 (21.2), with the magic bytes of section 3, the extension, and section 17 as its security considerations.
- **Icon:** the operating system's file icon comes from the app (its web app manifest, or a desktop wrapper later), never from the file. The thumbnail part is for previews inside file browsers and the library.
- **Double-click opening:** the web app can ask to handle `.spindle` files through the web app manifest's file handlers (`file_handlers`, with `launchQueue` in the page). This works only in Chromium-based desktop browsers (Chrome, Edge, Opera), only once the user has **installed** the app, and only after the browser asks the user's permission. It does not work in Firefox, in Safari, on iOS, or on Android. So **Open and drag-and-drop stay the main way to open a file** on every platform; double-click is an extra for those who installed the app. A desktop wrapper could later register the extension and media types with the operating system for everyone else.

## 19. Example package

A box and an extrude of a sketch, in a package holding the history part and a thumbnail.

Entries, in order: `mimetype`, `manifest.json`, `project.json`, `thumbnail.png`.

### 19.1 Example manifest

```json
{
  "document": {
    "author": { "displayName": "maker_one" },
    "created": "2026-11-11T09:30:00Z",
    "derivedFrom": [
      {
        "author": "plate_person",
        "documentId": "d7f3a2c1-0b9e-4f5a-8c2d-1e6f7a8b9c0d",
        "licence": "CC-BY-4.0",
        "revision": "r12",
        "title": "Simple block",
        "where": "library:lib-48213"
      }
    ],
    "id": "5b1e9c4a-2f7d-4e8b-9a6c-3d0f1e2a4b5c",
    "licence": "CC-BY-4.0",
    "modified": "2026-11-11T10:05:12Z",
    "revision": "r3",
    "title": "Block with tab"
  },
  "extensionsRequired": [],
  "extensionsUsed": [],
  "format": "spindlelabs-project",
  "generator": { "name": "SpindleLabs", "version": "0.52.3" },
  "minReaderVersion": "0.1",
  "parts": [
    {
      "mediaType": "application/vnd.spindlelabs.project+json",
      "path": "project.json",
      "role": "history",
      "sha256": "3f0c8e5a9b2d4c6e8f1a3b5c7d9e0f2a4b6c8d0e1f3a5b7c9d1e3f5a7b9c0d2e",
      "size": 5321
    },
    {
      "mediaType": "image/png",
      "path": "thumbnail.png",
      "role": "thumbnail",
      "sha256": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "size": 14208
    }
  ],
  "units": { "angle": "deg", "axes": "right-handed, Z up", "length": "mm" },
  "version": "0.1"
}
```

(The hashes and sizes here are made up for the example.)

### 19.2 Example history

A 40 × 30 × 20 mm box, a 20 × 20 mm square sketched on XY beside it, and that square extruded 10 mm up as a second body. The sketch is hidden, as the app hides a sketch once it is extruded. The marker is left out, so everything is built.

```json
{
  "formatVersion": 2,
  "links": [],
  "materials": [],
  "name": "Block with tab",
  "units": {
    "length": "mm"
  },
  "workspaces": {
    "design": {
      "bodies": [
        { "id": "body:feature-1", "number": 1 },
        { "id": "body:feature-11", "number": 2 }
      ],
      "hidden": ["sketch-2"],
      "nextBody": 3,
      "nextId": 12,
      "profiles": [],
      "sketches": [
        {
          "constraints": [],
          "curves": [
            { "end": "point-4", "id": "line-7", "kind": "line", "start": "point-3" },
            { "end": "point-5", "id": "line-8", "kind": "line", "start": "point-4" },
            { "end": "point-6", "id": "line-9", "kind": "line", "start": "point-5" },
            { "end": "point-3", "id": "line-10", "kind": "line", "start": "point-6" }
          ],
          "id": "sketch-2",
          "points": [
            { "id": "point-3", "x": 50, "y": 0 },
            { "id": "point-4", "x": 70, "y": 0 },
            { "id": "point-5", "x": 70, "y": 20 },
            { "id": "point-6", "x": 50, "y": 20 }
          ]
        }
      ],
      "timeline": {
        "features": [
          {
            "dependsOn": [],
            "id": "feature-1",
            "intent": {
              "parameters": { "depth": 30, "height": 20, "width": 40 },
              "summary": "Box: 40 × 30 × 20 mm",
              "type": "box"
            },
            "provenance": {
              "from": [],
              "self": { "id": "feature-1", "label": "Box 1", "workspace": "design" }
            },
            "suppressed": false
          },
          {
            "dependsOn": [],
            "id": "sketch-2",
            "intent": {
              "parameters": { "plane": "XY" },
              "summary": "Sketch 1 on the XY plane",
              "type": "sketch"
            },
            "provenance": {
              "from": [],
              "self": { "id": "sketch-2", "label": "Sketch 1", "workspace": "design" }
            },
            "suppressed": false
          },
          {
            "dependsOn": ["sketch-2"],
            "id": "feature-11",
            "intent": {
              "parameters": {
                "distance": 10,
                "region": {
                  "centroid": [60, 10],
                  "outer": [
                    { "curve": "line-7", "reversed": false },
                    { "curve": "line-8", "reversed": false },
                    { "curve": "line-9", "reversed": false },
                    { "curve": "line-10", "reversed": false }
                  ]
                },
                "sketch": "sketch-2"
              },
              "summary": "Extrude Sketch 1 by 10 mm",
              "type": "extrude"
            },
            "provenance": {
              "from": [{ "id": "sketch-2", "label": "Sketch 1", "workspace": "design" }],
              "self": { "id": "feature-11", "label": "Extrude 1", "workspace": "design" }
            },
            "suppressed": false
          }
        ]
      },
      "version": 16
    }
  }
}
```

The objects are shown here on fewer lines to save space. A real file has one key per line (10.1), so its bytes, and its `sha256`, are those of the app's own output.

What it builds, worked by hand: the box fills x 0 to 40, y 0 to 30, z 0 to 20 (10.6), volume 40 × 30 × 20 = 24,000 mm³. The square runs counter-clockwise (50, 0), (70, 0), (70, 20), (50, 20) on XY, area 400 mm², centroid (60, 10). Extruded 10 mm along +Z (XY's normal), it fills x 50 to 70, y 0 to 20, z 0 to 10, volume 4,000 mm³, apart from the box (its nearest x is 50, the box ends at 40). Its faces are `face:feature-11/start` (z = 0), `face:feature-11/end` (z = 10), and `face:feature-11/side:line-7` (y = 0) to `side:line-10` (x = 50).

## 20. Ideas from other formats

Ideas, not text, were taken from these formats. We thank their authors.

- **3MF**: a package with one required part and optional parts beside it; extensions as namespaces, ignored unless marked required; one unit for the whole model.
- **glTF 2.0**: `extensionsUsed` and `extensionsRequired`; a minimum reader version beside the file's version; geometry as JSON pointing into a little-endian binary buffer, with bounding boxes.
- **OpenDocument and EPUB packaging**: an uncompressed `mimetype` entry first, so a file can be recognised from its first bytes; a manifest listing every entry; strict entry name rules.
- **STEP, ISO 10303-55 (the concept)**: sending the procedural history and the exact shape together, so the shape can check the rebuild.

## 21. Migration plan and data version history

### 21.1 Plain to package

Converting a plain file into a package is lossless: the history part's bytes are the plain file's bytes, unchanged. The reference reader's tests check that `package(plain).history` equals `plain` byte for byte, and that taking the history part out gives the plain file back.

### 21.2 Phases

| Phase | What changes | What stays |
|---|---|---|
| 0 (now) | This draft spec and the reference reader (`packages/open-format/`). | The app is unchanged: it saves and opens plain JSON only. |
| 1 | The app opens packages: it reads the history part and ignores the caches. Needs only the reader. | The app still saves plain JSON. |
| 2 | The app saves packages: the history, a thumbnail, and a B-rep cache once designs hold shapes that are slow to rebuild. "Save as plain JSON" stays for one release. | Plain JSON opens for ever. |
| 3 | A new Design data version moves view state (`hidden`, `shownPlanes`) to the view part. A JSON Schema is published for every Design version. The media types are registered with IANA. Double-click opening through the web app's file handlers (installed desktop Chromium only) and the OS icon. | Old files still open and upgrade. |

### 21.3 Data version history

The outer project format:

| Version | What changed |
|---|---|
| 1 | The first format: name, units, materials, workspaces. |
| 2 | `links` added. Version 1 files read with `"links": []`. |

Design data (`workspaces.design.version`). From version 8 on, most versions add no new field shape: they mark that a new kind of value may now appear, and an older-numbered file holding it is refused. A reader upgrades an older file by every step after its version, in order.

| Version | What changed | Upgrade from the version before |
|---|---|---|
| 1 | Profiles and features only. | — |
| 2 | Sketches and the id counter `nextId`. | `nextId` = 1 + the largest number in any id; `sketches` empty. |
| 3 | Every solid feature is its own body; the timeline `marker`. | Every solid feature but the last becomes suppressed (version 2 showed only the last). |
| 4 | Presets get short names ("Box 1"). | Names exactly of the old form "Feature N (type)" become short names, with their copies in other items. |
| 5 | `bodies` and `nextBody`: body numbers given once. | Bodies numbered by build order, then suppressed and rolled-back ones. |
| 6 | Bodies named by body id (`body:feature-3`) in `hidden` and in a Move's new `bodies`. | Hidden items become their bodies' ids; each Move gets `bodies` from its `dependsOn`. |
| 7 | A ready-made profile's side names include its shape (`side:l-bracket-piece-2`). | Every such name in a face sketch's plane, pins and projections gains the shape. |
| 8 | Construction curves and dimensions may appear. | None. |
| 9 | An extrude's `region` may appear. | None. |
| 10 | An extrude's `operation` and `bodies` may appear. | None. |
| 11 | `duplicate` items may appear. | None. |
| 12 | A Move's `scale` and a Duplicate's `mirror` may appear. | None. |
| 13 | `bodies[].faces` for pieces may appear. | None (filled on the next build). |
| 14 | A circle's `fit` may appear. | None. |
| 15 | Design-wide edge names (`design:`) in pins and projections may appear. | None. |
| 16 | An Extrude Join's piece holding only the extrude is `body:<the extrude>`. | Every `body:<join>/piece:1` becomes `body:<join>`, and `piece:k` becomes `piece:(k − 1)`, wherever a body is named. |
| 17 (coming, SL #532) | A constraint may name a pinned or projected point beside one of the sketch's own points. | None. |
| 18 (coming, SL #531) | An extrude of a sketch may extrude several sketches together (`more`). | None. |

## 22. Open questions for Ben

1. **Default licence.** `document.licence` is required. Which value should the app write for a design that has never been shared: `none` (all rights reserved, until the author chooses) or `CC-BY-4.0` (the library's default)?
2. **The whole view part is personal.** A shared copy then loses its camera and colours too. Should only some view fields be personal (device names) so a shared copy keeps its look?
3. **Personal data inside the history.** Nothing in the history part is personal today. If something ever is (for example a printer's name in a fit), should it be moved to a `spindlelabs.local.` extension before it ships, so the share export never has to change the history?
4. **Which Design version to write.** Versions 8 to 15, 17 and 18 only mark that new values may appear. Should a writer write the lowest version its data needs, so older programs open more files, or always the newest, as the app does now?
5. **Title.** `document.title` duplicates the project's `name`. Keep both (the manifest readable without opening the history), or drop `title`? Is 200 characters the right limit?
6. **Media types of the cache and view parts.** This draft uses `application/json` and `application/octet-stream`. Should they get their own vendor types?
7. **Duplicate keys in plain files.** The spec refuses duplicate keys; the app's JSON parser today keeps the last one silently. Should the app start refusing them in plain files too (a change of behaviour for any hand-edited file holding one)?
8. **The outer `units.length`.** It is stored and checked but changes nothing. Retire it in a later outer format version, with display units moving to the view part?
9. **Mesh precision.** 32-bit floats lose detail far from the origin (about 0.06 mm at 1 km). Fine for a display cache, or should positions be relative to each body's bounding box?
