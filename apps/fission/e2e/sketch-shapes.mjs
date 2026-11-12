// Browser check of the more sketch shapes (step 52c): the Create menu's new
// rows and groups; a centre-to-centre slot drawn by three clicks and
// extruded to 4000 + 1000π mm³ worked by hand; a circumscribed octagon typed
// 8 sides and 10 across the flats, extruded to 2000·tan 22.5° mm³; a centre
// rectangle typed 12 × 8 round its centre; a 3-point circle; a refused
// polygon keeping its typed boxes and its sides through Escape; a refusal said
// by the pointer; and at 375 px with taps a sketch point placed, picked with
// Select and deleted, with the whole Create menu on a 375 × 667 screen.
// Screenshots go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { TOP, clickPlane, screenPoint } from "./sketch-screen.mjs";
import { gridSnapOn, startWithBox, pickPlane } from "./start.mjs";

const server = await preview({ preview: { port: 4197, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4197/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

async function fresh(width = 1280, touch = false, height = 800) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await startWithBox(page, touch);
  return page;
}

const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const until = (page, fn, arg, what) =>
  page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => {
    const shown = await page.evaluate(() => `status "${document.querySelector("#sketch-status")?.textContent}", note "${document.querySelector("#sketch-grid-error")?.textContent}", points "${document.querySelector("#viewport").dataset.sketchPoints}"`);
    assert.fail(`${what}: timed out; the page shows ${shown}`);
  });
const points = async (page, want) => until(page, (w) => document.querySelector("#viewport").dataset.sketchPoints === w, want, `points ${want}`);
const status = (page, re, what) => until(page, (r) => new RegExp(r).test(document.querySelector("#sketch-status")?.textContent ?? ""), re.source, what);
const rect = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
async function hover(page, [x, y]) {
  const box = await page.locator("#viewport canvas").boundingBox();
  const p = screenPoint(box, [x, y, 0], TOP);
  await page.mouse.move(p.x, p.y);
}

async function startSketch(page, tap = false) {
  await (tap ? page.tap("#create-sketch") : page.click("#create-sketch"));
  await pickPlane(page, "XY", tap);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
  await gridSnapOn(page);
  await page.evaluate(() => (document.getElementById("workspace").scrollTop = 0));
}

/** Chooses a tool from the Create menu, through its group's row when it has one. */
async function choose(page, kind, group = null, tap = false) {
  const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
  await press("#sketch-create");
  if (group) {
    if (tap) await page.tap(`#sketch-menu-group-${group}`);
    else await page.hover(`#sketch-menu-group-${group}`);
    await until(page, (g) => !document.getElementById(`sketch-${g}-menu`).hidden, group, `the ${group} menu open`);
  }
  await press(`#sketch-menu-${kind}`);
  await until(page, () => document.getElementById("sketch-create-menu").hidden, null, "the menu closed");
}

async function extrudeVolume(page, distance, want, what) {
  await page.click("#sketch-extrude");
  await until(page, () => document.querySelector("#extrude-ok")?.disabled === false, null, "Extrude's OK on");
  await page.fill("#extrude-distance", String(distance));
  await page.click("#extrude-ok");
  await until(page, (w) => Math.abs(parseFloat(document.querySelector("#volume").textContent.replace(/,/g, "")) - w) < 1e-3, want, what);
}

let failed = false;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

await check("the Create menu: the new rectangles and circle beside their kin, Polygon and Slot groups, and Point", async () => {
  const page = await fresh();
  try {
    await startSketch(page);
    await page.click("#sketch-create");
    const rows = await page.$$eval("#sketch-create-menu > button", (els) => els.map((e) => e.textContent));
    assert.deepEqual(rows, ["LineL", "RectangleR", "Centre rectangle", "3-point rectangle", "CircleC", "3-point circle", "Arc▸", "Polygon▸", "Slot▸", "Point", "ProjectP"]);
    await page.hover("#sketch-menu-group-polygon");
    await until(page, () => !document.getElementById("sketch-polygon-menu").hidden, null, "the polygons open on hover");
    assert.deepEqual(await page.$$eval("#sketch-polygon-menu [role=menuitemradio]", (els) => els.map((e) => e.textContent)), ["Inscribed polygon", "Circumscribed polygon"]);
    if (shots) await page.screenshot({ path: `${shots}/shapes-menu-1280.png` });
    // None of them took a button in the toolbar's row (it would no longer fit a phone).
    for (const id of ["centre-rectangle", "polygon", "slot", "point"]) assert.equal(await page.$(`#sketch-tool-${id}`), null, id);
  } finally {
    await page.context().close();
  }
});

await check("a centre to centre slot: three clicks, kept level, extruded to 4000 + 1000π mm³", async () => {
  const page = await fresh();
  try {
    await startSketch(page);
    await choose(page, "slot", "slot");
    assert.match(await page.textContent("#sketch-help"), /^Click the centre of one end/);
    await clickPlane(page, [10, 10]);
    await clickPlane(page, [30, 10]);
    await hover(page, [20, 20]);
    // The preview: two sides, two half circles of 32 segments and the centre line.
    await until(page, () => (document.querySelector("#viewport").dataset.sketchPreview ?? "").split(" | ").length === 67, null, "the whole slot previewed");
    if (shots) await page.screenshot({ path: `${shots}/slot-preview-1280.png` });
    await clickPlane(page, [20, 20]);
    // r = 10: a1 (10, 20), a2 (30, 20), b1 (10, 0), c1 (10, 10), b2 (30, 0), c2 (30, 10).
    await points(page, "10,20 30,20 10,0 10,10 30,0 30,10");
    await status(page, /^2 lines, 2 arcs and 1 construction curve, a closed outline/, "the slot closed");
    assert.equal(await page.evaluate(() => document.getElementById("undo").title), "Undo Draw slot (Ctrl+Z)");
    // Its area: the 20 × 20 middle and a whole circle of radius 10, 400 + 100π mm²; 10 high, 4000 + 1000π mm³.
    await extrudeVolume(page, 10, 4000 + 1000 * Math.PI, "4000 + 1000π mm³");
    if (shots) await page.screenshot({ path: `${shots}/slot-extruded-1280.png` });
  } finally {
    await page.context().close();
  }
});

await check("a circumscribed octagon typed 8 sides and 10 across the flats: 2000·tan 22.5° mm³ extruded 10", async () => {
  const page = await fresh();
  try {
    await startSketch(page);
    await choose(page, "outside-polygon", "polygon");
    await clickPlane(page, [20, 10]);
    await until(page, () => !!document.querySelector("#typed-sides"), null, "the sides, diameter and angle boxes");
    await hover(page, [30, 10]);
    // A digit starts the first box, Sides; Tab to Diameter.
    await page.keyboard.type("8");
    assert.equal(await page.evaluate(() => document.activeElement.id), "typed-sides");
    await page.keyboard.press("Tab");
    await page.keyboard.type("10");
    await page.keyboard.press("Tab");
    await page.keyboard.type("0");
    if (shots) await page.screenshot({ path: `${shots}/octagon-typed-1280.png` });
    await page.keyboard.press("Enter");
    await status(page, /^8 lines, a closed outline/, "eight sides, closed");
    // Its area with apothem a = 5: 8·a²·tan(180°/8) = 200·tan 22.5°; 10 high.
    await extrudeVolume(page, 10, 2000 * Math.tan(Math.PI / 8), "2000·tan 22.5° mm³");
  } finally {
    await page.context().close();
  }
});

await check("a polygon refused as drawn already keeps its typed boxes, and Escape keeps its sides (hunt 2026-11-12)", async () => {
  const page = await fresh();
  const typed = (f) => page.evaluate((id) => document.querySelector(`#typed-${id}`)?.value ?? null, f);
  const typeSizes = async () => {
    await page.keyboard.type("8");
    await page.keyboard.press("Tab");
    await page.keyboard.type("20");
    await page.keyboard.press("Tab");
    await page.keyboard.type("0");
  };
  try {
    await startSketch(page);
    await choose(page, "polygon", "polygon");
    await clickPlane(page, [20, 10]);
    await until(page, () => !!document.querySelector("#typed-sides"), null, "the sides, diameter and angle boxes");
    await hover(page, [30, 10]);
    await typeSizes();
    await page.keyboard.press("Enter");
    await status(page, /^8 lines, a closed outline/, "the octagon drawn");
    // The same centre and sizes again: the same octagon, refused, nothing placed; the boxes keep 8 and 20.
    await clickPlane(page, [20, 10]);
    await until(page, () => !!document.querySelector("#typed-sides"), null, "the boxes again");
    await hover(page, [30, 10]);
    await typeSizes();
    await page.keyboard.press("Enter");
    await until(page, () => /^This shape is there already/.test(document.querySelector("#sketch-grid-error").textContent), null, "the drawn-already note");
    assert.equal(await typed("sides"), "8", "Sides kept after the refusal");
    assert.equal(await typed("diameter"), "20", "Diameter kept after the refusal");
    await status(page, /^8 lines, a closed outline/, "still one octagon");
    // The refused click kept its centre. Escape empties and leaves the boxes, a second drops the centre; the next polygon
    // still has 8 sides (the panel: kept from one polygon to the next).
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await until(page, () => !document.querySelector("#typed-sides") || document.querySelector("#typed-sides").closest("[hidden]") !== null || document.querySelector("#typed-sides").offsetParent === null, null, "the centre dropped, the boxes gone");
    await clickPlane(page, [-20, 10]);
    await until(page, () => !!document.querySelector("#typed-sides"), null, "the boxes for the next polygon");
    await hover(page, [-10, 10]);
    await until(page, () => document.querySelector("#typed-sides").placeholder === "8", null, "8 sides shown for the next polygon");
    await clickPlane(page, [-10, 10]);
    await status(page, /^16 lines/, "a second octagon");
  } finally {
    await page.context().close();
  }
});

await check("a centre rectangle typed 12 × 8, a 3-point circle, and a refusal said by the pointer", async () => {
  const page = await fresh();
  try {
    await startSketch(page);
    await choose(page, "centre-rectangle");
    await clickPlane(page, [20, 10]);
    await hover(page, [25, 15]);
    await page.keyboard.type("12");
    await page.keyboard.press("Tab");
    await page.keyboard.type("8");
    await page.keyboard.press("Enter");
    // Corners 6 and 4 from the centre on the pointer's side: (26, 14), (14, 14), (14, 6), (26, 6).
    await points(page, "26,14 14,14 14,6 26,6");
    await status(page, /^4 lines and 2 construction curves, a closed outline/, "the rectangle with its diagonals");
    if (shots) await page.screenshot({ path: `${shots}/centre-rectangle-1280.png` });
    // A corner on the centre's row: refused in words.
    await clickPlane(page, [0, 20]);
    await clickPlane(page, [10, 20]);
    await until(page, () => /^A rectangle needs a width and a height/.test(document.querySelector("#sketch-grid-error").textContent), null, "the flat note");
    await page.keyboard.press("Escape");
    await choose(page, "three-circle");
    for (const p of [[0, 20], [20, 20], [10, 30]]) await clickPlane(page, p);
    // The right angle is at (10, 30): the circle's centre is the middle of (0, 20)–(20, 20), (10, 20).
    await status(page, /^4 lines, 1 circle and 2 construction curves/, "the circle drawn");
    assert.ok((await data(page, "sketchPoints")).endsWith("10,20"), "its centre point at (10, 20)");
  } finally {
    await page.context().close();
  }
});

await check("at 375 px with taps: the whole Create menu on a 375 × 667 screen, and a point placed, picked and deleted", async () => {
  const page = await fresh(375, true, 667);
  try {
    await startSketch(page, true);
    await page.tap("#sketch-create");
    const last = await rect(page, "#sketch-menu-project");
    assert.ok(last.bottom <= 667 && last.height >= 44, `the last row on screen and 44 px tall: ${JSON.stringify(last)}`);
    if (shots) await page.screenshot({ path: `${shots}/shapes-menu-375.png` });
    await page.tap("#sketch-menu-point");
    await clickPlane(page, [10, 10], TOP, true);
    await points(page, "10,10");
    await status(page, /^1 point/, "one point");
    // Select, then a tap on it picks it; Delete takes it out.
    await page.tap("#sketch-tool-select");
    await clickPlane(page, [10, 10], TOP, true);
    await until(page, () => document.getElementById("sketch-delete").disabled === false, null, "Delete on");
    if (shots) await page.screenshot({ path: `${shots}/point-picked-375.png` });
    await page.tap("#sketch-delete");
    await points(page, "");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no sideways page scroll");
  } finally {
    await page.context().close();
  }
});

assert.deepEqual(errors, [], "no page errors");
await browser.close();
await server.close();
if (failed) process.exit(1);
console.log("PASS sketch shapes");
