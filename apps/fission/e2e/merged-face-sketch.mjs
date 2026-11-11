// Browser check of SL #502 part 1: a sketch started on a top that two
// joined blocks share is named by the block under the click. Worked by
// hand: Box 1 80 × 60 × 40 at the origin, Box 2 the same moved (80, 0, 0),
// joined (Combine 1): one top x 0..160, y 0..60 at z = 40. Create sketch,
// then a click (or tap) at (150, 50, 40), over Box 2: the saved sketch's
// plane is Box 2's top, "face:feature-2/top"; at (20, 10, 40), over Box 1,
// "face:feature-1/top". Before the fix both named Box 1's top (the app
// dropped the kernel's merged names, and the pick took the first). 1280 px
// with a mouse and 375 px with taps. Run with `npm run e2e` (after
// `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { chooseFile } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4352, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4352/";
const browser = await launch();
const errors = [];
const T = 30000;

const until = (page, fn, arg, what, timeout = T) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
async function rebuilt(page) {
  await page.waitForTimeout(150);
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const TAN = Math.tan(Math.PI / 8);
/** Where a world point is on screen (client pixels) for the app's camera and the canvas. */
async function toScreen(page, p) {
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const box = await page.locator("#viewport canvas").boundingBox();
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const nx = dot(v, right) / (dot(v, forward) * TAN * (box.width / box.height));
  const ny = dot(v, up) / (dot(v, forward) * TAN);
  return { x: box.x + ((nx + 1) / 2) * box.width, y: box.y + ((1 - ny) / 2) * box.height };
}

const box = (n) => ({ id: `feature-${n}`, intent: { type: "box", parameters: { width: 80, depth: 60, height: 40 }, summary: "Box: 80 × 60 × 40 mm" }, provenance: { self: { workspace: "design", id: `feature-${n}`, label: `Box ${n}` }, from: [] }, dependsOn: [], suppressed: false });
const design = {
  version: 7,
  nextId: 5,
  profiles: [],
  sketches: [],
  timeline: {
    features: [
      box(1),
      box(2),
      { id: "feature-3", intent: { type: "move", parameters: { x: 80, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0, bodies: ["body:feature-2"] }, summary: "Move Box 2 by (80, 0, 0) mm" }, provenance: { self: { workspace: "design", id: "feature-3", label: "Move 1" }, from: [{ workspace: "design", id: "feature-2", label: "Box 2" }] }, dependsOn: ["feature-2"], suppressed: false },
      { id: "feature-4", intent: { type: "combine", parameters: { target: "body:feature-1", tools: ["body:feature-2"], operation: "join", keepTools: false }, summary: "Join Box 2 to Box 1" }, dependsOn: ["feature-1", "feature-2"], provenance: { self: { workspace: "design", id: "feature-4", label: "Combine 1" }, from: [{ workspace: "design", id: "feature-1", label: "Box 1" }, { workspace: "design", id: "feature-2", label: "Box 2" }] }, suppressed: false },
    ],
  },
  bodies: [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }],
  nextBody: 3,
};
const project = { formatVersion: 2, links: [], materials: [], name: "check", units: { length: "mm" }, workspaces: { design } };

/** The plane a sketch started by a click or tap at world point `p` on the joined top is saved with. */
async function sketchedAt(p, phone) {
  const context = await browser.newContext(phone ? { viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true, acceptDownloads: true } : { viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(T);
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}?test-hooks&combine#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "check.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 4, null, "the file opened");
  await rebuilt(page);
  if (phone) await page.tap("#create-sketch");
  else await page.click("#create-sketch");
  await until(page, () => document.querySelector("#viewport").dataset.planes === "XY, XZ, YZ", null, "planes offered");
  const s = await toScreen(page, p);
  const on = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [s.x, s.y]);
  assert.equal(on, "CANVAS", `[${p}] is on the canvas on screen`);
  if (phone) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
  await until(page, () => document.querySelector("#viewport").dataset.planes !== "XY, XZ, YZ", null, "the face picked");
  await page.evaluate(() => document.getElementById("finish-sketch").click());
  await rebuilt(page);
  const coming = page.waitForEvent("download", { timeout: 15000 });
  await chooseFile(page, "file-save", phone);
  const saved = JSON.parse(readFileSync(await (await coming).path(), "utf8"));
  await context.close();
  const sketches = saved.workspaces.design.sketches;
  assert.equal(sketches.length, 1, "one sketch made");
  return saved.workspaces.design.timeline.features.find((f) => f.id === sketches[0].id)?.intent.parameters.plane ?? sketches[0].plane;
}

try {
  for (const phone of [false, true]) {
    assert.equal(await sketchedAt([150, 50, 40], phone), "face:feature-2/top", `over Box 2 (${phone ? "375 px, tap" : "1280 px, mouse"})`);
    assert.equal(await sketchedAt([20, 10, 40], phone), "face:feature-1/top", `over Box 1 (${phone ? "375 px, tap" : "1280 px, mouse"})`);
  }
  assert.deepEqual(errors, []);
  console.log("merged-face-sketch: ok");
} finally {
  await browser.close();
  await server.close();
}
