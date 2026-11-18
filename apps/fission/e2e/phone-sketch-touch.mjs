// Browser check of the sketch and Extrude on touch screens of every shape
// (phone hunt 2026-11-12, SpindleLabs #614; styles: typed-entry.css,
// sketchbar.css, phone-short.css, phone-float.css, view-controls.css,
// extrude-several.css).
// 1. A phone held sideways wider than 640 px (667 × 375, 740 × 360): the
//    typed-size boxes take no taps until typed in, so the next tap of a line,
//    rectangle or circle, landing where the boxes stand, places the point and
//    opens no keyboard; the sketch toolbar's Type button shows there.
//    (A tablet, 1024 × 768 touch, keeps boxes that take taps and no Type.)
// 2. A short phone held sideways, also 640 px wide or less (568 × 320,
//    600 × 340, 640 × 300) and the usual sizes: in a sketch and at the plane
//    prompt no button's centre lies under another element.
//    Short and narrow, the prompt's words let a tap through to the part.
// 3. Pick several is at least 44 px tall on every touch screen.
// 4. On a touch screen the Extrude hint does not tell to hold Ctrl or Shift.
// Each check was red on the build before the fix. Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { insertPreset } from "./start.mjs";

const server = await preview({ build: { outDir: process.env.E2E_DIST || "dist" }, preview: { port: 4414, strictPort: true }, logLevel: "error" });
const browser = await launch();
const problems = [];
const fail = (m) => { problems.push(m); console.log("FAIL", m); };

async function phone(w, h) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 800, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.errors = [];
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto("http://localhost:4414/?test-hooks#design");
  await page.locator("#start-hint").waitFor();
  return page;
}
const enterSketch = async (page) => {
  await page.tap("#create-sketch");
  await page.waitForTimeout(300);
  await page.tap((await page.isVisible("#float-plane-XY")) ? "#float-plane-XY" : "#sketch-plane-XY");
  await page.waitForTimeout(800);
};
/** Canvas points of the 3-D view (a grid) that are not covered by anything. */
const freePoints = (page) => page.evaluate(() => {
  const c = document.querySelector("#viewport canvas").getBoundingClientRect(); const out = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 20; j++) {
    const x = c.left + (i + 0.5) * c.width / 30, y = c.top + (j + 0.5) * c.height / 20;
    const e = document.elementFromPoint(x, y);
    if (e?.tagName === "CANVAS" && e.closest("#viewport")) out.push([x, y]);
  } return out;
});
/** Buttons whose centre is covered by some other element. */
const buried = (page) => page.evaluate(() => {
  const out = [];
  for (const b of document.querySelectorAll("button, [role=button], [aria-label^='Orientation cube']")) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(b).visibility === "hidden" || !b.checkVisibility?.()) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    // Scrolled out of a bar that scrolls sideways: not on the screen, so nothing is buried.
    let clipped = false;
    for (let a = b.parentElement; a; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if (o !== "visible" && a !== document.body && a !== document.documentElement) { const q = a.getBoundingClientRect(); if (x < q.left || x > q.right) clipped = true; }
    }
    if (clipped) continue;
    const e = document.elementFromPoint(x, y);
    if (e && e !== b && !b.contains(e) && !e.contains(b)) out.push(`${b.id || b.getAttribute("aria-label") || b.textContent.trim().slice(0, 12)} under ${e.id || e.closest("[id]")?.id || e.className}`);
  }
  return out;
});

try {
  // 1. Sideways phones: the next tap draws.
  for (const [w, h] of [[667, 375], [740, 360]]) {
    const page = await phone(w, h);
    await enterSketch(page);
    const free = await freePoints(page);
    const near = (x, y) => free.some(([a, b]) => Math.abs(a - x) < 12 && Math.abs(b - y) < 12);
    const c = await page.locator("#viewport canvas").boundingBox();
    free.sort((p, q) => Math.hypot(p[0] - c.x - c.width / 2, p[1] - c.y - c.height / 2) - Math.hypot(q[0] - c.x - c.width / 2, q[1] - c.y - c.height / 2));
    const A = free.find(([x, y]) => near(x + 60, y + 40) && near(x + 30, y + 30));
    assert.ok(A, `${w}x${h}: a free spot to draw`);
    for (const tool of ["line", "rectangle", "circle"]) {
      await page.tap(`#sketch-tool-${tool}`);
      await page.touchscreen.tap(...A); await page.waitForTimeout(400);
      const box = await page.locator("#typed-entry").boundingBox();
      if (!box) console.log(await page.evaluate(() => document.querySelector('#typed-entry')?.outerHTML.slice(0, 300)), A, await page.evaluate(() => document.querySelector('#viewport').dataset.sketchPoints));
      assert.ok(box, `${w}x${h} ${tool}: the size boxes show after the first tap`);
      // The second tap where the first box stands: the pointer test is what decides, the box takes none.
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("#typed-entry") != null, [box.x + box.width / 2, box.y + 12]);
      if (hit) fail(`${w}x${h} ${tool}: the size boxes take the next tap`);
      await page.touchscreen.tap(box.x + box.width / 2, box.y + 12); await page.waitForTimeout(400);
      const focus = await page.evaluate(() => document.activeElement?.id || "");
      if (focus.startsWith("typed-")) fail(`${w}x${h} ${tool}: the next tap opened a size box (focus ${focus})`);
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    }
    // Type is there to type sizes.
    await page.tap("#sketch-tool-line");
    await page.touchscreen.tap(...A); await page.waitForTimeout(300);
    if (!(await page.isVisible(".sketchbar-type"))) fail(`${w}x${h}: no Type button in the sketch toolbar`);
    await page.context().close();
  }
  {
    // A tablet is unchanged: its boxes take taps (no hover), no Type button.
    const page = await phone(1024, 768);
    await enterSketch(page);
    await page.tap("#sketch-tool-line");
    const free = await freePoints(page);
    await page.touchscreen.tap(...free[Math.floor(free.length / 2)]); await page.waitForTimeout(300);
    const pe = await page.$eval("#typed-entry", (e) => getComputedStyle(e).pointerEvents);
    if (pe !== "auto") fail(`1024x768: tablet boxes take taps (pointer-events ${pe})`);
    if (await page.isVisible(".sketchbar-type")) fail("1024x768: a tablet shows the Type button");
    await page.context().close();
  }

  // 2. Nothing always-on lies on something else, in a sketch and at the plane prompt.
  for (const [w, h] of [[568, 320], [600, 340], [640, 300], [640, 360], [375, 667], [393, 852]]) {
    const page = await phone(w, h);
    await page.tap("#start-hint-close").catch(() => {});
    await enterSketch(page);
    let b = await buried(page);
    if (b.length) fail(`${w}x${h} in a sketch: ${b.join(" | ")}`);
    await page.tap("#float-finish"); await page.waitForTimeout(800);
    await page.tap("#create-sketch"); await page.waitForTimeout(500);
    b = await buried(page);
    if (b.length) fail(`${w}x${h} at the plane prompt: ${b.join(" | ")}`);
    if (w <= 640 && h <= 500) {
      // The prompt's words and padding let a tap through to the part under them (only its buttons take taps).
      const through = await page.evaluate(() => { const r = document.querySelector(".phone-float-words").getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e?.tagName === "CANVAS"; });
      if (!through) fail(`${w}x${h}: the plane prompt's words take the tap`);
    }
    await page.context().close();
  }

  // 3 and 4. Pick several's size and the Extrude hint on touch screens.
  for (const [w, h] of [[375, 667], [852, 393], [740, 360], [1024, 768], [820, 1180]]) {
    const page = await phone(w, h);
    await enterSketch(page);
    await page.tap("#sketch-tool-circle");
    const free = await freePoints(page);
    const A = free[Math.floor(free.length / 2)];
    await page.touchscreen.tap(...A); await page.waitForTimeout(300);
    await page.touchscreen.tap(A[0] + 30, A[1]); await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.tap("#sketch-extrude, #extrude").catch(async () => page.tap("#extrude"));
    await page.waitForTimeout(1200);
    if (await page.isVisible("#properties-toggle")) await page.tap("#properties-toggle");
    await page.waitForTimeout(400);
    const box = await page.locator("#extrude-several").boundingBox();
    if (!box || box.height < 44) fail(`${w}x${h}: Pick several is ${box ? Math.round(box.height) : "not shown"} px tall (44 needed)`);
    const hint = await page.locator(".extrude-several-hint").innerText().catch(() => "");
    if (/ctrl|shift/i.test(hint)) fail(`${w}x${h}: the Extrude hint tells a touch screen to hold Ctrl or Shift: ${hint}`);
    await page.context().close();
  }
} finally { await browser.close(); server.httpServer.close(); }
if (problems.length) { console.log(`${problems.length} problem(s)`); process.exit(1); }
console.log("phone-sketch-touch ok");
