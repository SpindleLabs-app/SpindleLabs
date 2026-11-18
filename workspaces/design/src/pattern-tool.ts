// The Pattern tool (step 61c): what the Pattern panel (pattern-panel.ts)
// needs worked out, as pure functions workspace.ts drives. The panel's
// boxes read as a Pattern's values (`readPatternBoxes`: an empty box counts
// as 0, as every tool's typed box does, and an empty angle is a full turn),
// the spacing a new row starts with (`startSpacing`: the picked bodies'
// length along the direction and a gap, so the copies start apart), the
// preview (`copiesMesh`: each picked body's shown mesh put where each of
// the kernel's motions puts it, no body built), the words over the view
// and the question a Join that adds nothing asks. The item itself is
// pattern.ts; the rebuild is rebuild.ts `patternRun`.

import type { DisplayMesh, Motion } from "@fission/core";
import { bodiesChanged } from "./body-uses.ts";
import type { DesignDocument } from "./document.ts";
import { FULL_TURN, KERNEL_INPUT_WORDS, PATTERN_AXES, type PatternAxis, type PatternValues } from "./pattern-values.ts";
import type { Scene } from "./scene.ts";

type Point = [number, number, number];
type Box3 = readonly [readonly [number, number, number], readonly [number, number, number]];

/** The panel's three kinds: a row along one axis, a grid along two, or copies round an axis. */
export const PATTERN_KINDS = ["row", "grid", "circular"] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

/** Each kind as the panel's list says it. */
export const KIND_WORDS: Record<PatternKind, string> = { row: "Row", grid: "Grid", circular: "Round an axis" };

/** What the panel's boxes hold: lengths in mm and counts as text (as typed), the angle in degrees, Join. */
export interface PatternTyped {
  kind: PatternKind;
  direction: PatternAxis;
  spacing: string;
  count: string;
  direction2: PatternAxis;
  spacing2: string;
  count2: string;
  axis: PatternAxis;
  centre: [string, string, string];
  count3: string;
  angle: string;
  join: boolean;
}

/** A box's text as a number: empty counts as 0 (the typed-box rule); text that is no number is NaN, which `patternProblem` names. */
const numberOf = (text: string): number => (text.trim() === "" ? 0 : Number(text.trim()));

/**
 * The boxes as a Pattern's values, for `patternProblem` to judge: a row's
 * direction, spacing and count; a grid's with its second direction; round
 * an axis, the centre, count and angle, an empty angle being a full turn
 * (Fusion's default). Counts are read as typed, so "2.5" is refused in
 * `patternProblem`'s words, never rounded.
 */
export function readPatternBoxes(t: PatternTyped): PatternValues {
  if (t.kind === "circular") {
    const angle = t.angle.trim() === "" ? FULL_TURN : Number(t.angle.trim());
    return { kind: "circular", axis: t.axis, centre: t.centre.map(numberOf) as Point, count: numberOf(t.count3), angle, join: t.join };
  }
  const row = { kind: "linear" as const, direction: t.direction, spacing: numberOf(t.spacing), count: numberOf(t.count), join: t.join };
  return t.kind === "grid" ? { ...row, direction2: t.direction2, spacing2: numberOf(t.spacing2), count2: numberOf(t.count2) } : row;
}

/** The boxes holding `v` (Edit feature on a Pattern): a grid's second direction, else the defaults stay in the boxes it doesn't use. */
export function typedOf(v: PatternValues, base: PatternTyped): PatternTyped {
  const text = (n: number) => String(n);
  if (v.kind === "circular") {
    const full = Math.abs(v.angle) === FULL_TURN && v.angle > 0;
    return { ...base, kind: "circular", axis: v.axis, centre: v.centre.map(text) as [string, string, string], count3: text(v.count), angle: full ? "" : text(v.angle), join: v.join };
  }
  const grid = v.direction2 !== undefined;
  return { ...base, kind: grid ? "grid" : "row", direction: v.direction, spacing: text(v.spacing), count: text(v.count), ...(grid ? { direction2: v.direction2!, spacing2: text(v.spacing2!), count2: text(v.count2!) } : {}), join: v.join };
}

/** The gap a new row's spacing leaves between copies, in mm. */
export const START_GAP = 5;
/** The spacing a new row starts with when nothing is picked. */
export const START_SPACING = 20;

/**
 * The spacing a new Pattern's boxes start at along `axis`: the length of
 * the box round the picked bodies along it plus `START_GAP`, rounded up to
 * a whole mm, so the copies start side by side and apart, never on top of
 * the bodies; `START_SPACING` with nothing picked.
 */
export function startSpacing(boxes: readonly Box3[], axis: PatternAxis): number {
  if (boxes.length === 0) return START_SPACING;
  const k = PATTERN_AXES.indexOf(axis);
  const low = Math.min(...boxes.map((b) => b[0][k]));
  const high = Math.max(...boxes.map((b) => b[1][k]));
  return Math.ceil(high - low + START_GAP);
}

/**
 * `p` put where `motion` puts it (the kernel's motions, `pattern_motions`):
 * a move shifts it; a turn turns it by `angle` radians about the line
 * through `pivot` along `axis` (a unit vector), counter-clockwise looking
 * down the axis (Rodrigues' formula). With `vector` a direction (a normal)
 * is only turned. Pattern's motions are only moves and turns; anything else
 * is refused, never guessed.
 */
export function motionPoint(p: readonly number[], motion: Motion, vector = false): Point {
  if ("move" in motion) return vector ? [p[0], p[1], p[2]] : [p[0] + motion.move[0], p[1] + motion.move[1], p[2] + motion.move[2]];
  if (!("turn" in motion)) throw new Error("a pattern's copies are only moved or turned");
  const { pivot, axis, angle } = motion.turn;
  const o = vector ? [0, 0, 0] : pivot;
  const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  const cross = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
  return [0, 1, 2].map((k) => v[k] * c + cross[k] * s + axis[k] * dot * (1 - c) + o[k]) as Point;
}

/**
 * The preview's copies as one mesh: each picked body's shown mesh (on
 * `scene`, by body id, in the order picked), once per motion in the
 * kernel's order, its points and edge lines moved and its normals turned.
 * Drawn see-through over the bodies, so a click still picks the bodies under
 * them; null when there is nothing to draw (no body shown, no motion).
 */
export function copiesMesh(scene: Scene, bodies: readonly string[], motions: readonly Motion[]): DisplayMesh | null {
  const shown = bodies.flatMap((id) => scene.bodies.filter((b) => b.body === id));
  if (shown.length === 0 || motions.length === 0) return null;
  const out: DisplayMesh = { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] };
  const moveAll = (list: readonly number[], m: Motion, vector: boolean, into: number[]) => {
    for (let n = 0; n < list.length; n += 3) into.push(...motionPoint(list.slice(n, n + 3), m, vector));
  };
  for (const b of shown) {
    const mesh = b.view.mesh;
    for (const m of motions) {
      const first = out.positions.length / 3;
      moveAll(mesh.positions, m, false, out.positions);
      moveAll(mesh.normals, m, true, out.normals);
      for (const i of mesh.indices) out.indices.push(i + first);
      out.triangle_faces.push(...mesh.triangle_faces);
      moveAll(mesh.edge_lines, m, false, out.edge_lines);
      out.edge_line_edges.push(...mesh.edge_line_edges);
    }
  }
  return out;
}

/** The hint over the view while a new Pattern has no body yet. */
export function patternHintWords(touch: boolean): string {
  return `Pattern: ${touch ? "tap" : "click"} the bodies to repeat`;
}

/** The panel's line naming the picked bodies, or how to pick them. */
export function bodiesWords(names: readonly string[], touch: boolean): string {
  if (names.length === 0) return `${touch ? "Tap" : "Click"} the bodies to repeat, in the view or the browser.`;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Repeating ${list}`;
}

/** Why the kernel refused the preview's pattern, in the pattern's own words: the input it names (`KERNEL_INPUT_WORDS`), never its sentence. */
export function refusalWords(inputs: readonly { input: string; name?: string }[]): string {
  const named = inputs.flatMap((x) => (x.input === "param" && x.name !== undefined && Object.hasOwn(KERNEL_INPUT_WORDS, x.name) ? [KERNEL_INPUT_WORDS[x.name]] : []));
  return named.length > 0 ? `The kernel can't use ${named[0]}: change it and try again.` : "The kernel can't make this pattern: change it and try again.";
}

/** Why an edited Pattern shows no preview. */
export const FAILED_NO_PREVIEW = "No preview while this Pattern has failed: press OK to try the new values.";
export const JOINED_NO_PREVIEW = "No preview for a joined Pattern: its bodies are drawn joined, so the result shows after OK.";
export const LATER_CHANGES = "No preview: an item after this Pattern changes its bodies, so the result shows after OK.";

/**
 * Why Edit feature on Pattern `id` can't preview its copies from the bodies
 * shown, or null when it can: the view shows its bodies as they are at the
 * end of the timeline, which is how the Pattern copies them only while it
 * built, without Join (Join draws them with their copies joined in), and no
 * built item after it changes them (a Move, a Combine, a Chamfer).
 */
export function editPreviewOff(doc: DesignDocument, id: string, results: Readonly<Record<string, { status: string }>>): string | null {
  const features = doc.timeline.features;
  const at = features.findIndex((f) => f.id === id);
  const f = features[at];
  if (f === undefined || results[id]?.status !== "built") return FAILED_NO_PREVIEW;
  if (f.intent.parameters.join === true) return JOINED_NO_PREVIEW;
  const sources = new Set(f.intent.parameters.bodies as string[]);
  const later = features.slice(at + 1).some((g) => results[g.id]?.status === "built" && bodiesChanged(g).some((b) => sources.has(b)));
  return later ? LATER_CHANGES : null;
}
