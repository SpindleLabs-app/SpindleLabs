// 35f4: Ben's Fusion 360 answers for Combine, checked through the real Combine
// box (Modify ▾ Combine, a face of each body picked, OK) on the real kernel,
// as a person would: the bodies, their names and volumes must be Fusion's
// (docs/progress/booleans.md in the kernel repo, "Fusion checks").
// F2: a Join of two boxes 10 mm apart: no error, no warning; the target stays
// Body 1 and the tool's box becomes a new body, Body 3.
// F3: a Cut whose tool swallows the target, and an Intersect of boxes that
// only touch: Fusion's "Compute Failed", both bodies kept; here the box says
// why and nothing is added to the timeline.
// F1, F4 and F5 are Extrude cuts (step 39): tests/golden/f1-bar-slot waits for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

// Combine is behind ?combine until it goes public (35f5): on here, as a tester's tab has it.
setCombineShown(true);

type App = Awaited<ReturnType<typeof app>>;

/** Box 1 (w × d × h from the origin) and Box 2 (W × D × H) moved by (x, y, z). */
function twoBoxes(first: [number, number, number], second: [number, number, number], at: [number, number, number]): DesignDocument {
  const doc = partDocument("box", ...first);
  const made = insertPreset(doc, "box", ...second);
  return insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: at[0], y: at[1], z: at[2] }).doc;
}

/** A face of the shown bodies whose every drawn corner passes `on` (the first such). */
function faceWhere(a: App, on: (p: number[]) => boolean): number {
  const mesh = a.mesh()!;
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const corners = [0, 1, 2].map((k) => {
      const i = mesh.indices[3 * t + k];
      return [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
    });
    all.set(f, (all.get(f) ?? true) && corners.every(on));
  });
  const found = [...all].filter(([, ok]) => ok).map(([f]) => f);
  assert.ok(found.length > 0, "a face there");
  return found[0];
}

/** Modify ▾ Combine, the target and tool picked by a face each, `op`, Keep tools off, OK. */
async function combine(a: App, target: (p: number[]) => boolean, tool: (p: number[]) => boolean, op: string) {
  a.$("#modify-menu")!.click();
  await a.settle();
  a.$("#modify-menu-combine")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a, target) });
  await a.pick({ face: faceWhere(a, tool) });
  assert.equal(`${a.$("#combine-target-names")!.textContent} | ${a.$("#combine-tools-names")!.textContent}`, "Body 1 | Body 2");
  const select = a.$("#combine-operation") as HTMLSelectElement;
  select.value = op;
  select.dispatchEvent(new a.window.Event("change") as never);
  assert.equal((a.$("#combine-keep") as HTMLInputElement).checked, false, "Keep tools is off, as in Fusion");
  (a.$("#combine-ok") as HTMLButtonElement).click();
  await a.settle();
}

/** The browser's body rows, by name. */
const bodyRows = (a: App) => [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].map((r) => r.textContent!.trim()).filter((t) => /^Body \d+/.test(t));
const refusal = (a: App) => {
  const e = a.$("#combine-error");
  return e && !e.hidden ? e.textContent : null;
};
const combines = (a: App) => a.doc().timeline.features.filter((f) => f.intent.type === "combine").length;

test("F2 (Fusion): a Join of two boxes 10 mm apart keeps both, the target Body 1 and the tool's box a new Body 3", async () => {
  // Box 1 x 0..10 and Box 2 x 20..30 (moved 20): 10 mm apart, each 10³ = 1000 mm³, so 2000 in all, before and after.
  const a = await app(twoBoxes([10, 10, 10], [10, 10, 10], [20, 0, 0]), designWorkspace);
  assert.deepEqual(bodyRows(a), ["Body 1", "Body 2"]);
  await combine(a, (p) => close(p[0], 0), (p) => close(p[0], 30), "join");
  assert.equal(refusal(a), null, "no error");
  assert.equal(a.warning(), null, "no warning");
  assert.equal(combines(a), 1);
  assert.deepEqual(bodyRows(a), ["Body 1", "Body 3"], "Fusion: Body1 and a new Body3");
  assert.ok(close(a.volume(), 2000), `${a.volume()}`);
  assert.ok(await a.close());
});

test("F3 (Fusion): a Cut whose tool swallows the target, and an Intersect of boxes that only touch, are refused with both bodies kept", async () => {
  // A 20 × 20 × 10 target inside a 40 × 40 × 20 tool moved (−10, −10, −5): the Cut would leave nothing.
  // Kept: 20·20·10 + 40·40·20 = 4000 + 32000 = 36000 mm³ drawn (the two overlap; the view draws each).
  const a = await app(twoBoxes([20, 20, 10], [40, 40, 20], [-10, -10, -5]), designWorkspace);
  await combine(a, (p) => close(p[2], 0), (p) => close(p[2], -5), "cut");
  assert.match(refusal(a) ?? "", /can't be made/, "Fusion: Compute Failed");
  assert.equal(combines(a), 0, "Fusion: Failed to create feature");
  assert.deepEqual(bodyRows(a), ["Body 1", "Body 2"]);
  assert.ok(close(a.volume(), 36000), `${a.volume()}`);
  assert.ok(await a.close());
  // Two 10 mm cubes, Box 2 moved 10 along x: they share only the face x = 10, so their Intersect has no volume.
  const b = await app(twoBoxes([10, 10, 10], [10, 10, 10], [10, 0, 0]), designWorkspace);
  await combine(b, (p) => close(p[0], 0), (p) => close(p[0], 20), "intersect");
  assert.match(refusal(b) ?? "", /can't be made/);
  assert.equal(combines(b), 0);
  assert.deepEqual(bodyRows(b), ["Body 1", "Body 2"]);
  assert.ok(close(b.volume(), 2000), `${b.volume()}`);
  assert.ok(await b.close());
});
