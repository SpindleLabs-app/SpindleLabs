// Step 59a2: the Construct panel and its controller in a real DOM (happy-dom)
// on the real kernel: choosing the origin's planes from a row's list, the
// number, the kernel's answer drawn as the preview, its refusal in words
// (parallel planes never meet), OK recording one item through the rebuild's
// own check, and Cancel, a rebuild and a click leaving the right things.
// Every place is worked out by hand: an offset plane 10 mm from XY (normal
// +z) passes through (0, 0, 10) with normal (0, 0, 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { constructView, type ConstructDeps } from "../src/construct-view.ts";
import { checkedItem } from "../src/cut-ask.ts";
import { isConstructItem, partDocument, type DesignDocument } from "../src/document.ts";
import { constructOf } from "../src/document.ts";
import type { ConstructAnswer } from "../src/construct-data.ts";
import type { BodyHandle } from "@fission/core";
import { changePreset } from "../src/document.ts";
import { BodyCache, rebuildTimeline, type TimelineBuild } from "../src/rebuild.ts";
import { joinBodies, sceneHit, shownBodies, type Scene } from "../src/scene.ts";
import { heldNamesOf } from "../src/chamfer-tool.ts";
import { sceneCorners } from "../src/measure-view.ts";

const kernel = nodeKernel();
const { Window } = await import("happy-dom");

function setup(doc0: DesignDocument = partDocument("box", 40, 30, 20), world?: { scene: () => Scene | null; handle: (b: number) => BodyHandle | null; heldNames: ConstructDeps["heldNames"] }) {
  const window = new Window({ width: 1280, height: 800 });
  (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: false });
  const dom = window.document as unknown as Document;
  const slot = dom.createElement("div");
  const over = dom.createElement("div");
  dom.body.append(slot, over);
  let doc = doc0;
  const recorded: { step: string; doc: DesignDocument }[] = [];
  const previews: (ConstructAnswer | null)[] = [];
  const corners: unknown[] = [];
  const deps: ConstructDeps = {
    slot,
    over,
    doc: () => doc,
    scene: world?.scene ?? (() => null),
    handle: world?.handle ?? (() => null),
    heldNames: world?.heldNames ?? (async () => []),
    ask: (make) => kernel.call("body_construct", make),
    check: (next, id) => checkedItem(kernel, next, id),
    record: (step, next) => (recorded.push({ step, doc: next }), (doc = next)),
    okCheck: (w) => w,
    hold: (w) => w,
    preview: (a) => previews.push(a),
    offerCorners: (c) => corners.push(c),
    changed: () => {},
  };
  const view = constructView(deps);
  const $ = <T extends HTMLElement>(id: string) => dom.getElementById(id) as T;
  const choose = (slotName: string, ref: string) => {
    const select = $<HTMLSelectElement>(`construct-choose-${slotName}`);
    select.value = ref;
    select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
  };
  const type = (id: string, text: string) => {
    const input = $<HTMLInputElement>(id);
    input.value = text;
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  };
  const changeKind = (kind: string) => {
    const select = $<HTMLSelectElement>("construct-kind");
    select.value = kind;
    select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
  };
  return { view, $, choose, type, changeKind, recorded, previews, corners, setDoc: (d: DesignDocument) => (doc = d), dom, window };
}

test("opens at the kind, one row for each thing it is made from, OK off until all are picked", () => {
  const { view, $ } = setup();
  view.open("mid_plane");
  assert.equal(view.shown, true);
  assert.equal($("construct-title").textContent, "Midplane");
  assert.ok($("construct-slot-first") && $("construct-slot-second"));
  assert.equal($("construct-slot-first").getAttribute("aria-current"), "true"); // the first empty row takes the next pick
  assert.equal(($("construct-ok") as HTMLButtonElement).disabled, true);
  assert.equal($("construct-number-row").hidden, true); // a midplane takes no number
  assert.match($("construct-hint").textContent!, /Midplane: click a plane/);
});

test("an offset plane 10 mm from XY: asked of the real kernel, drawn as the preview, recorded by OK", async () => {
  const { view, $, choose, recorded, previews } = setup();
  view.open("offset_plane");
  assert.equal($("construct-number-row").hidden, false);
  assert.equal(($("construct-number") as HTMLInputElement).value, "10"); // the default
  choose("plane", "XY");
  await view.settled;
  const p = previews.at(-1)!;
  assert.equal(p.kind, "plane");
  assert.deepEqual((p as { point: number[] }).point.map((x) => Math.abs(x) < 1e-9 ? 0 : x), [0, 0, 10]); // 10 mm along the plane's own normal, +z
  assert.deepEqual((p as { normal: number[] }).normal, [0, 0, 1]);
  assert.match($("construct-preview").textContent!, /^A plane through/);
  assert.equal(($("construct-ok") as HTMLButtonElement).disabled, false);
  ($("construct-ok") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].step, "Construct");
  const item = recorded[0].doc.timeline.features.at(-1)!;
  assert.ok(isConstructItem(item));
  const c = constructOf(item);
  assert.equal(c.make, "offset_plane");
  assert.deepEqual(c.inputs, { plane: "XY" });
  assert.equal(c.distance, 10);
  assert.equal(item.intent.summary, "Offset plane, 10 mm");
  assert.equal(view.shown, false); // the panel is put away
  assert.equal(previews.at(-1), null); // and the preview with it
});

test("typing another distance asks the kernel again; a bad number is refused in words, never sent", async () => {
  const { view, $, choose, type, previews } = setup();
  view.open("offset_plane");
  choose("plane", "XZ");
  await view.settled;
  type("construct-number", "-5");
  await view.settled;
  // XZ faces -y (sketch.ts planeOf); -5 mm along that normal is +y: the plane passes through (0, 5, 0).
  const p = previews.at(-1) as { point: number[] };
  assert.deepEqual(p.point.map((x) => Math.abs(x) < 1e-9 ? 0 : x), [0, 5, 0]);
  const before = previews.length;
  type("construct-number", "abc");
  assert.match($("construct-preview").textContent!, /not a number/);
  assert.equal($("construct-preview").dataset.previewRefused ?? ($("construct-panel").dataset.previewRefused), "true");
  assert.equal(($("construct-ok") as HTMLButtonElement).disabled, true);
  assert.equal(previews.at(-1), null);
  assert.ok(previews.length > before);
});

test("two parallel planes have no axis where they meet: the kernel's refusal shows, OK stays off, nothing is recorded", async () => {
  const { view, $, choose, recorded } = setup();
  view.open("axis_where_planes_meet");
  choose("first", "XY");
  choose("second", "XY");
  await view.settled;
  assert.equal($("construct-panel").dataset.previewRefused, "true");
  assert.ok($("construct-preview").textContent!.length > 0);
  assert.equal(($("construct-ok") as HTMLButtonElement).disabled, true);
  assert.equal(recorded.length, 0);
});

test("the × lets a row go; changing the Type starts the rows again; Cancel puts it away", async () => {
  const { view, $, choose, changeKind } = setup();
  view.open("axis_where_planes_meet");
  choose("first", "XY");
  assert.deepEqual(view.filled, { first: "XY" });
  assert.equal($("construct-slot-second").getAttribute("aria-current"), "true"); // the next pick moves on
  ($("construct-drop-first") as HTMLButtonElement).click();
  assert.deepEqual(view.filled, {});
  assert.equal($("construct-slot-first").getAttribute("aria-current"), "true");
  choose("first", "XZ");
  changeKind("plane_through_points");
  assert.deepEqual(view.filled, {});
  assert.ok($("construct-slot-third"));
  assert.equal($("construct-title").textContent, "Plane through three points");
  ($("construct-cancel") as HTMLButtonElement).click();
  assert.equal(view.shown, false);
  assert.equal($("construct-panel").hidden, true);
});

test("an earlier construction is offered in the list and is built on as its answer", async () => {
  const { view, $, choose, recorded, setDoc, previews } = setup();
  view.open("offset_plane");
  choose("plane", "XY");
  await view.settled;
  ($("construct-ok") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 200));
  const first = recorded[0].doc.timeline.features.at(-1)!;
  setDoc(recorded[0].doc);
  view.open("offset_plane");
  const options = [...($("construct-choose-plane") as HTMLSelectElement).options].map((o) => o.value);
  assert.deepEqual(options, ["", "XY", "XZ", "YZ", `construct:${first.id}`]);
  choose("plane", `construct:${first.id}`);
  await view.settled;
  // 10 mm above the plane that is 10 mm above XY.
  assert.deepEqual((previews.at(-1) as { point: number[] }).point.map((x) => Math.abs(x) < 1e-9 ? 0 : Math.round(x * 1e9) / 1e9), [0, 0, 20]);
});

test("a rebuild keeps what was chosen from the list; a corner is offered only while a point is wanted", async () => {
  const { view, $, choose, corners } = setup();
  view.open("plane_through_points");
  assert.ok(corners.length > 0);
  choose("first", "O");
  view.rebuilt();
  assert.deepEqual(view.filled, { first: "O" });
  view.open("offset_plane"); // no point wanted: no corners offered (a click near one must pick the edge or face there)
  assert.equal(corners.at(-1), null);
  assert.equal($("construct-hint").hidden, false);
});

/** The design built on `cache` and joined into the scene the view shows, as the workspace makes it. */
async function sceneOf(doc: DesignDocument, cache: BodyCache): Promise<{ build: TimelineBuild; scene: Scene }> {
  const build = await rebuildTimeline(doc, cache, kernel);
  return { build, scene: joinBodies(await shownBodies(doc, build, cache), build) };
}

/** The joined face of `scene` facing `n` whose centroid has coordinate `k` at `v`. */
function faceAt(scene: Scene, n: readonly number[], k: number, v: number): number {
  for (let face = 0; ; face++) {
    const hit = sceneHit(scene, "face", face);
    if (hit === null) throw new Error("no such face");
    const b = scene.bodies[hit.body].view;
    const m = b.face_normals[hit.index]!;
    const c = b.face_centroids[hit.index]!;
    if (m.every((x, i) => Math.abs(x - n[i]) < 1e-9) && Math.abs(c[k] - v) < 1e-9) return face;
  }
}

test("59a3: a pick on a body is found again by its name after a rebuild (the box made 35 high: the plane 5 mm above its top is z = 40); one gone is let go", async () => {
  const cache = new BodyCache(kernel);
  let doc = partDocument("box", 40, 30, 20);
  let now = await sceneOf(doc, cache);
  const world = {
    scene: () => now.scene,
    handle: (b: number) => now.build.bodies[now.scene.bodies[b].body]?.handle ?? null,
    heldNames: (edges: readonly { body: string; edge: number }[]) => heldNamesOf(now.build.bodies, (b) => cache.view(b.handle), edges),
  };
  const { view, previews, setDoc, $, type } = setup(doc, world);
  view.open("offset_plane");
  type("construct-number", "5");
  view.pick({ face: faceAt(now.scene, [0, 0, 1], 2, 20), shift: false } as never);
  await new Promise((r) => setTimeout(r, 50));
  await view.settled;
  assert.deepEqual(view.filled, { plane: "face:feature-1/top" });
  // The top is z = 20: 5 mm above it, z = 25.
  assert.ok(Math.abs((previews.at(-1) as { point: number[] }).point[2] - 25) < 1e-9, JSON.stringify(previews.at(-1)));
  // The box made 35 high and rebuilt: the top found again by its name on the new body, z = 35 + 5 = 40.
  doc = changePreset(doc, "feature-1", "box", 40, 30, 35);
  setDoc(doc);
  now = await sceneOf(doc, cache);
  view.rebuilt();
  await view.settled;
  assert.deepEqual(view.filled, { plane: "face:feature-1/top" });
  assert.ok(Math.abs((previews.at(-1) as { point: number[] }).point[2] - 40) < 1e-9, JSON.stringify(previews.at(-1)));
  assert.equal(($("construct-ok") as HTMLButtonElement).disabled, false);
  // A sphere has no top: the pick is let go, never moved onto another face.
  doc = changePreset(doc, "feature-1", "sphere", 40, 40, 40);
  setDoc(doc);
  now = await sceneOf(doc, cache);
  view.rebuilt();
  await view.settled;
  assert.deepEqual(view.filled, {});
  assert.equal(($("construct-ok") as HTMLButtonElement).disabled, true);
  view.close();
  await cache.close();
});

test("59a3: an edge and a corner picked on the box are found again after it is made wider (an axis along its top back edge; a point at its top back right corner, x = 60 then 80)", async () => {
  const cache = new BodyCache(kernel);
  let doc = partDocument("box", 40, 30, 20);
  let now = await sceneOf(doc, cache);
  const world = {
    scene: () => now.scene,
    handle: (b: number) => now.build.bodies[now.scene.bodies[b].body]?.handle ?? null,
    heldNames: (edges: readonly { body: string; edge: number }[]) => heldNamesOf(now.build.bodies, (b) => cache.view(b.handle), edges),
  };
  const { view, previews, setDoc } = setup(doc, world);
  // The edge along x at y = 30, z = 20 (the top's back edge), by its ends.
  const edgeAt = () => {
    const v = now.scene.bodies[0].view;
    const e = v.edge_vertices.findIndex(([a, b]) => [a, b].every((k) => Math.abs(v.vertex_points[k][1] - 30) < 1e-9 && Math.abs(v.vertex_points[k][2] - 20) < 1e-9));
    return e;
  };
  view.open("axis_along");
  view.pick({ face: null, edge: edgeAt(), shift: false } as never);
  await new Promise((r) => setTimeout(r, 50));
  await view.settled;
  const named = view.filled.line;
  assert.ok(named !== undefined && named.startsWith("design:"), JSON.stringify(view.filled));
  const axis = () => previews.at(-1) as { point: number[]; direction: number[] };
  // An axis along the edge: the foot of the origin on the line y = 30, z = 20 along x is (0, 30, 20).
  assert.deepEqual(axis().point.map((x) => Math.round(x * 1e9) / 1e9 + 0), [0, 30, 20]);
  doc = changePreset(doc, "feature-1", "box", 60, 30, 20);
  setDoc(doc);
  now = await sceneOf(doc, cache);
  view.rebuilt();
  await view.settled;
  assert.deepEqual(view.filled, { line: named });
  assert.deepEqual(axis().point.map((x) => Math.round(x * 1e9) / 1e9 + 0), [0, 30, 20]);
  // A point at the box's top back right corner, (60, 30, 20) now; made 80 wide it is found again at (80, 30, 20).
  view.open("point_at");
  const cornerAt = (x: number) => sceneCorners(now.scene).findIndex((c) => [x, 30, 20].every((w, i) => Math.abs(c.at[i] - w) < 1e-9));
  view.pick({ face: null, vertex: cornerAt(60), shift: false } as never);
  await new Promise((r) => setTimeout(r, 50));
  await view.settled;
  const corner = view.filled.point;
  assert.ok(corner !== undefined && corner.startsWith("corner:"), JSON.stringify(view.filled));
  assert.deepEqual((previews.at(-1) as { point: number[] }).point, [60, 30, 20]);
  doc = changePreset(doc, "feature-1", "box", 80, 30, 20);
  setDoc(doc);
  now = await sceneOf(doc, cache);
  view.rebuilt();
  await view.settled;
  assert.deepEqual(view.filled, { point: corner });
  assert.deepEqual((previews.at(-1) as { point: number[] }).point, [80, 30, 20]);
  view.close();
  await cache.close();
});
