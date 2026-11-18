// The Shell's live preview (step 35h2c-app2): before OK, the body drawn as
// the kernel would hollow it at the thickness typed with the faces picked
// left open, in place of the body as it is. The kernel's own shell of the
// body shown (never a guess drawn over it), asked once per picks and
// thickness, the pieces' display meshes kept and the bodies freed at once,
// so a preview holds nothing in the kernel. Walls falling apart draw as
// every piece. For an edited Shell the body it was made from (the rebuild's
// `holds`) is hollowed again with its open faces as the rebuild found them,
// while no later item has changed what it made (`editPreviewInput`).
// The tool still picks faces while the preview is drawn: the view answers a
// click by the drawn mesh's face numbers, which `shellPickAt` reads back
// through the kernel's history to the body's own face (an outside face kept
// from the body) or to an inside wall (which opens nothing). The workspace
// drives it.

import { SHELL_INSIDE, type BodyHandle, type BodyView, type DisplayMesh, type KernelCalls, type ShellResult } from "@fission/core";
import { joinBodies, sceneHit, type Scene, type ShownBody } from "./scene.ts";

/** A preview: each piece's view and where its faces came from (the kernel's history), and the body handle hollowed. */
export interface ShellPreview {
  from: BodyHandle;
  views: BodyView[];
  history: ShellResult["history"];
}

/** The pieces of `handle` hollowed with `open` left open and walls `thickness` mm, viewed; every piece is freed before it returns. A refusal is the kernel's error. */
export async function previewShell(kernel: KernelCalls, handle: BodyHandle, open: readonly number[], thickness: number): Promise<ShellPreview> {
  const out = await kernel.call("body_shell", handle, [...open], thickness);
  try {
    const views = await Promise.all(out.bodies.map((b) => kernel.call("body_view", b)));
    return { from: handle, views, history: out.history };
  } finally {
    // A kernel restarted meanwhile holds them no more.
    await Promise.all(out.bodies.map((b) => kernel.call("body_free", b).catch(() => {})));
  }
}

/** The total volume a preview draws (mm³). */
export const previewVolume = (p: ShellPreview): number => p.views.reduce((v, x) => v + x.volume, 0);

/** The scene as drawn with a preview: its bodies, `replaced` (body ids) taken out and the preview's pieces put where the first of them was; which drawn entry is which piece. */
export interface DrawnShell {
  scene: Scene;
  /** For each drawn body, the preview's piece it is (its index), or the scene body it is (by body id). */
  drawn: readonly ({ piece: number } | { body: string })[];
}

/**
 * The scene drawn with `preview` in place of the bodies `replaced` (body
 * ids: a new Shell's body; an edited Shell's every body it made), its pieces
 * where the first replaced body was; the scene as it is when it shows none
 * of them. Drawn only: the pieces carry no design names, so nothing is
 * named on them.
 */
export function drawnShell(scene: Scene, replaced: readonly string[], preview: ShellPreview): DrawnShell {
  const first = scene.bodies.findIndex((b) => replaced.includes(b.body));
  if (first < 0) return { scene, drawn: scene.bodies.map((b) => ({ body: b.body })) };
  const bodies: ShownBody[] = [];
  const drawn: DrawnShell["drawn"][number][] = [];
  scene.bodies.forEach((b, i) => {
    const plain = { ...b };
    delete plain.design;
    if (i === first) {
      preview.views.forEach((view, k) => {
        bodies.push({ ...plain, view, names: { ...plain.names, faces: [], edges: [] } });
        drawn.push({ piece: k });
      });
    } else if (!replaced.includes(b.body)) {
      bodies.push(plain);
      drawn.push({ body: b.body });
    }
  });
  return { scene: joinBodies(bodies), drawn };
}

/** The drawn mesh of a preview. */
export const drawnMesh = (d: DrawnShell): DisplayMesh => d.scene.mesh;

/**
 * What a click on drawn face `face` is, read back to the scene: a face of
 * a scene body (its index among the scene's bodies and its kernel face
 * there), the outside face of the hollowed body it was kept from, or an
 * inside wall of the preview (`inside`); null past every body or for a
 * face the history names on no body the tool knows.
 */
export function shellPickAt(scene: Scene, d: DrawnShell, preview: ShellPreview, hollowed: string, face: number): { body: number; face: number } | "inside" | null {
  if (!Number.isInteger(face) || face < 0) return null;
  const hit = sceneHit(d.scene, "face", face);
  if (hit === null) return null;
  const what = d.drawn[hit.body];
  if (what === undefined) return null;
  if ("body" in what) {
    const at = scene.bodies.findIndex((b) => b.body === what.body);
    return at < 0 ? null : { body: at, face: hit.index };
  }
  const from = preview.history[what.piece]?.faces[hit.index];
  if (from === undefined) return null;
  if (from.body === SHELL_INSIDE) return "inside";
  if (from.body !== preview.from) return null;
  const at = scene.bodies.findIndex((b) => b.body === hollowed);
  return at < 0 ? null : { body: at, face: from.face };
}

/** What the preview reads of a Shell's rebuild result (rebuild.ts `FeatureResult`). */
export interface ShellBuilt {
  status: string;
  holds?: readonly BodyHandle[];
  shelled?: { open: readonly number[]; bodies: readonly BodyHandle[] };
}

/** Why an edited Shell has no preview: a later item changed a body it made. */
export const LATER_CHANGES = "No preview: an item after this Shell changes its body, so the result shows after OK.";

/** Why an edited Shell that failed has no preview. */
export const FAILED_NO_PREVIEW = "No preview while this Shell has failed: press OK to try the new thickness.";

/**
 * What an edited Shell's preview hollows: the body as it was before the
 * Shell (`holds`) and the faces the rebuild opened, when every body it made
 * is still as it made it (`now`: each body id's handle in the last build,
 * of the ids the Shell made, `made`); else why not, or null when the
 * rebuild has no answer for it.
 */
export function editPreviewInput(result: ShellBuilt | undefined, made: readonly (BodyHandle | undefined)[]): { handle: BodyHandle; open: number[] } | { why: string } | null {
  if (result?.status === "failed") return { why: FAILED_NO_PREVIEW };
  if (result?.status !== "built" || result.shelled === undefined || result.holds === undefined || result.holds.length !== 1) return null;
  if (made.length === 0 || made.some((h) => h === undefined || !result.shelled!.bodies.includes(h))) return { why: LATER_CHANGES };
  return { handle: result.holds[0], open: [...result.shelled.open] };
}
