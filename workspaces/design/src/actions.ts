// Design's verbs in the one action registry (core's actions.ts). Download
// STL, for one body or several: the toolbar's STL button and the AI's
// export_stl command (every body shown) and the verb shown under selected
// bodies all run it. Copy as SVG, for a profile or a sketch: the verb under
// it and Ctrl+C both run it (X6b, 25c1).

import { outlineToSvg, type Action, type ActionOutcome, type ActionRegistry, type ActionTarget, type Feature, type GeometryReference, type OverlayMark, type RepresentationKind, type Selected, type SolidReport, type StlFile, type WorkspaceContext } from "@fission/core";
import { saveFile, STL_KIND } from "@fission/ui";
import { planeSeenAs } from "@fission/viewport";
import { designBodies } from "./browser.ts";
import { bodyHidden, bodyIdOf, bodyNumbers, isDuplicateItem, makesPieces, partFeature, shapeOf, type DesignDocument } from "./document.ts";
import { endStls } from "./move-tool.ts";
import { badgeFor, SOLID_OVERLAY, solidOverlay, stampChecked, touchingWords, type ExportNotes } from "./solid-badge.ts";
import { bodyReference, readDesignReference, readProfileReference } from "./references.ts";
import { designObjects } from "./representations.ts";
import type { Scene } from "./scene.ts";
import { outlineSourceOf } from "./sketch.ts";

export const DOWNLOAD_STL = "design.download-stl";
export const COPY_SVG = "design.copy-svg";

/** The STL-precision overlay: the whole part, while its last export warned. Design clears it on every edit. */
export const STL_OVERLAY = "design.stl-precision";

/** Asks for the file's name and place (the browser's save picker, or a name box), then saves it: the name it was saved under, or false when the user closed the box. */
async function download(bytes: Uint8Array<ArrayBuffer>, name: string): Promise<string | false> {
  const r = await saveFile(document, { suggestedName: name, kind: STL_KIND, bytes });
  if (r.status === "failed") throw new Error(r.message);
  return r.status === "saved" ? r.name : false;
}

/** Hands a file to the user; false (rather than nothing) says they chose not to save it, and a string is the name it was saved under (the person may have typed another). */
export type SaveFile = (bytes: Uint8Array<ArrayBuffer>, name: string) => void | boolean | string | Promise<void | boolean | string>;

/** Puts an SVG file on the clipboard; rejects when the browser refuses. */
export type CopySvg = (svg: string) => Promise<void>;

/**
 * The browser's clipboard: the SVG as an image/svg+xml item where the
 * browser supports one (drawing programs paste the shape), always with the
 * same text as text/plain (text editors and code paste the markup).
 */
async function copyToClipboard(svg: string): Promise<void> {
  const text = new Blob([svg], { type: "text/plain" });
  if (typeof ClipboardItem !== "undefined" && ClipboardItem.supports?.("image/svg+xml"))
    return navigator.clipboard.write([new ClipboardItem({ "image/svg+xml": new Blob([svg], { type: "image/svg+xml" }), "text/plain": text })]);
  return navigator.clipboard.writeText(svg);
}

/** Nothing failed: what a document alone says, before any rebuild has answered. */
const NONE_FAILED: ReadonlySet<string> = new Set();

/**
 * The solid feature a body reference names, when it is one of the bodies
 * shown (`bodyFeatures`, less `failed`: the last rebuild's failed ids);
 * null for a face, an edge, or a body rolled back, suppressed, deleted,
 * failed (25c1: any body shown, not only the part's) or hidden by its eye
 * (U0f3).
 */
export function shownBodyFeature(ref: Selected, doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): Feature | null {
  if (ref.kind !== "body") return null;
  const r = readDesignReference(ref as GeometryReference);
  if (r === null || r.kind !== "body" || failed.has(r.featureId) || bodyHidden(doc, ref.id)) return null;
  return designBodies(doc, failed).find((b) => b.body === ref.id)?.feature ?? null;
}

/**
 * What a selected Design thing can be handed over as. A body shown: its
 * exact solid and a mesh. A profile or a sketch with curves: its exact
 * outline (a sketch's is found by the kernel when asked for, so an open
 * one is refused then, saying why). Faces and edges: nothing yet (a flat
 * face's outline comes with the conversions that need it). A reference to
 * anything no longer shown: nothing.
 */
export function representationsOf(ref: Selected, doc: DesignDocument | undefined, failed: ReadonlySet<string> = NONE_FAILED): RepresentationKind[] {
  if (!doc) return [];
  if (ref.kind === "outline") return outlineSourceOf(ref, doc) ? ["outline"] : [];
  return shownBodyFeature(ref, doc, failed) ? ["solid", "mesh"] : [];
}

/** The selection as action targets; `failed`, the last rebuild's failed ids. */
export function targetsOf(items: readonly Selected[], doc: DesignDocument | undefined, failed: ReadonlySet<string> = NONE_FAILED): ActionTarget[] {
  return items.map((ref) => ({ ref, representations: representationsOf(ref, doc, failed) }));
}

/** What the toolbar's STL button says for a design with no body (24f4). */
export const NO_BODY_STL = "There is no body to download: nothing in the timeline builds.";
/** Why the whole design's STL has nothing in it when every body built is hidden by its eye (U0f3). */
export const ALL_HIDDEN_STL = "There is no body to download: every body is hidden. Show one with its eye in the browser.";

/** Why the whole design's STL is empty (`shownBodyRefs` lists none): every body built is hidden, or nothing builds. */
export const noBodyWords = (doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): string =>
  designBodies(doc, failed).length > 0 ? ALL_HIDDEN_STL : NO_BODY_STL;

/** The reference to the part's body (the last solid feature that builds); null for a design with no body (24f4). */
export function partBody(doc: DesignDocument): Selected | null {
  const part = partFeature(doc);
  return part === null ? null : bodyReference(bodyIdOf(part.id));
}

/** Every body shown, for "the whole design" (the toolbar's STL button, the AI's export_stl; 25c1), in build order; none for a design with no body. */
export function shownBodyRefs(doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): Selected[] {
  return designBodies(doc, failed).flatMap(({ body }) => (bodyHidden(doc, body) ? [] : [bodyReference(body)]));
}

/**
 * What the whole design's STL says of the bodies it leaves out because
 * their eye hides them (built ones only; failed ones are in no STL), by
 * their browser numbers: they were left out without a word (beginner
 * play-test 2026-10-28). Empty when none is hidden.
 */
export function hiddenStlNote(doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): string {
  const numbers = bodyNumbers(doc);
  const hidden = designBodies(doc, failed).flatMap(({ body }) => (bodyHidden(doc, body) && numbers.has(body) ? [numbers.get(body)!] : [])).sort((a, b) => a - b);
  if (hidden.length === 0) return "";
  if (hidden.length === 1) return `Body ${hidden[0]} is hidden, so it is not in the STL: show it with its eye in the browser to include it.`;
  const list = `${hidden.slice(0, -1).join(", ")} and ${hidden.at(-1)}`;
  return `Bodies ${list} are hidden, so they are not in the STL: show them with their eyes in the browser to include them.`;
}

/** "Extrude 1", "Extrude 1 and Combine 2", "Extrude 1, Extrude 2 and Combine 3", "Extrude 1, Extrude 2, Extrude 3 and 2 more". */
function namesWords(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  const shown = names.length > 4 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/**
 * What an export (the STL, `what` "STL"; Slice for printing and its preview, "print") says of the timeline items the
 * last rebuild failed (`failed`, browser.ts `failedIds`: the ones the timeline shows red), by their names, in timeline
 * order: whatever they would have made or changed is not in the file, so the part comes out without it (a failed
 * Extrude Cut's hole was left out without a word, the file still "Checked solid": export hunt 2026-11-12 D). Empty
 * when nothing failed. The file is still made: the person may want what was built, and is told before they use it.
 */
export function failedItemsNote(doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED, what: "STL" | "print" = "STL"): string {
  const names = doc.timeline.features.flatMap((f) => (failed.has(f.id) ? [f.provenance.self.label] : []));
  if (names.length === 0) return "";
  const they = names.length === 1 ? "it" : "them";
  const made = what === "STL" ? `the part is saved without ${they}` : `the part is printed without ${they}`;
  return `${namesWords(names)} failed, so ${names.length === 1 ? "it is" : "they are"} not in the ${what}: ${made}. Fix ${they} in the timeline (red) to include ${they}.`;
}

/** What Download STL returns in Design (35f1 export hunt D): the outcome, with what its export badge says beyond the file's check (`ExportNotes`), when anything. */
export interface DesignOutcome extends ActionOutcome {
  notes?: ExportNotes;
}

/**
 * What the whole design's STL says when it holds more than one body: they are separate shells in one file, and two that
 * touch or overlap make a file that some slicers (our own too) refuse (slicer hunt 2026-10-31, L12). Empty for one body.
 */
export function manyBodiesStlNote(count: number): string {
  if (count < 2) return "";
  return `The ${count} bodies are separate shells in one STL file. If two of them touch or overlap, some slicers refuse the file: Slice for printing sends them one by one, which is safe.`;
}

const STL_HEADER = 80;
const STL_TRIANGLE = 50;

/**
 * Binary STL files joined into one (25c1): an 80-byte header with `name`
 * after "SpindleLabs STL: " (as the kernel writes its own), the sum of their
 * triangle counts, then every file's triangles unchanged, in order. A file
 * whose length disagrees with its count throws, and nothing is written.
 */
export function joinStl(files: readonly Uint8Array[], name: string): Uint8Array<ArrayBuffer> {
  let triangles = 0;
  for (const [i, f] of files.entries()) {
    const n = f.length >= STL_HEADER + 4 ? new DataView(f.buffer, f.byteOffset, f.byteLength).getUint32(STL_HEADER, true) : -1;
    if (n < 0 || f.length !== STL_HEADER + 4 + STL_TRIANGLE * n) throw new Error(`STL file ${i + 1} is ${f.length} bytes, which is not 84 + 50 for each of its triangles`);
    triangles += n;
  }
  if (triangles > 0xffffffff) throw new Error(`${triangles} triangles is more than one STL file can count`);
  const out = new Uint8Array(STL_HEADER + 4 + STL_TRIANGLE * triangles);
  // Spaces after the name, as the kernel pads its header; never "solid" first (that reads as ASCII STL).
  out.fill(0x20, 0, STL_HEADER);
  const text = new TextEncoder().encode(`SpindleLabs STL: ${name}`).subarray(0, STL_HEADER);
  out.set(text, 0);
  new DataView(out.buffer).setUint32(STL_HEADER, triangles, true);
  let at = STL_HEADER + 4;
  for (const f of files) {
    out.set(f.subarray(STL_HEADER + 4), at);
    at += f.length - STL_HEADER - 4;
  }
  return out;
}

/**
 * What Design's own runs add to the context (25c1): the bodies on screen,
 * so the precision overlay marks only the faces of the bodies that warned.
 * Without it (a run from elsewhere) a warning marks every body.
 */
export interface DesignRun extends WorkspaceContext {
  scene?: Scene | null;
  /** What the last rebuild failed (browser.ts `failedIds`): a failed Combine used up none of its bodies, so they can still be downloaded (#500). */
  failed?: ReadonlySet<string>;
}

/** The overlay's marks for the bodies (by body id, 35f1) that warned: their faces on `scene`, or every body when there is no scene or each shown body warned. */
export function warnedMarks(warned: readonly string[], scene: Scene | null | undefined): OverlayMark[] {
  const at = scene ? warned.map((id) => scene.bodies.findIndex((b) => b.body === id)) : [];
  if (!scene || at.some((b) => b < 0) || new Set(at).size === scene.bodies.length) return [{ target: { body: true }, severity: "warning" }];
  return at.flatMap((b) => Array.from({ length: scene.bodies[b].view.faces }, (_, i) => ({ target: { face: scene.faceStart[b] + i }, severity: "warning" as const })));
}

/**
 * Design's verbs; `save` hands a file to the user (the browser's download,
 * or a test's recorder), `copy` puts an SVG on the clipboard (the
 * browser's, or a test's recorder).
 */
export function designActions(save: SaveFile = download, copy: CopySvg = copyToClipboard): Action[] {
  const downloadStl: Action = {
    id: DOWNLOAD_STL,
    workspace: "design",
    label: "Download STL",
    title: "Download the bodies as one binary STL file, for printing or another program. Checks the file is solid (closed, nothing flipped or crossing) and warns when it is not, or when a body is too big for STL's single-precision numbers.",
    kinds: ["body"],
    uses: "mesh",
    count: "many",
    async run(targets, ctx: DesignRun): Promise<ActionOutcome> {
      const doc = ctx.project.workspaces.design as DesignDocument | undefined;
      if (!doc) return { message: "There is no part to download yet.", bad: true };
      if (targets.length === 0) return { message: "Download STL takes at least one body.", bad: true };
      const picked: { body: string; feature: Feature }[] = [];
      const failed = ctx.failed ?? NONE_FAILED;
      // Which body, in a message: its browser row's number (35e: the body's own), never its id.
      const numbers = bodyNumbers(doc);
      for (const target of targets) {
        // Design's own run knows the bodies the last rebuild drew (a failed one is not among them).
        const f = shownBodyFeature(target, doc, failed);
        if (!f || (ctx.scene && !ctx.scene.bodies.some((b) => b.body === target.id))) return { message: `${numbers.has(target.id) ? `Body ${numbers.get(target.id)}` : target.id} is not a body shown in the design, so there is nothing to download.`, bad: true };
        if (!picked.some((p) => p.body === target.id)) picked.push({ body: target.id, feature: f });
      }
      // Build order, whatever order they were picked in: the same bodies make the same file.
      const order = designBodies(doc, failed).map((b) => b.body);
      picked.sort((a, b) => order.indexOf(a.body) - order.indexOf(b.body));
      const features = picked.map((p) => p.feature);
      const kindOf = (f: Feature) => {
        // A Combine's piece is named for no one shape (35f1).
        if (makesPieces(f) || isDuplicateItem(f)) return "body";
        const shape = shapeOf(doc, f).shape;
        return shape === "sketch-extrude" ? "extrude" : shape;
      };
      try {
        const files: StlFile[] = await endStls(ctx.kernel, doc, picked.map((p) => ({ ...p, name: kindOf(p.feature) })));
        const one = features.length === 1;
        const name = one ? kindOf(features[0]) : `${features.length} bodies`;
        const file = `spindlelabs-${one ? name : `${features.length}-bodies`}.stl`;
        const bytes = one ? files[0].bytes : joinStl(files.map((f) => f.bytes), name);
        // The export badge: the kernel checks the file's own bytes, as saved (every body, every corner rounded); a
        // solid one says so in its header. A check that can't run never stops the export, and never says solid.
        let solid: SolidReport | undefined;
        let unchecked = "";
        try {
          solid = await ctx.kernel.call("check_solid", bytes);
        } catch (e) {
          unchecked = `The solid check could not run (${e instanceof Error ? e.message : String(e)}), so the file is not known to be solid.`;
        }
        // Several bodies whose file has problems: each body's own file is checked alone too. When every one is solid, the
        // problems lie between them (they touch or overlap), which the badge says as that, never "Not solid" (hunt D, 2).
        // A body that is not solid alone (or a check that can't run) keeps the file's own verdict.
        let touching: number | undefined;
        if (!one && solid?.verdict === "problems") {
          const alone = await Promise.all(files.map((f) => ctx.kernel.call("check_solid", f.bytes).then((r) => r.verdict, () => "unchecked")));
          if (alone.every((v) => v === "solid")) touching = files.length;
        }
        // Timeline items that failed are not in the file: never stamped or said "checked solid" as if it were the design.
        const missing = failedItemsNote(doc, failed, "STL");
        const notes: ExportNotes = { ...(missing && { missing }), ...(touching !== undefined && { touching }) };
        const saved = await save(solid?.verdict === "solid" && !missing ? stampChecked(bytes, name) : bytes, file);
        if (saved === false) return { message: "Export STL cancelled: nothing was saved.", bad: false };
        const marked = solid ? solidOverlay(solid, touching !== undefined) : null;
        if (marked) ctx.viewport.setOverlay(marked);
        else ctx.viewport.clearOverlay(SOLID_OVERLAY);
        // Mark the bodies that warned on screen too: every face of one moves in single precision.
        const warned = picked.filter((_, i) => files[i].warning);
        if (warned.length > 0)
          ctx.viewport.setOverlay({ id: STL_OVERLAY, label: "Too big for an accurate STL", detail: files.flatMap((f) => (f.warning ? [f.warning] : [])).join("\n"), marks: warnedMarks(warned.map((p) => p.body), ctx.scene) });
        else ctx.viewport.clearOverlay(STL_OVERLAY);
        const place = (body: string) => `Body ${numbers.get(body)}`;
        const warnings = picked.flatMap((p, i) => (files[i].warning ? [one ? files[i].warning! : `${place(p.body)}: ${files[i].warning}`] : []));
        // Touching bodies: their own words in place of the badge's and the several-bodies note (which they say again).
        const between = touching !== undefined ? touchingWords(touching) : null;
        const badge = between ? `${between.title}: ${between.detail.charAt(0).toLowerCase()}${between.detail.slice(1)}` : solid ? (missing && solid.verdict === "solid" ? "What was built is checked solid." : `${badgeFor(solid).title}.`) : unchecked;
        const message = [`Exported ${typeof saved === "string" && saved !== "" ? saved : file}.`, missing, badge, ...warnings, between ? "" : manyBodiesStlNote(features.length)].filter(Boolean).join(" "); // the person sees that it happened, and what the file is called
        const outcome: DesignOutcome = { message, bad: warned.length > 0 || solid?.verdict !== "solid" || missing !== "", ...(solid && { solid }), ...(Object.keys(notes).length > 0 && { notes }) };
        return outcome;
      } catch (e) {
        return { message: e instanceof Error ? e.message : String(e), bad: true };
      }
    },
  };
  const copySvg: Action = {
    id: COPY_SVG,
    workspace: "design",
    label: "Copy as SVG",
    title: "Copy the profile or sketch as an SVG drawing, sized in mm, to paste into a drawing program or a laser cutter's software. Key: Ctrl+C (⌘C on a Mac).",
    kinds: ["outline"],
    uses: "outline",
    count: "one",
    async run(targets, ctx: WorkspaceContext): Promise<ActionOutcome> {
      const doc = ctx.project.workspaces.design as DesignDocument | undefined;
      const [target] = targets;
      if (!doc) return { message: "There is no profile to copy yet.", bad: true };
      if (targets.length !== 1) return { message: `Copy as SVG takes one profile or sketch, not ${targets.length} things.`, bad: true };
      const source = outlineSourceOf(target, doc);
      if (!source) return { message: `${target.id} is not a profile or a sketch with curves, so there is nothing to copy.`, bad: true };
      const id = readProfileReference(target)!;
      const type = source.kind === "profile" ? "design.profile" : "design.sketch";
      const object = designObjects(doc, ctx.kernel).find((o) => o.type === type && o.id === id)!;
      try {
        // Copies out go through the representation registry, like everything handed over.
        const { representation } = await ctx.representations.deliver(object, ["outline"]);
        if (representation.kind !== "outline") throw new Error(`the ${source.kind} came as ${representation.kind}, not an outline`);
        // A sketch on a back or bottom face is drawn looking against its plane's normal: the file is that picture, not its mirror image.
        const seen = representation.side === -1 ? planeSeenAs(representation.plane, -1) : undefined;
        const svg = outlineToSvg(representation.outline, source.label, seen);
        await copy(svg.text);
        const mm = (v: number) => Number(v.toPrecision(6)).toString();
        return { message: `Copied as SVG: ${source.label}, ${mm(svg.width)} × ${mm(svg.height)} mm.`, bad: false };
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        return { message: `Could not copy the ${source.kind}: ${why}`, bad: true };
      }
    },
  };
  return [downloadStl, copySvg];
}

/** Registers Design's verbs; the shell calls it once at start-up. */
export function registerDesignActions(registry: ActionRegistry, save?: SaveFile, copy?: CopySvg): void {
  for (const a of designActions(save, copy)) registry.register(a);
}
