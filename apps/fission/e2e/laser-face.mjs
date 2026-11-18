// Browser check of Laser step L1b4 (behind ?laser): a sketch on a face seen from behind its plane lies on the laser bed
// as it was drawn, never as its mirror image (export hunt 2026-11-12, SL #639 item 2), and Flip mirrors a part.
// - An L is drawn with the line tool on the box's top face (the control) and on its bottom face (the view turned to look
//   up at it). Laser's saved SVG is compared with where the corners were clicked on screen: both are y-down pictures,
//   so a true copy keeps the turning sense (the sign of the area) and the way the L's foot and arm point; a mirror image
//   turns the sense (copy-svg-face.mjs makes the same proof for Copy as SVG).
// - Flip on the bottom face's part turns the sense in the file and on the bed, and Flip again turns it back.
// Needs `?test-hooks` for the camera. Port 4633.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { gridSnapOn, startWithBox } from "./start.mjs";

const PORT = 4633;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/?laser&test-hooks`;
const browser = await launch();
const errors = [];
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();

// The pinhole camera, worked here apart from the app: forward = unit(target − position), right = unit(forward × up),
// the screen's up = right × forward; a 45° vertical field of view.
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
/** Clicks the world point `p` as the camera sees it now; fails if something is over the canvas there. */
async function at(page, p) {
  const s = toScreen(await camera(page), await canvasBox(page), p);
  const on = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  await page.mouse.click(s.x, s.y);
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

/** Twice the signed area of a y-down picture's corners, halved: its sign is the turning sense. */
const shoelace = (pts) => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;
/** The corners of the first part in Laser's saved SVG (straight sides only: M and L), in the file's y-down numbers. */
const svgCorners = (text) => [...(/<path id="part-[^"]+" d="([^"]+)"/.exec(text)?.[1] ?? "").matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
/**
 * Which way an L faces in a picture, whatever order its corners are written in: the corner of its box that is not one
 * of its own (the notch's side), as [x, y] signs from the box's middle. A mirror changes one sign; Look At and the bed
 * add no turn, so a true copy has the same signs as the screen. `slack` is how near a corner must be to count, in the
 * picture's units.
 */
function notch(pts, slack) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const missing = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].filter((c) => !pts.some((p) => Math.abs(p[0] - c[0]) <= slack && Math.abs(p[1] - c[1]) <= slack));
  assert.equal(missing.length, 1, `an L's box has one corner that is not the L's: ${JSON.stringify(pts)}`);
  return [Math.sign(missing[0][0] - (x0 + x1) / 2), Math.sign(missing[0][1] - (y0 + y1) / 2)];
}

const save = async (page) => {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".laser-page button[data-save=svg]")]);
  return readFileSync(await dl.path(), "utf8");
};

/** An L drawn on face `which` (top z = 20 or bottom z = 0) with the line tool, finished; its corners on screen as clicked. */
async function drawL(page, which) {
  const z = which === "bottom" ? 0 : 20;
  if (which === "bottom") {
    // Look up at the box: a drag up on the canvas orbits the camera under it (copy-svg-face.mjs's way).
    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 15 * k);
    await page.mouse.up();
    await settle(page);
  }
  await page.click("#create-sketch");
  await until(page, () => document.querySelector("#viewport").dataset.planes === "XY, XZ, YZ", null, "planes offered");
  const middle = [20, 15, z];
  const hoverAt = toScreen(await camera(page), await canvasBox(page), middle);
  await page.mouse.move(hoverAt.x, hoverAt.y);
  await page.waitForTimeout(150);
  await at(page, middle);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching on the face");
  // In the world's x and y on the 10 mm grid: the long arm along y, the foot at small y towards +x.
  const L = [[10, 0], [30, 0], [30, 10], [20, 10], [20, 30], [10, 30]].map(([x, y]) => [x, y, z]);
  const cam = await settle(page);
  const canvas = await canvasBox(page);
  const onScreen = L.map((p) => toScreen(cam, canvas, p)).map((s) => [s.x, s.y]);
  await page.evaluate(() => document.getElementById("properties-toggle")?.getAttribute("aria-expanded") === "false" && document.getElementById("properties-toggle").click());
  await gridSnapOn(page);
  await page.evaluate(() => (document.getElementById("workspace").scrollTop = 0));
  for (const p of [...L, L[0]]) await at(page, p);
  await until(page, () => document.querySelector("#sketch-status")?.textContent === "6 lines, a closed outline.", null, "a closed L");
  await page.click("#finish-sketch");
  await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true", null, "the sketch finished");
  return onScreen;
}

async function lOnTheBed(which) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}#design`);
  await startWithBox(page);
  const onScreen = await drawL(page, which);
  await page.evaluate(() => (location.hash = "#laser"));
  await until(page, () => document.body.dataset.activeWorkspace === "laser", null, "Laser shown");
  await until(page, () => document.querySelector(".laser-page-words")?.textContent?.startsWith("1 part on the bed."), null, "the L on the bed");
  const file = svgCorners(await save(page));
  const [seen, saved] = [notch(onScreen, 1), notch(file, 1e-6)];
  console.log(`  ${which}: the L's notch on screen ${seen}, in Laser's SVG ${saved}`);
  assert.equal(Math.abs(shoelace(file)), 400, "the L's area in the file, mm² (by hand 20·10 + 10·20)");
  assert.deepEqual(saved, seen, `the L on the ${which} face is on the bed as the MIRROR IMAGE of what was drawn`);
  return { context, page, seen };
}

try {
  await check("control: an L drawn on the top face is on the bed the way it looked on screen", async () => {
    const { context } = await lOnTheBed("top");
    await context.close();
  });

  await check("an L drawn on the bottom face is on the bed the way it looked on screen; Flip mirrors it, on the bed and in the file, and Flip again brings it back", async () => {
    const { context, page, seen } = await lOnTheBed("bottom");
    const part = ".laser-flat path.laser-flat-part";
    const box = await page.locator(part).boundingBox();
    await page.mouse.click(box.x + 3, box.y + box.height - 3); // the L's stem, near the box's corner: on the shape, not its empty corner
    await until(page, () => document.querySelector(".laser-flat")?.dataset.picked !== undefined, null, "the L picked");
    const picked = await page.locator(part).boundingBox(); // the picked part's heavier edge makes its box a little bigger
    await page.click('.laser-flat-bar button[data-view="flip"]');
    await until(page, () => document.querySelector(".laser-page-part button[data-rows]")?.hidden === false, null, "the L placed by hand once flipped");
    const flipped = svgCorners(await save(page));
    assert.deepEqual(notch(flipped, 1e-6), [-seen[0], seen[1]], "Flip mirrors the part left to right in the file");
    assert.equal(Math.abs(shoelace(flipped)), 400);
    // The same box on the bed: flipped on the spot.
    const after = await page.locator(part).boundingBox();
    for (const k of ["x", "y", "width", "height"]) assert.ok(Math.abs(after[k] - picked[k]) <= 1, `the box's ${k} kept: ${after[k]} vs ${picked[k]}`);
    await page.click('.laser-page button[data-flip]');
    assert.deepEqual(notch(svgCorners(await save(page)), 1e-6), seen, "Flip again brings it back");
    await context.close();
  });

  await check("no page errors", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) process.exit(1);
