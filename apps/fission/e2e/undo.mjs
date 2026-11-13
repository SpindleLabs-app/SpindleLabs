// Browser check of Undo and Redo (step 20b): the top bar's buttons say what
// they would take back and are off at the ends; Ctrl+Z undoes, Ctrl+Shift+Z
// and Ctrl+Y redo; typing in one box is one step; in a size box Ctrl+Z is the
// project's Undo, in any other text field the browser's own undo of that
// field's typing, which never reaches a size box; undo survives a workspace
// switch; a default Design fills in when first shown is never a step.
// Step 20c: the selection follows undo (dropped with the note when the face
// is gone), undo never re-frames the camera (an opened file still does), and
// at phone width the pair sits in the viewport's corner.
// Every volume is worked out by hand from V = width · depth · height with
// the default depth 30 and height 20.
// Real-use hunt C1, C2 (2026-10-28): two quick Undos or Redos free every body the put-away Design built, and the
// rebuilding flag holds until the last rebuild lands.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browserName, launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { chooseShape, closePanels, openPanel, sheetsClearFor, startWithBox, switchTo, pickPlane } from "./start.mjs";
import { TOP, screenPoint } from "./sketch-screen.mjs";
const shots = process.env.E2E_SHOTS;

const server = await preview({ preview: { port: 4180, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4180/";
const browser = await launch();
const errors = [];

async function fresh(hash = "#design", { box = true, hooks = false, width = 1280, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: touch ? 667 : 800 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + (hooks ? "?test-hooks" : "") + hash); // hooks: window.fissionTest, the kernel's body count
  if (hash === "#design" && box) await startWithBox(page, touch); // a new project starts empty (U0c): the 40 · 30 · 20 box, inserted
  await pinProperties(page); // the size boxes are in the panel, folded at the start on a wide screen (U0b)
  return page;
}
/** Waits until the readout shows `text`, and says what it showed if it never does. */
async function volume(page, text) {
  try {
    await page.waitForFunction((t) => document.querySelector("#volume")?.textContent === t, text, { timeout: 5000 });
  } catch {
    assert.fail(`volume: expected ${text}, saw ${await page.textContent("#volume")}`);
  }
}
/** Each button's state: [disabled, title]. */
const buttons = (page) => page.evaluate(() => ["undo", "redo"].map((id) => [document.getElementById(id).disabled, document.getElementById(id).title]));
const width = (page) => page.inputValue("#width");
/** Types into the width box key by key, as a person does (one input event per key). */
async function typeWidth(page, text) {
  await page.click("#width");
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
}
const selection = (page) => page.evaluate(() => document.body.dataset.selection ?? "");
/** Waits until the viewport shows this shape, built. */
const shape = (page, kind) => page.waitForFunction((k) => document.querySelector("#viewport").dataset.shape === k, kind, { timeout: 5000 });
/** Clicks the middle of the viewport's canvas, where the part is. */
async function clickCentre(page) {
  const box = await page.locator("#viewport canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
/** Takes focus out of any field, so keys go to the app. */
const blur = (page) => page.evaluate(() => document.activeElement?.blur());

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

try {
  await check("buttons: off at the start, then Undo Change width puts back the old volume and size box, Redo brings it again", async () => {
    const page = await fresh("#design", { box: false });
    try {
      // Design filled in its empty design while it was first shown: not a step.
      await page.waitForSelector("#start-hint", { state: "visible" });
      assert.deepEqual(await buttons(page), [[true, "Nothing to undo"], [true, "Nothing to redo"]]);
      await startWithBox(page);
      assert.deepEqual(await buttons(page), [[false, "Undo Insert Box (Ctrl+Z)"], [true, "Nothing to redo"]]);
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³"); // 50 · 30 · 20
      assert.deepEqual(await buttons(page), [[false, "Undo Change width (Ctrl+Z)"], [true, "Nothing to redo"]]);
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      assert.equal(await width(page), "40");
      assert.deepEqual(await buttons(page), [[false, "Undo Insert Box (Ctrl+Z)"], [false, "Redo Change width (Ctrl+Shift+Z)"]]);
      await page.screenshot({ path: "e2e/undo.png", clip: { x: 0, y: 0, width: 1280, height: 120 } });
      await page.click("#redo");
      await volume(page, "30,000 mm³");
      assert.equal(await width(page), "50");
      assert.deepEqual(await buttons(page), [[false, "Undo Change width (Ctrl+Z)"], [true, "Nothing to redo"]]);
      // Clicking an off button does nothing.
      await page.click("#redo", { force: true });
      await volume(page, "30,000 mm³");
    } finally {
      await page.close();
    }
  });

  await check("typing 6 then 0 in one box is one step; a shape is a step of its own; the walk ends at the start", async () => {
    const page = await fresh();
    try {
      await typeWidth(page, "60"); // the box shows 6, then 60: two input events, well under a second apart
      await volume(page, "36,000 mm³"); // 60 · 30 · 20
      await chooseShape(page, "cylinder");
      assert.deepEqual((await buttons(page))[0], [false, "Undo Change shape to Cylinder (Ctrl+Z)"]);
      await page.click("#undo"); // back to the box, 60 wide
      await volume(page, "36,000 mm³");
      await page.click("#undo"); // the whole typed 60 at once, back to 40
      await volume(page, "24,000 mm³");
      assert.equal(await width(page), "40");
      assert.deepEqual(await buttons(page), [[false, "Undo Insert Box (Ctrl+Z)"], [false, "Redo Change width (Ctrl+Shift+Z)"]]);
      await page.click("#undo"); // the insert: empty again, as the project started
      await page.waitForSelector("#start-hint", { state: "visible" });
      assert.equal(await page.textContent("#volume"), "—");
      assert.deepEqual(await buttons(page), [[true, "Nothing to undo"], [false, "Redo Insert Box (Ctrl+Shift+Z)"]]);
    } finally {
      await page.close();
    }
  });

  await check("keys: Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo (Cmd on a Mac is the same chord)", async () => {
    const page = await fresh();
    try {
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      await page.fill("#width", "10"); // the same box within a second: the same step, 40 → 10
      await volume(page, "6,000 mm³"); // 10 · 30 · 20
      await blur(page);
      await page.keyboard.press("Control+z");
      await volume(page, "24,000 mm³"); // back to 40 in one step
      await page.keyboard.press("Control+Shift+Z");
      await volume(page, "6,000 mm³");
      await page.keyboard.press("Control+z");
      await volume(page, "24,000 mm³");
      await page.keyboard.press("Control+y");
      await volume(page, "6,000 mm³");
      await page.keyboard.press("Meta+z");
      await volume(page, "24,000 mm³");
    } finally {
      await page.close();
    }
  });

  // Undo hunt 2026-11-12 (#623): Ctrl+Z was left to the browser in every field, and the browser's undo of typing is
  // one for the whole page: it untyped the last size typed, in whichever box, as a NEW step (Width 60 became 6).
  // A size box's typing is the project's own step, so there Ctrl+Z is the project's Undo.
  const state = async (page) => `${await page.textContent("#volume")}; ${(await buttons(page)).map((b) => b[1].replace(/ \(.*/, "")).join("; ")}`;
  /** The 40 · 30 · 20 box made 60 wide, typed key by key and entered: 60 · 30 · 20 = 36,000 mm³, one step. */
  async function sixtyWide() {
    const page = await fresh();
    await typeWidth(page, "60");
    await page.keyboard.press("Enter");
    await volume(page, "36,000 mm³");
    return page;
  }
  await check("Ctrl+Z in a size box is the project's Undo of the size typed, never a new size", async () => {
    for (const from of ["#width", "#height"]) {
      const page = await sixtyWide();
      try {
        await page.click(from);
        await page.keyboard.press("Control+z");
        await volume(page, "24,000 mm³"); // 40 · 30 · 20: the width typed is taken back
        assert.equal(await state(page), "24,000 mm³; Undo Insert Box; Redo Change width", `Ctrl+Z with the keys in ${from}`);
        assert.equal(await width(page), "40");
      } finally {
        await page.close();
      }
    }
  });
  await check("Ctrl+Z with the keys on the Shape list takes back the shape chosen", async () => {
    const page = await sixtyWide();
    try {
      await page.selectOption("#shape", "cylinder");
      await shape(page, "cylinder");
      await page.focus("#shape");
      await page.keyboard.press("Control+z");
      await shape(page, "box");
      assert.equal(await state(page), "36,000 mm³; Undo Change width; Redo Change shape to Cylinder");
    } finally {
      await page.close();
    }
  });
  await check("Ctrl+Z in another text field (the command search, a panel's box) undoes its own typing and never a size box's", async () => {
    const page = await sixtyWide();
    try {
      const before = await state(page);
      const view = await page.locator("#viewport canvas").boundingBox();
      await page.mouse.click(view.x + 40, view.y + view.height - 60); // empty space: the keys leave the box
      await page.keyboard.press("s");
      await page.waitForSelector("#command-search-input", { state: "visible" });
      await page.keyboard.type("ex", { delay: 30 });
      for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
      await page.waitForTimeout(600);
      assert.equal(await state(page), before, "the design is as it was");
      assert.equal(await width(page), "60");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "command-search-input", "the keys stay in the search box");
      if (browserName === "chromium") assert.equal(await page.inputValue("#command-search-input"), "", "the browser's own undo took the search's typing back");
    } finally {
      await page.close();
    }
  });
  await check("Ctrl+Z after a line placed by typed sizes takes the line back (the keys are in its empty Length box)", async () => {
    const page = await fresh();
    try {
      sheetsClearFor(page);
      await page.click("#create-sketch");
      await openPanel(page, "properties", false);
      await pickPlane(page, "XY", false);
      await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
      await closePanels(page, false);
      const lines = (n) => page.waitForFunction((w) => document.querySelector("#viewport").dataset.sketchLines === String(w), n, { timeout: 5000 });
      const view = await page.locator("#viewport canvas").boundingBox();
      const at = (xy) => screenPoint(view, [...xy, 0], TOP);
      await page.keyboard.press("l");
      await page.mouse.click(at([0, 0]).x, at([0, 0]).y);
      await page.mouse.move(at([20, 0]).x, at([20, 0]).y);
      await page.waitForTimeout(300);
      await page.keyboard.type("10");
      await page.keyboard.press("Tab");
      await page.keyboard.type("0");
      await page.keyboard.press("Enter");
      await lines(1);
      assert.match(await page.getAttribute("#undo", "title"), /^Undo Draw line/);
      assert.match(await page.evaluate(() => document.activeElement?.id ?? ""), /^typed-/, "the keys stay in the typed boxes for the next line");
      await page.keyboard.press("Control+z");
      await lines(0);
      assert.match(await page.getAttribute("#redo", "title"), /^Redo Draw line/);
      // Half a number typed for the next line is the box's own to untype: the project keeps its steps.
      await page.keyboard.press("Control+Shift+z");
      await lines(1);
    } finally {
      await page.close();
    }
  });

  await check("undo survives a workspace switch, and works from another workspace", async () => {
    const page = await fresh();
    try {
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      await switchTo(page, "laser");
      await switchTo(page, "design");
      assert.deepEqual((await buttons(page))[0], [false, "Undo Change width (Ctrl+Z)"]);
      await switchTo(page, "laser");
      await blur(page);
      await page.keyboard.press("Control+z"); // undone while Laser is on screen
      await switchTo(page, "design");
      await volume(page, "24,000 mm³");
      assert.equal(await width(page), "40");
    } finally {
      await page.close();
    }
  });

  await check("starting in another workspace: Design's empty design, filled in when it is first shown, is no step", async () => {
    const page = await fresh("#laser");
    try {
      assert.deepEqual(await buttons(page), [[true, "Nothing to undo"], [true, "Nothing to redo"]]);
      await switchTo(page, "design");
      await page.waitForSelector("#start-hint", { state: "visible" });
      await volume(page, "—");
      assert.deepEqual(await buttons(page), [[true, "Nothing to undo"], [true, "Nothing to redo"]]);
    } finally {
      await page.close();
    }
  });

  await check("the selection follows undo and redo while the faces are the same ones", async () => {
    const page = await fresh();
    try {
      await clickCentre(page);
      const picked = await selection(page);
      assert.match(picked, /^(face|edge):feature-1\/[a-z+:-]+$/, "a face or edge of the box at the centre of the view, by name");
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      assert.equal(await selection(page), picked, "a new width keeps the box's faces (17e)");
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      // Undo re-mounts Design on the restored project: still a box with the same faces, so the face stays.
      assert.equal(await selection(page), picked, "kept through Undo");
      assert.equal(await page.isVisible("#selection-note"), false);
      await page.click("#redo");
      await volume(page, "30,000 mm³");
      assert.equal(await selection(page), picked, "kept through Redo");
      const kind = picked.slice(0, picked.indexOf(":"));
      assert.match(await page.$eval("#viewport", (el) => el.dataset.highlight), new RegExp(`${kind}s \\d`), "and drawn");
    } finally {
      await page.close();
    }
  });

  await check("undo to a different shape keeps a face of the same name and drops one that is gone, with the note", async () => {
    const page = await fresh();
    try {
      await chooseShape(page, "cylinder");
      await shape(page, "cylinder");
      await clickCentre(page);
      // The centre of the view is on the cylinder's top.
      assert.equal(await selection(page), "face:feature-1/top", "the cylinder's top");
      await page.click("#undo"); // back to the box: the same feature, which has a top too
      await shape(page, "box");
      await volume(page, "24,000 mm³");
      assert.equal(await selection(page), "face:feature-1/top", "the top is the box's top now");
      assert.equal(await page.isVisible("#selection-note"), false);
      await chooseShape(page, "sphere");
      await shape(page, "sphere");
      // A sphere has no top: dropped by the change of shape, with the note.
      assert.equal(await selection(page), "");
      assert.equal(await page.textContent("#selection-note"), "Taken out of the selection: Top face. The edit took them off the body, so they could not be followed.");
      await page.keyboard.press("Escape");
      await clickCentre(page);
      const half = await selection(page);
      assert.match(half, /^face:feature-1\/(upper|lower)$/, "one of the sphere's halves");
      await page.click("#undo"); // back to the box, which has no halves
      await shape(page, "box");
      await volume(page, "24,000 mm³");
      assert.equal(await selection(page), "", "the sphere's half is not one of the box's faces");
      const word = half.endsWith("upper") ? "Upper" : "Lower";
      assert.equal(await page.textContent("#selection-note"), `Taken out of the selection: ${word} face. The edit took them off the body, so they could not be followed.`);
    } finally {
      await page.close();
    }
  });

  await check("undo and redo keep the camera: no re-framing, the user's view stays, even for a shape", async () => {
    const page = await fresh();
    try {
      const fits = () => page.$eval("#viewport", (el) => Number(el.dataset.fits));
      await page.click('[data-view="top"]'); // the user's own view: straight down
      // 40 → 50 wide: the framed sphere r = √(40²+30²+20²)/2 = 26.9 mm; the new body's centre moves
      // 5 mm and its r = √(50²+30²+20²)/2 = 30.8 mm, 5 + 30.8 = 35.8 < 1.5 · 26.9 = 40.4, so it still fits: no refit.
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      const before = await fits();
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      await page.click("#redo");
      await volume(page, "30,000 mm³");
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      assert.equal(await fits(), before, "undo and redo framed nothing");
      // Still the top view: the centre of the view is the box's centre (20, 15) seen from above, on the +Z face (face 1).
      await clickCentre(page);
      assert.equal(await selection(page), "face:feature-1/top", "the view is still the top view");
      // Another shape, undone: the user's shape change is framed (a new part), its undo is not, as long as
      // the box still fits the framing (box and L-bracket sit in the same place; box ↔ cylinder re-frames
      // because the cylinder sits elsewhere, the needsRefit rule edits use).
      await chooseShape(page, "l-bracket");
      await shape(page, "l-bracket");
      const framed = await fits();
      assert.equal(framed, before + 1, "a new shape by the user is framed");
      await page.click('[data-view="top"]');
      await page.click("#undo");
      await shape(page, "box");
      await page.click("#redo");
      await shape(page, "l-bracket");
      await page.click("#undo");
      await shape(page, "box");
      assert.equal(await fits(), framed, "undoing and redoing the shape framed nothing");
    } finally {
      await page.close();
    }
  });

  await check("undo made in another workspace keeps Design's camera when you come back", async () => {
    const page = await fresh();
    try {
      const fits = () => page.$eval("#viewport", (el) => Number(el.dataset.fits));
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      const before = await fits();
      await switchTo(page, "laser");
      await page.click("#undo");
      await switchTo(page, "design");
      await volume(page, "24,000 mm³");
      assert.equal(await fits(), before);
    } finally {
      await page.close();
    }
  });

  await check("opening a project still frames its part", async () => {
    const page = await fresh();
    try {
      const fits = () => page.$eval("#viewport", (el) => Number(el.dataset.fits));
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
      const fs = await import("node:fs");
      const file = { name: "part.fission.json", mimeType: "application/json", buffer: fs.readFileSync(await download.path()) };
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      const before = await fits();
      await page.setInputFiles("#open-file", file);
      await volume(page, "30,000 mm³");
      assert.equal(await fits(), before + 1, "an opened file is a new part: framed");
    } finally {
      await page.close();
    }
  });

  for (const w of [375, 320]) {
    await check(`phone width ${w} px: Undo and Redo sit in the viewport's corner, one tap, clear of the View buttons, no sideways scroll`, async () => {
      const page = await fresh();
      try {
        await page.setViewportSize({ width: w, height: 740 });
        await openPanel(page, "properties", false); // the sizes are in the Properties sheet, closed until its toggle (U5)
        await page.fill("#width", "50");
        await volume(page, "30,000 mm³");
        assert.equal(await page.isVisible("#undo"), true, "on screen without opening Menu");
        const rect = (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
        const port = await rect("#viewport");
        const views = await rect("#view-controls");
        for (const id of ["undo", "redo"]) {
          const b = await rect(`#${id}`);
          assert.ok(b.width >= 44 && b.height >= 44, `${id} is a 44 px tap target: ${JSON.stringify(b)}`);
          assert.ok(b.left >= port.left && b.right <= port.right && b.top >= port.top && b.bottom <= port.bottom, `${id} inside the viewport`);
          assert.ok(b.right <= w, `${id} inside the screen`);
          const overlaps = !(b.right <= views.left || b.left >= views.right || b.bottom <= views.top || b.top >= views.bottom);
          assert.equal(overlaps, false, `${id} clear of the View buttons ${JSON.stringify(views)}`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), w);
        await page.click("#menu-toggle");
        assert.equal(await page.$$eval("#topbar #undo", (els) => els.length), 0, "no longer on the bar or in Menu");
        await page.click("#menu-toggle");
        await page.screenshot({ path: `e2e/undo-${w}.png` });
        await closePanels(page, false); // the Properties sheet (U5) covers the lower part of the view; closed with its toggle, as a person would
        await page.click("#undo"); // one tap
        await volume(page, "24,000 mm³");
        // Back to a wide screen: the pair returns to the bar after Save, as Fusion's (U0f2a).
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForFunction(() => document.getElementById("undo-redo").parentElement.id === "file-bar"); // on the media query's change event
        assert.equal(await page.$eval("#undo-redo", (el) => el.previousElementSibling?.id), "save");
        assert.equal(await page.$eval("#undo-redo", (el) => el.classList.contains("docked")), false);
      } finally {
        await page.close();
      }
    });
  }

  await check("Undo pressed at once after a sketch click drops the click, with no page error (app sweep 2026-10-28)", async () => {
    // A new sketch on XY, a click, and Ctrl+Z before the kernel has rounded the click: the undo takes the sketch out,
    // and the click, still waiting, was for that sketch. On main it went on and threw "there is no sketch sketch-2".
    // The click's rounding (snap_to_grid, place_freely) is held back 400 ms on its way to the kernel's worker, in every
    // engine, so the key always comes first (the sweep's repro slowed Chromium's CPU instead: it threw 5 runs in 5).
    const page = await fresh();
    const before = errors.length;
    try {
      sheetsClearFor(page);
      await page.click("#create-sketch");
      await openPanel(page, "properties", false);
      await pickPlane(page, "XY", false);
      await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
      await closePanels(page, false);
      await page.evaluate(() => {
        const send = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message, ...rest) {
          if (message?.op === "snap_to_grid" || message?.op === "place_freely") {
            window.kernelHeld = (window.kernelHeld ?? 0) + 1;
            return void setTimeout(() => send.call(this, message, ...rest), 400);
          }
          return send.call(this, message, ...rest);
        };
      });
      const box = await page.locator("#viewport canvas").boundingBox();
      const p = screenPoint(box, [10, 10, 0], TOP);
      await page.mouse.click(p.x, p.y);
      await page.waitForFunction(() => (window.kernelHeld ?? 0) > 0); // the click sent to the kernel, its answer held back
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(1500); // the held answers have come back by now
      assert.deepEqual(errors.slice(before), [], "no page error");
      // Undo took the sketch out (Redo would bring it back); the click drew nothing.
      assert.match(await page.getAttribute("#redo", "title"), /^Redo Create sketch/);
    } finally {
      errors.length = before;
      await page.close();
    }
  });

  // Undo hunt 2026-11-12 (#622). The kernel's answers are held back on their way to its worker, so the key always
  // comes while the action just made is still being worked out, on any machine.
  const slowKernel = (page, ms) =>
    page.evaluate((wait) => {
      const send = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, ...rest) {
        if (message?.op === undefined) return send.call(this, message, ...rest);
        return void setTimeout(() => send.call(this, message, ...rest), wait);
      };
    }, ms);
  await check("Ctrl+Z straight after the click that draws a rectangle takes back that rectangle, not the one before", async () => {
    const page = await fresh();
    try {
      sheetsClearFor(page);
      await page.click("#create-sketch");
      await openPanel(page, "properties", false);
      await pickPlane(page, "XY", false);
      await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
      await closePanels(page, false);
      const lines = (n) => page.waitForFunction((w) => document.querySelector("#viewport").dataset.sketchLines === String(w), n, { timeout: 8000 });
      const view = await page.locator("#viewport canvas").boundingBox();
      const click = (xy) => page.mouse.click(screenPoint(view, [...xy, 0], TOP).x, screenPoint(view, [...xy, 0], TOP).y);
      await page.keyboard.press("r");
      await click([0, 0]);
      await click([10, 10]);
      await lines(4); // rectangle A
      await click([20, 0]);
      await page.waitForTimeout(500);
      await slowKernel(page, 150);
      await click([30, 10]); // rectangle B, still with the kernel when the key comes
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(2500);
      // A's four sides stay; B was drawn and taken back, so Redo offers it.
      assert.equal(await page.$eval("#viewport", (v) => v.dataset.sketchLines), "4");
      assert.match(await page.getAttribute("#undo", "title"), /^Undo Draw rectangle/);
      assert.match(await page.getAttribute("#redo", "title"), /^Redo Draw rectangle/);
      await page.keyboard.press("Control+Shift+z");
      await lines(8);
    } finally {
      await page.close();
    }
  });
  await check("Ctrl+Z straight after a Delete that asks first leaves the step before alone, and the question open", async () => {
    // Box 1, Sketch 1 and Extrude 1 of it: deleting Sketch 1 asks, since Extrude 1 is built from it.
    const page = await fresh("#design", { box: false });
    try {
      await page.setInputFiles("#open-file", { name: "ask.spindle", mimeType: "application/json", buffer: readFileSync(new URL("./regressions/undo-delete-ask.spindle", import.meta.url)) });
      await page.waitForFunction(() => document.querySelectorAll("#timeline li[data-item]").length === 3, null, { timeout: 30000 });
      await page.waitForTimeout(1000);
      const bar = () => page.$$eval("#timeline .timeline-bar-item", (ls) => ls.map((li) => li.title.split("\n")[0] + (li.dataset.suppressed ? " (suppressed)" : "")));
      await page.locator("#timeline .timeline-bar-item").nth(0).click({ button: "right" });
      await page.click("#row-menu-suppress"); // the step before
      await page.waitForFunction(() => document.getElementById("undo").title.startsWith("Undo Suppress Box 1"));
      await page.waitForTimeout(1000);
      await page.locator("#timeline .timeline-bar-item").nth(1).focus();
      await slowKernel(page, 100);
      await page.keyboard.press("Delete");
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(2500);
      assert.deepEqual(await bar(), ["1. Box 1 (suppressed)", "2. Sketch 1", "3. Extrude 1"], "nothing was deleted and the Suppress stays");
      assert.match(await page.getAttribute("#undo", "title"), /^Undo Suppress Box 1/);
      assert.equal(await page.$eval("#delete-ask", (d) => d.open), true, "the question is still there to answer");
    } finally {
      await page.close();
    }
  });

  await check("Undo pressed while an OK is still with the kernel takes back that OK, not the step before (clumsy hunt 2026-11-04)", async () => {
    // Move: Box 1 and Cylinder 1, Move Body 1 by X 10, OK, and Ctrl+Z while the kernel still checks the Move. On main the
    // Undo ran first: it took back Insert Cylinder, and the OK, finding the design changed, recorded nothing, so the Move
    // was lost and Redo offered the cylinder. Extrude: a 40 × 30 rectangle extruded 10, the same, losing the extrude and
    // taking back the rectangle. Every kernel message after OK is held back 300 ms so the key always comes first.
    const hold = (page) =>
      page.evaluate(() => {
        const send = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message, ...rest) {
          window.kernelHeld = (window.kernelHeld ?? 0) + 1;
          setTimeout(() => send.call(this, message, ...rest), 300);
        };
      });
    const settled = (page) => page.waitForFunction(() => document.querySelector("#viewport").dataset.rebuilding === "false" && document.getElementById("redo").title !== "Nothing to redo", null, { timeout: 15000 });
    const before = errors.length;
    const page = await fresh();
    try {
      await page.click("#insert");
      await page.click("#insert-cylinder");
      await page.waitForFunction(() => /^Undo Insert Cylinder/.test(document.getElementById("undo").title));
      await page.click("#move");
      await page.click('#browser .tree-row[data-node="body-1"]');
      await page.waitForFunction(() => !!document.getElementById("viewport").dataset.moveHandles);
      await page.fill("#move-x", "10");
      await hold(page);
      await page.click("#move-ok");
      await page.waitForFunction(() => (window.kernelHeld ?? 0) > 0); // the Move sent to the kernel, its answer held back
      await page.keyboard.press("Control+z");
      await settled(page);
      assert.match(await page.getAttribute("#redo", "title"), /^Redo Move bodies/, "the Move is what Undo took back");
      assert.match(await page.getAttribute("#undo", "title"), /^Undo Insert Cylinder/, "the cylinder is still there");
    } finally {
      await page.close();
    }
    const sketching = await fresh("#design", { box: false });
    try {
      sheetsClearFor(sketching);
      await sketching.click("#create-sketch");
      await openPanel(sketching, "properties", false);
      await pickPlane(sketching, "XY", false);
      await sketching.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
      await closePanels(sketching, false);
      await sketching.click("#sketch-tool-rectangle");
      const box = await sketching.locator("#viewport canvas").boundingBox();
      for (const xy of [[0, 0], [40, 30]]) {
        const p = screenPoint(box, [...xy, 0], TOP);
        await sketching.mouse.click(p.x, p.y);
        await sketching.waitForTimeout(150);
      }
      await sketching.waitForFunction(() => /closed/.test(document.querySelector("#sketch-status")?.textContent ?? ""));
      await sketching.click("#sketch-extrude");
      await sketching.fill("#extrude-distance", "10");
      await sketching.waitForFunction(() => document.querySelector("#extrude-ok")?.disabled === false && (document.getElementById("extrude-panel")?.dataset.previewVolume ?? "") !== "");
      await hold(sketching);
      await sketching.click("#extrude-ok");
      await sketching.waitForFunction(() => (window.kernelHeld ?? 0) > 0);
      await sketching.keyboard.press("Control+z");
      await settled(sketching);
      assert.match(await sketching.getAttribute("#redo", "title"), /^Redo Extrude/, "the extrude is what Undo took back");
      assert.match(await sketching.getAttribute("#undo", "title"), /^Undo Draw rectangle/, "the rectangle is still there");
    } finally {
      await sketching.close();
    }
    assert.deepEqual(errors.slice(before), [], "no page error");
  });

  for (const [width, touch] of [[1280, false], [375, true]]) {
    await check(`${width} px${touch ? ", taps" : ""}: Undo pressed while an OK is still with the kernel shows it is waiting, then takes back the OK (clumsy hunt 2026-11-04)`, async () => {
      // Pressed while a Move's OK was still being worked out, Undo waited for it (as it should) but looked as if nothing
      // had happened, so a person pressed again. Now it says it is busy (aria-busy, lit and pulsing, its title saying
      // why) until the OK is in and taken back. Every kernel message after OK is held back 1.5 s.
      const before = errors.length;
      const page = await fresh("#design", { width, touch });
      const press = (sel) => (touch ? page.tap(sel) : page.click(sel));
      try {
        await press("#move");
        if (touch) await openPanel(page, "browser", true);
        await press('#browser .tree-row[data-node="body-1"]');
        await page.waitForFunction(() => !!document.getElementById("viewport").dataset.moveHandles);
        if (touch) await openPanel(page, "properties", true);
        await page.fill("#move-x", "10");
        await page.evaluate(() => {
          const send = Worker.prototype.postMessage;
          Worker.prototype.postMessage = function (message, ...rest) {
            window.kernelHeld = (window.kernelHeld ?? 0) + 1;
            setTimeout(() => send.call(this, message, ...rest), 1500);
          };
        });
        await press("#move-ok");
        await page.waitForFunction(() => (window.kernelHeld ?? 0) > 0); // the Move sent to the kernel, its answer held back
        assert.equal(await page.getAttribute("#undo", "aria-busy"), null, "not busy before it is pressed");
        if (touch) await closePanels(page, true); // the sheet opened by hand stays after OK, over the docked Undo
        await press("#undo");
        await page.waitForFunction(() => document.getElementById("undo").getAttribute("aria-busy") === "true", null, { timeout: 1000 });
        assert.match(await page.getAttribute("#undo", "title"), /^Undo waits for the change still being worked out/);
        const look = await page.$eval("#undo", (b) => ({ border: getComputedStyle(b).borderTopColor, animation: getComputedStyle(b).animationName, box: b.getBoundingClientRect().toJSON() }));
        assert.notEqual(look.animation, "none", "it pulses while it waits");
        assert.ok(look.box.width > 0 && look.box.right <= width + 0.5, `on screen: ${JSON.stringify(look.box)}`);
        if (shots) await page.screenshot({ path: `${shots}/undo-waiting-${width}.png` });
        await page.waitForFunction(() => /^Redo Move bodies/.test(document.getElementById("redo").title), null, { timeout: 15000 });
        await page.waitForFunction(() => document.getElementById("undo").getAttribute("aria-busy") === null);
        assert.match(await page.getAttribute("#undo", "title"), /^Undo Insert Box/, "the Move taken back, its title back to the step before");
      } finally {
        await page.context().close();
      }
      assert.deepEqual(errors.slice(before), [], "no page error");
    });
  }

  await check("two quick Undos and two quick Redos say rebuilding until the last one lands (real-use hunt C2)", async () => {
    // Every Undo and Redo remounts Design while the put-away one's rebuild may still run. Before the fix that rebuild's end
    // set data-rebuilding false while the new Design's rebuild still ran, so a check read the page too early. Each kernel
    // message is held 150 ms, so a second press 60 ms after the first always lands while the first's rebuild runs.
    const page = await fresh("#design", { hooks: true });
    const before = errors.length;
    try {
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³"); // 50 · 30 · 20
      await page.fill("#depth", "40"); // another box, so another step (typing on in one box is one step)
      await volume(page, "40,000 mm³"); // 50 · 40 · 20
      await page.evaluate(() => {
        const send = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message, ...rest) {
          setTimeout(() => send.call(this, message, ...rest), 150);
        };
      });
      const twice = async (id) => {
        await page.click(id);
        await page.waitForTimeout(60);
        await page.click(id);
        await page.waitForFunction(() => document.querySelector("#viewport").dataset.rebuilding === "false", null, { timeout: 15000 });
        // Read the moment the flag says done: what is shown then must be the last press's design, and it must stay.
        const now = () => page.evaluate(async () => [document.querySelector("#volume")?.textContent, await window.fissionTest.bodyCount()]);
        const atFlag = await now();
        await page.waitForTimeout(1500);
        return [atFlag, await now()];
      };
      for (let round = 1; round <= 3; round++) {
        // Undo, Undo: back to the 40 · 30 · 20 box, 24,000 mm³, one body in the kernel (nothing kept from the put-away rebuilds).
        assert.deepEqual(await twice("#undo"), [["24,000 mm³", 1], ["24,000 mm³", 1]], `round ${round}: two quick Undos, [volume, kernel bodies] at the flag and 1.5 s later`);
        // Redo, Redo: the 50 · 40 · 20 box again, 40,000 mm³, one body.
        assert.deepEqual(await twice("#redo"), [["40,000 mm³", 1], ["40,000 mm³", 1]], `round ${round}: two quick Redos, [volume, kernel bodies] at the flag and 1.5 s later`);
      }
      assert.deepEqual(errors.slice(before), [], "no page error");
    } finally {
      errors.length = before;
      await page.close();
    }
  });

  await check("two quick Undos of a 30-item project leave the kernel holding what it held before the edits (real-use hunt C1)", async () => {
    // Every Undo remounts Design and closes the old cache while its rebuild runs; before the fix that rebuild's own keepOnly
    // at its end kept its bodies for good, about 13 more each time on this project. Each kernel message is held 20 ms, so the
    // rebuild of its 16 bodies is still running when the second Undo comes 150 ms after the first.
    const page = await fresh("#design", { box: false, hooks: true });
    const before = errors.length;
    try {
      await page.waitForSelector("#start-hint", { state: "visible" });
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.evaluate(() => document.getElementById("open-file").click())]);
      await chooser.setFiles({ name: "thirty.spindle", mimeType: "application/json", buffer: readFileSync(new URL("../../../tests/golden/thirty-features.panosolid.json", import.meta.url)) });
      /** [Bodies rows, kernel bodies] once the page has stopped changing. */
      const quiet = async () => {
        let last = "";
        for (;;) {
          await page.waitForTimeout(300);
          const now = await page.evaluate(async () => JSON.stringify([document.querySelector("#viewport").dataset.rebuilding, document.querySelectorAll('#browser [data-node^="body-"]').length, await window.fissionTest.bodyCount()]));
          if (now === last && !now.startsWith('["true"')) return JSON.parse(now).slice(1);
          last = now;
        }
      };
      const opened = await quiet();
      assert.ok(opened[1] > 5, `the project built its bodies (${opened})`);
      await page.evaluate(() => {
        const send = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message, ...rest) {
          setTimeout(() => send.call(this, message, ...rest), 20);
        };
      });
      const edit = async (key, v) => {
        await page.click('#timeline li[data-item="feature-1"]', { button: "right" });
        await page.click("#row-menu-edit");
        await page.fill(`#edit-${key}`, String(v));
        await page.click("#feature-edit-ok");
        await quiet();
      };
      for (let round = 1; round <= 3; round++) {
        await edit("depth", 15 + round);
        await edit("height", 5 + round);
        await page.click("#undo");
        await page.waitForTimeout(150);
        await page.click("#undo");
        // Both edits taken back: the same rows and the same kernel bodies as when the project was opened.
        assert.deepEqual(await quiet(), opened, `round ${round}: [Bodies rows, kernel bodies] after two quick Undos, as opened`);
      }
      assert.deepEqual(errors.slice(before), [], "no page error");
    } finally {
      errors.length = before;
      await page.close();
    }
  });

  assert.deepEqual(errors, [], "no page errors or console errors");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) process.exit(1);
