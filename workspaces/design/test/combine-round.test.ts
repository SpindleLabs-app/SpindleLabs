// Curved Combine in the app (kernel 0.33.88, 37df): a Combine with a cylinder builds, with the volume a beginner
// expects. Hand-worked parts (a drilled box, a slanted rod through a slab) and seeded ones against closed forms: a rod
// wholly through a box takes πr²·H out of it; a rod at angle θ from upright through a slab t thick, its ends outside,
// meets it in πr²·t / cos θ (every slice of the rod parallel to the slab is an ellipse of area πr² / cos θ). On the
// real kernel, through the app's own rebuild.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, type CombineOperation, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE, type MoveValues } from "../src/move.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();
const SEEDS = Number(process.env.ROUND_COMBINE_SEEDS ?? 30);
const SEED = process.env.FISSION_SEED === undefined ? null : Number(process.env.FISSION_SEED);

/** mulberry32: the same seed gives the same parts. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A box w × d × h from the origin and a cylinder (diameter, length: standing on the ground round the origin) moved by `move`, combined. */
function rodAndBox(size: [number, number, number], rod: [number, number], move: MoveValues, operation: CombineOperation): { doc: DesignDocument; id: string } {
  const one = partDocument("box", ...size);
  const c = insertPreset(one, "cylinder", rod[0], rod[0], rod[1]);
  const m = insertMove(c.doc, [`body:${c.id}`], move);
  return insertCombine(m.doc, "body:feature-1", [`body:${c.id}`], operation);
}
/** The Combine's result and Box 1's volume after it. */
async function built(doc: DesignDocument, id: string): Promise<{ status: string; volume: number | null; bodies: number }> {
  const cache = new BodyCache(kernel);
  try {
    const b = await rebuildTimeline(doc, cache, kernel);
    const box = b.bodies["body:feature-1"];
    return { status: b.results[id].status === "failed" ? `failed: ${(b.results[id] as { message: string }).message}` : b.results[id].status, volume: box ? (await cache.view(box.handle)).volume : null, bodies: Object.keys(b.bodies).length };
  } finally {
    await cache.close();
  }
}
function near(actual: number | null, expected: number, what: string): void {
  assert.ok(actual !== null && Math.abs(actual - expected) <= 1e-9 * expected, `${what}: ${actual} is not ${expected}`);
}

test("hand-worked: a 20 × 20 × 10 box drilled through its middle by a rod r 3 is 4,000 − 90π mm³", async () => {
  // The rod Ø6 × 30 stands round (10, 10) from z = −10 to 20, through the whole 10 mm: 20·20·10 − π·3²·10 = 4,000 − 90π
  // = 3,717.25666118 mm³.
  const { doc, id } = rodAndBox([20, 20, 10], [6, 30], { ...NO_MOVE, x: 10, y: 10, z: -10 }, "cut");
  const r = await built(doc, id);
  assert.equal(r.status, "built");
  assert.equal(r.bodies, 1, "the rod is used up");
  near(r.volume, 4000 - 90 * Math.PI, "drilled box");
});

test("hand-worked: a rod r 5 slanted 60° through a 3.5 mm slab takes out 175π mm³", async () => {
  // The rod Ø10 × 40 turned 60° about Y round its middle (0, 0, 20), then moved so its middle is the slab's middle
  // (20, 20, 1.75): z by 1.75 − 20 = −18.25. Its ends are 20 mm from the middle, far outside the slab (|z| ≤ 20·cos 60° +
  // 5·sin 60° = 14.3 > 1.75), and its ellipse (10 mm across the tilt plus 3.5·tan 60° = 6.1 mm drift) stays inside 40 × 40.
  // Inside: π·5²·3.5 / cos 60° = 25π·7 = 175π = 549.778714378 mm³; the Cut leaves 40·40·3.5 − 175π = 5,600 − 175π.
  const tilt = { ...NO_MOVE, pivotZ: 20, turnY: 60, x: 20, y: 20, z: -18.25 };
  const inside = rodAndBox([40, 40, 3.5], [10, 40], tilt, "intersect");
  near((await built(inside.doc, inside.id)).volume, 175 * Math.PI, "the slab's part of the rod");
  const cut = rodAndBox([40, 40, 3.5], [10, 40], tilt, "cut");
  const r = await built(cut.doc, cut.id);
  assert.equal(r.status, "built");
  near(r.volume, 5600 - 175 * Math.PI, "the slab with its slanted hole");
});

test("seeded: rods through boxes, upright and slanted, against the closed forms", async () => {
  const seeds = SEED === null ? Array.from({ length: SEEDS }, (_, k) => 9100 + k) : [SEED];
  for (const seed of seeds) {
    const rand = random(seed);
    const pick = (lo: number, hi: number) => lo + (hi - lo) * rand();
    // A box from 1 µm-ish fine sizes to 1 m-ish ones is the kernel's own business; here parts a person draws, 5 to 200 mm.
    const scale = 10 ** pick(0.7, 2.3);
    const [w, d, h] = [pick(1, 2) * scale, pick(1, 2) * scale, pick(0.1, 0.3) * scale];
    const r = pick(0.05, 0.2) * Math.min(w, d);
    // Up to 45°, so the ellipse and its drift (at most 0.29 + 0.15 of the box's width) always fit.
    const slant = rand() < 0.5 ? 0 : pick(5, 45);
    const cos = Math.cos((slant * Math.PI) / 180);
    const tan = Math.tan((slant * Math.PI) / 180);
    // Long enough that its ends are well outside: the rod's half length covers the box's height over cos θ plus its radius's tilt.
    const len = 2 * (h / cos + 2 * r * tan + r + 1);
    // Its middle somewhere the ellipse (half axis r / cos θ, drifting h·tan θ across) keeps inside the box in x and y.
    const reach = r / cos + (h * tan) / 2;
    const x = pick(reach + 0.01 * w, w - reach - 0.01 * w);
    const y = pick(r + 0.01 * d, d - r - 0.01 * d);
    const move = { ...NO_MOVE, pivotZ: len / 2, turnY: slant, x, y, z: h / 2 - len / 2 };
    const through = (Math.PI * r * r * h) / cos;
    const what = `seed ${seed}: box ${w.toFixed(3)} × ${d.toFixed(3)} × ${h.toFixed(3)}, rod r ${r.toFixed(3)} at ${slant.toFixed(1)}° (FISSION_SEED=${seed})`;
    for (const operation of ["cut", "intersect"] as CombineOperation[]) {
      const { doc, id } = rodAndBox([w, d, h], [2 * r, len], move, operation);
      const out = await built(doc, id);
      assert.equal(out.status, "built", `${what} ${operation}`);
      near(out.volume, operation === "cut" ? w * d * h - through : through, `${what} ${operation}`);
    }
  }
});
