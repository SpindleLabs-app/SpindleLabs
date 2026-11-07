// Makes the golden models that today's SpindleLabs can build (step 28a),
// each through the Design app itself on the real WASM kernel (the app
// journeys' design-app.ts: Design mounted in happy-dom, picks and clicks
// handed to it as the viewport would), or for the gear, whose 96 sides
// no one would click, through the same document functions the sketch
// tools call. Each is saved as the app saves a project. The answers in
// each `<name>.expect.json` are worked out by hand, never by this script.
// Run from the repository root after the WASM build:
//   node --experimental-strip-types --no-warnings tests/golden/make.ts [name …]
import { writeFileSync } from "node:fs";
import { emptyProject, projectToJson, type DisplayMesh } from "@fission/core";
import { addSketch, designWorkspace, drawArc, drawLine, extrudeSketch, insertMove, insertPreset, NO_MOVE, partDocument, setCombineShown, type DesignDocument } from "@fission/design";
import { app, close } from "../../packages/testing/journeys/design-app.ts";

const DIR = new URL("./", import.meta.url);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

function save(file: string, title: string, doc: DesignDocument) {
  const p = emptyProject(title);
  p.workspaces.design = doc as never;
  writeFileSync(new URL(`${file}.panosolid.json`, DIR), projectToJson(p));
  console.log("saved", file);
}

/**
 * The joined face whose every drawn triangle corner passes `on` and which
 * has a corner at each of `reach` (one face: the make stops if none or two
 * do; a block's start cap lies on the base's top, so it takes both
 * corners of the top to tell them apart).
 */
function faceWhere(mesh: DisplayMesh, on: (p: number[]) => boolean, reach: number[][] = []): number {
  const all = new Map<number, boolean>();
  const reached = new Map<number, Set<number>>();
  mesh.triangle_faces.forEach((f, t) => {
    const corners = [0, 1, 2].map((k) => {
      const i = mesh.indices[3 * t + k];
      return [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
    });
    all.set(f, (all.get(f) ?? true) && corners.every(on));
    for (const p of corners) reach.forEach((q, j) => q.every((c, n) => near(c, p[n])) && reached.set(f, (reached.get(f) ?? new Set()).add(j)));
  });
  const found = [...all].filter(([f, ok]) => ok && (reached.get(f)?.size ?? 0) === reach.length).map(([f]) => f);
  if (found.length !== 1) throw new Error(`${found.length} faces match`);
  return found[0];
}

type App = Awaited<ReturnType<typeof app>>;

async function sketchOnFace(a: App, on: (p: number[]) => boolean, reach: number[][] = []) {
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a.mesh()!, on, reach) });
}

async function extrude(a: App, distance: number, flip = false) {
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = String(distance);
  // Flip turns the typed distance the other way from the sketch's plane.
  if (flip) {
    a.$("#extrude-flip")!.click();
    await a.settle();
  }
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  if (a.sketching()) await a.finish();
}

async function circle(a: App, centre: [number, number], radius: number) {
  await a.key("sketch-circle");
  await a.click(...centre);
  await a.click(centre[0] + radius, centre[1]);
}

async function rectangle(a: App, from: [number, number], to: [number, number], pixel = 0.1) {
  await a.key("sketch-rectangle");
  await a.click(...from, {}, false, false, pixel);
  await a.click(...to, {}, false, false, pixel);
}

/** A new part with its ready-made box deleted from the timeline, as a user starting from nothing would (the counter goes on from 2). */
async function emptyPart(): Promise<App> {
  const a = await app(partDocument("box", 40, 30, 20), designWorkspace);
  const [box] = a.doc().timeline.features.map((f) => f.id);
  await a.menu(box, "delete");
  a.$("#delete-ask-confirm")?.click();
  await a.settle();
  return a;
}

/** Create Sketch on an origin plane, then a rectangle from `from` to `to` (sketch coordinates). */
async function planeRectangle(a: App, plane: "XY" | "XZ", from: [number, number], to: [number, number], pixel = 0.1) {
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ plane });
  await rectangle(a, from, to, pixel);
  await a.key("clear-selection");
}

// Combine is behind ?combine until it goes public (35f5): on here, as a tester's tab has it.
setCombineShown(true);

/** Modify ▾ Combine: the body with a face wholly where `target` holds as the target, the one with a face where `tool` holds as the tool, `op`, Keep tools off, OK. */
async function combine(a: App, target: (p: number[]) => boolean, tool: (p: number[]) => boolean, op: "join" | "cut" | "intersect") {
  a.$("#modify-menu")!.click();
  await a.settle();
  a.$("#modify-menu-combine")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a.mesh()!, target) });
  await a.pick({ face: faceWhere(a.mesh()!, tool) });
  const picked = `${a.$("#combine-target-names")!.textContent} | ${a.$("#combine-tools-names")!.textContent}`;
  if (!/^Body \d+ \| Body \d+$/.test(picked)) throw new Error(`Combine picked ${picked}; items ${a.doc().timeline.features.map((f) => f.id)}; error ${a.error()}`);
  const select = a.$("#combine-operation") as HTMLSelectElement;
  select.value = op;
  select.dispatchEvent(new a.window.Event("change") as never);
  if ((a.$("#combine-keep") as HTMLInputElement).checked) throw new Error("Keep tools is on");
  (a.$("#combine-ok") as HTMLButtonElement).click();
  await a.settle();
  const refused = a.$("#combine-error");
  if (refused && !refused.hidden) throw new Error(`Combine refused: ${refused.textContent}`);
}

/** The six step-35 models: a block, a second body sketched and extruded, then Combine (their recipes in each .expect.json). */
async function blockAndTool(file: string, title: string, block: { plane: "XY" | "XZ"; from: [number, number]; to: [number, number]; d: number; flip?: boolean }, tool: { plane: "XY" | "XZ"; from: [number, number]; to: [number, number]; d: number; flip?: boolean }, pick: [(p: number[]) => boolean, (p: number[]) => boolean], pixel = 0.1, then?: (a: App) => Promise<void>) {
  const a = await emptyPart();
  for (const b of [block, tool]) {
    await planeRectangle(a, b.plane, b.from, b.to, pixel);
    await extrude(a, b.d, b.flip);
  }
  await combine(a, ...pick, "cut");
  if (then) await then(a);
  save(file, title, a.doc());
  await close(a);
}

const MODELS: Record<string, () => Promise<void>> = {
  // Step 36's: the ready-made box 40 × 30 × 10, a 40 × 12 × 10 block on its top flush with its front and sides, joined.
  async "flush-blocks"() {
    const a = await app(partDocument("box", 40, 30, 10), designWorkspace);
    await sketchOnFace(a, (p) => near(p[2], 10), [[0, 0, 10], [40, 30, 10]]);
    await rectangle(a, [0, 0], [40, 12]);
    await extrude(a, 10);
    await combine(a, (p) => near(p[2], 0), (p) => near(p[2], 20), "join");
    save("flush-blocks", "Flush blocks", a.doc());
    await close(a);
  },
  // Fusion check F2 (35f4): two 10 mm cubes 10 mm apart (Box 2 moved 20 along x), joined: Body 1 and a new Body 3.
  async "f2-gap-join"() {
    const made = insertPreset(partDocument("box", 10, 10, 10), "box", 10, 10, 10);
    const a = await app(insertMove(made.doc, [`body:${made.id}`], { ...NO_MOVE, x: 20 }).doc, designWorkspace);
    await combine(a, (p) => near(p[0], 0), (p) => near(p[0], 30), "join");
    save("f2-gap-join", "Fusion F2: a gap joined", a.doc());
    await close(a);
  },
  // Step 35's models (35f1f): each a Cut of Body 2 from Body 1, Keep tools off.
  "box-minus-box": () =>
    blockAndTool("box-minus-box", "Box minus box", { plane: "XY", from: [-20, -15], to: [20, 15], d: 20 }, { plane: "XZ", from: [10, 10], to: [30, 30], d: 25 }, [(p) => near(p[2], 0), (p) => near(p[1], -25)]),
  "far-wall-outside": () =>
    blockAndTool("far-wall-outside", "Far wall outside", { plane: "XY", from: [0, 10], to: [40, 40], d: 20 }, { plane: "XZ", from: [10, 5], to: [30, 30], d: 40.0005, flip: true }, [(p) => near(p[2], 0), (p) => near(p[1], 0)]),
  "hollow-box": () =>
    blockAndTool("hollow-box", "Hollow box", { plane: "XY", from: [-20, -15], to: [20, 15], d: 20 }, { plane: "XZ", from: [-10, 5], to: [10, 15], d: 5 }, [(p) => near(p[2], 0), (p) => near(p[1], -5) && Math.abs(p[0]) <= 10 + 1e-9]),
  "km-plate": () =>
    blockAndTool("km-plate", "Plate a kilometre out", { plane: "XZ", from: [1000000, 5], to: [1000100, 15], d: 60, flip: true }, { plane: "XY", from: [1000020, 20], to: [1000050, 40], d: 10 }, [(p) => near(p[1], 60), (p) => near(p[2], 0)]),
  // A click lands on the 1 µm grid, so the thin part comes from a typed extrude distance: the block 1.5 µm (refused) or 2.1 µm (builds) tall, its lower 1 µm cut.
  // A Combine that can't be made is refused in its box and never added (as Fusion's), so the refused Combine on the
  // timeline comes as a user's would: made at 2.1 µm, then the block edited down to 1.5 µm under it.
  "micron-cube-halved": () =>
    blockAndTool("micron-cube-halved", "Micron block halved", { plane: "XY", from: [0, 0.001], to: [0.001, 0.002], d: 0.0021 }, { plane: "XY", from: [-0.001, 0], to: [0.002, 0.003], d: 0.001 }, [(p) => Math.abs(p[2] - 0.0021) < 1e-9, (p) => Math.abs(p[0] + 0.001) < 1e-9], 1e-5, async (a) => {
      const off = await a.menu("feature-15", "edit");
      if (off !== null) throw new Error(`Edit feature is off: ${off}`);
      (a.$("#edit-height") as HTMLInputElement).value = "0.0015";
      a.$("#feature-edit-ok")!.click();
      await a.settle();
      if (a.$('.timeline-bar-item[data-item="feature-30"]')?.dataset.failed !== "true") throw new Error("the Combine still builds");
    }),
  "small-cube-halved": () =>
    blockAndTool("small-cube-halved", "Small block halved", { plane: "XY", from: [0, 0.001], to: [0.001, 0.002], d: 0.0021 }, { plane: "XY", from: [-0.001, 0], to: [0.002, 0.003], d: 0.001 }, [(p) => Math.abs(p[2] - 0.0021) < 1e-9, (p) => Math.abs(p[0] + 0.001) < 1e-9], 1e-5),
};

const wanted = process.argv.slice(2);
for (const [name, make] of Object.entries(MODELS)) if (wanted.length === 0 || wanted.includes(name)) await make();
