// Design's browser panel, read from the Design document (document.ts):
// the timeline's items in build order, the sketches and profiles, the
// bodies they make, and the origin's planes and axes. A pure function of the document, so step 24's
// longer timeline only adds rows here.

import { summaryInUnit, type Feature, type GeometryReference, type Unit } from "@fission/core";
import { ICONS, type IconName } from "@fission/ui";
import { BUILD_AREA_LABEL, BUILD_AREA_ROW, BUILD_AREA_TITLE } from "@fission/print";
import { bodyHidden, bodyIdOf, bodyItem, bodyNumbers, buildingItems, combineBodies, EYE_FOLDERS, extrudeOperation, isCombineItem, isPiece, isHidden, isSketchItem, makesBody, numberedWhenBuilt, ORIGIN_PLANES, presetKinds, profileLabel, type DesignDocument } from "./document.ts";
import { bodyReference, profileReference } from "./references.ts";
import { sketchItem } from "./sketch.ts";

export interface BrowserNode {
  /** Stable within the document: a feature's id, "body-1", "origin-xy"… */
  id: string;
  label: string;
  /** The row's tooltip when it is not its label alone: an item's short name, and its description under it ("Box 1\nBox: 40 × 30 × 20 mm", U0e). */
  title?: string;
  /** Groups have children (possibly none); leaves are rows a click highlights. */
  children?: BrowserNode[];
  /** A group shown folded until the user opens it (U0a, like Fusion's browser). */
  startsFolded?: boolean;
  /** The icon before its words (U0f3, like Fusion's browser): a folder for a group, the item's own for a row. */
  icon: IconName;
  /**
   * The row's eye (U0f3; Ben 2026-10-29, on everything that is drawn, as in
   * Fusion): whether its own eye is shut. On Body, sketch and origin rows
   * and the Sketches, Bodies and Origin folders; left out on the Timeline
   * and its rows, and the Profiles and theirs (drawn by nothing of their own).
   */
  hidden?: boolean;
  /** Whether its folder's eye is shut, so the row is not drawn whatever its own eye says (dimmed); left out when not. */
  folderHidden?: boolean;
}

/** The origin every part is built on; the same for every document. */
const ORIGIN: readonly BrowserNode[] = [
  { id: "origin-xy", label: "XY plane", icon: "plane" },
  { id: "origin-xz", label: "XZ plane", icon: "plane" },
  { id: "origin-yz", label: "YZ plane", icon: "plane" },
  { id: "origin-x", label: "X axis", icon: "axis" },
  { id: "origin-y", label: "Y axis", icon: "axis" },
  { id: "origin-z", label: "Z axis", icon: "axis" },
];

/** A timeline item's icon, as its toolbar button's: a preset's own shape's (the slot's for a slot, though an extrude of its profile), else a sketch's or an extrude's; any other feature the plain feature icon. */
export function itemIcons(doc: Pick<DesignDocument, "profiles">): (f: Feature) => IconName {
  const kindOf = presetKinds(doc);
  return (f) => {
    const name = kindOf(f) ?? f.intent.type;
    return Object.hasOwn(ICONS, name) ? (name as IconName) : "feature";
  };
}

/**
 * The solid features that build (`builds`: not suppressed, not after the
 * rollback marker, their sketch there), in build order: each makes a body
 * (24d1), each with its own number (35e), all drawn (24d3b).
 */
export function bodyFeatures(document: DesignDocument): Feature[] {
  const building = buildingItems(document);
  return document.timeline.features.filter((f) => makesBody(f) && building.has(f));
}

/** No feature failed: the browser before any rebuild has answered. */
const NONE_FAILED: ReadonlySet<string> = new Set();

/** One body of the design: its id, and the item a Body row stands for (the item that made it; a Combine's piece, the Combine). */
export interface DesignBody {
  body: string;
  feature: Feature;
}

/**
 * The design's bodies, in the order their items come in the timeline
 * (step 35f1): every body an item that builds makes, unless the last
 * rebuild failed it (`failed`, its ids); a Combine that builds and did not
 * fail uses up its tools (unless it keeps them), keeps its target's id,
 * and adds the pieces the data numbers for it (`numberPieces`) that the
 * rebuild made (`failed` holds the ids of numbered pieces it didn't). A
 * Combine whose target or tools are not there fails in the rebuild, which
 * says so in `failed`. Which of the bodies an Extrude Join picked are
 * still bodies after it is the rebuild's to say (`failed` holds a mark for
 * each, `failedIds`): a body it does not reach stays as it was, and the
 * rest are joined into the earliest made of them (SL #538 item 2: read
 * from the data alone, as "every body after the first picked is used up",
 * a body built and drawn had no row and was left out of the STL).
 */
export function designBodies(document: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): DesignBody[] {
  const building = buildingItems(document);
  const out = new Map<string, DesignBody>();
  const pieces = new Map<string, string[]>();
  const numbered = new Set((document.bodies ?? []).map((b) => b.id));
  for (const b of [...(document.bodies ?? [])].sort((x, y) => x.number - y.number))
    if (isPiece(b.id)) pieces.set(bodyItem(b.id)!, [...(pieces.get(bodyItem(b.id)!) ?? []), b.id]);
  for (const f of document.timeline.features) {
    if (!building.has(f) || failed.has(f.id)) continue;
    if (makesBody(f)) {
      out.set(bodyIdOf(f.id), { body: bodyIdOf(f.id), feature: f });
      // An extrude of several profiles apart (version 18): its other bodies are its pieces, once numbered.
      for (const piece of pieces.get(f.id) ?? []) if (!failed.has(piece)) out.set(piece, { body: piece, feature: f });
    }
    else if (isCombineItem(f)) {
      const { target, tools, keepTools } = combineBodies(f);
      if (![target, ...tools].every((b) => out.has(b))) continue;
      if (!keepTools) for (const t of tools) out.delete(t);
      for (const piece of pieces.get(f.id) ?? []) if (!failed.has(piece)) out.set(piece, { body: piece, feature: f });
    } else {
      // An extrude with an operation (version 10): its own body never stays.
      const op = extrudeOperation(f);
      if (op === null || !op.bodies.every((b) => out.has(b))) continue;
      if (op.operation === "join") {
        // The bodies the rebuild says are still bodies after it; until one has answered, the one every body it picked
        // is joined into when it reaches them all: the earliest made (docs/document-model.md section 8).
        const left = op.bodies.filter((b) => failed.has(stays(f.id, b)));
        const keep = left.length > 0 ? left : [earliestMade(document, op.bodies)];
        for (const b of op.bodies) if (!keep.includes(b)) out.delete(b);
      }
      // Its piece holding only the extrude is its own body (version 16), once numbered.
      const own = bodyIdOf(f.id);
      if (op.operation === "join" && !failed.has(own) && numbered.has(own)) out.set(own, { body: own, feature: f });
      for (const piece of pieces.get(f.id) ?? []) if (!failed.has(piece)) out.set(piece, { body: piece, feature: f });
    }
  }
  return [...out.values()];
}

/** In what the last rebuild said (`failedIds`): body `body` is still a body after Extrude Join `join`. No item's or body's id reads so. */
const stays = (join: string, body: string) => `stays:${join}>${body}`;

/** The earliest made of `bodies` (section 8's rule 1 for an Extrude Join): by its item's place in the timeline, then the item's own body before its pieces, by number. */
function earliestMade(document: DesignDocument, bodies: readonly string[]): string {
  const key = (b: string): [number, number] => [document.timeline.features.findIndex((f) => f.id === bodyItem(b)), isPiece(b) ? Number(b.slice(b.lastIndexOf(":") + 1)) : 0];
  return [...bodies].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1])[0];
}

/**
 * What the last rebuild said that the data alone can't, as `designBodies`
 * reads it: the ids of the items whose result is failed; a mark for each
 * body an Extrude Join that built picked and left a body (its result's
 * `bodies`: a body it does not reach, and the earliest made of each lot it
 * joins); and the ids of the numbered pieces (a Combine's, an Extrude
 * Join's own body) the design should hold now but the rebuild didn't make
 * (`built`, the ids of the bodies it holds). A piece a later
 * item used up is not held either, and it did not fail: counting it as
 * failed made `designBodies` skip the item that used it, so that item's
 * new pieces had no row and were left out of the STL (#499). So only the
 * pieces the design's bodies would hold with nothing but the failed items
 * left out are looked for.
 */
export function failedIds(document: DesignDocument, results: Readonly<Record<string, { status: string; bodies?: readonly string[] }>>, built: ReadonlySet<string>): Set<string> {
  const failed = Object.keys(results).filter((id) => results[id].status === "failed");
  const makers = new Map(document.timeline.features.map((f) => [f.id, f] as const));
  const left = document.timeline.features.flatMap((f) => {
    const [op, r] = [extrudeOperation(f), results[f.id]];
    return op?.operation === "join" && r?.status === "built" ? op.bodies.filter((b) => r.bodies?.includes(b)).map((b) => stays(f.id, b)) : [];
  });
  const items = [...failed, ...left];
  const absent = designBodies(document, new Set(items)).flatMap(({ body }) => (numberedWhenBuilt(body, makers.get(bodyItem(body)!)) && results[bodyItem(body)!]?.status === "built" && !built.has(body) ? [body] : []));
  return new Set([...items, ...absent]);
}

/**
 * The Bodies group's rows: one for each feature in `bodyFeatures` that the
 * last rebuild did not fail (`failed`, its ids), "body-n" and "Body n", n
 * the body's own number (35e, `bodyNumbers`), so a body keeps it when one
 * before it fails, is suppressed or is reordered. A feature that failed has no body, so no row (bug hunt
 * 2026-10-19, finding 5: its row selected a body that did not exist).
 */
export function bodyRows(document: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): { id: string; label: string; feature: Feature; body: string }[] {
  const numbers = bodyNumbers(document);
  return designBodies(document, failed).flatMap(({ body, feature }) => {
    const n = numbers.get(body);
    return n === undefined ? [] : [{ id: `body-${n}`, label: `Body ${n}`, feature, body }];
  });
}

/**
 * What the Combine panel and its questions call `body` (SL #677 item 5):
 * its Bodies row ("Body 2") when the list shows it, else its item's name
 * ("Box 2", or "a piece of Combine 1"): an edited Combine's tools are used
 * up, so the list has no row for them, and a number it doesn't show would
 * send a person looking for a body that isn't there. A body whose item is
 * deleted is named as `by` (the Combine using it) remembers it, then
 * "(deleted)"; never a raw id.
 */
export function bodyLabel(document: DesignDocument, body: string, failed: ReadonlySet<string> = NONE_FAILED, by?: Feature): string {
  const row = bodyRows(document, failed).find((r) => r.body === body);
  if (row !== undefined) return row.label;
  const id = bodyItem(body);
  const item = document.timeline.features.find((f) => f.id === id);
  if (item !== undefined) return isPiece(body) ? `a piece of ${item.provenance.self.label}` : item.provenance.self.label;
  const was = by?.provenance.from.find((x) => x.id === id)?.label;
  return was === undefined ? "a deleted body" : `${was} (deleted)`;
}

/**
 * The Bodies rows' tags while Combine is open (SL #677 item 5): "Target"
 * on the target's row and "Tool" on each tool's, by row id ("body-2"),
 * in the list's order; words, so they don't rest on colour alone.
 */
export function combineRowTags(document: DesignDocument, failed: ReadonlySet<string>, target: string | null, tools: readonly string[]): Map<string, "Target" | "Tool"> {
  const tags = new Map<string, "Target" | "Tool">();
  for (const r of bodyRows(document, failed)) {
    if (r.body === target) tags.set(r.id, "Target");
    else if (tools.includes(r.body)) tags.set(r.id, "Tool");
  }
  return tags;
}

/**
 * The browser's tree for a document. Each feature is a row in build order
 * by its short name ("Box 1", U0e), its tooltip the name with its
 * description (intent summary) under it, so a name cut short is still
 * there whole; a suppressed one says so. The
 * Timeline and the Origin start folded (U0a): the bar along the bottom
 * shows the timeline, and the origin's planes are seldom needed. Each
 * body the last rebuild built is a row (`bodyRows`; `failed` the ids it failed). Each profile
 * is a row by its own id ("profile-1"), selectable as an outline. Each
 * sketch is a timeline row by its id and a row in Sketches by
 * "sketches/<id>", so no two rows share an id.
 */
export function browserTree(document: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED, buildAreaShown = false, unit: Unit = "mm"): BrowserNode[] {
  const features = document.timeline.features;
  // Each sketch's item by its id, looked up once (S2: a search per sketch took the timeline's length squared).
  const items = new Map<string, Feature>();
  for (const f of features) if (isSketchItem(f) && !items.has(f.id)) items.set(f.id, f);
  const sketchItemOf = (id: string) => items.get(id) ?? sketchItem(document, id);
  const iconOf = itemIcons(document);
  // A row's eye: its own (an origin plane's shut until shown), and its folder's when shut.
  const planes: readonly string[] = ORIGIN_PLANES;
  const eye = (id: string, folder?: string) => ({
    hidden: planes.includes(id) ? !(document.shownPlanes?.includes(id) ?? false) : isHidden(document, id),
    ...(folder !== undefined && isHidden(document, folder) ? { folderHidden: true } : {}),
  });
  return [
    {
      id: "timeline",
      label: "Timeline",
      icon: "folder",
      // The bar along the bottom shows every item already, with the same menu and double-click.
      startsFolded: true,
      children: features.map((f) => {
        const off = f.suppressed ? " (suppressed)" : "";
        return { id: f.id, label: `${f.provenance.self.label}${off}`, title: `${f.provenance.self.label}${off}\n${summaryInUnit(f.intent.summary, unit)}`, icon: iconOf(f) };
      }),
    },
    {
      id: "sketches",
      label: "Sketches",
      icon: "folder",
      ...eye(EYE_FOLDERS.sketches),
      children: document.sketches.map((s) => {
        const item = sketchItemOf(s.id);
        return { id: `sketches/${s.id}`, label: item.provenance.self.label, title: `${item.provenance.self.label}\n${summaryInUnit(item.intent.summary, unit)}`, icon: "sketch", ...eye(s.id, EYE_FOLDERS.sketches) };
      }),
    },
    { id: "profiles", label: "Profiles", icon: "folder", children: document.profiles.map((p) => ({ id: p.id, label: profileLabel(p), icon: "profile" })) },
    { id: "bodies", label: "Bodies", icon: "folder", ...eye(EYE_FOLDERS.bodies), children: bodyRows(document, failed).map(({ id, label, body }) => ({ id, label, icon: "body", ...eye(body, EYE_FOLDERS.bodies) })) },
    {
      id: "origin",
      label: "Origin",
      icon: "origin",
      ...eye(EYE_FOLDERS.origin),
      // Last, the printer's build area (Ben, 2026-11-01): its eye is a view setting (build-area.ts), shut at first.
      children: [
        ...ORIGIN.map((n) => ({ ...n, ...eye(n.id, EYE_FOLDERS.origin) })),
        { id: BUILD_AREA_ROW, label: BUILD_AREA_LABEL, title: BUILD_AREA_TITLE, icon: "box", hidden: !buildAreaShown, ...(isHidden(document, EYE_FOLDERS.origin) ? { folderHidden: true } : {}) },
      ],
      startsFolded: true,
    },
  ];
}

/**
 * The timeline item a browser row stands for, whose menu (Delete, Suppress,
 * Edit…) and double-click it takes: a Timeline row's own item, a sketch's
 * row in Sketches its sketch item, and (the owner's ask, 2026-10-24) a
 * Body row the feature that makes the body, since every body is made by
 * one feature; deleting it asks first when anything is built from it, as
 * the timeline's rules say. Other rows (profiles, the origin) have none.
 */
export function rowItem(node: string, doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): string | null {
  if (node.startsWith("sketches/")) return node.slice("sketches/".length);
  if (node.startsWith("body-")) return bodyRows(doc, failed).find((r) => r.id === node)?.feature.id ?? null;
  return doc.timeline.features.some((f) => f.id === node) ? node : null;
}

/**
 * The browser rows that stand for selectable geometry, and the reference
 * each selects: "body-n" its body, a profile's row its outline, and (step
 * 24f6) a Timeline row of a solid feature that builds the body it makes,
 * the same as its Body row. A sketch's rows (its Timeline row and its
 * row in Sketches) select its outline once it has a curve (25c1), to copy
 * or hand over; an item that builds no body selects nothing, one the last
 * rebuild failed (`failed`) among them.
 */
export function rowReference(node: string, doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): GeometryReference | null {
  return rowReferences(doc, failed)(node);
}

/**
 * `rowReference` for every row of one document: the bodies and profiles
 * are listed once, so the browser's rows take time in proportion to their
 * number (security audit S2: listing them per row took its square).
 */
export function rowReferences(doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): (node: string) => GeometryReference | null {
  // A hidden body (U0f3) is not drawn, so its rows select nothing: a selection of something unseen.
  const rows = new Map(bodyRows(doc, failed).flatMap((r) => (bodyHidden(doc, r.body) ? [] : [[r.id, r.body] as const])));
  // A solid item's Timeline row selects the body it made, while that body is there (a Combine's piece has no item of its own).
  const solids = new Map([...rows.values()].flatMap((b) => (isPiece(b) ? [] : [[bodyItem(b)!, b] as const])));
  // A profile, and (25c1) a sketch with curves by either of its rows: its outline.
  const outlines = new Set([...doc.profiles.map((p) => p.id), ...doc.sketches.flatMap((s) => (s.curves.length > 0 ? [s.id] : []))]);
  return (node) => {
    const body = rows.get(node);
    if (body !== undefined) return bodyReference(body);
    if (solids.has(node)) return bodyReference(solids.get(node)!);
    const outline = node.startsWith("sketches/") ? node.slice("sketches/".length) : node;
    return outlines.has(outline) ? profileReference(outline) : null;
  };
}

/**
 * What a browser row's eye shuts or opens (`hideRow`'s id): a Body row its
 * body id (Design data version 6), a sketch's row its item, an origin row itself, the Sketches,
 * Bodies and Origin folders theirs (EYE_FOLDERS); null for a row with no
 * eye (the Timeline's, the Profiles').
 */
export function eyeId(doc: DesignDocument, node: string, failed: ReadonlySet<string> = NONE_FAILED): string | null {
  if (node.startsWith("sketches/")) return node.slice("sketches/".length);
  if (node.startsWith("body-")) {
    const row = bodyRows(doc, failed).find((r) => r.id === node);
    return row === undefined ? null : row.body;
  }
  if (ORIGIN.some((n) => n.id === node)) return node;
  return Object.hasOwn(EYE_FOLDERS, node) ? EYE_FOLDERS[node as keyof typeof EYE_FOLDERS] : null;
}
