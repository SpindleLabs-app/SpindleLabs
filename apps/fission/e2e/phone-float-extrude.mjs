// Browser check of Extrude on the phone's floating bar (UI audit 2026-11-12, phone-float.ts ENDERS' `next`): at phone
// width the sketch toolbar's Extrude sits past the screen's right edge, so a box took Finish Sketch and then a hunt for
// Extrude along the main toolbar. While a sketch is open the bar now holds Extrude beside Finish Sketch: on screen,
// 44 px tall, tappable, left of the view cube, and a tap on it does what the toolbar's Extrude does (the sketch finished,
// Extrude open with it chosen). The taps for a 10 mm box from an empty design are counted: 9 with the bar's Extrude,
// against 10 with Finish Sketch then the toolbar's Extrude (the old way, also run here as the control). Nothing else on
// the bar changes: the plane prompt and Extrude's own bar have no Extrude. At 393 × 852 (Ben's iPhone 15 Pro) and 390 × 844,
// with taps; at 375 × 667 and 320 × 568 there is no room, and the bar is Finish Sketch alone as before (the old way's
// control runs at all four). Screenshots go to E2E_SHOTS when set. Run with `npm run e2e`.
import assert from "node:assert/strict";
import { launch, untilBodies } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4851, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4851/?test-hooks"; // fissionTest.bodyCount() for untilBodies
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n${e.stack}`);
  }
}

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.locator("#start-hint").waitFor();
  let taps = 0;
  const tap = async (sel) => {
    taps++;
    await page.tap(sel);
  };
  /** A tap at fractions (fx, fy) of the view left clear between the bar over its top and the view bar at its foot (a 320 × 568
   * phone leaves little: the sketch toolbar wraps to four rows there), checked to land on the canvas and nothing over it. */
  const tapPlane = async ([fx, fy]) => {
    taps++;
    const at = await page.evaluate(([fx, fy]) => {
      const top = document.getElementById("phone-float").getBoundingClientRect().bottom;
      const foot = document.getElementById("view-controls").getBoundingClientRect().top;
      const x = innerWidth * fx;
      const y = top + (foot - top) * fy;
      const hit = document.elementFromPoint(x, y);
      return { x, y, canvas: hit?.tagName === "CANVAS" };
    }, [fx, fy]);
    assert.ok(at.canvas, `the tap at ${at.x}, ${at.y} lands on the 3D view`);
    await page.touchscreen.tap(at.x, at.y);
  };
  return { page, context, tap, tapPlane, taps: () => taps };
}

/** The element's box, whether it is all inside the window, and whether a tap at its middle lands on it (nothing over it). */
const reach = (page, sel) =>
  page.$eval(sel, (b) => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { onScreen: r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, tappable: hit === b || b.contains(hit), height: r.height };
  });
const sketching = (page, on) => page.waitForFunction((w) => document.querySelector("#viewport").dataset.sketching === String(w), on);

/** Create sketch, the XY plane from the bar, Rectangle, two corners: 5 taps. */
async function rectangle({ page, tap, tapPlane }) {
  await tap("#create-sketch");
  await page.waitForSelector("#float-plane-XY", { state: "visible" });
  assert.equal(await page.isVisible("#float-extrude"), false, "the plane prompt has no Extrude");
  await tap("#float-plane-XY");
  await sketching(page, true);
  await tap("#sketch-tool-rectangle");
  await tapPlane([0.3, 0.25]);
  await tapPlane([0.6, 0.75]);
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketchPoints?.split(" ").length >= 4);
}

/** Extrude open on Sketch 1: 10 typed in its box from the Properties sheet, then Finish Extrude: 3 taps, one body. */
async function finishAt10({ page, tap }) {
  await page.waitForFunction(() => document.querySelector("#float-finish")?.textContent === "Finish Extrude");
  assert.equal(await page.isVisible("#float-extrude"), false, "Extrude's own bar has no Extrude");
  await tap("#properties-toggle");
  await tap("#extrude-distance");
  await page.fill("#extrude-distance", "10");
  await page.waitForFunction(() => !document.querySelector("#float-finish")?.disabled);
  await tap("#float-finish");
  await untilBodies(page, 1);
}

for (const [width, height] of [[393, 852], [390, 844]]) {
  await check(`${width} px: Extrude beside Finish Sketch on the bar, on screen and tappable, left of the view cube; a tap opens Extrude on the sketch`, async () => {
    const o = await open(width, height);
    const { page } = o;
    await rectangle(o);
    assert.equal(await page.textContent("#float-finish"), "Finish Sketch");
    assert.equal(await page.getAttribute("#float-extrude", "aria-label"), "Extrude");
    // One row, as with Finish Sketch alone (6 + 44 + 6 px and its edges): two buttons never make the bar grow over the view.
    const barHeight = await page.$eval("#phone-float", (b) => b.getBoundingClientRect().height);
    assert.ok(barHeight <= 60, `the bar is one row (${barHeight} px tall)`);
    assert.deepEqual(await reach(page, "#float-extrude"), { onScreen: true, tappable: true, height: 44 }, "Extrude on screen and tappable");
    assert.deepEqual(await reach(page, "#float-finish"), { onScreen: true, tappable: true, height: 44 }, "Finish Sketch still on screen and tappable");
    // The view cube is 8 + 96 px in from the right (phone-start.mjs): the bar never reaches it, now it holds two buttons.
    const right = await page.$eval("#phone-float", (b) => b.getBoundingClientRect().right);
    assert.ok(right <= width - 96, `the bar stops left of the view cube (its right edge at ${right})`);
    // The toolbar's own Extrude is off the screen's right edge here: the reason the bar holds one.
    const toolbarExtrude = await page.$eval("#extrude", (b) => b.getBoundingClientRect().left);
    assert.ok(toolbarExtrude >= width, `the toolbar's Extrude is past the right edge (left at ${toolbarExtrude})`);
    if (shots) await page.screenshot({ path: `${shots}/phone-float-extrude-${width}.png` });
    await o.tap("#float-extrude");
    await sketching(page, false);
    await page.waitForFunction(() => document.querySelector("#extrude-profile")?.textContent === "Sketch 1");
    assert.equal(await page.getAttribute("#properties-toggle", "aria-expanded"), "false", "the sheet stays shut: the view is clear");
    await finishAt10(o);
    // 5 taps to the rectangle, 1 for Extrude, 3 to type 10 and finish.
    assert.equal(o.taps(), 9, "taps for a 10 mm box with the bar's Extrude");
    await o.context.close();
  });

}

// Narrower than 390 px there is no room (phone-float.css): the bar is Finish Sketch alone, exactly as before, so it covers
// no more of the view (at 375 px a second button wrapped the bar or reached onto the spots the sketch checks tap).
for (const [width, height] of [[375, 667], [320, 568]]) {
  await check(`${width} px: no room for Extrude on the bar, which stays Finish Sketch alone in one row`, async () => {
    const o = await open(width, height);
    const { page } = o;
    await rectangle(o);
    assert.equal(await page.isVisible("#float-extrude"), false, "no Extrude on the bar");
    assert.deepEqual(await reach(page, "#float-finish"), { onScreen: true, tappable: true, height: 44 }, "Finish Sketch on screen and tappable");
    const bar = await page.$eval("#phone-float", (b) => {
      const r = b.getBoundingClientRect();
      const f = document.getElementById("float-finish").getBoundingClientRect();
      return { height: r.height, past: r.right - f.right };
    });
    assert.ok(bar.height <= 60, `the bar is one row (${bar.height} px tall)`);
    // The bar ends 6 px (its padding) and its edge past Finish Sketch: nothing beside it.
    assert.ok(bar.past <= 8, `the bar ends just past Finish Sketch (${bar.past} px)`);
    await o.context.close();
  });
}

for (const [width, height] of [[393, 852], [390, 844], [375, 667], [320, 568]]) {
  await check(`${width} px, the control: the old way (Finish Sketch, then the toolbar's Extrude) takes one tap more`, async () => {
    const o = await open(width, height);
    const { page } = o;
    await rectangle(o);
    await o.tap("#float-finish");
    await sketching(page, false);
    await page.$eval("#extrude", (b) => b.scrollIntoView({ inline: "nearest" }));
    await o.tap("#extrude");
    await page.waitForFunction(() => document.querySelector("#extrude-profile")?.textContent === "Sketch 1");
    await finishAt10(o);
    assert.equal(o.taps(), 10, "taps for a 10 mm box the old way");
    await o.context.close();
  });
}

await check("1280 px: no bar, so no second Extrude (the toolbar's is in sight)", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  await page.goto(url);
  await page.locator("#start-hint").waitFor();
  await page.click("#create-sketch");
  await page.click("#sketch-plane-XY");
  await sketching(page, true);
  assert.equal(await page.isVisible("#float-extrude"), false);
  assert.equal(await page.isVisible("#extrude"), true);
  await context.close();
});

await browser.close();
await server.close();
assert.deepEqual(errors, [], "no page errors");
if (failed) process.exit(1);
