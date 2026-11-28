// Bug sweep 2026-11-28, A1-1 (behind ?pattern): a click on a Pattern copy in the view picks the copy clicked. Every
// copy's faces carry the Pattern's names (docs/progress/cad.md 61d), and a pick held as a face's name was resolved to
// the first shown body carrying it, so a click on Body 3 selected, moved, combined and duplicated Body 2.
// By hand: a 10 mm cube x 0..10 (Body 1) and Pattern 1, a row of 3 along X 15 mm apart: Body 2 = piece:1 at x 15..25,
// Body 3 = piece:2 at x 30..40. The face clicked is the one whose corners all lie in a body's x range facing +z (its top).
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument, setCombineShown } from "@fission/design";
import { insertPattern } from "../../../workspaces/design/src/pattern.ts";
import { app } from "./design-app.ts";
setCombineShown(true);
const row = () => insertPattern(partDocument("box", 10, 10, 10), ["body:feature-1"], { kind: "linear", direction: "X", spacing: 15, count: 3, join: false }).doc;
type App = Awaited<ReturnType<typeof app>>;
/** The face of the drawn mesh whose corners all lie at x between lo and hi, facing +z (the top). */
function topBetween(a: App, lo: number, hi: number): number {
  const m = a.mesh()!;
  const ok = new Map<number, boolean>();
  m.triangle_faces.forEach((f, t) => {
    for (let k = 0; k < 3; k++) {
      const i = m.indices[3 * t + k];
      const good = m.positions[3 * i] >= lo - 1e-9 && m.positions[3 * i] <= hi + 1e-9 && m.normals[3 * i + 2] > 0.999;
      ok.set(f, (ok.get(f) ?? true) && good);
    }
  });
  const found = [...ok].filter(([, g]) => g).map(([f]) => f);
  assert.equal(found.length, 1, `one top face at x ${lo}..${hi}`);
  return found[0];
}
const ids = (a: App) => a.selection.items.map((r) => JSON.stringify(r));

test("a click on Body 3's top (x 30..40) selects Body 3 (its face, or the body while the copies share names), not Body 2", async () => {
  const a = await app(row());
  const f3 = topBetween(a, 30, 40);
  await a.pick({ face: f3 });
  const lit = a.highlight();
  const m = a.mesh()!;
  const litX = new Set<number>();
  m.triangle_faces.forEach((f, t) => { if (lit.faces.includes(f)) litX.add(m.positions[3 * m.indices[3 * t]]); });
  assert.ok(lit.faces.includes(f3), `the clicked face ${f3} is lit (lit: ${JSON.stringify(lit.faces)})`);
  assert.ok([...litX].every((x) => x >= 30 - 1e-9 && x <= 40 + 1e-9), `only Body 3 lit, at x ${JSON.stringify([...litX])}`);
  await a.close();
});

test("Move: Body 3 picked by a click on its top, moved +100 in x: Body 3 moves, Body 2 stays", async () => {
  const a = await app(row());
  a.$("#modify-menu")!.click(); await a.settle();
  (a.$("#modify-menu-move") as HTMLElement).click(); await a.settle();
  await a.pick({ face: topBetween(a, 30, 40) });
  const x = a.$("#move-x") as HTMLInputElement;
  x.value = "100"; x.dispatchEvent(new a.window.Event("input") as never); await a.settle();
  (a.$("#move-ok") as HTMLButtonElement).click(); await a.settle();
  const mv = a.doc().timeline.features.at(-1)!;
  assert.deepEqual(mv.intent.parameters.bodies, ["body:feature-2/piece:2"]);
  // Drawn: Body 3's 30..40 moved to 130..140, Body 2 left at 15..25, so x runs 0..140.
  const m = a.mesh()!;
  const xs: number[] = [];
  for (let i = 0; i < m.positions.length; i += 3) xs.push(m.positions[i]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [0, 140]);
  assert.ok(xs.some((v) => v > 15.5 && v < 24.5) || xs.includes(15), "Body 2 still at 15..25");
  await a.close();
});

test("Combine: target Body 1 by its top, tool Body 3 by its top: the tool field says Body 3", async () => {
  const a = await app(row());
  a.$("#modify-menu")!.click(); await a.settle();
  a.$("#modify-menu-combine")!.click(); await a.settle();
  await a.pick({ face: topBetween(a, 0, 10) });
  await a.pick({ face: topBetween(a, 30, 40) });
  const said = `${a.$("#combine-target-names")!.textContent} | ${a.$("#combine-tools-names")!.textContent}`;
  assert.equal(said, "Body 1 | Body 3");
  await a.close();
});

test("the view's menu on Body 3's top: Hide hides Body 3", async () => {
  const a = await app(row());
  const opened = await a.viewMenu({ face: topBetween(a, 30, 40) });
  await a.chooseEntry("hide");
  assert.ok(opened);
  assert.deepEqual(a.doc().hidden, ["body:feature-2/piece:2"]);
  await a.close();
});

test("Duplicate (Ctrl+D) after a click on Body 3's top copies Body 3", async () => {
  const a = await app(row());
  await a.pick({ face: topBetween(a, 30, 40) });
  await a.key("duplicate-bodies");
  const last = a.doc().timeline.features.at(-1)!;
  assert.equal(last.intent.type, "duplicate");
  assert.equal(last.intent.parameters.body, "body:feature-2/piece:2");
  await a.close();
});

test("control: a click on Body 2's top (x 15..25) still picks Body 2, by its face when the face's name finds it", async () => {
  const a = await app(row());
  a.$("#modify-menu")!.click(); await a.settle();
  (a.$("#modify-menu-move") as HTMLElement).click(); await a.settle();
  await a.pick({ face: topBetween(a, 15, 25) });
  const x = a.$("#move-x") as HTMLInputElement;
  x.value = "100"; x.dispatchEvent(new a.window.Event("input") as never); await a.settle();
  (a.$("#move-ok") as HTMLButtonElement).click(); await a.settle();
  assert.deepEqual(a.doc().timeline.features.at(-1)!.intent.parameters.bodies, ["body:feature-2/piece:1"]);
  await a.close();
});

test("Chamfer through its panel: Body 2's top front edge, whose name only looks unique because Pattern 2 changed Body 3, is refused in words, never recorded (A1-2)", async () => {
  const { setChamferShown } = await import("../../../workspaces/design/src/chamfer-flag.ts");
  setChamferShown(true);
  // Pattern 2 joins Body 3 (piece:2) with a copy 5 along X, so Body 3 is x 30..45 and Body 2's names look its own.
  const first = await app(row());
  const numbered = first.doc();
  await first.close();
  const p2 = insertPattern(numbered, ["body:feature-2/piece:2"], { kind: "linear", direction: "X", spacing: 5, count: 2, join: true });
  const a = await app(p2.doc);
  const items = a.doc().timeline.features.length;
  a.$("#modify-menu")!.click(); await a.settle();
  (a.$("#modify-menu-chamfer") as HTMLElement).click(); await a.settle();
  // The drawn edge at y 0, z 10, x 15..25: Body 2's top front edge.
  const m = a.mesh()!;
  let edge = -1;
  for (let s = 0; s < m.edge_line_edges.length; s++) {
    const p = m.edge_lines.slice(6 * s, 6 * s + 6);
    if (p[1] === 0 && p[4] === 0 && p[2] === 10 && p[5] === 10 && Math.min(p[0], p[3]) >= 15 && Math.max(p[0], p[3]) <= 25) edge = m.edge_line_edges[s];
  }
  assert.ok(edge >= 0, "Body 2's top front edge drawn");
  await a.pick({ face: null, edge });
  const d = a.$("#chamfer-distance") as HTMLInputElement;
  d.value = "2"; d.dispatchEvent(new a.window.Event("input") as never); await a.settle();
  (a.$("#chamfer-ok") as HTMLButtonElement).click(); await a.settle();
  assert.equal(a.doc().timeline.features.length, items, "no Chamfer recorded");
  assert.match(a.$("#chamfer-panel")!.textContent ?? "", /no name of its own/);
  await a.close();
});
