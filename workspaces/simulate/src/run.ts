// TestLab's Run (step T5b): a study on the body as it is now turned into
// the kernel's stress test, and its answer checked and turned into what the
// page shows. Pure functions only; page.ts does the calling.
//
// Units: the kernel works in millimetres, newtons and megapascals (N/mm²).
// The materials library keeps pascals, so stiffness and strength are divided
// by 1,000,000; a pressure typed in kilopascals is divided by 1,000; a mass
// hanging is m × G newtons (study.ts `newtons`).
//
// Nothing here guesses: a load that can't be turned into the kernel's terms
// is refused in words, and an answer that fails its own checks (the loads
// and the holds' reactions not balancing, the solver not converged, a
// number that isn't one) is refused rather than shown.

import { weakerWay, type DisplayMesh, type Mechanical, type StressLoad, type StressStage, type StressTest, type StressTestResult } from "@fission/core";
import type { StudyNow } from "./faces.ts";
import { newtons, type Direction, type HeldFace, type Load, type Study } from "./study.ts";

/** Pascals in a megapascal: the library's numbers to the kernel's. */
export const PA_PER_MPA = 1e6;
/** Kilopascals in a megapascal: a typed pressure to the kernel's. */
export const KPA_PER_MPA = 1e3;

/** Each world direction a force can push along (Design's Z is up, so "down" is −Z, the way gravity pulls). */
export const AXIS: Readonly<Record<Exclude<Direction, "into">, [number, number, number]>> = {
  down: [0, 0, -1],
  up: [0, 0, 1],
  "+x": [1, 0, 0],
  "-x": [-1, 0, 0],
  "+y": [0, 1, 0],
  "-y": [0, -1, 0],
};

/**
 * How far a face's triangles may turn from the face's own normal (the sine
 * of the angle between them) and the face still count as flat for a push
 * square into it: 1e-6, a turn of about 0.2 seconds of arc, far below any
 * face Design makes on purpose and far above the display mesh's rounding.
 */
export const FLAT_FACE = 1e-6;

/** The largest relative residual an answer may have to be shown: 1e-6, ten thousand times the solver's own target (1e-10), so only an answer that did not converge is refused. */
export const MAX_RESIDUAL = 1e-6;

/**
 * How far the holds' reactions may be from balancing the loads, as a share
 * of the loads' total: 1e-6. A converged answer balances to round-off; an
 * answer off by more than this carries a load the solver lost.
 */
export const MAX_IMBALANCE = 1e-6;

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);

/**
 * Face `face` of a display mesh: its area (mm²) and its unit outward normal,
 * the area-weighted sum of its triangles' (the kernel winds them outwards);
 * `flat` is false when a triangle turns from that normal by more than
 * FLAT_FACE, or the face has no area.
 */
export function faceFacts(mesh: Pick<DisplayMesh, "positions" | "indices" | "triangle_faces">, face: number): { area: number; normal: [number, number, number]; flat: boolean } {
  const p = (i: number) => [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
  const sum = [0, 0, 0];
  const each: number[][] = [];
  mesh.triangle_faces.forEach((f, t) => {
    if (f !== face) return;
    const a = p(mesh.indices[3 * t]);
    const n = cross(sub(p(mesh.indices[3 * t + 1]), a), sub(p(mesh.indices[3 * t + 2]), a)); // twice the triangle's area, along its normal
    each.push(n);
    for (let k = 0; k < 3; k++) sum[k] += n[k];
  });
  const twice = length(sum);
  if (!(twice > 0)) return { area: 0, normal: [0, 0, 0], flat: false };
  const normal: [number, number, number] = [sum[0] / twice, sum[1] / twice, sum[2] / twice];
  const flat = each.every((n) => {
    const l = length(n);
    return l === 0 || length(cross(n, normal)) / l <= FLAT_FACE;
  });
  return { area: twice / 2, normal, flat };
}

/**
 * The faces of a hold or load found on the body now, by index, each once. On bodies joined for the test (join.ts)
 * a picked face the join cut into pieces is every piece (`pieces`).
 */
function indices(faces: readonly HeldFace[], now: StudyNow & { pieces?: ReadonlyMap<string, readonly number[]> }): number[] {
  const out = new Set<number>();
  for (const f of faces) {
    const pieces = now.pieces?.get(f.ref.id);
    if (pieces !== undefined) for (const p of pieces) out.add(p);
    else {
      const at = now.found.get(f.ref.id);
      if (at?.status === "found") out.add(at.face);
    }
  }
  return [...out];
}

/**
 * One load as the kernel's: a pressure in MPa; a force along a world axis as
 * one total force (N) over its faces; a force square into its faces as one
 * load a face, the total split by area, each pushing against that face's
 * outward normal, so every face is pushed equally hard (the same force per
 * mm²) as one total spread evenly over them all would. Refused in words for a
 * push square into a face that isn't flat.
 */
export function kernelLoads(load: Load, faces: readonly number[], mesh: Pick<DisplayMesh, "positions" | "indices" | "triangle_faces">, name: string): StressLoad[] | { refused: string } {
  if (load.unit === "kPa") return [{ faces: [...faces], pressure: load.amount / KPA_PER_MPA }];
  const total = newtons(load)!;
  if (load.direction !== "into") {
    const d = AXIS[load.direction];
    return [{ faces: [...faces], force: [total * d[0], total * d[1], total * d[2]] }];
  }
  const facts = faces.map((f) => faceFacts(mesh, f));
  if (facts.some((f) => !f.flat)) return { refused: `${name} pushes square into a face that isn't flat: choose a direction (down, up, along X or Y) or a pressure.` };
  const area = facts.reduce((a, f) => a + f.area, 0);
  return faces.map((face, i) => {
    const share = (total * facts[i].area) / area;
    const n = facts[i].normal;
    return { faces: [face], force: [-share * n[0], -share * n[1], -share * n[2]] as [number, number, number] };
  });
}

/**
 * The study as the kernel's stress test on the body now (`now`, from the same
 * look-up whose body is tested), made of `material`: the weaker way's
 * stiffness and strength (study.ts T2), the mesh size left to the kernel.
 * Refused in words when something can't be sent.
 */
export function stressTestOf(study: Study, now: StudyNow & { pieces?: ReadonlyMap<string, readonly number[]> }, material: Mechanical): StressTest | { refused: string } {
  const weak = weakerWay(material);
  const loads: StressLoad[] = [];
  for (const [i, l] of study.loads.entries()) {
    const got = kernelLoads(l, indices(l.faces, now), now.faces.mesh, `Load ${i + 1}`);
    if ("refused" in got) return got;
    loads.push(...got);
  }
  return {
    youngsModulus: weak.stiffness / PA_PER_MPA,
    poissonsRatio: material.poissonsRatio,
    strength: weak.strength / PA_PER_MPA,
    held: indices(
      study.fixtures.flatMap((f) => f.faces),
      now,
    ),
    loads,
  };
}

const finite = (xs: readonly number[]) => xs.every((x) => typeof x === "number" && Number.isFinite(x));

/**
 * Why the kernel's answer can't be shown, in words; null when it passes
 * every check: its lists fit together and hold numbers, the largest bend and
 * stress are at least those listed, the safety factor is the strength
 * (MPa, as sent) over that largest stress (so it is measured against the
 * highest stress found anywhere, the safe side, never a lower one), the
 * solver converged (MAX_RESIDUAL) and the holds' reactions balance the loads
 * (MAX_IMBALANCE).
 */
export function answerProblem(r: StressTestResult, strength: number): string | null {
  const bad = (why: string) => `TestLab's answer didn't check out (${why}), so it is not shown. Please report this.`;
  const n = r.points.length / 3;
  if (!Number.isInteger(n) || n === 0 || r.displacement.length !== r.points.length || r.vonMises.length !== n) return bad("its lists don't fit together");
  if (r.triangles.length % 3 !== 0 || r.triangleFaces.length !== r.triangles.length / 3 || r.triangles.some((i) => !(Number.isInteger(i) && i >= 0 && i < n))) return bad("its surface doesn't fit together");
  if (!finite(r.points) || !finite(r.displacement) || !finite(r.vonMises) || !finite([r.maxDisplacement, r.maxVonMises, r.relativeResidual, ...r.applied, ...r.reaction])) return bad("a number in it isn't one");
  if (r.safetyFactor !== null && !(Number.isFinite(r.safetyFactor) && r.safetyFactor > 0)) return bad("its safety factor isn't a number above 0");
  const most = Math.max(...r.vonMises.map(Math.abs));
  let bend = 0;
  for (let i = 0; i < n; i++) bend = Math.max(bend, length(r.displacement.slice(3 * i, 3 * i + 3)));
  if (most > r.maxVonMises * (1 + 1e-12) || bend > r.maxDisplacement * (1 + 1e-12)) return bad("a point bends or is stressed more than its largest");
  const factorOff = r.maxVonMises > 0 ? r.safetyFactor === null || Math.abs(r.safetyFactor * r.maxVonMises - strength) > 1e-12 * strength : r.safetyFactor !== null;
  if (factorOff) return bad("its safety factor isn't measured against its biggest stress");
  if (!(r.relativeResidual <= MAX_RESIDUAL)) return bad("the solver didn't settle on an answer");
  const applied = length(r.applied);
  const off = length([r.applied[0] + r.reaction[0], r.applied[1] + r.reaction[1], r.applied[2] + r.reaction[2]]);
  if (!(applied > 0) || off > MAX_IMBALANCE * applied) return bad("the loads and what holds the part don't balance");
  return null;
}

/**
 * The most a bend may be drawn, as a share of the body's size (its box's diagonal): past a tenth, the small-bend maths
 * (each point moved in a straight line) visibly stretches the part, and drawn at true size a part far past breaking
 * grew ten times its length and threw the view off (Ben's 1000 mm bar, 19 Nov).
 */
export const MOST_DRAWN_BEND = 0.1;

/** `wanted` rounded down to 1, 2 or 5 times a power of ten. */
function roundDown125(wanted: number): number {
  const power = 10 ** Math.floor(Math.log10(wanted));
  const step = [5, 2, 1].find((k) => k * power <= wanted * (1 + 1e-12)) ?? 1;
  return step * power;
}

/**
 * How many times bigger than real the bend is drawn: a small bend scaled up
 * to about a twentieth of the body's size (its box's diagonal), rounded down
 * to 1, 2 or 5 times a power of ten; one up to MOST_DRAWN_BEND of the size
 * drawn as it is; a bigger one scaled down to at most that, rounded down the
 * same way (below 1: drawn smaller than worked out); 1 when nothing moves.
 */
export function drawnScale(maxBend: number, diagonal: number): number {
  if (!(maxBend > 0) || !(diagonal > 0)) return 1;
  const wanted = diagonal / 20 / maxBend;
  if (wanted > 1) return roundDown125(wanted);
  const most = (MOST_DRAWN_BEND * diagonal) / maxBend;
  return most >= 1 ? 1 : roundDown125(most);
}

/** The diagonal of the box round a list of x, y, z points (mm). */
export function boxDiagonal(points: readonly number[]): number {
  if (points.length < 3) return 0;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < points.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], points[i + k]);
      hi[k] = Math.max(hi[k], points[i + k]);
    }
  return length(sub(hi, lo));
}

/**
 * The answer's surface as a display mesh, bent `scale` times its real bend:
 * a vertex for each point on each face it touches (so a face is shaded
 * flat-ish and keeps sharp edges with its neighbours), its normal the
 * face's triangles' around it, its triangles tagged with the body's own face
 * numbers, and an edge line wherever two triangles of different faces meet.
 * `vertexPoint` gives each vertex's point, for the colours.
 */
export function bentMesh(r: StressTestResult, scale: number): { mesh: DisplayMesh; vertexPoint: number[] } {
  const at = (i: number) => [r.points[3 * i] + scale * r.displacement[3 * i], r.points[3 * i + 1] + scale * r.displacement[3 * i + 1], r.points[3 * i + 2] + scale * r.displacement[3 * i + 2]];
  const vertexOf = new Map<string, number>();
  const vertexPoint: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const triangles = r.triangleFaces.length;
  for (let t = 0; t < triangles; t++) {
    const face = r.triangleFaces[t];
    const corners = [r.triangles[3 * t], r.triangles[3 * t + 1], r.triangles[3 * t + 2]];
    const [a, b, c] = corners.map(at);
    const n = cross(sub(b, a), sub(c, a));
    for (const p of corners) {
      const key = `${p}/${face}`;
      let v = vertexOf.get(key);
      if (v === undefined) {
        v = vertexPoint.length;
        vertexOf.set(key, v);
        vertexPoint.push(p);
        positions.push(...at(p));
        normals.push(0, 0, 0);
      }
      for (let k = 0; k < 3; k++) normals[3 * v + k] += n[k];
      indices.push(v);
    }
  }
  for (let v = 0; v < vertexPoint.length; v++) {
    const l = length(normals.slice(3 * v, 3 * v + 3));
    if (l > 0) for (let k = 0; k < 3; k++) normals[3 * v + k] /= l;
  }
  // An edge line where a side of a triangle is shared with a triangle of another face, or with none.
  const sides = new Map<string, { a: number; b: number; faces: Set<number>; count: number }>();
  for (let t = 0; t < triangles; t++)
    for (let k = 0; k < 3; k++) {
      const a = r.triangles[3 * t + k];
      const b = r.triangles[3 * t + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const side = sides.get(key) ?? { a, b, faces: new Set<number>(), count: 0 };
      side.faces.add(r.triangleFaces[t]);
      side.count++;
      sides.set(key, side);
    }
  const edgeLines: number[] = [];
  const edgeLineEdges: number[] = [];
  for (const side of sides.values())
    if (side.faces.size > 1 || side.count < 2) {
      edgeLines.push(...at(side.a), ...at(side.b));
      edgeLineEdges.push(0);
    }
  return { mesh: { positions, normals, indices, triangle_faces: [...r.triangleFaces], edge_lines: edgeLines, edge_line_edges: edgeLineEdges }, vertexPoint };
}

/** The colour scale, low to high (sRGB, 0 to 1): blue, cyan, green, yellow, red. */
export const SCALE_COLOURS: readonly (readonly [number, number, number])[] = [
  [0.13, 0.33, 0.85],
  [0.1, 0.75, 0.85],
  [0.2, 0.75, 0.3],
  [0.95, 0.8, 0.15],
  [0.85, 0.15, 0.12],
];

/** The scale's colour a share `t` of the way up (0 to 1, clamped), straight between its stops. */
export function scaleColour(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (SCALE_COLOURS.length - 1);
  const i = Math.min(SCALE_COLOURS.length - 2, Math.floor(x));
  const f = x - i;
  const a = SCALE_COLOURS[i];
  const b = SCALE_COLOURS[i + 1];
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

/** Each vertex's colour (three a vertex) for `values` per point, from 0 to `top`. */
export function vertexColours(vertexPoint: readonly number[], values: readonly number[], top: number): number[] {
  const out: number[] = [];
  for (const p of vertexPoint) out.push(...scaleColour(top > 0 ? values[p] / top : 0));
  return out;
}

/** Each point's bend (how far it moves, mm). */
export function bends(r: StressTestResult): number[] {
  const out: number[] = [];
  for (let i = 0; i < r.displacement.length; i += 3) out.push(length(r.displacement.slice(i, i + 3)));
  return out;
}

/** A number to three significant figures in words, with thousands marked ("0.00494", "10.2", "1,250"). */
export function figure(x: number): string {
  if (x === 0) return "0";
  if (Math.abs(x) >= 1000) return Math.round(x).toLocaleString("en");
  return Number(x.toPrecision(3)).toLocaleString("en", { maximumSignificantDigits: 3 });
}

/**
 * The safety factor to three significant figures, as `figure`, except where rounding would carry it over its band's edge
 * (1.9996 to "2", 0.9996 to "1"): then rounded down ("1.99", "0.999"), so the number never contradicts its band's words
 * and never claims more strength than worked out (bug sweep 2026-11-28, A2-5).
 */
export function factorFigure(x: number): string {
  const shown = figure(x);
  if (!(x > 0) || x >= 1000 || safetyBand(Number(shown.replaceAll(",", ""))) === safetyBand(x)) return shown;
  const step = 10 ** (Math.floor(Math.log10(x)) - 2);
  return figure(Number((Math.floor(x / step) * step).toPrecision(3)));
}

/** The safety factor's band: below 1 it fails, below 2 it is close, from 2 it has room to spare. */
export type SafetyBand = "fails" | "close" | "safe";

/** Where a safety factor falls (null: nothing is stressed, safe). */
export function safetyBand(factor: number | null): SafetyBand {
  if (factor === null || factor >= 2) return "safe";
  return factor >= 1 ? "close" : "fails";
}

/** The sentence beside the safety factor, for a material whose strength is a yield (metal) or a breaking strength (printed plastic). */
export function safetyWords(factor: number | null, strengthKind: Mechanical["strengthKind"]): string {
  const broken = strengthKind === "yield" ? "bend for good" : "break";
  if (factor === null) return "Nothing in the part is stressed by these loads.";
  const band = safetyBand(factor);
  if (band === "fails") return `The stress goes past the material's strength: the part would ${broken} under these loads.`;
  if (band === "close") return `It holds, but with little to spare: a weaker print or a bigger load could make it ${broken}. Aim for 2 or more.`;
  return `It holds with room to spare: the material is ${factorFigure(factor)} times stronger than the biggest stress.`;
}

/** What the progress line says while a stage runs. */
export const STAGE_WORDS: Readonly<Record<StressStage, string>> = {
  meshing: "Making the mesh…",
  solving: "Solving…",
  stresses: "Working out the stresses…",
};

/** Said with every result: it is an estimate, and how it can be off. */
export const ESTIMATE = "An estimate, not a promise: real prints are weaker across their layers, and the stress at sharp inside corners and held edges reads higher the finer the mesh.";
