// Browser check of 36d's pointer (refusal-overlay.ts, places-layer.ts): a
// Join of two 10 mm cubes that meet only along an edge is refused by the
// kernel, its row fails, and the view draws that edge over the bodies in
// the error colour. Worked by hand: Box 1 spans 0..10 on every axis, Box 2
// moved (10, 0, 10) spans x 10..20, y 0..10, z 10..20, so both hold only
// x = 10, z = 10 for y 0..10: the edge (10, 0, 10) to (10, 10, 10), one
// line, no dot. Switching to another workspace takes the line off the view;
// coming back puts it on again. 1280 px with a mouse and 375 px with taps.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after
// `npm run build`). Then a Combine that builds, using up the design's last
// box (Ben's file of 2026-11-05): no failure shown anywhere.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { decodePng } from "./png.mjs";
import { preview } from "vite";
import { readFileSync } from "node:fs";

const server = await preview({ preview: { port: 4296, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4296/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out`));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function rebuilt(page) {
  await until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed", 15000);
  await nextFrame(page);
}
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
/** The WebGL canvas's own pixels (it keeps its drawing buffer). */
async function canvasImage(page) {
  const u = await page.evaluate(() => document.querySelector("#viewport canvas").toDataURL("image/png"));
  return decodePng(Buffer.from(u.slice(u.indexOf(",") + 1), "base64"));
}
/**
 * How red the reddest pixel within 2 px of the world point `p` is: red less
 * green. The error colour (1, 0.42, 0.42) is 255 − 107 = 148; the cubes'
 * grey and the background are near 0 (red and green within a few levels).
 * Half a pixel of line beside grey still reads over 60.
 */
async function redNear(page, p) {
  const box = await canvasBox(page);
  const s = toScreen(await camera(page), box, p);
  const img = await canvasImage(page);
  const scale = img.width / box.width;
  const [cx, cy] = [Math.round((s.x - box.x) * scale), Math.round((s.y - box.y) * scale)];
  let most = -255;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const i = 4 * ((cy + dy) * img.width + cx + dx);
      most = Math.max(most, img.data[i] - img.data[i + 1]);
    }
  return most;
}
const switchTo = (page, id) =>
  page.evaluate(async (id) => {
    document.getElementById("workspace-menu").click();
    document.querySelector(`#workspace-menu-menu [data-workspace="${id}"]`).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (document.body.dataset.activeWorkspace !== id) throw new Error(`asked for ${id}, showing ${document.body.dataset.activeWorkspace}`);
  }, id);

const design = {"version":7,"nextId":5,"profiles":[],"sketches":[],"timeline":{"features":[{"id":"feature-1","intent":{"type":"box","parameters":{"width":10,"depth":10,"height":10},"summary":"Box: 10 × 10 × 10 mm"},"provenance":{"self":{"workspace":"design","id":"feature-1","label":"Box 1"},"from":[]},"dependsOn":[],"suppressed":false},{"id":"feature-2","intent":{"type":"box","parameters":{"width":10,"depth":10,"height":10},"summary":"Box: 10 × 10 × 10 mm"},"provenance":{"self":{"workspace":"design","id":"feature-2","label":"Box 2"},"from":[]},"dependsOn":[],"suppressed":false},{"id":"feature-3","intent":{"type":"move","parameters":{"x":10,"y":0,"z":10,"turnX":0,"turnY":0,"turnZ":0,"pivotX":0,"pivotY":0,"pivotZ":0,"bodies":["body:feature-2"]},"summary":"Move Box 2 by (10, 0, 10) mm"},"provenance":{"self":{"workspace":"design","id":"feature-3","label":"Move 1"},"from":[{"workspace":"design","id":"feature-2","label":"Box 2"}]},"dependsOn":["feature-2"],"suppressed":false},{"id":"feature-4","intent":{"type":"combine","parameters":{"target":"body:feature-1","tools":["body:feature-2"],"operation":"join","keepTools":false},"summary":"Join Box 2 to Box 1"},"dependsOn":["feature-1","feature-2"],"provenance":{"self":{"workspace":"design","id":"feature-4","label":"Combine 1"},"from":[{"workspace":"design","id":"feature-1","label":"Box 1"},{"workspace":"design","id":"feature-2","label":"Box 2"}]},"suppressed":false}]},"bodies":[{"id":"body:feature-1","number":1},{"id":"body:feature-2","number":2}],"nextBody":3};
const project = { formatVersion: 2, links: [], materials: [], name: "Refused Combine", units: { length: "mm" }, workspaces: { design } };
const COMBINE = "feature-4";

try {
  for (const [width, height, tap] of [[1280, 800, false], [375, 812, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap, isMobile: tap, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${url}?test-hooks&all-workspaces#design`);
    await page.locator("#start-hint").waitFor();
    await page.setInputFiles("#open-file", { name: "refused.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await until(page, (id) => document.querySelector(`#timeline li[data-item="${id}"]`) !== null, COMBINE, "the file open", 15000);
    await rebuilt(page);
    await until(page, () => document.querySelector("#viewport").dataset.overlayPlaces === "points 0 lines 1", null, `${width}: the edge drawn as one line`);
    const row = await page.$eval(`#timeline li[data-item="${COMBINE}"]`, (li) => ({ failed: li.dataset.failed, title: li.title }));
    assert.equal(row.failed, "true", `${width}: Combine 1 fails on its row`);
    await nextFrame(page);
    // The edge's middle (10, 5, 10) and a quarter along it are red; a point on Box 1's top well away from it is not.
    for (const p of [[10, 5, 10], [10, 2.5, 10]]) {
      const red = await redNear(page, p);
      assert.ok(red > 60, `${width}: the line shows at [${p}] (red less green ${red})`);
    }
    const away = await redNear(page, [3, 3, 10]);
    assert.ok(away < 30, `${width}: no red on Box 1's top away from the edge (${away})`);
    // The legend names it in the error's red, not under the view cube or Design's Properties toggle (it sat under
    // the toggle at the top right before 36d): its middle is the legend itself.
    const legend = await page.evaluate(() => {
      const li = document.querySelector(".overlay-legend li");
      const r = li.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      // One line: its words make one line box.
      const words = document.createRange();
      words.selectNodeContents(li);
      const oneLine = new Set([...words.getClientRects()].map((b) => Math.round(b.top))).size === 1;
      return { text: li.textContent, colour: getComputedStyle(li).color, onTop: top === li || li.contains(top), oneLine };
    });
    assert.deepEqual(legend, { text: "Where Combine 1 can't be made", colour: "rgb(255, 107, 107)", onTop: true, oneLine: true }, `${width}: the legend`);
    if (shots) await page.screenshot({ path: `${shots}/combine-refused-${width}.png` });
    // Another workspace: Design's pointer leaves the view. Back: it is drawn again.
    await switchTo(page, "laser");
    await until(page, () => document.querySelector("#viewport").dataset.overlayPlaces === undefined, null, `${width}: the line off the view in Laser`);
    await switchTo(page, "design");
    await until(page, () => document.querySelector("#viewport").dataset.overlayPlaces === "points 0 lines 1", null, `${width}: the line back in Design`);
    // Ben's design (2026-11-05): the last box cut from the part by a Combine that builds. Nothing failed, so no
    // red line under the body and no ⚠ on the folded Properties button (it said "Box 5 is built").
    await page.setInputFiles("#open-file", { name: "Untitled.spindle", mimeType: "application/json", buffer: readFileSync(new URL("../../../workspaces/design/test/regressions/combined-part.spindle", import.meta.url)) });
    await until(page, () => document.querySelector('#timeline li[data-item="feature-57"]') !== null, null, `${width}: Ben's file open`, 15000);
    await rebuilt(page);
    const used = await page.evaluate(() => ({
      error: document.querySelector("#error").textContent,
      problem: document.querySelector("#properties").hasAttribute("data-problem"),
      failed: [...document.querySelectorAll("#timeline li[data-failed], #timeline li[data-warned]")].map((li) => li.dataset.item),
      outOfDate: !document.querySelector("#stale-note").hidden,
    }));
    assert.deepEqual(used, { error: "", problem: false, failed: [], outOfDate: false }, `${width}: a Combine using up the last box is no failure`);
    if (shots) await page.screenshot({ path: `${shots}/combine-used-up-${width}.png` });
    await context.close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("combine-refused: PASS");
} finally {
  await browser.close();
  server.httpServer.close();
}
