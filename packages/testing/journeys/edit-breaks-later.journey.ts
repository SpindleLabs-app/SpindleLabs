// Bug sweep 2026-11-28, A1-4: an edit that breaks a later step asks first (SL #676 item 2, the 2026-11-20 rule), as an
// edited Combine does, for an edited Pattern, Chamfer and Shell too: their OK compared the check build with nothing, so
// it never asked. Each case is built by hand (the volumes and sizes in the comments); the app runs on the real kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertCombine, insertMove, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { insertPattern } from "../../../workspaces/design/src/pattern.ts";
import { setPatternShown } from "../../../workspaces/design/src/pattern-flag.ts";
import { insertChamfer } from "../../../workspaces/design/src/chamfer.ts";
import { chamferOf } from "../../../workspaces/design/src/document.ts";
import { setChamferShown } from "../../../workspaces/design/src/chamfer-flag.ts";
import { insertShell } from "../../../workspaces/design/src/shell.ts";
import { setShellShown } from "../../../workspaces/design/src/shell-flag.ts";
import { heldFaceNames } from "../../../workspaces/design/src/shell-tool.ts";
import { BodyCache, rebuildTimeline } from "../../../workspaces/design/src/rebuild.ts";
import { designNames } from "../../../workspaces/design/src/boolean-names.ts";
import { namedBody } from "../../../workspaces/design/src/built-body.ts";
import { heldEdgeNames } from "../../../workspaces/design/src/design-edges.ts";
import { nodeKernel } from "../src/node-kernel.ts";
import { app } from "./design-app.ts";

setCombineShown(true);
setPatternShown(true);
setChamferShown(true);
setShellShown(true);
const kernel = nodeKernel();
const BODY = "body:feature-1";

/** Box 1's held name of the edge whose two ends both pass `on`, as the Chamfer tool would hold it. */
async function edgeName(doc: DesignDocument, on: (p: readonly number[]) => boolean): Promise<string> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const ids = Object.keys(build.bodies);
    const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
    const at = ids.indexOf(BODY);
    const view = list[at].view;
    const e = view.edge_vertices.findIndex(([a, b]) => on(view.vertex_points[a]) && on(view.vertex_points[b]));
    const name = heldEdgeNames(designNames(list), at)[e];
    assert.ok(name, "the edge has a name of its own");
    return name!;
  } finally {
    await cache.close();
  }
}

/** Types `value` into `#id`, presses `#ok`, and says whether the question came up (its words, or null). */
async function typeAndOk(a: Awaited<ReturnType<typeof app>>, id: string, value: string, ok: string): Promise<string | null> {
  const box = a.$(`#${id}`) as HTMLInputElement;
  assert.ok(box, `#${id} is open`);
  box.value = value;
  box.dispatchEvent(new a.window.Event("input") as never);
  await a.settle();
  (a.$(`#${ok}`) as HTMLButtonElement).click();
  await a.settle();
  const ask = a.$("#cut-ask") as HTMLDialogElement | null;
  return ask?.open ? (a.$("#cut-ask-words")?.textContent ?? "") : null;
}

/** A 10 mm cube and Pattern 1, a row of 3 along X 15 mm apart: Body 2 = piece:1 at x 15..25, Body 3 = piece:2 at x 30..40; numbered as the app numbers them. */
async function row(): Promise<{ doc: DesignDocument; pattern: string }> {
  const p = insertPattern(partDocument("box", 10, 10, 10), [BODY], { kind: "linear", direction: "X", spacing: 15, count: 3, join: false });
  const a = await app(p.doc);
  const doc = a.doc();
  await a.close();
  return { doc, pattern: p.id };
}

test("a Pattern edited from 3 copies to 2, with Move 1 lifting the third: OK asks first; Cancel keeps 3, Record anyway records 2", async () => {
  const { doc, pattern } = await row();
  const m = insertMove(doc, [`body:${pattern}/piece:2`], { ...NO_MOVE, z: 50 });
  const a = await app(m.doc);
  await a.doubleClick(pattern);
  // Count 2 makes only Body 2: Body 3, the one Move 1 lifts, is gone, so Move 1 would fail.
  const words = await typeAndOk(a, "pattern-count", "2", "pattern-ok");
  assert.match(words ?? "no question", /This change to Pattern 1 would break Move 1/);
  (a.$("#cut-ask-cancel") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.doc().timeline.features.find((f) => f.id === pattern)!.intent.parameters.count, 3, "Cancel records nothing");
  (a.$("#pattern-ok") as HTMLButtonElement).click();
  await a.settle();
  (a.$("#cut-ask-go") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.doc().timeline.features.find((f) => f.id === pattern)!.intent.parameters.count, 2, "Record anyway records it");
  assert.ok(await a.close());
});

test("a Pattern edited from 3 copies to 2, with Combine 1 joining the third to Body 1: OK asks first", async () => {
  const { doc, pattern } = await row();
  const c = insertCombine(doc, BODY, [`body:${pattern}/piece:2`], "join");
  const a = await app(c.doc);
  await a.doubleClick(pattern);
  assert.match((await typeAndOk(a, "pattern-count", "2", "pattern-ok")) ?? "no question", /would break Combine 1/);
  assert.ok(await a.close());
});

test("a Chamfer edited from 2 mm to 8 mm on a 10 mm cube's top front edge breaks a 2 mm Chamfer of its bottom front edge: OK asks first", async () => {
  // By hand: the front face is 10 high; an 8 mm cut from the top leaves it 10 - 8 = 2 high, so a 2 mm cut from the
  // bottom would take it all and the kernel refuses Chamfer 2 ("too big here"); at 2 mm the front is 6 high and both build.
  const cube = partDocument("box", 10, 10, 10);
  const c1 = insertChamfer(cube, BODY, [await edgeName(cube, (p) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9)], { equal: 2 });
  const c2 = insertChamfer(c1.doc, BODY, [await edgeName(c1.doc, (p) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2]) < 1e-9)], { equal: 2 });
  const a = await app(c2.doc);
  assert.equal(a.error(), "");
  await a.doubleClick(c1.id);
  assert.match((await typeAndOk(a, "chamfer-distance", "8", "chamfer-ok")) ?? "no question", /This change to Chamfer 1 would break Chamfer 2/);
  (a.$("#cut-ask-cancel") as HTMLButtonElement).click();
  await a.settle();
  assert.deepEqual(chamferOf(a.doc().timeline.features.find((f) => f.id === c1.id)!)?.size, { equal: 2 }, "Cancel records nothing");
  assert.ok(await a.close());
});

test("a Shell edited from 4 mm to 1 mm walls breaks a 3 mm Chamfer of its top front rim: OK asks first", async () => {
  // By hand: the cube shelled with its top open leaves a rim 4 wide on top; a 3 mm chamfer of its outer front edge fits
  // in it, but in a rim 1 wide it runs into the inside, so the kernel refuses Chamfer 1.
  const cube = partDocument("box", 10, 10, 10);
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(cube, cache, kernel);
  const view = await cache.view(build.bodies[BODY].handle);
  const [top] = await heldFaceNames(build.bodies, (b) => cache.view(b.handle), BODY, [view.face_normals.findIndex((n) => n != null && n[2] > 0.999999)]);
  await cache.close();
  const sh = insertShell(cube, BODY, [top!], 4);
  const c = insertChamfer(sh.doc, BODY, [await edgeName(sh.doc, (p) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9)], { equal: 3 });
  const a = await app(c.doc);
  assert.equal(a.error(), "");
  await a.doubleClick(sh.id);
  assert.match((await typeAndOk(a, "shell-thickness", "1", "shell-ok")) ?? "no question", /This change to Shell 1 would break Chamfer 1/);
  assert.ok(await a.close());
});
