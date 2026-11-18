// Download 3MF and Download OBJ (step 77): the same bodies Download STL
// takes, made the same way (`endStls`), then packed by mesh-files.ts with
// each body its own object. Each object is checked on its own by the
// kernel's solid check (its STL holds exactly the object's triangles), so
// two bodies touching along a face, which the joined STL rightly calls not
// solid, are two solid objects here; the reports are added up into one.
// Kept apart from actions.ts so the STL verb's file stays as it is.

import type { Action, ActionOutcome, ActionRegistry, Feature, SolidProblem, SolidReport } from "@fission/core";
import { saveFile, type SaveKind } from "@fission/ui";
import { checkWords, exportNotes, failedItemsNote, joinStl, shownBodyFeature, type DesignOutcome, type SaveFile } from "./actions.ts";
import { designBodies } from "./browser.ts";
import { bodyNumbers, isDuplicateItem, makesPieces, shapeOf, type DesignDocument } from "./document.ts";
import { meshOfStl, objBytes, threeMf, type Mesh } from "./mesh-files.ts";
import { endStls } from "./move-tool.ts";
import type { DesignRun } from "./actions.ts";
import { SOLID_OVERLAY, solidOverlay } from "./solid-badge.ts";

export const DOWNLOAD_3MF = "design.download-3mf";
export const DOWNLOAD_OBJ = "design.download-obj";

/** A 3MF file: the mesh in millimetres, each body its own object (what slicers open first). */
export const THREEMF_KIND: SaveKind = { description: "3MF model", mime: "model/3mf", extension: ".3mf" };
/** A Wavefront OBJ mesh (no units in the format: millimetres). */
export const OBJ_KIND: SaveKind = { description: "OBJ mesh", mime: "model/obj", extension: ".obj" };

/** Why an OBJ's numbers need the reader's help: the format has no units. */
export const OBJ_UNITS = "OBJ files carry no units: these numbers are millimetres, so pick millimetres if the other program asks.";

interface Format {
  id: string;
  label: string;
  name: string;
  kind: SaveKind;
  title: string;
  pack: (meshes: Mesh[]) => Uint8Array<ArrayBuffer>;
  note: string;
}

const FORMATS: Format[] = [
  {
    id: DOWNLOAD_3MF,
    label: "Download 3MF",
    name: "3MF",
    kind: THREEMF_KIND,
    title: "Download the bodies as one 3MF file, for a slicer: sizes in millimetres, each body its own object. Checks the file is solid, as Download STL does.",
    pack: threeMf,
    note: "",
  },
  {
    id: DOWNLOAD_OBJ,
    label: "Download OBJ",
    name: "OBJ",
    kind: OBJ_KIND,
    title: "Download the bodies as one OBJ mesh file, for another 3D program: each body its own object. Checks the file is solid, as Download STL does.",
    pack: objBytes,
    note: OBJ_UNITS,
  },
];

/**
 * One report for several objects each checked alone: solid only when every
 * one is; problems (of any one) before unfinished; counts, triangles,
 * pieces and volume added up, each kind of problem listed once.
 */
export function mergeReports(reports: readonly SolidReport[]): SolidReport {
  const problems: SolidProblem[] = [];
  for (const r of reports)
    for (const p of r.problems) {
      const same = problems.find((q) => q.kind === p.kind);
      if (same) {
        same.count += p.count;
        same.places = [...same.places, ...p.places];
      } else problems.push({ ...p, places: [...p.places] });
    }
  const verdict = reports.some((r) => r.verdict === "problems") ? "problems" : reports.some((r) => r.verdict === "unfinished") ? "unfinished" : "solid";
  const sum = (k: "triangles" | "shells" | "volume") => reports.reduce((n, r) => n + r[k], 0);
  return { verdict, triangles: sum("triangles"), shells: sum("shells"), volume: sum("volume"), problems };
}

/** The kernel's STL precision words, said of this format (the file is not an STL, but holds the same numbers). */
export function precisionWords(warning: string, format: string): string {
  const stl = "STL stores single-precision numbers:";
  return warning.startsWith(stl) ? `The ${format} holds single-precision numbers, as STL does:${warning.slice(stl.length)}` : warning;
}

function saverFor(kind: SaveKind): SaveFile {
  return async (bytes, name) => {
    const r = await saveFile(document, { suggestedName: name, kind, bytes });
    if (r.status === "failed") throw new Error(r.message);
    return r.status === "saved" ? r.name : false;
  };
}

function meshAction(format: Format, save: SaveFile): Action {
  return {
    id: format.id,
    workspace: "design",
    label: format.label,
    title: format.title,
    kinds: ["body"],
    uses: "mesh",
    count: "many",
    async run(targets, ctx: DesignRun): Promise<ActionOutcome> {
      const doc = ctx.project.workspaces.design as DesignDocument | undefined;
      if (!doc) return { message: "There is no part to download yet.", bad: true };
      if (targets.length === 0) return { message: `${format.label} takes at least one body.`, bad: true };
      // The bodies as Download STL picks them: each shown, once, in build order, with the last rebuild's failed items
      // (a failed Combine leaves its inputs shown: #640 2).
      const failed = ctx.failed ?? NONE_FAILED;
      const numbers = bodyNumbers(doc);
      const place = (body: string) => `Body ${numbers.get(body)}`;
      const picked: { body: string; feature: Feature }[] = [];
      for (const target of targets) {
        const f = shownBodyFeature(target, doc, failed);
        if (!f || (ctx.scene && !ctx.scene.bodies.some((b) => b.body === target.id))) return { message: `${numbers.has(target.id) ? place(target.id) : target.id} is not a body shown in the design, so there is nothing to download.`, bad: true };
        if (!picked.some((p) => p.body === target.id)) picked.push({ body: target.id, feature: f });
      }
      const order = designBodies(doc, failed).map((b) => b.body);
      picked.sort((a, b) => order.indexOf(a.body) - order.indexOf(b.body));
      const kindOf = (f: Feature) => {
        if (makesPieces(f) || isDuplicateItem(f)) return "body";
        const shape = shapeOf(doc, f).shape;
        return shape === "sketch-extrude" ? "extrude" : shape;
      };
      try {
        const files = await endStls(ctx.kernel, doc, picked.map((p) => ({ ...p, name: kindOf(p.feature) })));
        const one = picked.length === 1;
        const name = one ? kindOf(picked[0].feature) : `${picked.length} bodies`;
        const file = `spindlelabs-${one ? name : `${picked.length}-bodies`}${format.kind.extension}`;
        const all = files.map((f, i) => ({ mesh: meshOfStl(f.bytes, place(picked[i].body)), file: f, body: picked[i].body }));
        // Each object checked on its own, on its own triangles: never blocks the save, never says solid when it can't run.
        let unchecked = "";
        const reports = new Map<string, SolidReport>();
        try {
          for (const m of all) if (m.mesh.triangles.length > 0) reports.set(m.body, await ctx.kernel.call("check_solid", m.file.bytes));
        } catch (e) {
          unchecked = `The solid check could not run (${e instanceof Error ? e.message : String(e)}), so the file is not known to be solid.`;
          reports.clear();
        }
        // A body single precision squashes to nothing has no triangles left, and one squashed flat (#640 4) no volume: no
        // object either would make sense of (a slicer crashed loading the flat one), so each is left out, in words.
        const nothing = all.filter((m) => m.mesh.triangles.length === 0).map((m) => place(m.body));
        const flat = all.filter((m) => squashedFlat(reports.get(m.body))).map((m) => place(m.body));
        const kept = all.filter((m) => m.mesh.triangles.length > 0 && !squashedFlat(reports.get(m.body)));
        if (kept.length === 0) return { message: `Nothing to export as ${format.name}: ${[...nothingWords(nothing, format.name, false), ...flatWords(flat, format.name, false)].join(" ")}`, bad: true };
        let solid = reports.size > 0 ? mergeReports(kept.map((m) => reports.get(m.body)!)) : undefined;
        // Several objects each solid alone: the joined file is checked too, so bodies that touch or overlap get the
        // STL's words (#640 5), and its marks show where; a check of it that can't run says nothing more.
        let touching: number | undefined;
        if (solid?.verdict === "solid" && kept.length > 1) {
          const joined = await ctx.kernel.call("check_solid", joinStl(kept.map((m) => m.file.bytes), name)).catch(() => undefined);
          if (joined?.verdict === "problems") {
            touching = kept.length;
            solid = joined;
          }
        }
        // Timeline items that failed are not in the file (#640 1): said as Download STL says them.
        const missing = failedItemsNote(doc, failed, format.name as "3MF" | "OBJ");
        const saved = await save(format.pack(kept.map((m) => m.mesh)), file);
        if (saved === false) return { message: `Export ${format.name} cancelled: nothing was saved.`, bad: false };
        // The red marks follow this file's check, as Download STL's do: set when it found places, cleared otherwise.
        const marked = solid ? solidOverlay(solid, touching !== undefined) : null;
        if (marked) ctx.viewport.setOverlay(marked);
        else ctx.viewport.clearOverlay(SOLID_OVERLAY);
        const warnings = kept.flatMap((m) => (m.file.warning ? [one ? precisionWords(m.file.warning, format.name) : `${place(m.body)}: ${precisionWords(m.file.warning, format.name)}`] : []));
        const left = [...nothingWords(nothing, format.name, true), ...flatWords(flat, format.name, true)];
        const message = [`Exported ${typeof saved === "string" && saved !== "" ? saved : file}.`, missing, checkWords(solid, unchecked, missing, touching, true), ...left, ...warnings, format.note].filter(Boolean).join(" ");
        const notes = exportNotes(missing, touching, true);
        const outcome: DesignOutcome = { message, bad: warnings.length > 0 || left.length > 0 || solid?.verdict !== "solid" || missing !== "", ...(solid && { solid }), ...(notes && { notes }) };
        return outcome;
      } catch (e) {
        return { message: e instanceof Error ? e.message : String(e), bad: true };
      }
    },
  };
}

const NONE_FAILED: ReadonlySet<string> = new Set();

/**
 * Whether a body's own check finds it squashed flat by single precision: its triangles cross and fold onto each other
 * (collapsed ones among them) round no volume at all, less than a cube of the smallest feature (1 µm, 1e-9 mm³).
 * A real body that small is checked solid, so it is never taken for one (a 2 µm cube: 8e-9 mm³, solid).
 */
export function squashedFlat(report: SolidReport | undefined): boolean {
  return report !== undefined && report.verdict === "problems" && Math.abs(report.volume) < 1e-9 && report.problems.some((p) => p.kind === "collapsed");
}

/** Bodies with no triangles left, in words: "… is left out of the 3MF: …" (`out`), or why there is nothing. */
function nothingWords(bodies: readonly string[], format: string, out: boolean): string[] {
  if (bodies.length === 0) return [];
  const it = bodies.length === 1;
  const why = `single precision squashes ${it ? "it" : "them"} to nothing, so ${it ? "it has" : "they have"} no triangles.`;
  return [out ? `${listWords(bodies)} ${it ? "is" : "are"} left out of the ${format}: ${why}` : `single precision squashes ${listWords(bodies)} to nothing, so ${it ? "it has" : "they have"} no triangles.`];
}

/** Bodies squashed flat, in words, as `nothingWords`. */
function flatWords(bodies: readonly string[], format: string, out: boolean): string[] {
  if (bodies.length === 0) return [];
  const it = bodies.length === 1;
  const why = `single precision squashes ${it ? "it" : "them"} flat, so ${it ? "it has" : "they have"} no volume. Move ${it ? "it" : "them"} closer to the origin or make ${it ? "it" : "them"} thicker.`;
  return [out ? `${listWords(bodies)} ${it ? "is" : "are"} left out of the ${format}: ${why}` : `single precision squashes ${listWords(bodies)} flat, so ${it ? "it has" : "they have"} no volume.`];
}

/** "Body 1", "Body 1 and Body 2", "Body 1, Body 2 and Body 3". */
function listWords(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Design's 3MF and OBJ verbs; `save` hands a file to the user (the browser's save, or a test's recorder). */
export function meshActions(save?: SaveFile): Action[] {
  return FORMATS.map((f) => meshAction(f, save ?? saverFor(f.kind)));
}

/** Registers them; the workspace calls it beside `registerDesignActions`. */
export function registerMeshActions(registry: ActionRegistry, save?: SaveFile): void {
  for (const a of meshActions(save)) registry.register(a);
}
