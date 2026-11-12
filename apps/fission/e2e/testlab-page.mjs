// Browser check of the TestLab page (Simulate workspace step T1, behind ?testlab), in a real Chromium.
// - Without ?testlab, #simulate is still the Simulate placeholder: no page.
// - With ?testlab, the 40 × 30 × 20 box (x 0..40, y 0..30, z 0..20) from Design is tested without being asked: its front
//   face (y = 0) tapped to hold, a load added and the top (z = 20) tapped, typed 5 kg: "5 kg hanging (49.0 N) down on
//   1 face" (5 × 9.80665), made of PLA with its numbers (T2). Run says it checked the set-up and that solving comes later.
// - The box typed 35 high in Design: back in TestLab the study is out of date with the change note naming the edit, and
//   the top is found again by name at z = 35 (its paint read off the canvas there). The box made a sphere: both faces
//   lost, said in words; Undo brings them back.
// - At 375 px with taps: picking puts the Properties sheet away so the body can be tapped; nothing runs off the side.
// Screenshots: E2E_SHOTS=<dir> saves testlab-1280.png, testlab-taller-1280.png, testlab-lost-1280.png, testlab-375.png.
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { openPanel, chooseShape, startWithBox } from "./start.mjs";
import { pinProperties } from "./properties.mjs";

const PORT = 4637;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/`;
const browser = await launch();
const shots = process.env.E2E_SHOTS;
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
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(async () => assert.fail(`${what}: timed out (status: "${await status(page)}")`));
const status = (page) => page.evaluate(() => document.querySelector(".testlab-page-status")?.textContent ?? "(no page)");
const saying = (page, re, what) => until(page, (s) => new RegExp(s).test(document.querySelector(".testlab-page-status")?.textContent ?? ""), re.source, what);

// The pinhole camera (navigation.mjs's sums): forward = unit(target − position), right = unit(forward × up), up = right × forward; 45° field.
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);
async function screenOf(page, p) {
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const box = await page.locator("#viewport canvas").boundingBox();
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  const nx = dot(v, right) / (dot(v, forward) * T * (box.width / box.height));
  const ny = dot(v, up) / (dot(v, forward) * T);
  return { x: box.x + ((nx + 1) / 2) * box.width, y: box.y + ((1 - ny) / 2) * box.height };
}
/** Clicks or taps the world point `p` on the canvas; fails when something else is on top of it. */
async function at(page, p, tap) {
  const s = await screenOf(page, p);
  const on = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${p}] is under ${on} on screen, not the canvas`);
  if (tap) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}

async function newPage(query, width = 1280) {
  const phone = width < 640;
  const context = await browser.newContext({ viewport: { width, height: phone ? 760 : 800 }, ...(phone && { hasTouch: true, isMobile: true }) });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}${query}#design`);
  return { context, page, tap: phone };
}
const toTestLab = async (page) => {
  await page.evaluate(() => (location.hash = "#simulate"));
  await until(page, () => document.body.dataset.activeWorkspace === "simulate", null, "TestLab shown");
};
const toDesign = async (page) => {
  await page.evaluate(() => (location.hash = "#design"));
  await until(page, () => document.body.dataset.activeWorkspace === "design", null, "Design shown");
};
const press = async (page, sel, tap) => {
  await openPanel(page, "properties", tap);
  if (tap) await page.tap(sel);
  else await page.click(sel);
};

/** Holds the front face, adds a 5 kg load on the top, all by clicks or taps on the body. */
async function setUpStudy(page, tap) {
  await until(page, () => document.querySelector("section[aria-label='TestLab study'] h2")?.textContent === "Study 1: static stress", null, "Study 1 set up");
  await press(page, "[data-testlab=pick-held]", tap);
  await at(page, [20, 0, 10], tap); // the front face's middle
  await until(page, () => document.querySelector(".testlab-page-held li")?.textContent?.startsWith("Front face"), null, "the front held");
  await press(page, "[data-testlab=add-load]", tap);
  if (tap) await page.waitForTimeout(300); // the sheet sliding away
  await at(page, [20, 15, 20], tap); // the top's middle
  await until(page, () => document.querySelector(".testlab-page-load li")?.textContent?.startsWith("Top face"), null, "the top pushed");
  await openPanel(page, "properties", tap);
  await page.fill(".testlab-page input[name=amount]", "5");
  await page.press(".testlab-page input[name=amount]", "Enter");
  await page.selectOption(".testlab-page select[name=unit]", "kg");
  // 5 kg × 9.80665 m/s² = 49.03 N.
  await until(page, () => document.querySelector(".testlab-page-load .testlab-page-words")?.textContent === "5 kg hanging (49.0 N) down on 1 face", null, "the load in words");
  // T2: what it is made of, asked once; PLA across its layers: the lower of 2160 and 2370 MPa, and 35 MPa (the maker's sheet).
  assert.match(await status(page), /Choose what the part is made of\./);
  await page.selectOption(".testlab-page select[name=material]", "pla");
  await until(page, () => /Stiffness 2,160 MPa, breaking strength 35 MPa, 1\.24 g\/cm³\./.test(document.querySelector(".testlab-page-material")?.textContent ?? ""), null, "PLA's numbers");
  assert.doesNotMatch(await status(page), /Choose what the part is made of/);
}

/** The colour of the canvas pixel at world point `p` (premultiplied RGBA). */
async function pixel(page, p) {
  const s = await screenOf(page, p);
  const shot = await page.screenshot({ clip: { x: Math.round(s.x), y: Math.round(s.y), width: 1, height: 1 } });
  const { decodePng } = await import("./png.mjs");
  const img = decodePng(shot);
  return [...img.data.slice(0, 3)];
}

try {
  await check("without ?testlab, Simulate is still the placeholder", async () => {
    const { context, page } = await newPage("?all-workspaces");
    await startWithBox(page);
    await toTestLab(page);
    assert.equal(await page.locator(".testlab-page").count(), 0);
    await context.close();
  });

  await check("1280 px: the box's front held and top pushed by 5 kg, Run checks; the box made taller keeps both and marks it out of date; a sphere loses both; Undo", async () => {
    const { context, page } = await newPage("?testlab&test-hooks");
    await startWithBox(page);
    await toTestLab(page);
    await setUpStudy(page, false);
    await page.click("[data-testlab=run]");
    await saying(page, /^Set up and checked against the design as it is now\. Solving comes with TestLab's solver/, "Run's words");
    assert.equal(await page.getAttribute(".testlab-page-state", "data-stale"), "false");
    if (shots) await page.screenshot({ path: `${shots}/testlab-1280.png` });

    // Made 35 high in Design.
    await toDesign(page);
    await pinProperties(page);
    await page.fill("#height", "35");
    await page.press("#height", "Enter");
    await until(page, () => document.querySelector("#volume")?.textContent === "42,000 mm³", null, "the box 35 high"); // 40 × 30 × 35
    await toTestLab(page);
    await until(page, () => document.querySelector(".testlab-page-state")?.dataset.stale === "true", null, "out of date");
    const notes = await page.locator(".change-note .note-text").allTextContents();
    assert.ok(notes.some((n) => n === "Study 1 out of date: you changed the box in DesignLab. Rerun it in TestLab."), notes.join(" | "));
    await until(page, () => (document.querySelector(".testlab-page-status")?.textContent ?? "x") === "", null, "both faces found again");
    // The top's paint at z = 35 (where it is now), and the plain body colour at z = 20 on the front, held, so painted too.
    const atTop = await pixel(page, [20, 15, 35]);
    const plainSide = await pixel(page, [40, 15, 17]); // the right side, neither held nor pushed
    assert.notDeepEqual(atTop, plainSide, `the top (${atTop}) is painted, unlike the right side (${plainSide})`);
    if (shots) await page.screenshot({ path: `${shots}/testlab-taller-1280.png` });

    // A sphere: both faces lost, said; Undo: found again.
    await toDesign(page);
    await chooseShape(page, "sphere");
    await until(page, () => !["", "—", "42,000 mm³"].includes(document.querySelector("#volume")?.textContent ?? ""), null, "the sphere built");
    await toTestLab(page);
    await saying(page, /Held here lost its face Front face: the last edit took it off the body\./, "the hold's face lost");
    assert.match(await status(page), /Load 1 lost its face Top face: the last edit took it off the body\./);
    if (shots) await page.screenshot({ path: `${shots}/testlab-lost-1280.png` });
    await page.click("#undo");
    await until(page, () => (document.querySelector(".testlab-page-status")?.textContent ?? "x") === "", null, "found again after Undo");
    await context.close();
  });

  await check("375 px with taps: picking puts the sheet away, the faces are tapped, nothing runs off the side", async () => {
    const { context, page, tap } = await newPage("?testlab&test-hooks", 375);
    await startWithBox(page, true);
    await toTestLab(page);
    await setUpStudy(page, tap);
    await page.tap("[data-testlab=run]");
    await saying(page, /^Set up and checked/, "Run's words");
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 375, `the page is ${wide} px wide`);
    if (shots) await page.screenshot({ path: `${shots}/testlab-375.png` });
    await context.close();
  });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
if (failed > 0) process.exit(1);
