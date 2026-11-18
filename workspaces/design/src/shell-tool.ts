// The Shell tool's rules (step 35h2c-app2), pure so they are unit-tested:
// which body and faces the clicks pick, what the tool refuses at once in
// plain words (a body with round faces, a face of a second body), the
// thickness typed, and each picked face's design-wide held name, found
// again by the rebuild's `shellRun` exactly as it looks for it (the one
// face of the design carrying that name). Anything the kernel itself
// refuses (walls that close up or run into each other, every face open, an
// open face beside a closed one in its plane) comes back in the kernel's
// own words through the live preview and the OK's check build. The panel
// is shell-panel.ts; workspace.ts wires it.

import type { BodyView } from "@fission/core";
import { namedBody } from "./built-body.ts";
import { shellThicknessProblem } from "./document.ts";
import { faceFeature, isFacePlane } from "./face-sketch.ts";
import type { BuiltBody } from "./rebuild.ts";

/**
 * What the tool holds: the body being shelled (a body id; null until a
 * face or body is picked) and its faces to leave open (kernel face
 * indices on it as the scene shows it, in the order clicked). A body with
 * no open face is shelled sealed: walls all round, hollow inside.
 */
export interface ShellPicks {
  body: string | null;
  faces: number[];
}

export const NO_PICKS: ShellPicks = { body: null, faces: [] };

/** What a body's view tells the picking. */
export type FaceFacts = Pick<BodyView, "face_types" | "faces">;

/** The words for each pick the tool refuses at once. */
export const ROUND_FACES = "That body has round faces (a hole, a cylinder or a sphere): for now only bodies whose faces are all flat can be shelled.";
export const ONE_BODY = "A shell works on one body at a time: pick faces of the same body, or press OK and start another shell.";
export const NOT_A_FACE = "That is not a face of the body, so it can't be left open.";
export const NO_NAME = "That face has no name of its own (two faces of the design are alike), so a shell could not find it again after an edit.";
export const INSIDE_WALL = "That is an inside wall of the shell being previewed: click or tap an outside face to leave it open.";

/** Why a body whose view is `view` can't be shelled, in plain words; null when the tool takes it. */
export function bodyRefusal(view: FaceFacts): string | null {
  return view.face_types.some((t) => t !== "plane") ? ROUND_FACES : null;
}

/**
 * The picks after a click on face `face` of body `body` (whose view is
 * `view`): a face already open is closed again (the body stays picked, so
 * taking out the last face leaves it sealed); any other face is added at
 * the end, unless it is on another body than the faces picked, or its body
 * can't be shelled (`bodyRefusal`), when the picks stay and `refused` says
 * why. With no face picked, a face of another body moves the shell there.
 */
export function togglePick(picks: ShellPicks, body: string, face: number, view: FaceFacts): { picks: ShellPicks; refused: string | null } {
  const same = { body: picks.body, faces: [...picks.faces] };
  if (!Number.isInteger(face) || face < 0 || face >= view.faces) return { picks: same, refused: NOT_A_FACE };
  if (picks.body === body && picks.faces.includes(face)) return { picks: { body, faces: picks.faces.filter((f) => f !== face) }, refused: null };
  if (picks.body !== null && picks.body !== body && picks.faces.length > 0) return { picks: same, refused: ONE_BODY };
  const why = bodyRefusal(view);
  if (why !== null) return { picks: same, refused: why };
  return { picks: { body, faces: picks.body === body ? [...picks.faces, face] : [face] }, refused: null };
}

/**
 * The picks from a selection, in order: a body (a whole-body pick: shelled
 * sealed) or a face (`{ body, face }`), each taken as a click
 * (`togglePick`, a face given twice once; a body picks itself when nothing
 * else is picked yet); the first refusal, if any, says why one was left out.
 */
export function picksFrom(items: readonly ({ body: string; face: number } | { body: string })[], viewOf: (body: string) => FaceFacts | null): { picks: ShellPicks; refused: string | null } {
  let picks: ShellPicks = NO_PICKS;
  let refused: string | null = null;
  for (const item of items) {
    const view = viewOf(item.body);
    if (view === null) continue;
    if (!("face" in item)) {
      if (picks.body !== null) {
        if (picks.body !== item.body) refused ??= ONE_BODY;
        continue;
      }
      const why = bodyRefusal(view);
      if (why === null) picks = { body: item.body, faces: [] };
      else refused ??= why;
      continue;
    }
    if (picks.body === item.body && picks.faces.includes(item.face)) continue;
    const next = togglePick(picks, item.body, item.face, view);
    picks = next.picks;
    refused ??= next.refused;
  }
  return { picks, refused };
}

/** A new Shell's wall thickness (mm). */
export const DEFAULT_THICKNESS = 1;

/** A number typed as the size box gives it (millimetres as text): read strictly, never by Number ("0x10", "Infinity"). */
function strict(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The thickness typed (mm, as text), or why not in plain words: an empty box or text that is no number; a number the data can't hold in `shellThicknessProblem`'s words. */
export function readThickness(text: string): { thickness: number } | { why: string } {
  const t = strict(text);
  if (t === null) return { why: text.trim() === "" ? "Type the wall thickness in mm." : `"${text.trim()}" is not a thickness: type the wall thickness in mm.` };
  const problem = shellThicknessProblem(t);
  return problem === null ? { thickness: t } : { why: `The shell can't be made: ${problem}.` };
}

/** What the panel's Faces row says: how to pick (by touch: Tap), "Sealed: …" for a body with none open, "1 face open", "3 faces open". */
export function facesWords(picks: ShellPicks, touch: boolean): string {
  if (picks.body === null) return touch ? "Tap the faces to leave open" : "Click the faces to leave open";
  const n = picks.faces.length;
  if (n === 0) return "No face open: sealed, hollow inside";
  return n === 1 ? "1 face open" : `${n} faces open`;
}

/** The hint over the view while nothing is picked. */
export function shellHintWords(bodies: number): string {
  if (bodies === 0) return "Shell needs a body: make one first with Insert or Extrude";
  return "Shell: click or tap the faces to leave open";
}

/**
 * Each picked face's held design-wide name, as the rebuild's `shellRun`
 * finds it again: of the names the design gives that face (`namedBody`
 * over every body of the build, `bodies` by body id, as rebuilt up to the
 * marker, where the Shell goes in, each body's view from `view`), the first
 * that no other face of the design carries. Null for a face with no such
 * name, a body the build does not hold, or a face it does not have.
 */
export async function heldFaceNames(bodies: Readonly<Record<string, BuiltBody>>, view: (b: BuiltBody) => Promise<BodyView>, body: string, faces: readonly number[]): Promise<(string | null)[]> {
  const ids = Object.keys(bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, bodies[k], await view(bodies[k]), 0)));
  const count = new Map<string, number>();
  for (const nb of list) for (const f of nb.faces) for (const n of new Set(f.names)) count.set(n, (count.get(n) ?? 0) + 1);
  const at = ids.indexOf(body);
  return faces.map((face) => {
    const names = at < 0 ? undefined : list[at].faces[face]?.names;
    return names?.find((n) => count.get(n) === 1 && isFacePlane(n) && faceFeature(n) !== null) ?? null;
  });
}
