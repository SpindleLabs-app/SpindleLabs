// TestLab T5c6, the suggestions' corner and hold checks on the real kernel's stress test: an L bracket made by joining
// two boxes (a base 40 × 10 × 5 and an upright 5 × 10 × 30, both from the origin), held by its bottom and pushed
// sideways at the top of the upright. Worked by hand from the shape: the one inside corner is the edge x = 5, z = 5
// where the upright meets the base's top; the base's far top edge (x = 40, z = 5) is an outside corner; every point of
// the bottom (z = 0) is held still and nothing at the top of the upright is. These checks would fail if the kernel's
// surface were wound inwards or its held points moved, which the hand-made surfaces in suggest.test.ts can't catch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { materialLibrary, weakerWay, type DisplayMesh } from "@fission/core";
import { heldNear, insideCornerNear, resultOf, suggestionsOf } from "@fission/simulate";
import { nodeKernel } from "../src/node-kernel.ts";

const kernel = nodeKernel();

/** The face of `m` whose every corner has coordinate `axis` equal to `at`, and lies within `inside` on the others. */
function faceAt(m: DisplayMesh, axis: number, at: number, inside: (p: number[]) => boolean = () => true): number {
  const p = (i: number) => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
  const faces = new Set(m.triangle_faces.filter((_, t) => [0, 1, 2].every((k) => Math.abs(p(m.indices[3 * t + k])[axis] - at) < 1e-9 && inside(p(m.indices[3 * t + k])))));
  assert.equal(faces.size, 1, `one face at ${"xyz"[axis]} = ${at}`);
  return [...faces][0];
}

test("hand-worked: an L bracket's inside corner and held bottom found on the kernel's own answer", async () => {
  const before = await kernel.call("body_count");
  const base = await kernel.call("body_build", { box: { width: 40, depth: 10, height: 5 } });
  const upright = await kernel.call("body_build", { box: { width: 5, depth: 10, height: 30 } });
  const joined = await kernel.call("body_boolean", base, [upright], "union");
  assert.equal(joined.bodies.length, 1);
  const l = joined.bodies[0];
  const view = await kernel.call("body_view", l);
  // Volume by hand: 40 × 10 × 5 + 5 × 10 × 25 = 2,000 + 1,250 = 3,250 mm³ (the upright's lowest 5 mm are inside the base).
  assert.ok(Math.abs(view.volume - 3250) < 1e-9 * 3250, `volume ${view.volume}`);
  const bottom = faceAt(view.mesh, 2, 0);
  const top = faceAt(view.mesh, 2, 30);
  const pla = weakerWay(materialLibrary().get("pla")!.mechanical!);
  const answer = await kernel.call("stress_test", l, { youngsModulus: pla.stiffness / 1e6, poissonsRatio: 0.35, strength: pla.strength / 1e6, held: [bottom], loads: [{ faces: [top], force: [50, 0, 0] }], size: 2 });
  const near = answer.size;
  assert.equal(insideCornerNear(answer, [5, 5, 5], near), true, "the inside corner where the upright meets the base");
  assert.equal(insideCornerNear(answer, [40, 5, 5], near), false, "the base's far top edge is an outside corner");
  assert.equal(insideCornerNear(answer, [0, 5, 30], near), false, "the upright's top edge is an outside corner");
  assert.equal(heldNear(answer, [20, 5, 0], near), true, "the bottom is held still");
  assert.equal(heldNear(answer, [2.5, 5, 30], near), false, "the pushed top moves");
  // The upright bends at its root like a cantilever, and the stress bunches at the sharp inside corner (the elastic
  // answer there grows without bound as the mesh gets finer), so the red dot is on that edge and the suggestions offer
  // rounding it, not moving the hold (the bottom is 5 mm below, more than one mesh size of 2 mm away).
  const at = answer.maxVonMisesAt;
  assert.ok(Math.abs(at[0] - 5) <= near && Math.abs(at[2] - 5) <= near, `red dot at ${at}`);
  const ids = suggestionsOf(resultOf(answer, { name: "PLA", mechanical: materialLibrary().get("pla")!.mechanical! }, { body: "L", held: ["Bottom"], loads: [] })).map((s) => s.id);
  assert.ok(ids.includes("corner") && !ids.includes("hold"), ids.join(", "));
  for (const b of [base, upright, l]) await kernel.call("body_free", b);
  assert.equal(await kernel.call("body_count"), before, "every body built is freed");
});
