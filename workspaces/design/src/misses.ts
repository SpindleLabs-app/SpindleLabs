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

/** "Body 2", "Body 2 and Body 3", "Body 2, Body 3 and Body 4". */
export function listWords(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Body 2 or Body 3": the targets an extrude misses. */
const orWords = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`);

/**
 * The row's warning for an item whose Cut or Join changes nothing (no
 * full stop): "Combine 1: Body 2 removes nothing from Body 1",
 * "Extrude 2 cuts nothing: it doesn't reach Body 1". `name` gives a body
 * id's words; `own` is an operation extrude's own body.
 */
export function missWords(label: string, op: "cut" | "join", misses: readonly Miss[], name: (body: string) => string, own?: string): string {
  if (own !== undefined && misses.every((m) => m.tools.length === 1 && m.tools[0] === own)) {
    // An extrude whose own body is what misses (Cut: each target its own boolean; Join: into the first body picked).
    const targets = misses.map((m) => name(m.target));
    return op === "cut" ? `${label} cuts nothing: it doesn't reach ${orWords(targets)}` : `${label} adds nothing: it doesn't reach ${orWords(targets)}`;
  }
  const parts = misses.map((m) => {
    const tools = m.tools.map(name);
    const one = tools.length === 1;
    return op === "cut" ? `${listWords(tools)} ${one ? "removes" : "remove"} nothing from ${name(m.target)}` : `${listWords(tools)} ${one ? "adds" : "add"} nothing to ${name(m.target)}`;
  });
  return `${label}: ${parts.join("; ")}`;
}
