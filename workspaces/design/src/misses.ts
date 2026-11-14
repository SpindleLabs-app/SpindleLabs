// A Cut or Join that changes nothing (Ben, 11 Nov, SL #506 item 5 and
// #521): a tool body that removes nothing from the target (Cut) or adds
// nothing to it (Join). Told from the boolean's own history, never from
// volumes against a tolerance:
// - Cut: a tool removes something exactly when some face of the result
//   lies on one of its faces. If the tool T overlaps the target B in a
//   solid region, B minus T's new boundary includes the part of T's
//   boundary inside B, which is not empty (B is connected and T doesn't
//   hold all of it, else nothing would be left, which the rebuild already
//   refuses), so a result face comes from T. A tool that only touches B on
//   a face, an edge or a corner, or is far away, gives no face; one wholly
//   inside B gives the hollow's faces, so it counts as removing.
// - Join: a tool adds something exactly when one result body holds faces
//   of both the target and the tool. Far away, it is a piece of its own
//   (only its faces); wholly inside the target, none of its faces is left.
//   Tools joined through another tool count (target, A touching it, B
//   touching only A: one body holds all three).
// A face merged into another (36c1) lists every face it lies on: `also`.

import type { BodyHandle, BooleanResult } from "@fission/core";

/** One boolean whose tools change nothing: its target and those tools (body ids). */
export interface Miss {
  target: string;
  tools: string[];
  /** Of a Join's `tools`, those none of whose faces is left on the result: wholly inside the target (SL #583 item 3). */
  inside?: string[];
}

/** The inputs each result body's faces lie on (first origins and merged ones). */
function facesFrom(result: Pick<BooleanResult, "history">): Set<BodyHandle>[] {
  return result.history.map((h) => new Set([...h.faces, ...(h.also ?? []).flat()].map((f) => f.body)));
}

/** The indices of the `tools` (handles) a Cut or Join of `target` with them changes nothing with; none for Intersect. */
export function missedTools(op: "cut" | "join" | "intersect", target: BodyHandle, tools: readonly BodyHandle[], result: Pick<BooleanResult, "history">): number[] {
  if (op === "intersect") return [];
  const from = facesFrom(result);
  const reaches = (tool: BodyHandle) => (op === "cut" ? from.some((s) => s.has(tool)) : from.some((s) => s.has(tool) && s.has(target)));
  return tools.flatMap((t, i) => (reaches(t) ? [] : [i]));
}

/** Whether no face of the result lies on `tool`: a Join's tool that adds nothing lies wholly inside the target (far away, its faces are a piece of their own). */
export function leavesNoFace(tool: BodyHandle, result: Pick<BooleanResult, "history">): boolean {
  return !facesFrom(result).some((s) => s.has(tool));
}

/**
 * Whether a Join's `tool` lies wholly inside the `target` while flush with
 * a face of it, so it adds nothing (SL #677 item 3): its flush face is
 * merged into the target's, which `missedTools` reads as reaching. Told
 * from the history alone: some result body is the target unchanged, that
 * is, every one of the target's `faces` (how many it has) is still there,
 * each whole unless a face of the tool is merged into it, and no face of
 * that body lies on the tool alone.
 * Why: a tool that adds volume buries some of the target's surface (the
 * two share one body, so they meet over an area). The face that area is
 * on is then gone (a pocket filled level loses the pocket's walls), or
 * only a piece of it is left (`whole` false: a pad's footprint), and what
 * sticks out has faces of the tool's alone. A face the tool's flush face
 * is merged into is always given as a piece, so it can't be read; for the
 * rule to be wrong there the tool would have to bury part of that very
 * face from outside, lie flush in the rest of it, and have every other
 * face of the part outside hidden in the same way, which no extrude of one
 * sketch does. In doubt it answers false: no question, as before.
 */
export function joinsInside(target: BodyHandle, faces: number, tool: BodyHandle, result: Pick<BooleanResult, "history">): boolean {
  return targetFacesKept(target, tool, result).includes(faces);
}

/**
 * Whether `joinsInside` could hold whatever the target's number of faces: told from the history alone, so the caller
 * asks for the target's faces (which meshes it) only for a Join that may add nothing, never for one that adds.
 */
export function mayJoinInside(target: BodyHandle, tool: BodyHandle, result: Pick<BooleanResult, "history">): boolean {
  return targetFacesKept(target, tool, result).length > 0;
}

/** For each result body that could be the target unchanged with the tool inside it: how many of the target's faces it keeps. */
function targetFacesKept(target: BodyHandle, tool: BodyHandle, result: Pick<BooleanResult, "history">): number[] {
  return result.history.flatMap((h) => {
    const from = h.faces.map((f, i) => [f, ...(h.also?.[i] ?? [])]);
    if (!from.some((l) => l.some((x) => x.body === tool)) || from.some((l) => l.every((x) => x.body === tool))) return [];
    const there = new Set<number>();
    for (const l of from)
      for (const x of l) {
        if (x.body !== target) continue;
        if (!x.whole && !l.some((y) => y.body === tool)) return [];
        there.add(x.face);
      }
    return [there.size];
  });
}

/** "Body 2", "Body 2 and Body 3", "Body 2, Body 3 and Body 4". */
export function listWords(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Body 2 or Body 3": the targets an extrude misses. */
const orWords = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`);

/**
 * The row's warning for an item whose Cut or Join changes nothing (no
 * full stop): "Combine 1: Body 2 removes nothing from Body 1",
 * "Extrude 2 cuts nothing: it doesn't reach Body 1", "Extrude 2 adds nothing: it
 * lies wholly inside Body 1" (a Join's own body none of whose faces is left). `name` gives a body
 * id's words; `own` is an operation extrude's own body.
 */
export function missWords(label: string, op: "cut" | "join", misses: readonly Miss[], name: (body: string) => string, own?: string): string {
  if (own !== undefined && misses.every((m) => m.tools.length === 1 && m.tools[0] === own)) {
    // An extrude whose own body is what misses (Cut: each target its own boolean; Join: into the first body picked).
    const targets = misses.map((m) => name(m.target));
    if (op === "join" && misses.every((m) => m.inside?.includes(own))) return `${label} adds nothing: it lies wholly inside ${orWords(targets)}`;
    return op === "cut" ? `${label} cuts nothing: it doesn't reach ${orWords(targets)}` : `${label} adds nothing: it doesn't reach ${orWords(targets)}`;
  }
  const parts = misses.map((m) => {
    const tools = m.tools.map(name);
    const one = tools.length === 1;
    return op === "cut" ? `${listWords(tools)} ${one ? "removes" : "remove"} nothing from ${name(m.target)}` : `${listWords(tools)} ${one ? "adds" : "add"} nothing to ${name(m.target)}`;
  });
  return `${label}: ${parts.join("; ")}`;
}
