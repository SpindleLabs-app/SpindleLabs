// Thin faces (Ben, 2026-11-19): a face only a few pixels wide on screen lay wholly inside the reach of its own edges
// (5 px) and corners, which were asked first, so a click or tap on it always picked an edge or nothing.
// - Design, 1280 px mouse and 375 px taps: a 200 × 150 mm plate (x 0..200, y 0..150), 2 mm thick at 1280 px and 4 mm at
//   375 px, from Home; its front face (y = 0) is about 5 px tall. A click or tap on its middle (x 100, half way up)
//   selects the front face, not an edge; a click on the top 1.5 px back from the front edge still selects that edge
//   (the top is wide: the old rule).
// - TestLab, 1280 px mouse and 375 px taps: the 1000 × 5 × 5 mm bar (x 0..1000) from Home; its 5 × 5 end (x = 1000) is
//   a few px across, inside its corners' and edges' reach. Holding: a click or tap on the end's middle holds it.
// - TestLab, 375 px taps: the plate above, its 4 mm front face about 5 px tall. A finger 8 px back on the wide top, or
//   8 px off the part below, takes the front face (thinner than a fingertip, within FACE_TAP_PX = 12 px); 16 px back on
//   the top, the top. (The whole bar is thin at 375 px, so its long faces win a tap on them: the plate shows the reach.)
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { openPanel, sheetsClearFor } from "./start.mjs";

const PORT = 4991;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await launch();
const shots = process.env.E2E_SHOTS;
const probe = process.env.THIN_PROBE === "1";
const errors = [];
let failed = 0;

const box = (width, depth, height) => {
  const features = [{ dependsOn: [], id: "feature-1", intent: { parameters: { width, depth, height }, summary: `Box: ${width} × ${depth} × ${height} mm`, type: "box" }, provenance: { from: [], self: { id: "feature-1", label: "Box 1", workspace: "design" } }, suppressed: false }];
  return { formatVersion: 2, links: [], materials: [], name: "Thin", units: { length: "mm" }, workspaces: { design: { nextId: 2, profiles: [], sketches: [], version: 4, timeline: { features } } } };
};

const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.hypot(...a));
const T = Math.tan(Math.PI / 8); // the 45° field of view

/** Where world point `p` is on screen for the app's camera (the pinhole picture: long-part.mjs's sums). */
async function screenOf(page, p) {
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const r = await page.locator("#viewport canvas").boundingBox();
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const ahead = dot(v, forward);
  return { x: r.x + ((dot(v, right) / (ahead * T * (r.width / r.height)) + 1) / 2) * r.width, y: r.y + ((1 - dot(v, up) / (ahead * T)) / 2) * r.height };
}

/** The camera once it has stopped moving (Home may glide). */
async function still(page) {
  let last = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const now = await page.evaluate(() => window.fissionTest.camera());
    if (last !== null && ["position", "target"].every((k) => now[k].every((x, j) => Math.abs(x - last[k][j]) < 1e-6))) return now;
    last = now;
  }
  assert.fail("the camera never came to rest");
}

async function fresh(width, touch, project, volume, query) {
  const context = await browser.newContext({ viewport: { width, height: touch ? 667 : 800 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/${query}#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "thin.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, (v) => document.querySelector("#volume")?.textContent === v, volume, "the part built");
  await sheetsClearFor(page);
  return page;
}

/** Clicks or taps screen point `s`; fails when something other than the view's canvas is on top there. */
async function hit(page, s, tap) {
  const on = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  assert.equal(on, "canvas", `(${s.x}, ${s.y}) is under ${on}, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}

/** TestLab picking the holds, the part seen from Home. */
async function pickingHolds(page, tap) {
  await page.evaluate(() => (location.hash = "#simulate"));
  await until(page, () => document.querySelector("section[aria-label='TestLab study'] h2")?.textContent === "Study 1: static stress", null, "Study 1 set up");
  await openPanel(page, "properties", tap);
  if (tap) await page.tap("[data-testlab=pick-held]");
  else await page.click("[data-testlab=pick-held]");
  if (tap) await page.waitForTimeout(300); // the sheet sliding away
  await until(page, () => { const h = document.querySelector("#testlab-view-hint"); return h !== null && !h.hidden; }, null, "picking the holds");
  if (tap) await page.tap('#viewport [data-view="home"]');
  else await page.click('#viewport [data-view="home"]');
  await still(page);
}

const selection = (page) => page.evaluate(() => document.body.dataset.selection ?? "");

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}

try {
  for (const [width, tap] of [[1280, false], [375, true]]) {
    const what = `${width} px${tap ? ", taps" : ""}`;
    const h = tap ? 4 : 2;
    await check(`${what}: Design, a click on the middle of a plate's thin front face selects that face, and next to its edge on the top still the edge`, async () => {
      const page = await fresh(width, tap, box(200, 150, h), tap ? "120,000 mm³" : "60,000 mm³", "?test-hooks"); // 200 × 150 × h
      try {
        if (tap) await page.tap('#viewport [data-view="home"]');
        else await page.click('#viewport [data-view="home"]');
        await still(page);
        const low = await screenOf(page, [100, 0, 0]);
        const high = await screenOf(page, [100, 0, h]);
        const tall = Math.hypot(high.x - low.x, high.y - low.y);
        if (probe) console.log(`# ${what}: the front face is ${tall.toFixed(2)} px tall at x 100`);
        // Thin on screen: inside the edges' 5 px reach from both sides (under 10 px), yet a few px to aim at.
        assert.ok(tall > 3 && tall < 10, `the ${h} mm front face is ${tall} px tall on screen`);
        await hit(page, await screenOf(page, [100, 0, h / 2]), tap);
        await until(page, () => /^face:feature-1\//.test(document.body.dataset.selection ?? ""), null, `a face selected (got "${await selection(page)}")`);
        const front = await selection(page);
        assert.match(front, /front/, `the front face: ${front}`);
        if (shots) await page.screenshot({ path: `${shots}/thin-face-design-${width}.png` });
        // The top's front edge (y 0, z h): 1.5 px back onto the top, which is wide, so the edge as before.
        await page.waitForTimeout(600); // past a double-click's 500 ms, which would pick the whole body
        const edge = await screenOf(page, [100, 0, h]);
        const back = await screenOf(page, [100, 50, h]);
        const toward = unit([back.x - edge.x, back.y - edge.y, 0]);
        await hit(page, { x: edge.x + 1.5 * toward[0], y: edge.y + 1.5 * toward[1] }, tap);
        await until(page, () => /^edge:/.test(document.body.dataset.selection ?? ""), null, `the edge selected (got "${await selection(page)}")`);
      } finally {
        await page.context().close();
      }
    });
  }

  for (const [width, tap] of [[1280, false], [375, true]]) {
    const what = `${width} px${tap ? ", taps" : ""}`;
    await check(`${what}: TestLab, the bar's few-pixel end face is held by a ${tap ? "tap" : "click"} on it`, async () => {
      const page = await fresh(width, tap, box(1000, 5, 5), "25,000 mm³", "?testlab&test-hooks"); // 1000 × 5 × 5
      try {
        await pickingHolds(page, tap);
        const end = await screenOf(page, [1000, 2.5, 2.5]);
        const corners = await Promise.all([[1000, 0, 0], [1000, 5, 0], [1000, 0, 5], [1000, 5, 5]].map((p) => screenOf(page, p)));
        const across = Math.max(...corners.map((a) => Math.max(...corners.map((b) => Math.hypot(a.x - b.x, a.y - b.y)))));
        if (probe) console.log(`# ${what}: the end face is ${across.toFixed(2)} px across`);
        // Thin on screen: every point of it within a corner's or edge's reach, so they used to take the click.
        assert.ok(across > 2 && across < 10, `the 5 × 5 mm end is ${across} px across on screen`);
        const held = () => page.evaluate(() => [...document.querySelectorAll(".testlab-page-held li")].map((l) => l.textContent ?? ""));
        await hit(page, end, tap);
        await until(page, () => [...document.querySelectorAll(".testlab-page-held li")].filter((l) => !/^No face/.test(l.textContent ?? "")).length === 1, null, `the end held (held: ${JSON.stringify(await held())}, status: ${await page.locator(".testlab-page-status").textContent()})`);
        const label = (await held())[0];
        if (probe) console.log(`# ${what}: held ${label}`);
        assert.match(label, /^Right face/, "the end (x = 1000, the box's right face)");
        if (shots) await page.screenshot({ path: `${shots}/thin-face-testlab-${width}.png` });
      } finally {
        await page.context().close();
      }
    });
  }

  await check("375 px, taps: TestLab, a finger beside a plate's thin front face holds it, from the wide top or off the part", async () => {
    const page = await fresh(375, true, box(200, 150, 4), "120,000 mm³", "?testlab&test-hooks"); // 200 × 150 × 4
    try {
      await pickingHolds(page, true);
      const held = () => page.evaluate(() => [...document.querySelectorAll(".testlab-page-held li")].map((l) => (l.textContent ?? "").replace("✕", "")));
      const edge = await screenOf(page, [100, 0, 4]); // the top's front edge
      const low = await screenOf(page, [100, 0, 0]); // the bottom's
      const back = await screenOf(page, [100, 50, 4]);
      const u = unit([back.x - edge.x, back.y - edge.y, 0]);
      const down = unit([low.x - edge.x, low.y - edge.y, 0]);
      const tall = Math.hypot(low.x - edge.x, low.y - edge.y);
      assert.ok(tall > 3 && tall < 10, `the 4 mm front face is ${tall} px tall on screen`);
      // 8 px back onto the top (wide): the front face is 8 px off and about 5 px tall, thinner than a fingertip, so
      // the tap is the front's (FACE_TAP_PX, 12 px).
      await hit(page, { x: edge.x + 8 * u[0], y: edge.y + 8 * u[1] }, true);
      await until(page, () => [...document.querySelectorAll(".testlab-page-held li")].filter((l) => !/^No face/.test(l.textContent ?? "")).length === 1, null, `the front held (held: ${JSON.stringify(await held())})`);
      assert.match((await held())[0], /^Front face/);
      // 8 px below the bottom's front edge, off the part: the nearest face, the front, let go again.
      await page.waitForTimeout(600);
      await hit(page, { x: low.x + 8 * down[0], y: low.y + 8 * down[1] }, true);
      await until(page, () => [...document.querySelectorAll(".testlab-page-held li")].filter((l) => !/^No face/.test(l.textContent ?? "")).length === 0, null, `the front let go (held: ${JSON.stringify(await held())})`);
      // And 16 px back onto the top: past the reach, the top's own.
      await page.waitForTimeout(600);
      await hit(page, { x: edge.x + 16 * u[0], y: edge.y + 16 * u[1] }, true);
      await until(page, () => [...document.querySelectorAll(".testlab-page-held li")].filter((l) => !/^No face/.test(l.textContent ?? "")).length === 1, null, `the top held (held: ${JSON.stringify(await held())})`);
      assert.match((await held())[0], /^Top face/);
      if (shots) await page.screenshot({ path: `${shots}/thin-face-testlab-beside-375.png` });
    } finally {
      await page.context().close();
    }
  });
} finally {
  await browser.close();
  server.httpServer.close();
}
if (errors.length) {
  failed++;
  console.log(`not ok - page errors\n  ${errors.join("\n  ")}`);
}
process.exit(failed ? 1 : 0);
