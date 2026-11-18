// Browser check of a sketch snapping onto construction points (step 59a3b2, constructions behind ?construct): a file
// holds Box 1 (40 x 30 x 20 at the origin), three planes and Point 1 where they meet: Plane 1 the YZ plane offset 25
// (x = 25), Plane 2 the XY plane offset 7 (z = 7), Plane 3 the box's back face (y = 30, facing +y) offset -12
// (y = 18), so Point 1 is (25, 18, 7), worked by hand. A sketch on XY sees it square on at (25, 18): inside the box's
// outline, away from every body corner, edge middle, edge and line-up, so only the construction point can be what
// snaps there. Half a snap reach from it the view says "construction point 25,18" and a click (or tap) lands a line's
// start on (25, 18) exactly. With Point 1's eye shut in the Construction folder first, the same pointer snaps to
// nothing and the click lands off it. 1280 px with a mouse, 375 px with taps. Screenshots go to E2E_SHOTS when set.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, openPanel, pickPlane } from "./start.mjs";

const server = await preview({ preview: { port: 4973, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4973/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
/** The Design data version the file is written in (29; constructions from 26). */
const DESIGN_FILE_VERSION = 29;

const until = (page, fn, arg, what, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed", 15000);
  await nextFrame(page);
}

// The pinhole camera (navigation.mjs's sums).
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
function toScreen(cam, box, p) {
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const aspect = box.width / box.height;
  const nx = dot(v, right) / (dot(v, forward) * T * aspect);
  const ny = dot(v, up) / (dot(v, forward) * T);
  return { x: box.x + ((nx + 1) / 2) * box.width, y: box.y + ((1 - ny) / 2) * box.height };
}
/** Millimetres per screen pixel on the plane the camera looks straight down at. */
async function mmPerPixel(page) {
  const cam = await camera(page);
  const d = sub(cam.position, cam.target);
  return (2 * Math.sqrt(dot(d, d)) * T) / (await canvasBox(page)).height;
}
/** Moves the mouse to (or taps) the world point `p`; fails if something is over the canvas there. */
async function at(page, p, tap, click) {
  await closePanels(page, tap);
  const s = toScreen(await camera(page), await canvasBox(page), p);
  const on = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest("#viewport canvas") ? "canvas" : document.elementFromPoint(x, y)?.id || "other"), [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else if (click) await page.mouse.click(s.x, s.y);
  else await page.mouse.move(s.x, s.y);
}
async function settle(page) {
  let last = null;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last && [...now.position, ...now.target].every((x, k) => Math.abs(x - [...last.position, ...last.target][k]) < 1e-6)) return now;
    last = now;
  }
  throw new Error("the camera never settled");
}
const points = async (page) => (await data(page, "sketchPoints")).split(" ").filter(Boolean).map((p) => p.split(",").map(Number));

const plane = (id, n, inputs, distance, answer, label, dependsOn = []) => ({
  dependsOn,
  id: `feature-${n}`,
  intent: { parameters: { make: "offset_plane", inputs, distance, answer }, summary: `Offset plane, ${distance} mm`, type: "construct" },
  provenance: { from: [], self: { id: `feature-${n}`, label, workspace: "design" } },
  suppressed: false,
});
const features = [
  {
    dependsOn: [],
    id: "feature-1",
    intent: { parameters: { width: 40, depth: 30, height: 20 }, summary: "Box: 40 × 30 × 20 mm", type: "box" },
    provenance: { from: [], self: { id: "feature-1", label: "Box 1", workspace: "design" } },
    suppressed: false,
  },
  // The answers here are the rebuild's to make again from the names; written as worked by hand.
  plane("p1", 2, { plane: "YZ" }, 25, { kind: "plane", point: [25, 0, 0], normal: [1, 0, 0], near: [25, 0, 0] }, "Plane 1"),
  plane("p2", 3, { plane: "XY" }, 7, { kind: "plane", point: [0, 0, 7], normal: [0, 0, 1], near: [0, 0, 7] }, "Plane 2"),
  plane("p3", 4, { plane: "face:feature-1/back" }, -12, { kind: "plane", point: [0, 18, 0], normal: [0, 1, 0], near: [20, 18, 10] }, "Plane 3", ["feature-1"]),
  {
    dependsOn: ["feature-2", "feature-3", "feature-4"],
    id: "feature-5",
    intent: { parameters: { make: "point_where_planes_meet", inputs: { first: "construct:feature-2", second: "construct:feature-3", third: "construct:feature-4" }, answer: { kind: "point", point: [25, 18, 7] } }, summary: "Point where three planes meet", type: "construct" },
    provenance: { from: [], self: { id: "feature-5", label: "Point 1", workspace: "design" } },
    suppressed: false,
  },
];
const project = { formatVersion: 2, links: [], materials: [], name: "Construct snap", units: { length: "mm" }, workspaces: { design: { nextId: 6, profiles: [], sketches: [], version: DESIGN_FILE_VERSION, timeline: { features } } } };

async function fresh(width, height, tap) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${url}?test-hooks&construct#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "construct-snap.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 5, null, "the file open", 15000);
  await rebuilt(page);
  await settle(page);
  return page;
}

/** A sketch on XY, looked at square on, with the Line tool. */
async function sketchOnXY(page, tap) {
  await closePanels(page, tap);
  await press(page, "#create-sketch", tap);
  await pickPlane(page, "XY", tap);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching on XY");
  await settle(page);
  await press(page, "#sketch-tool-line", tap);
  if (tap) await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
  await settle(page);
}

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    const how = `${width} px${tap ? ", taps" : ""}`;
    await check(`${how}: half a reach from Point 1 (25, 18) a sketch on XY snaps to it; the click lands there exactly`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await sketchOnXY(page, tap);
        const half = 5 * (await mmPerPixel(page)); // half a snap reach (SNAP_PIXELS = 10 px)
        const by = [25 + half * 0.6, 18 - half * 0.8, 0];
        if (!tap) {
          await at(page, by, false, false);
          await until(page, () => document.querySelector("#viewport").dataset.sketchSnap === "construction point 25,18", null, `"construction point 25,18" shown (shown: "${await data(page, "sketchSnap")}")`);
          if (shots) await page.screenshot({ path: `${shots}/construct-snap-${width}.png` });
        }
        await at(page, by, tap, true);
        await until(page, () => document.querySelector("#viewport").dataset.sketchPoints !== "", null, "a line started");
        const [p] = await points(page);
        assert.deepEqual(p, [25, 18], "the line's start is on Point 1 exactly");
        if (tap && shots) await page.screenshot({ path: `${shots}/construct-snap-${width}.png` });
      } finally {
        await page.context().close();
      }
    });

    await check(`${how}: Point 1's eye shut, the same pointer snaps to nothing and lands off it`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await openPanel(page, "browser", tap);
        const eye = '[data-eye="constructions/feature-5"]';
        await until(page, (sel) => document.querySelector(sel) !== null, eye, "Point 1's eye");
        await press(page, eye, tap);
        await until(page, (sel) => document.querySelector(sel)?.getAttribute("aria-pressed") === "false", eye, "Point 1 hidden");
        await sketchOnXY(page, tap);
        const half = 5 * (await mmPerPixel(page));
        const by = [25 + half * 0.6, 18 - half * 0.8, 0];
        if (!tap) {
          await at(page, by, false, false);
          await page.waitForTimeout(300);
          assert.equal(await data(page, "sketchSnap"), "", "no snap by a hidden point");
          if (shots) await page.screenshot({ path: `${shots}/construct-snap-hidden-${width}.png` });
        }
        await at(page, by, tap, true);
        await until(page, () => document.querySelector("#viewport").dataset.sketchPoints !== "", null, "a line started");
        const [p] = await points(page);
        assert.ok(!(p[0] === 25 && p[1] === 18), `a hidden point snapped: ${p}`);
        assert.ok(Math.hypot(p[0] - by[0], p[1] - by[1]) <= half, `the click landed where the pointer was: ${p} vs ${by}`);
        if (tap && shots) await page.screenshot({ path: `${shots}/construct-snap-hidden-${width}.png` });
      } finally {
        await page.context().close();
      }
    });
  }
} finally {
  await browser.close();
  await server.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
