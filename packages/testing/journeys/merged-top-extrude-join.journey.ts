// SL #759 item 4 (app-wide hunt 2026-11-14, hunter R; the owner's call 2026-11-19: "make it follow"), in the Design app
// on the real kernel: a block drawn on the top a face of Box 1 was pulled out to (an Extrude of the face, joined level with
// Box 1's top or as a new body) follows Box 1 when Box 1's Move is edited. The pulled-out part is built from a sketch on
// Box 1's face, which that Move carries; from Design data version 30 the part's own frame starts from that sketch's
// (rebuild.ts BuiltBody `base`), so a sketch on it is carried too. Before, it stayed behind in the air (red on main
// cd89748: tests 2 and 3). Old files: workspaces/design/test/old-file-unbased.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DisplayMesh } from "@fission/core";
import { BodyCache, builtPieceFaces, designWorkspace, followedDoc, insertMove, NO_MOVE, numberPieces, partDocument, readDesignDocument, rebuildTimeline, setCombineShown, type DesignDocument } from "@fission/design";
import { app, kernel } from "./design-app.ts";

setCombineShown(true);
type App = Awaited<ReturnType<typeof app>>;
type Box3 = number[][];
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;

async function built(doc: DesignDocument): Promise<Map<string, { volume: number; bounds: Box3 }>> {
  let d = doc;
  const cache = new BodyCache(kernel);
  try {
    let build = await rebuildTimeline(d, cache, kernel);
    for (let i = 0; i < 4; i++) {
      const next = numberPieces(followedDoc(d, build), Object.keys(build.bodies), builtPieceFaces(build));
      if (next === d) break;
      d = next;
      build = await rebuildTimeline(d, cache, kernel);
    }
    const out = new Map<string, { volume: number; bounds: Box3 }>();
    for (const [id, b] of Object.entries(build.bodies)) {
      const v = await cache.view(b.handle);
      out.set(id, { volume: r6(v.volume), bounds: v.bounds.map((p: number[]) => p.map(r6)) });
    }
    return out;
  } finally {
    await cache.close();
  }
}
const block = async (doc: DesignDocument) => [...(await built(doc)).values()].find((b) => Math.abs(b.volume - 500) < 1e-6)?.bounds ?? null;

function facesWhere(mesh: DisplayMesh, on: (p: number[]) => boolean): number[] {
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const ok = [0, 1, 2].every((j) => {
      const i = mesh.indices[3 * t + j];
      return on([mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]);
    });
    all.set(f, (all.get(f) ?? true) && ok);
  });
  return [...all].filter(([, ok]) => ok).map(([f]) => f);
}

async function editMove(a: App, id: string, v: Record<string, string>) {
  await a.doubleClick(id);
  for (const [axis, val] of Object.entries(v)) {
    const box = a.$(`#move-${axis}`) as HTMLInputElement;
    assert.ok(box, `Move's ${axis} box`);
    box.value = val;
    box.dispatchEvent(new a.window.Event("input") as unknown as Event);
  }
  await a.settle();
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
}

/**
 * Box 1 40 × 30 × 20 moved 10 along x (Move 1): x 10..50. Extrude, a click on its right face (x 50), 20 mm, operation
 * `op`: joined, one body x 10..70 whose top (z 20) is one face, Box 1's top and the pulled part's side level; as a new
 * body, a second body x 50..70. Then Create sketch with a click on the top at x `cx`, a 10 × 10 rectangle round
 * (cx, 15), extruded 5 as a new body: the block (500 mm³).
 */
async function setUp(op: "join" | "new", cx: number) {
  const base = partDocument("box", 40, 30, 20);
  const m = insertMove(base, ["body:feature-1"], { ...NO_MOVE, x: 10 });
  const a = await app(m.doc, designWorkspace);
  a.$("#extrude")!.click();
  await a.settle();
  const right = a.extrudeShown()!.profiles.find((p) => p.id.includes("right"));
  assert.ok(right, `the right face is offered: ${a.extrudeShown()!.profiles.map((p) => p.id).join(" ")}`);
  await a.extrudePointer({ kind: "pick", profile: right.id });
  if (op === "join") {
    const sel = a.$("#extrude-operation") as HTMLSelectElement;
    assert.ok(sel, "Extrude has an Operation choice");
    sel.value = "join";
    sel.dispatchEvent(new a.window.Event("change", { bubbles: true }) as unknown as Event);
    await a.settle();
  }
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = "20";
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  a.$("#create-sketch")!.click();
  await a.settle();
  const top = facesWhere(a.mesh()!, (p) => Math.abs(p[2] - 20) < 1e-9 && (op === "join" || (cx > 50 ? p[0] >= 50 - 1e-9 : p[0] <= 50 + 1e-9)));
  assert.ok(top.length >= 1, "a top face");
  await a.pick({ face: top[0], point: [cx, 15, 20] } as never);
  assert.ok(a.sketching(), `a sketch opened on the top: ${a.error()}`);
  for (const [x, y] of [[cx - 5, 10], [cx + 5, 10], [cx + 5, 20], [cx - 5, 20], [cx - 4.7, 9.8]]) await a.click(x, y);
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = "5";
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  return { a, move: m.id };
}

// Worked by hand: everything is built on Box 1 (the pulled-out part from Box 1's own right face, the block on the top),
// so when Box 1's Move goes from x 10 to x 30 everything goes 20 along x with it: the block from x cx-5..cx+5 to
// x cx+15..cx+25, y 10..20, z 20..25.
for (const [op, cx, what] of [["join", 30, "Join, the block over Box 1's part (control)"], ["join", 60, "Join, the block over the pulled-out part"], ["new", 60, "no Join, the block on the pulled-out body's own top"]] as const) {
  test(`${what}: the block follows Box 1's Move edited from x 10 to x 30`, async () => {
    const { a, move } = await setUp(op, cx);
    assert.deepEqual(await block(a.doc()), [[cx - 5, 10, 20], [cx + 5, 20, 25]], "drawn where it was clicked");
    await editMove(a, move, { x: "30" });
    assert.deepEqual(await block(a.doc()), [[cx + 15, 10, 20], [cx + 25, 20, 25]]);
    // Saved and opened afresh: the same.
    assert.deepEqual(await block(readDesignDocument(JSON.parse(JSON.stringify(a.doc())))), [[cx + 15, 10, 20], [cx + 25, 20, 25]]);
    await a.close();
  });
}
