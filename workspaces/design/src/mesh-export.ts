// Download 3MF and Download OBJ (step 77): the same bodies Download STL
// takes, made the same way (`endStls`), checked the same way (the kernel's
// solid check of the joined STL, whose triangles these files hold exactly),
// then packed by mesh-files.ts with each body its own object. Kept apart
// from actions.ts so the STL verb's file stays as it is.

import type { Action, ActionOutcome, ActionRegistry, Feature, SolidReport } from "@fission/core";
import { saveFile, type SaveKind } from "@fission/ui";
import { joinStl, shownBodyFeature, type SaveFile } from "./actions.ts";
import { designBodies } from "./browser.ts";
import { bodyNumbers, isDuplicateItem, makesPieces, shapeOf, type DesignDocument } from "./document.ts";
import { meshOfStl, objText, threeMf, type Mesh } from "./mesh-files.ts";
import { endStls } from "./move-tool.ts";
import type { DesignRun } from "./actions.ts";
import { badgeFor } from "./solid-badge.ts";

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
    pack: (meshes) => new TextEncoder().encode(objText(meshes)) as Uint8Array<ArrayBuffer>,
    note: OBJ_UNITS,
  },
];

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
      // The bodies as Download STL picks them: each shown, once, in build order.
      const picked: { body: string; feature: Feature }[] = [];
      for (const target of targets) {
        const f = shownBodyFeature(target, doc);
        if (!f || (ctx.scene && !ctx.scene.bodies.some((b) => b.body === target.id))) return { message: `${target.id} is not a body shown in the design, so there is nothing to download.`, bad: true };
        if (!picked.some((p) => p.body === target.id)) picked.push({ body: target.id, feature: f });
      }
      const order = designBodies(doc).map((b) => b.body);
      picked.sort((a, b) => order.indexOf(a.body) - order.indexOf(b.body));
      const kindOf = (f: Feature) => {
        if (makesPieces(f) || isDuplicateItem(f)) return "body";
        const shape = shapeOf(doc, f).shape;
        return shape === "sketch-extrude" ? "extrude" : shape;
      };
      const numbers = bodyNumbers(doc);
      const place = (body: string) => `Body ${numbers.get(body)}`;
      try {
        const files = await endStls(ctx.kernel, doc, picked.map((p) => ({ ...p, name: kindOf(p.feature) })));
        const one = picked.length === 1;
        const name = one ? kindOf(picked[0].feature) : `${picked.length} bodies`;
        const file = `spindlelabs-${one ? name : `${picked.length}-bodies`}${format.kind.extension}`;
        const meshes = files.map((f, i) => meshOfStl(f.bytes, place(picked[i].body)));
        // The same check Download STL makes, on the same triangles: never blocks the save, never says solid when it can't run.
        let solid: SolidReport | undefined;
        let unchecked = "";
        try {
          solid = await ctx.kernel.call("check_solid", one ? files[0].bytes : joinStl(files.map((f) => f.bytes), name));
        } catch (e) {
          unchecked = `The solid check could not run (${e instanceof Error ? e.message : String(e)}), so the file is not known to be solid.`;
        }
        const saved = await save(format.pack(meshes), file);
        if (saved === false) return { message: `Export ${format.name} cancelled: nothing was saved.`, bad: false };
        const warnings = picked.flatMap((p, i) => (files[i].warning ? [one ? files[i].warning! : `${place(p.body)}: ${files[i].warning}`] : []));
        const badge = solid ? `${badgeFor(solid).title}.` : unchecked;
        const message = [`Exported ${typeof saved === "string" && saved !== "" ? saved : file}.`, badge, ...warnings, format.note].filter(Boolean).join(" ");
        return { message, bad: warnings.length > 0 || solid?.verdict !== "solid", ...(solid && { solid }) };
      } catch (e) {
        return { message: e instanceof Error ? e.message : String(e), bad: true };
      }
    },
  };
}

/** Design's 3MF and OBJ verbs; `save` hands a file to the user (the browser's save, or a test's recorder). */
export function meshActions(save?: SaveFile): Action[] {
  return FORMATS.map((f) => meshAction(f, save ?? saverFor(f.kind)));
}

/** Registers them; the workspace calls it beside `registerDesignActions`. */
export function registerMeshActions(registry: ActionRegistry, save?: SaveFile): void {
  for (const a of meshActions(save)) registry.register(a);
}
