// Bodies joined for a test (Ben, 2026-11-19): a study can test several of
// Design's bodies as one part, joined by the kernel's exact union each time
// the study is looked up or run, never in the design (nothing of it is saved
// but the choice, `Study.joined`).
//
// Faces are picked on the bodies as Design names them, so a hold or load
// keeps its face's stable name through design edits exactly as on one body.
// While picking, the view shows the bodies side by side (`joinedFaces`, no
// union needed); at Run the union is made and each picked face is followed
// into the joined part by the boolean's own history (`unionStudy`): a face
// cut into pieces by the join pushes or holds on every piece, a face merged
// level with a face of another body takes in the merged face (said in
// words), and a face wholly inside the join is refused in words. Bodies that
// don't touch are refused: the union gives separate pieces, which aren't one
// part (the honest answer; testing them apart is a test each).

import type { BodyFaces, BodyReference, BodyView, BooleanResult, FaceFound, FaceReference, KernelCalls, LentBody, ListedObject, Project, RepresentationRegistry } from "@fission/core";
import { GEOMETRY_OWNER, studyOn, type StudyNow } from "./faces.ts";
import { studyFaces, type HeldFace, type JoinedBody, type Study } from "./study.ts";

/** The bodies a study tests now, its body first: one when it joins nothing, else each joined body with its name now. */
export interface JoinGroup {
  bodies: JoinedBody[];
  /** One sentence per joined body Design doesn't show now (deleted, hidden or failed): never tested without it. */
  missing: string[];
}

/** "Body 1", "Body 1 and Body 2", "Body 1, Body 2 and Body 3". */
export function listWords(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The study's bodies as Design shows them now (`listed`, its lister's answer), its body first. "all" is every body
 * listed (its own body first when listed, else the first listed); a chosen body Design no longer lists is said in
 * words, never dropped. Pure.
 */
export function joinGroup(study: Study, listed: readonly ListedObject[]): JoinGroup {
  if (study.body === null) return { bodies: [], missing: [] };
  const shown = listed.filter((o): o is ListedObject & { ref: BodyReference } => o.ref !== undefined);
  const now = (b: JoinedBody): JoinedBody | null => {
    const o = shown.find((x) => x.ref.id === b.ref.id);
    return o ? { ref: o.ref, label: o.label } : null;
  };
  const main = now(study.body) ?? study.body;
  if (!study.joined) return { bodies: [main], missing: [] };
  if (study.joined === "all") {
    const others = shown.filter((o) => o.ref.id !== study.body!.ref.id).map((o) => ({ ref: o.ref, label: o.label }));
    return { bodies: now(study.body) ? [main, ...others] : others.length > 0 ? others : [main], missing: [] };
  }
  const bodies = [main];
  const missing: string[] = [];
  for (const b of study.joined) {
    const n = now(b);
    if (n) bodies.push(n);
    else missing.push(`${b.label} is joined for this test but Design doesn't show it now (deleted, hidden or not built): change the join.`);
  }
  return { bodies, missing };
}

/** What the panel says of a join: "Joined for this test: Body 1 and Body 2. The design isn't changed." */
export function joinWords(group: JoinGroup, all: boolean): string {
  const names = listWords(group.bodies.map((b) => b.label));
  return `${all ? "All bodies joined" : "Joined"} for this test: ${names}. The design isn't changed.`;
}

/** The faces of several bodies drawn side by side as one (for picking): `owner` the body each face is on, `offsets` each body's first face. */
export interface SideBySide {
  faces: BodyFaces;
  owner: number[];
  offsets: number[];
}

/**
 * Several bodies' faces as one answer, in the bodies' order, each body's faces numbered after the previous ones' and
 * named with the body ("Top face of Body 2"); every reference found where one body found it. Each body's `found` must
 * answer the same references in the same order (the page asks each body for all of the study's faces). A reference
 * no body has is gone with the first reason that isn't "on another body"; one two bodies claim is shared. Pure.
 */
export function joinedFaces(parts: readonly { label: string; faces: BodyFaces }[]): SideBySide {
  const mesh = { positions: [] as number[], normals: [] as number[], indices: [] as number[], triangle_faces: [] as number[], edge_lines: [] as number[], edge_line_edges: [] as number[] };
  const faces: (FaceReference | null)[] = [];
  const labels: string[] = [];
  const owner: number[] = [];
  const offsets: number[] = [];
  const inputs = new Set<string>();
  let edges = 0;
  const one = parts.length === 1;
  for (const [k, p] of parts.entries()) {
    const m = p.faces.mesh;
    const points = mesh.positions.length / 3;
    offsets.push(faces.length);
    mesh.positions.push(...m.positions);
    mesh.normals.push(...m.normals);
    mesh.indices.push(...m.indices.map((i) => i + points));
    mesh.triangle_faces.push(...m.triangle_faces.map((f) => f + offsets[k]));
    mesh.edge_lines.push(...m.edge_lines);
    mesh.edge_line_edges.push(...m.edge_line_edges.map((e) => e + edges));
    edges += m.edge_line_edges.length === 0 ? 0 : Math.max(...m.edge_line_edges) + 1;
    faces.push(...p.faces.faces);
    labels.push(...p.faces.labels.map((l) => (one ? l : `${l} of ${p.label}`)));
    owner.push(...p.faces.faces.map(() => k));
    for (const i of p.faces.inputs) inputs.add(i);
  }
  const asked = parts[0]?.faces.found.length ?? 0;
  const found: FaceFound[] = [];
  for (let r = 0; r < asked; r++) {
    const hits = parts.flatMap((p, k) => {
      const f = p.faces.found[r];
      return f?.status === "found" ? [offsets[k] + f.face] : [];
    });
    if (hits.length === 1) found.push({ status: "found", face: hits[0] });
    else if (hits.length > 1) found.push({ status: "shared", count: hits.length });
    else {
      const shared = parts.map((p) => p.faces.found[r]).find((f) => f?.status === "shared");
      if (shared) found.push(shared);
      else {
        const whys = parts.map((p) => p.faces.found[r]).flatMap((f) => (f?.status === "gone" ? [f.why] : []));
        const why = whys.find((w) => w !== "it is on another body now") ?? (one ? whys[0] ?? "it was not looked up" : "it is on a body not joined for this test");
        found.push({ status: "gone", why });
      }
    }
  }
  return { faces: { mesh, faces, labels, found, inputs: [...inputs] }, owner, offsets };
}

/** A study on its joined part: as `StudyNow`, with each picked face's pieces on the part (a face the join cut holds on every piece). */
export interface JoinedNow extends StudyNow {
  /** Stable id → the joined part's faces it became (one or more); a face the join swallowed has none and is in `lost`. */
  pieces: ReadonlyMap<string, number[]>;
  /** Faces of a hold or load that became one with a face it didn't pick (lying level), in words. */
  notes: string[];
}

/** A body of the join as lent: its name, its kernel handle and its faces as its owner gave them. */
export interface JoinPart {
  label: string;
  handle: number;
  faces: BodyFaces;
}

/** What the page says when the union gives several pieces: the bodies don't make one part. */
export const apartWords = (names: readonly string[], pieces: number): string =>
  `${listWords(names)} don't all touch, so they can't be joined into one part (joining them gives ${pieces} separate pieces). Move them in Design so they touch or overlap, or test them one at a time.`;

/**
 * The study on the joined part (`result`, the union of `parts` in order, and `view`, its view): each picked face
 * followed by the boolean's history to the faces it became, by the body it was found on and its face there. Refused
 * in words when the union is not one piece or its history doesn't fit its view. Pure.
 */
export function unionStudy(study: Study, parts: readonly JoinPart[], result: BooleanResult, view: Pick<BodyView, "mesh" | "faces">): JoinedNow | { refused: string } {
  if (result.bodies.length !== 1) return { refused: apartWords(parts.map((p) => p.label), result.bodies.length) };
  const h = result.history[0];
  if (h.faces.length !== view.faces || view.mesh.triangle_faces.some((f) => f >= view.faces)) return { refused: "the joined part's faces don't match its history, so no face can be followed onto it: please report this." };
  const part = new Map(parts.map((p, k) => [p.handle, k]));
  const key = (k: number, face: number) => `${k}:${face}`;
  // Each face of the joined part: every input face (by body and face) it lies on, its first origin first.
  const origins = h.faces.map((f, j) => [f, ...(h.also?.[j] ?? [])].flatMap((o) => (part.has(o.body) ? [key(part.get(o.body)!, o.face)] : [])));
  const byInput = new Map<string, number[]>();
  origins.forEach((os, j) => os.forEach((o) => byInput.set(o, [...(byInput.get(o) ?? []), j])));
  const nameOf = (o: string) => {
    const [k, f] = o.split(":").map(Number);
    return `${parts[k].faces.labels[f]} of ${parts[k].label}`;
  };
  const held = studyFaces(study);
  const where = new Map<string, string>(); // stable id → "k:face" on the bodies
  held.forEach((hf, r) => {
    for (const [k, p] of parts.entries()) {
      const f = p.faces.found[r];
      if (f?.status === "found") where.set(hf.ref.id, key(k, f.face));
    }
  });
  const pieces = new Map<string, number[]>();
  const found: FaceFound[] = held.map((hf) => {
    const at = where.get(hf.ref.id);
    if (at === undefined) {
      const f = parts.map((p) => p.faces.found[held.indexOf(hf)]).find((x) => x?.status === "shared");
      return f ?? { status: "gone", why: "it is on a body not joined for this test" };
    }
    const js = byInput.get(at) ?? [];
    pieces.set(hf.ref.id, js);
    return js.length > 0 ? { status: "found", face: js[0] } : { status: "gone", why: "it is where the bodies join, so none of it is left on the outside of the joined part" };
  });
  const faces: BodyFaces = {
    mesh: view.mesh,
    faces: origins.map((os) => {
      if (os.length === 0) return null;
      const [k, f] = os[0].split(":").map(Number);
      return parts[k].faces.faces[f];
    }),
    labels: origins.map((os, j) => (os.length === 0 ? `Face ${j + 1} (no name of its own)` : nameOf(os[0]))),
    found,
    inputs: [...new Set(parts.flatMap((p) => p.faces.inputs))],
  };
  const now = studyOn(study, faces);
  // A hold's or load's face that became one with a face it didn't pick takes in the whole joined face: said, never silent.
  const notes: string[] = [];
  const say = (owner: string, picked: readonly HeldFace[]) => {
    const mine = new Set(picked.flatMap((f) => (where.has(f.ref.id) ? [where.get(f.ref.id)!] : [])));
    const extra = new Set<string>();
    for (const f of picked) for (const j of pieces.get(f.ref.id) ?? []) for (const o of origins[j]) if (!mine.has(o)) extra.add(o);
    if (extra.size === 0) return;
    const others = [...extra].map(nameOf);
    notes.push(`${owner}: joining makes ${listWords(others)} one face with a face it picked, so it ${owner === "Held here" ? "holds" : "pushes on"} ${others.length === 1 ? "that" : "those"} too.`);
  };
  for (const f of study.fixtures) say("Held here", f.faces);
  for (const [i, l] of study.loads.entries()) say(`Load ${i + 1}`, l.faces);
  // A face held and pushed at once can't be: two picks that the join makes one face are refused, naming both.
  const heldOn = new Set(study.fixtures.flatMap((f) => f.faces).flatMap((f) => pieces.get(f.ref.id) ?? []));
  for (const [i, l] of study.loads.entries()) {
    const clash = l.faces.flatMap((f) => pieces.get(f.ref.id) ?? []).find((j) => heldOn.has(j));
    if (clash !== undefined)
      return { refused: `once joined, ${listWords(origins[clash].map(nameOf))} are one face, held and pushed by Load ${i + 1} at once: pick faces that stay apart.` };
  }
  return { ...now, pieces, notes };
}

/**
 * The study's bodies (`group`, its body first) each borrowed from Design as built now (core's `withBody`), joined by
 * the kernel's union, and the joined part lent to `use` with the study followed onto it; every body the union made is
 * freed after, however it ends. Refused in words when the bodies don't make one part, or the kernel won't join them.
 */
export async function withJoined<T>(
  registry: RepresentationRegistry,
  kernel: KernelCalls,
  project: Project,
  study: Study,
  group: readonly JoinedBody[],
  use: (lent: LentBody, on: JoinedNow) => Promise<T>,
): Promise<T | { refused: string }> {
  const refs = studyFaces(study).map((f) => f.ref);
  const parts: JoinPart[] = [];
  const borrow = async (k: number): Promise<T | { refused: string }> => {
    if (k < group.length)
      return registry.withBody(GEOMETRY_OWNER, project, group[k].ref, refs, async (lent) => {
        parts.push({ label: group[k].label, handle: lent.handle, faces: lent.faces });
        return borrow(k + 1);
      });
    let joined: BooleanResult;
    try {
      joined = await kernel.call("body_boolean", parts[0].handle, parts.slice(1).map((p) => p.handle), "union");
    } catch (e) {
      return { refused: `${listWords(group.map((b) => b.label))} can't be joined: ${e instanceof Error ? e.message : String(e)}` };
    }
    try {
      if (joined.bodies.length !== 1) return { refused: apartWords(group.map((b) => b.label), joined.bodies.length) };
      const view = await kernel.call("body_view", joined.bodies[0]);
      const on = unionStudy(study, parts, joined, view);
      if ("refused" in on) return on;
      return await use({ handle: joined.bodies[0], faces: on.faces }, on);
    } finally {
      for (const b of joined.bodies) await kernel.call("body_free", b).catch(() => {});
    }
  };
  return borrow(0);
}

/** The study's bodies' faces side by side as Design shows them now (for picking), each body asked for all of the study's faces. Refused in words for a body Design can't give. */
export async function joinedNow(registry: RepresentationRegistry, project: Project, study: Study, group: readonly JoinedBody[]): Promise<(StudyNow & { owner: number[] }) | { refused: string }> {
  const refs = studyFaces(study).map((f) => f.ref);
  const parts: { label: string; faces: BodyFaces }[] = [];
  for (const b of group) {
    try {
      parts.push({ label: b.label, faces: await registry.facesOf(GEOMETRY_OWNER, project, b.ref, refs) });
    } catch (e) {
      return { refused: `${b.label} can't be tested now: ${e instanceof Error ? e.message : String(e)}.` };
    }
  }
  const side = joinedFaces(parts);
  return { ...studyOn(study, side.faces), owner: side.owner };
}
