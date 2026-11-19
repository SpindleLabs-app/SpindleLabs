// Ben's long skinny part (2026-11-19): a 1000 × 5 × 5 mm bar (200:1, x 0..1000) was hard to move round and the view
// cube sometimes stuck. Each check was red before its fix:
// - Zoom: the wheel at the bar's near end used to scale about the focus plane through the bar's middle (500 mm back),
//   so the camera flew through the end and on past it. Now it scales about the bar's own point under the pointer: that
//   point stays under the pointer, the camera closes in on it and stays in front of it.
// - Clipping: zoomed in close at one end, the far plane (100 × the camera's distance) cut off the rest of the bar. The far
//   plane now reaches past the whole part.
// - Tabs: putting a camera back (as a design tab does) made its up the screen's tilted up, so Top came out rolled and
//   the view flipped wherever it looked along that tilt (the cube "stuck"). By hand: Top looks down −Z with +Y up on
//   screen; Front looks along +Y with +Z up.
// - The cube: a drag whose mouse release never arrived kept orbiting with the bare pointer. Now a move with no button
//   held ends the drag.
// - TestLab: 50 kg on the bar's top, its right end held: a bend of metres was drawn at true size and the bar looked
//   ten times longer; now drawn a hundred-odd times smaller and said so, and Home frames the bar as it did before Run.
// 1280 px with a mouse, and 375 px with taps (Top after a tab's camera, Home, the clipping range).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { openPanel, sheetsClearFor } from "./start.mjs";

const PORT = 4983;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await launch();
const shots = process.env.E2E_SHOTS;
const errors = [];
let failed = 0;

const features = [{ dependsOn: [], id: "feature-1", intent: { parameters: { width: 1000, depth: 5, height: 5 }, summary: "Box: 1000 × 5 × 5 mm", type: "box" }, provenance: { from: [], self: { id: "feature-1", label: "Box 1", workspace: "design" } }, suppressed: false }];
const project = { formatVersion: 2, links: [], materials: [], name: "Long bar", units: { length: "mm" }, workspaces: { design: { nextId: 2, profiles: [], sketches: [], version: 4, timeline: { features } } } };

const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.hypot(...a));
const T = Math.tan(Math.PI / 8); // the 45° field of view
const near = (a, b, eps, what) => assert.ok(a.every((x, i) => Math.abs(x - b[i]) <= eps), `${what}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);

/** Where world point `p` is on screen for the app's camera (the pinhole picture), and how far ahead of the camera. */
async function screenOf(page, p) {
  const cam = await camera(page);
  const box = await page.locator("#viewport canvas").boundingBox();
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const ahead = dot(v, forward);
  return { x: box.x + ((dot(v, right) / (ahead * T * (box.width / box.height)) + 1) / 2) * box.width, y: box.y + ((1 - dot(v, up) / (ahead * T)) / 2) * box.height, ahead };
}

/** Where the ray through screen pixel (x, y) meets the plane z = `z` (the bar's top), for the app's camera now. */
async function onPlaneUnder(page, x, y, z) {
  const cam = await camera(page);
  const box = await page.locator("#viewport canvas").boundingBox();
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const nx = ((x - box.x) / box.width) * 2 - 1;
  const ny = 1 - ((y - box.y) / box.height) * 2;
  const ray = forward.map((f, i) => f + nx * T * (box.width / box.height) * right[i] + ny * T * up[i]);
  const k = (z - cam.position[2]) / ray[2];
  return cam.position.map((c, i) => c + k * ray[i]);
}

/** The camera once it has stopped moving (a view change may glide). */
async function still(page) {
  let last = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last !== null && ["position", "target"].every((k) => now[k].every((x, j) => Math.abs(x - last[k][j]) < 1e-6))) return now;
    last = now;
  }
  assert.fail("the camera never came to rest");
}

async function fresh(width, height, touch, query = "?test-hooks") {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/${query}#design`);
  await page.locator("#start-hint").waitFor();
  await page.setInputFiles("#open-file", { name: "long-bar.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await until(page, () => document.querySelector("#volume")?.textContent === "25,000 mm³", null, "the bar built"); // 1000 × 5 × 5
  await sheetsClearFor(page);
  return page;
}

/** Wheel notches (100 px each, in) with the pointer held still on world point `p`; returns where the pointer is. */
async function zoomInAt(page, p, notches) {
  const s = await screenOf(page, p);
  await page.mouse.move(s.x, s.y);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(20);
  }
  return s;
}

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
  await check("1280 px: the wheel at the bar's near end closes in on it, keeps it under the pointer, and the far end is not clipped", async () => {
    const page = await fresh(1280, 800, false);
    try {
      await press(page, '#viewport [data-view="home"]', false);
      await still(page);
      const end = [995, 2.5, 5]; // on the top, 5 mm from the near end (the camera is on the +x side)
      // The pointer on a whole pixel (as the browser reports it) over the top near the end: the bar's point under it.
      const guess = await screenOf(page, end);
      const pointer = { x: Math.round(guess.x), y: Math.round(guess.y) };
      const under = await onPlaneUnder(page, pointer.x, pointer.y, 5);
      assert.ok(under[0] > 990 && under[0] < 1000 && under[1] > 0 && under[1] < 5, `on the top near the end: ${under}`);
      let last = (await screenOf(page, under)).ahead;
      await page.mouse.move(pointer.x, pointer.y);
      for (let round = 0; round < 6; round++) {
        for (let i = 0; i < 5; i++) {
          await page.mouse.wheel(0, -100);
          await page.waitForTimeout(20);
        }
        const now = await screenOf(page, under);
        // In front of the camera and closer each round, and still under the pointer, which never moved, to a pixel.
        assert.ok(now.ahead > 0 && now.ahead < last, `round ${round}: the end ${now.ahead} mm ahead after ${last}`);
        assert.ok(Math.hypot(now.x - pointer.x, now.y - pointer.y) < 1, `round ${round}: the end at ${now.x}, ${now.y}, the pointer at ${pointer.x}, ${pointer.y}`);
        last = now.ahead;
      }
      // 30 notches of ×1.22: 1,600 mm / 1.22³⁰ ≈ 4 mm. The old way ended behind the end, inside or past the bar.
      assert.ok(last < 20, `the camera closed in: ${last} mm from the end`);
      // The far end of the bar (its corner at the origin, about 1,000 mm off) is inside the far plane.
      const cam = await camera(page);
      const clip = await page.evaluate(() => window.fissionTest.clip());
      const farCorner = Math.hypot(...cam.position);
      assert.ok(clip.far > farCorner, `the far plane ${clip.far} mm reaches the far end ${farCorner} mm away`);
      assert.ok(clip.near < last, `the near plane ${clip.near} mm is short of the end ${last} mm away`);
      if (shots) await page.screenshot({ path: `${shots}/long-part-zoomed-1280.png` });
    } finally {
      await page.context().close();
    }
  });

  for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
    await check(`${width} px${tap ? ", taps" : ""}: after a tab puts the camera back, Top and Front come out square, not rolled`, async () => {
      const page = await fresh(width, height, tap);
      try {
        await press(page, '#viewport [data-view="home"]', tap);
        const home = await still(page);
        // As a design tab returned to does (main.ts apply): the pose it took, put back.
        await page.evaluate((pose) => window.fissionTest.restoreCamera(pose), home);
        const back = await still(page);
        near(back.position, home.position, 1e-6, "the camera is where it was");
        near(back.up, home.up, 1e-9, "and its screen's up as it was");
        await press(page, '#viewport [data-view="top"]', tap);
        const top = await still(page);
        near(top.up, [0, 1, 0], 1e-6, "Top: +Y up on screen");
        await press(page, '#viewport [data-view="front"]', tap);
        const front = await still(page);
        near(front.up, [0, 0, 1], 1e-6, "Front: +Z up on screen");
        // The far plane covers the whole bar from Home, phone or not.
        await press(page, '#viewport [data-view="home"]', tap);
        const again = await still(page);
        const clip = await page.evaluate(() => window.fissionTest.clip());
        assert.ok(clip.far > Math.hypot(...again.position) && clip.far > Math.hypot(...sub(again.position, [1000, 5, 5])), JSON.stringify(clip));
        if (shots) await page.screenshot({ path: `${shots}/long-part-views-${width}.png` });
      } finally {
        await page.context().close();
      }
    });
  }

  await check("1280 px: a view cube drag whose release never arrives stops orbiting at the first move with no button held", async () => {
    const page = await fresh(1280, 800, false);
    try {
      await still(page);
      const cube = await page.locator("#viewport .view-cube").boundingBox();
      const at = [cube.x + cube.width / 2, cube.y + cube.height / 2];
      await page.mouse.move(at[0], at[1]);
      await page.mouse.down();
      await page.mouse.move(at[0] + 20, at[1], { steps: 4 });
      const dragged = await camera(page);
      // The release lost: a move over the cube with no button held (what the browser sends once the mouse was let go
      // outside the window). Chromium's mouse is pointer 1.
      await page.evaluate(([x, y]) => {
        const cube = document.querySelector("#viewport .view-cube");
        cube.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0, clientX: x, clientY: y, bubbles: true }));
        cube.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0, clientX: x + 40, clientY: y + 30, bubbles: true }));
      }, [at[0] + 30, at[1]]);
      const after = await camera(page);
      near(after.position, dragged.position, 1e-9, "no orbit after the release was lost");
      await page.mouse.up();
      // The cube still works: a fresh drag orbits.
      await page.mouse.move(at[0], at[1]);
      await page.mouse.down();
      await page.mouse.move(at[0] + 20, at[1], { steps: 4 });
      await page.mouse.up();
      const fresh2 = await camera(page);
      assert.ok(Math.hypot(...sub(fresh2.position, after.position)) > 1, "a new drag orbits");
    } finally {
      await page.context().close();
    }
  });

  await check("1280 px, then 375 px wide: TestLab past breaking draws the bend scaled down and says so; Home frames the bar as before Run", async () => {
    const page = await fresh(1280, 800, false, "?testlab&test-hooks");
    try {
      await page.evaluate(() => (location.hash = "#simulate"));
      await until(page, () => document.querySelector("section[aria-label='TestLab study'] h2")?.textContent === "Study 1: static stress", null, "Study 1 set up");
      await press(page, '#viewport [data-view="home"]', false);
      const home = await still(page);
      const homeDistance = Math.hypot(...sub(home.position, home.target));
      // Hold the right end: seen from Right, square on, it is 3 px across, so zoomed in on first as a person would (the
      // wheel at its middle; about the focus plane the camera went into the bar).
      await openPanel(page, "properties");
      await page.click("[data-testlab=pick-held]");
      await press(page, '#viewport [data-view="right"]', false);
      await still(page);
      await zoomInAt(page, [1000, 2.5, 2.5], 20);
      const endAt = await screenOf(page, [1000, 2.5, 2.5]);
      assert.ok(endAt.ahead > 0, "the camera is still outside the bar's end");
      await page.mouse.click(endAt.x, endAt.y);
      if (shots) await page.screenshot({ path: `${shots}/long-part-hold-1280.png` });
      await until(page, () => document.querySelector(".testlab-page-held li")?.textContent?.startsWith("Right face"), null, "the right end held");
      await page.click("[data-testlab=add-load]");
      await press(page, '#viewport [data-view="top"]', false);
      await still(page);
      await zoomInAt(page, [20, 2.5, 5], 12);
      const topAt = await screenOf(page, [20, 2.5, 5]);
      await page.mouse.click(topAt.x, topAt.y);
      await until(page, () => document.querySelector(".testlab-page-load li")?.textContent?.startsWith("Top face"), null, "the top pushed");
      await openPanel(page, "properties");
      await page.fill(".testlab-page input[name=amount]", "50");
      await page.press(".testlab-page input[name=amount]", "Enter");
      await page.selectOption(".testlab-page select[name=unit]", "kg");
      await page.selectOption(".testlab-page select[name=material]", "pla");
      await page.click("[data-testlab=run]");
      await until(page, () => document.querySelector(".testlab-results-verdict") !== null, null, "Run's result", 120000);
      assert.equal(await page.locator(".testlab-results-verdict").textContent(), "Would break");
      const words = await page.locator(".testlab-results").textContent();
      assert.match(words, /This estimate is for small bends and this one is too big to draw truly, so it is drawn [\d,]+ times smaller than worked out/);
      const bend = Number(/Biggest bend([\d,.]+) mm/.exec(words)[1].replace(/,/g, ""));
      assert.ok(bend > 100, `a bend of ${bend} mm, far past the bar's 100 mm tenth`);
      // Home frames what is drawn: the bar and a bend of at most a tenth of it, so about as far back as before Run (at
      // true size the drawn part was metres across and Home stood back many times further).
      await press(page, '#viewport [data-view="home"]', false);
      const after = await still(page);
      const ratio = Math.hypot(...sub(after.position, after.target)) / homeDistance;
      assert.ok(ratio > 0.9 && ratio < 1.15, `Home stands ${ratio.toFixed(3)} times as far back as before Run`);
      if (shots) await page.screenshot({ path: `${shots}/long-part-testlab-1280.png` });
      // At 375 px wide the words are there to read and Home frames the part on the narrow view.
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(300);
      await openPanel(page, "properties");
      const said = page.locator(".testlab-results-words", { hasText: "times smaller" });
      await page.locator(".testlab-results details summary, .testlab-results summary").first().click().catch(() => {});
      assert.equal(await said.count(), 1);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(wide <= 375, `the page is ${wide} px wide`);
      if (shots) await page.screenshot({ path: `${shots}/long-part-testlab-375.png` });
    } finally {
      await page.context().close();
    }
  });
} finally {
  await browser.close();
  server.httpServer.close();
}

if (errors.length) {
  console.log(`not ok - page errors\n  ${errors.join("\n  ")}`);
  failed++;
}
if (failed) process.exit(1);
