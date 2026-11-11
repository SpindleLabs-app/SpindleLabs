// Browser check of a circle's fit (FK2, fit-tag.ts; Ben's design of 2026-10-28: "a small + under the number"), in an
// empty design's XY sketch seen from above. The Circle tool: once its centre is down and a diameter typed, "+ Fit"
// stands under the Diameter box and takes the keys by Tab (a tap at phone width, once Type has put the keys in the
// boxes); "Clearance hole for a bolt" picked, Enter places the circle at the typed 3 mm, labelled "⌀ 3 · M3 bolt": the
// number stays the design's size, the tag only says what it is for. The pick stays for the next circle (the Circle
// tool keeps it), and "+ Fit" takes it off again. The Dimension tool: a circle picked for its diameter, a fit picked
// under the box tags it at once ("⌀ 20 · pin, slide"), then 24 typed sizes it ("⌀ 24 · pin, slide"); Ctrl+Z takes the
// size off, then the tag, each its own step. Saved and reloaded: the stored design holds both fits, version 16, and
// opens. At 1280 px with clicks and 375 px with taps, the list whole on screen. Screenshots go to E2E_SHOTS when set.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, openPanel, pickPlane, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4333, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4333/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function fresh(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: touch ? 740 : 800 }, hasTouch: touch });
  const page = await context.newPage();
  // Emptied once: the reload at the end must find what was stored.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("kept")) indexedDB.deleteDatabase("fission");
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await page.locator("#start-hint").waitFor();
  await pinProperties(page);
  return sheetsClearFor(page);
}

const data = (page, key) => page.evaluate((k) => document.querySelector("#viewport").dataset[k] ?? "", key);
const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 8000 }).catch(async () => assert.fail(`${what}: timed out`));
/** Waits for the sketch's labels to be `want` ("a | b"), in any order (a dimension's label is listed before a tag's own). */
const labels = (page, want, what) =>
  until(page, (w) => (document.querySelector("#viewport").dataset.sketchLabels ?? "").split(" | ").sort().join(" | ") === w.split(" | ").sort().join(" | "), want, what).catch(async (e) =>
    assert.fail(`${e.message} (shown: "${await data(page, "sketchLabels")}")`));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();
const focused = (page) => page.evaluate(() => document.activeElement?.id ?? "");

// The pinhole camera: forward = unit(target − position), right = unit(forward × up), up = right × forward; 45° field.
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
/** Clicks (or taps) sketch point (x, y) on XY; fails if something is over the canvas there. */
async function at(page, [x, y], tap) {
  const s = toScreen(await camera(page), await canvasBox(page), [x, y, 0]);
  await closePanels(page, tap);
  const on = await page.evaluate(([sx, sy]) => {
    const e = document.elementFromPoint(sx, sy);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${x}, ${y}] is under ${on} on screen, not the canvas`);
  if (tap) return page.touchscreen.tap(s.x, s.y);
  await page.mouse.click(s.x, s.y);
}
async function settle(page) {
  let last = null;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    const now = await camera(page);
    if (last && [...now.position, ...now.target].every((v, k) => Math.abs(v - [...last.position, ...last.target][k]) < 1e-6)) return now;
    last = now;
  }
  throw new Error("the camera never settled");
}
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

/** An empty design's sketch on XY, looked at from above, snapping to a 0.5 mm grid so every aimed point lands exactly. */
async function sketchOnXY(page, tap) {
  await press(page, "#create-sketch", tap);
  await pickPlane(page, "XY", tap);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching on XY");
  await settle(page);
  await openPanel(page, "properties", tap);
  await page.fill("#sketch-grid", "0.5");
  await page.press("#sketch-grid", "Enter");
  await page.check("#sketch-grid-snap");
  await closePanels(page, tap);
  if (tap) await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
}

/** Puts the keys in the Diameter box: typing a digit does it with a keyboard; on a phone the boxes take no taps until Type. */
async function typeDiameter(page, value, tap) {
  if (tap) {
    await page.tap("#sketch-type");
    await until(page, () => document.activeElement?.id === "typed-diameter", null, "Type puts the keys in Diameter");
    await page.keyboard.type(value);
  } else {
    await page.keyboard.type(value);
    await until(page, () => document.activeElement?.id === "typed-diameter", null, "a digit puts the keys in Diameter");
  }
}

/** Picks fit `id` ("" for none) from the list under the Diameter box, reached as a person would: Tab with a keyboard, a tap on a phone. */
async function pickFit(page, id, tap, width) {
  const list = page.locator("#typed-fit");
  assert.equal(await list.isVisible(), true, "+ Fit shows under the Diameter box");
  const b = await list.boundingBox();
  assert.ok(b.x >= 0 && b.x + b.width <= width + 0.5, `the fit list on screen: ${JSON.stringify(b)}`);
  if (tap) assert.ok(b.height >= 32, `the fit list is ${b.height} px tall on a phone`);
  // Nothing is over it where it would be pressed: the boxes take presses now the keys are in them.
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id ?? "", [b.x + b.width / 2, b.y + b.height / 2]);
  assert.equal(hit, "typed-fit", "a press there lands on the fit list");
  if (tap) await list.tap();
  else await page.keyboard.press("Tab");
  assert.equal(await focused(page), "typed-fit", "the keys go to the fit list");
  await list.selectOption(id);
  // Picked, the keys go back to Diameter, so Enter places the circle.
  await until(page, () => document.activeElement?.id === "typed-diameter", null, "the keys back in Diameter after the pick");
}

/** The stored project's Design data, read from IndexedDB (database "fission", store "kv") as the app kept it. */
const stored = (page) =>
  page.evaluate(
    () =>
      new Promise((done, fail) => {
        const r = indexedDB.open("fission", 1);
        r.onsuccess = () => {
          const kv = r.result.transaction("kv").objectStore("kv");
          const got = kv.get(`project/${document.body.dataset.projectId}`);
          got.onsuccess = () => (r.result.close(), done(JSON.parse(got.result).workspaces.design));
          got.onerror = () => fail(got.error);
        };
        r.onerror = () => fail(r.error);
      }),
  );
/** Every circle's fit in Design data `design`, in sketch order (null for an untagged circle). */
const fitsIn = (design) =>
  design.sketches.flatMap((s) => s.curves.filter((c) => c.kind === "circle").map((c) => c.fit ?? null));

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
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

try {
  for (const [width, tap] of [[1280, false], [375, true]]) {
    await check(`${width} px${tap ? " with taps" : ""}: a circle tagged as an M3 bolt's hole keeps its 3 mm, the tag stays for the next, the Dimension tool tags one, undo, kept on reload`, async () => {
      const page = await fresh(width, tap);
      await sketchOnXY(page, tap);

      // The Circle tool: centre (0, 0), 3 typed, "Clearance hole for a bolt" picked, Enter.
      await press(page, "#sketch-tool-circle", tap);
      await at(page, [0, 0], tap);
      await until(page, () => [...document.querySelectorAll(".typed-entry-name")].map((x) => x.textContent).join() === "Diameter", null, "the Diameter box");
      await typeDiameter(page, "3", tap);
      assert.equal(await page.locator("#typed-fit option:checked").textContent(), "+ Fit", "nothing picked yet: + Fit");
      await shot(page, `fit-tag-plus-${width}`);
      await pickFit(page, "bolt-normal", tap, width);
      assert.equal(await page.locator("#typed-fit").evaluate((s) => s.classList.contains("fit-tag-on")), true, "the picked list is marked on");
      assert.equal(await page.inputValue("#typed-diameter"), "3", "the typed size is untouched by the pick");
      await shot(page, `fit-tag-picked-${width}`);
      await page.keyboard.press("Enter");
      await until(page, () => document.querySelector("#viewport").dataset.sketchLines === "64", null, "the circle drawn").catch(async (e) => assert.fail(`${e.message} (lines ${await data(page, "sketchLines")}, focus ${await focused(page)}, error "${await page.textContent("#sketch-grid-error").catch(() => "")}", undo "${await page.getAttribute("#undo", "title")}")`));
      // The design's size, 3, with what it is for: M3 bolt (3 mm is M3's nominal size).
      await labels(page, "⌀ 3 · M3 bolt", "the tagged circle's label");
      await shot(page, `fit-tag-drawn-${width}`);

      // The next circle, round (0, 30), well clear of the first one's label, starts with the same fit (the tool keeps it); "+ Fit" takes it off before it is placed.
      await at(page, [0, 30], tap);
      await until(page, () => document.querySelector("#typed-fit")?.value === "bolt-normal", null, "the Circle tool keeps the fit for the next");
      await typeDiameter(page, "20", tap);
      await pickFit(page, "", tap, width);
      await page.keyboard.press("Enter");
      await until(page, () => document.querySelector("#viewport").dataset.sketchLines === "128", null, "the second circle drawn");
      await labels(page, "⌀ 3 · M3 bolt", "the untagged circle has no label");

      // The Dimension tool: the second circle's rim (0, 40) picked, a fit picked under the box tags it at once, then 24.
      await press(page, "#sketch-tool-dimension", tap);
      await at(page, [0, 40], tap);
      if (tap) {
        await until(page, () => document.querySelector("#typed-entry")?.hidden === false, null, "the Diameter box for the circle").catch(async (e) => {
          await shot(page, `fit-tag-fail-${width}`);
          assert.fail(`${e.message} (focus ${await focused(page)}, dimension ${await page.getAttribute("#sketch-tool-dimension", "aria-pressed")}, error "${await page.textContent("#sketch-grid-error").catch(() => "")}")`);
        });
        await page.tap("#sketch-type").catch(() => {});
      }
      await until(page, () => document.activeElement?.id === "typed-diameter", null, "the circle picked: the keys in Diameter");
      await pickFit(page, "hole-slide-bought", tap, width);
      await labels(page, "⌀ 3 · M3 bolt | ⌀ 20 · pin, slide", "the picked circle tagged at once");
      await page.keyboard.type("24");
      await page.keyboard.press("Enter");
      await labels(page, "⌀ 3 · M3 bolt | ⌀ 24 · pin, slide", "the tagged circle sized 24");
      await shot(page, `fit-tag-dimension-${width}`);
      if (tap) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no sideways scrolling");

      if (!tap) {
        // Each its own step: Ctrl+Z takes off the 24, then the tag; Ctrl+Shift+Z puts the tag back.
        await page.keyboard.press("Control+z");
        await labels(page, "⌀ 3 · M3 bolt | ⌀ 20 · pin, slide", "undo takes the size off");
        await page.keyboard.press("Control+z");
        await labels(page, "⌀ 3 · M3 bolt", "undo takes the tag off");
        await page.keyboard.press("Control+Shift+z");
        await labels(page, "⌀ 3 · M3 bolt | ⌀ 20 · pin, slide", "redo puts the tag back");
      }

      // Stored and reloaded: both fits are in the design, version 16, and it opens again.
      await until(page, () => document.querySelector("#save-status")?.dataset.state === "saved", null, "saved");
      let design = await stored(page);
      assert.equal(design.version, 17);
      assert.deepEqual(fitsIn(design), [{ role: "hole", kind: "bolt-normal" }, { role: "hole", kind: "slide", partner: "bought" }]);
      await page.evaluate(() => sessionStorage.setItem("kept", "1"));
      await page.reload();
      await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 1, null, "the sketch back in the timeline after the reload");
      design = await stored(page);
      assert.deepEqual(fitsIn(design), [{ role: "hole", kind: "bolt-normal" }, { role: "hole", kind: "slide", partner: "bought" }], "kept on reload");
      await page.context().close();
    });
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
assert.deepEqual(errors, [], "no page errors");
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
