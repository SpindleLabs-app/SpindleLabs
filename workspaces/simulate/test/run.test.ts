// TestLab's Run (run.ts, results.ts): the study turned into the kernel's test and the answer checked, each number
// worked out by hand in the comment beside it. On the real kernel: packages/testing journeys/testlab-run.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { materialLibrary, type DisplayMesh, type FaceFound, type StableId, type StressTestResult } from "@fission/core";
import { answerProblem, bentMesh, drawnScale, factorFigure, faceFacts, figure, FLAT_FACE, kernelLoads, MAX_IMBALANCE, MAX_RESIDUAL, safetyBand, safetyWords, scaleColour, stressTestOf, type StudyNow } from "../src/index.ts";
import { factorWords, resultOf, scaleWords } from "../src/results.ts";
import type { Load, Study } from "../src/study.ts";

const ref = (id: string) => ({ kind: "face" as const, id: id as StableId });

/** A mesh of one triangle a face: `tris[f]` the three corners of face f's triangle. */
function meshOf(tris: number[][][]): DisplayMesh {
  const positions = tris.flat(2);
  return { positions, normals: positions.map(() => 0), indices: tris.flatMap((_, t) => [3 * t, 3 * t + 1, 3 * t + 2]), triangle_faces: tris.map((_, f) => f), edge_lines: [], edge_line_edges: [] };
}

/** Two faces: face 0 a triangle in the plane z = 1 (area 2, outward +Z), face 1 one in the plane x = 3 (area 6, outward +X). */
const twoFaces = meshOf([
  [[0, 0, 1], [2, 0, 1], [0, 2, 1]],
  [[3, 0, 0], [3, 3, 0], [3, 0, 4]],
]);

/** Equal to within a few units in the last place (the hand-worked value is exact, the double rounds). */
function near(got: readonly number[], want: readonly number[]) {
  assert.equal(got.length, want.length);
  got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) <= 1e-12 * Math.max(1, Math.abs(want[i])), `${got} is not ${want}`));
}

const load = (l: Partial<Load>): Load => ({ id: "load-1", faces: [], amount: 10, unit: "N", direction: "down", ...l });

test("faceFacts: a face's area and outward normal by hand", () => {
  // Face 0: legs 2 and 2, area 2·2/2 = 2; (2,0,0) × (0,2,0) = (0,0,4), outward +Z.
  assert.deepEqual(faceFacts(twoFaces, 0), { area: 2, normal: [0, 0, 1], flat: true });
  // Face 1: legs 3 (along y) and 4 (along z), area 6; (0,3,0) × (0,0,4) = (12,0,0), outward +X.
  assert.deepEqual(faceFacts(twoFaces, 1), { area: 6, normal: [1, 0, 0], flat: true });
  // A face with no triangle has no area and is never taken as flat.
  assert.equal(faceFacts(twoFaces, 5).flat, false);
});

test("faceFacts: flat within FLAT_FACE at 0.9× and not at 1.1×", () => {
  // A big triangle in z = 0 (area 500,000) and a small one tilted: (−1,0,0) × (0,−1,z) = (0, z, 1), whose sine to +Z
  // is z/√(1 + z²) ≈ z. The big one sets the face's normal (the small one moves it by about 1e-6 of its own tilt).
  const tilted = (z: number) =>
    meshOf([
      [[0, 0, 0], [1000, 0, 0], [0, 1000, 0]],
      [[0, 0, 0], [-1, 0, 0], [0, -1, z]],
    ]);
  const one = (z: number): DisplayMesh => ({ ...tilted(z), triangle_faces: [0, 0] });
  assert.equal(faceFacts(one(0.9 * FLAT_FACE), 0).flat, true);
  assert.equal(faceFacts(one(1.1 * FLAT_FACE), 0).flat, false);
});

test("loads in the kernel's terms: a mass hanging, a pressure, an axis, square into faces split by area", () => {
  // 5 kg hanging is 5 × 9.80665 = 49.03325 N, down (−Z) (to the double's last place).
  const hanging = kernelLoads(load({ amount: 5, unit: "kg" }), [0], twoFaces, "Load 1") as { faces: number[]; force: number[] }[];
  assert.deepEqual(hanging[0].faces, [0]);
  near(hanging[0].force, [0, 0, -49.03325]);
  // 50 kPa is 50 / 1000 = 0.05 MPa (N/mm²), always pushing in.
  assert.deepEqual(kernelLoads(load({ amount: 50, unit: "kPa", direction: "into" }), [0, 1], twoFaces, "Load 1"), [{ faces: [0, 1], pressure: 0.05 }]);
  // 10 N along +Y on both faces: one total.
  assert.deepEqual(kernelLoads(load({ direction: "+y" }), [0, 1], twoFaces, "Load 1"), [{ faces: [0, 1], force: [0, 10, 0] }]);
  // 80 N square into both: areas 2 and 6 of 8, so 20 N against +Z and 60 N against +X; each face gets 10 N/mm².
  assert.deepEqual(kernelLoads(load({ amount: 80, direction: "into" }), [0, 1], twoFaces, "Load 1"), [
    { faces: [0], force: [-0, -0, -20] },
    { faces: [1], force: [-60, -0, -0] },
  ]);
  // Square into a face that isn't flat is refused in words.
  const bent: DisplayMesh = { ...twoFaces, triangle_faces: [0, 0] };
  assert.deepEqual(kernelLoads(load({ direction: "into" }), [0], bent, "Load 2"), { refused: "Load 2 pushes square into a face that isn't flat: choose a direction (down, up, along X or Y) or a pressure." });
});

test("the study as the kernel's test: PLA's weaker way in MPa, each face once, lost faces left for readyProblems", () => {
  const study: Study = {
    id: "study-1",
    name: "Study 1",
    kind: "static",
    body: { ref: { kind: "body", id: "body:feature-1" as StableId }, label: "Body 1" },
    material: "pla",
    mesh: "normal",
    fixtures: [{ id: "fixture-2", faces: [{ ref: ref("a"), label: "Top face" }, { ref: ref("a2"), label: "Top face" }] }],
    loads: [load({ faces: [{ ref: ref("b"), label: "Side face" }], amount: 2, unit: "kg", direction: "-x" })],
  };
  const found = new Map<string, FaceFound>([
    ["a", { status: "found", face: 0 }],
    ["a2", { status: "found", face: 0 }],
    ["b", { status: "found", face: 1 }],
  ]);
  const now: StudyNow = { faces: { mesh: twoFaces, faces: [ref("a"), ref("b")], labels: ["Top face", "Side face"], found: [], inputs: [] }, found, lost: [] };
  // PLA across the layers: stiffness min(2160 tensile, 2370 bending) = 2160 MPa, strength 35 MPa, ratio 0.35.
  // 2 kg along −X: 2 × 9.80665 = 19.6133 N.
  assert.deepEqual(stressTestOf(study, now, materialLibrary().get("pla")!.mechanical!), {
    youngsModulus: 2160,
    poissonsRatio: 0.35,
    strength: 35,
    held: [0],
    loads: [{ faces: [1], force: [-19.6133, 0, 0] }],
  });
});

/** A sound answer: the 100 × 10 × 10 bar pulled 1000 N along +X, held at x = 0, cut down to two points. */
function sound(): StressTestResult {
  return {
    points: [0, 0, 0, 100, 0, 0, 100, 10, 0],
    triangles: [0, 1, 2],
    triangleFaces: [3],
    displacement: [0, 0, 0, 0.005, 0, 0, 0.005, 0, 0],
    vonMises: [10, 10, 10],
    maxDisplacement: 0.005,
    maxDisplacementAt: [100, 0, 0],
    maxVonMises: 10,
    maxVonMisesAt: [0, 0, 0],
    safetyFactor: 25,
    applied: [1000, 0, 0],
    reaction: [-1000, 0, 0],
    size: 5,
    nodes: 3,
    elements: 1,
    worstQuality: 0.5,
    method: "direct",
    iterations: 1,
    relativeResidual: 1e-12,
  };
}

test("an answer is checked before it is shown: each check broken alone, and the limits at 0.9× and 1.1×", () => {
  // The sound answer's strength: safety factor 25 against its biggest stress 10 MPa is 25 × 10 = 250 MPa.
  assert.equal(answerProblem(sound(), 250), null);
  const broken = (change: Partial<StressTestResult>) => answerProblem({ ...sound(), ...change }, 250);
  assert.match(broken({ vonMises: [10, 10] })!, /its lists don't fit together/);
  assert.match(broken({ triangles: [0, 1, 3] })!, /its surface doesn't fit together/);
  assert.match(broken({ displacement: [0, 0, 0, NaN, 0, 0, 0, 0, 0] })!, /a number in it isn't one/);
  assert.match(broken({ safetyFactor: -1 })!, /its safety factor isn't a number above 0/);
  assert.match(broken({ vonMises: [10, 11, 10] })!, /a point bends or is stressed more than its largest/);
  assert.match(broken({ applied: [0, 0, 0], reaction: [0, 0, 0] })!, /don't balance/);
  // The safety factor must be measured against the biggest stress shown (the safe side): 250 / 10 = 25. One
  // measured against a lower stress inside the part (C-1: about 14% under the surface on bending, 250 / 8.6 = 29.1)
  // is refused, as is a factor with nothing stressed or none with something stressed.
  assert.match(broken({ safetyFactor: 250 / 8.6 })!, /its safety factor isn't measured against its biggest stress/);
  assert.match(broken({ safetyFactor: 25 * (1 + 1e-9) })!, /its safety factor isn't measured against its biggest stress/);
  assert.match(broken({ safetyFactor: null })!, /its safety factor isn't measured against its biggest stress/);
  assert.match(broken({ maxVonMises: 0, vonMises: [0, 0, 0] })!, /its safety factor isn't measured against its biggest stress/);
  assert.equal(broken({ maxVonMises: 0, vonMises: [0, 0, 0], safetyFactor: null }), null);
  // Residual: 0.9 × 1e-6 shown, 1.1 × 1e-6 refused.
  assert.equal(broken({ relativeResidual: 0.9 * MAX_RESIDUAL }), null);
  assert.match(broken({ relativeResidual: 1.1 * MAX_RESIDUAL })!, /the solver didn't settle on an answer/);
  // Balance: the reaction off by 0.9e-6 × 1000 N = 0.0009 N shown, by 0.0011 N refused.
  assert.equal(broken({ reaction: [-1000 + 0.9 * MAX_IMBALANCE * 1000, 0, 0] }), null);
  assert.match(broken({ reaction: [-1000 + 1.1 * MAX_IMBALANCE * 1000, 0, 0] })!, /the loads and what holds the part don't balance/);
});

test("how much bigger the bend is drawn, by hand", () => {
  // The 100 × 10 × 10 bar: diagonal √(100² + 10² + 10²) = √10200 = 100.995 mm; a twentieth is 5.0498 mm.
  const d = Math.sqrt(10200);
  assert.equal(drawnScale(0.005, d), 1000); // 5.0498 / 0.005 = 1009.95, rounded down to 1 × 10³
  assert.equal(drawnScale(0.2, d), 20); // 25.25, rounded down to 2 × 10
  assert.equal(drawnScale(0.0005, d), 10000); // 10,099.5, rounded down to 1 × 10⁴
  assert.equal(drawnScale(0.001, d), 5000); // 5049.8, rounded down to 5 × 10³
  assert.equal(drawnScale(10, d), 1); // 0.505: already big enough, drawn as it is
  assert.equal(drawnScale(0, d), 1); // nothing moves
  assert.equal(scaleWords(1000), "The bend is drawn 1,000 times bigger than it really is, so you can see it.");
  assert.equal(scaleWords(1), "The bend is drawn as big as it really is.");
});

test("a bend too big for the small-bend maths is drawn smaller, by hand (Ben's bar, 19 Nov)", () => {
  // The 100 × 10 × 10 bar again: diagonal 100.995 mm, so a bend over a tenth of it, 10.0995 mm, is too big to draw as it is
  // (the maths moves each point in a straight line, so a big bend stretches the part, Ben's "10 times bigger").
  const d = Math.sqrt(10200);
  // 0.9 × and 1.1 × the limit: 9.0896 mm is drawn as it is; 11.109 mm is drawn at a tenth of the diagonal over the bend,
  // 10.0995 / 11.109 = 0.909, rounded down to 5 × 10⁻¹: half size, 5.55 mm drawn.
  assert.equal(drawnScale(0.9 * (d / 10), d), 1);
  assert.equal(drawnScale(1.1 * (d / 10), d), 0.5);
  // Ben's bar: 1000 × 5 × 5, diagonal √(1000² + 5² + 5²) = 1000.025 mm, bend 6,947 mm: 100.0025 / 6947 = 0.0144,
  // rounded down to 1 × 10⁻²: drawn a hundred times smaller, 69.5 mm, under a tenth of the bar's length.
  const bar = Math.sqrt(1000 ** 2 + 50);
  assert.equal(drawnScale(6947, bar), 0.01);
  assert.ok(6947 * drawnScale(6947, bar) <= bar / 10);
  // 3 × 10⁻³ from 0.003 is 2 × 10⁻³; 0.004 rounds down to 2 × 10⁻³ too; 0.006 to 5 × 10⁻³.
  assert.equal(drawnScale(d / 10 / 0.003, d), 0.002);
  assert.equal(drawnScale(d / 10 / 0.006, d), 0.005);
  assert.equal(scaleWords(0.01), "This estimate is for small bends and this one is too big to draw truly, so it is drawn 100 times smaller than worked out, just to show which way the part goes.");
  assert.equal(scaleWords(0.005), "This estimate is for small bends and this one is too big to draw truly, so it is drawn 200 times smaller than worked out, just to show which way the part goes.");
});

test("the safety factor's bands at their edges, and its words", () => {
  assert.deepEqual([0.99, 1, 1.99, 2, null].map(safetyBand), ["fails", "close", "close", "safe", "safe"]);
  assert.match(safetyWords(0.5, "tensile"), /would break under these loads/);
  assert.match(safetyWords(0.5, "yield"), /would bend for good under these loads/);
  assert.match(safetyWords(1.5, "tensile"), /little to spare.*Aim for 2 or more/);
  assert.equal(safetyWords(3.5, "tensile"), "It holds with room to spare: the material is 3.5 times stronger than the biggest stress.");
  assert.equal(safetyWords(null, "tensile"), "Nothing in the part is stressed by these loads.");
  assert.deepEqual([factorWords(3.456), factorWords(2000), factorWords(null)], ["3.46", "over 1,000", "none"]);
  assert.deepEqual([figure(0.004983), figure(10.85), figure(1250.4), figure(0)], ["0.00498", "10.8", "1,250", "0"]);
});

test("the colour scale: blue at 0, green halfway, red at the top, clamped outside", () => {
  near(scaleColour(0), [0.13, 0.33, 0.85]);
  near(scaleColour(0.5), [0.2, 0.75, 0.3]);
  near(scaleColour(1), [0.85, 0.15, 0.12]);
  assert.deepEqual(scaleColour(-3), scaleColour(0));
  assert.deepEqual(scaleColour(7), scaleColour(1));
  // A quarter of the way is the second stop exactly: cyan.
  near(scaleColour(0.25), [0.1, 0.75, 0.85]);
});

test("the bent mesh: a vertex per point per face, an edge line where faces meet and round the outside", () => {
  // Points 0..3 of a unit square; triangle (0,1,2) on face 4, (1,3,2) on face 7. Their shared side 1–2 is a crease
  // between two faces; the four outside sides have one triangle each. So 3 + 3 = 6 vertices and 1 + 4 = 5 edge lines.
  const r = { ...sound(), points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], triangles: [0, 1, 2, 1, 3, 2], triangleFaces: [4, 7], displacement: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5], vonMises: [1, 2, 3, 4] };
  const { mesh, vertexPoint } = bentMesh(r, 2);
  assert.deepEqual(vertexPoint, [0, 1, 2, 1, 3, 2]);
  assert.equal(mesh.edge_lines.length / 6, 5);
  assert.deepEqual(mesh.triangle_faces, [4, 7]);
  // Point 3 moves 0.5 along Z, drawn twice as far: (1, 1, 1).
  assert.deepEqual(mesh.positions.slice(12, 15), [1, 1, 1]);
  // The first face is flat in z = 0 and wound counter-clockwise from above: its normals are +Z.
  assert.deepEqual(mesh.normals.slice(0, 3), [0, 0, 1]);
});

test("a result made from an answer: the scale from the surface's own size", () => {
  // The sound answer's points span 100 × 10 × 0: diagonal √10100 = 100.5 mm; a twentieth is 5.025 mm over a
  // 0.005 mm bend, 1005, so drawn 1000 times.
  const r = resultOf(sound(), { name: "Steel", mechanical: materialLibrary().get("steel-a36")!.mechanical! }, { body: "Body 1", held: [], loads: [] });
  assert.equal(r.scale, 1000);
  assert.deepEqual(r.bend, [0, 0.005, 0.005]);
});

test("the safety factor's figure never shows the next band's edge: three figures, rounded down where rounding would cross a band edge, so the number agrees with its band (bug sweep 2026-11-28, A2-5)", () => {
  // By hand: 1.9996 to three figures is 2.00 rounded, but it is below 2, so close; rounded down it is 1.99, which reads as
  // close too. 0.9996 rounded is 1.00 but it fails; down it is 0.999. Away from an edge it rounds as every figure does:
  // 2 -> 2, 1 -> 1, 3.456 -> 3.46, 12.34 -> 12.3.
  for (const [f, shown, band] of [[1.9996, "1.99", "close"], [1.9951, "1.99", "close"], [0.9996, "0.999", "fails"], [2, "2", "safe"], [1, "1", "close"], [3.456, "3.46", "safe"], [2.01, "2.01", "safe"], [0.549, "0.549", "fails"], [12.34, "12.3", "safe"]] as const) {
    assert.equal(factorFigure(f), shown, `${f}`);
    assert.equal(safetyBand(f), band, `${f}`);
    // The band the shown figure would be read as is the band the words say.
    assert.equal(safetyBand(Number(shown)), band, `${f}: shown ${shown}`);
  }
  // The badge and the words say that figure.
  assert.equal(factorWords(1.9996), "1.99");
  assert.match(safetyWords(2.0049, "tensile"), /is 2 times stronger/);
});
