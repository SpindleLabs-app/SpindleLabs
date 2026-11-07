// Browser check of picking a sketch region to extrude (step 48c2), in an
// empty design's XY sketch seen from above: a 40 × 30 rectangle from (0, 0)
// and a circle of radius 5 round (20, 15) make two regions, the plate round
// the hole and the disc inside it. 1280 px with a mouse: Extrude shades
// both and asks which; a click at (5, 5) picks the plate, whose preview at
// 10 mm is (1200 − 25π) × 10 = 11214.60 mm³; a click in the hole picks the
// disc, 25π × 10 = 785.40 mm³; OK makes it. A circle drawn later inside
// the plate makes a second hole in its extrude. 375 px with taps: the same
// picks by tapping, and the panel never covers the regions. Screenshots go
// to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { closePanels, openPanel, pickPlane, sheetsClearFor } from "./start.mjs";

const server = await preview({ preview: { port: 4293, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4293/?test-hooks";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

async function fresh(width = 1280, touch = false, height = 800) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
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
const shown = (page, key, want) => until(page, ([k, w]) => document.querySelector("#viewport").dataset[k] === w, [key, want], `${key} "${want}"`).catch(async (e) => assert.fail(`${e.message} (shown: "${await data(page, key)}")`));
const camera = (page) => page.evaluate(() => window.fissionTest.camera());
const canvasBox = (page) => page.locator("#viewport canvas").boundingBox();

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
/** Millimetres per screen pixel on the plane the camera looks straight down at. */
async function mmPerPixel(page) {
  const cam = await camera(page);
  const d = sub(cam.position, cam.target);
  return (2 * Math.sqrt(dot(d, d)) * T) / (await canvasBox(page)).height;
}
/** Clicks (or taps) sketch point (x, y) on XY, with Shift held when `shift`; fails if something is over the canvas there. */
async function at(page, [x, y], { tap = false, shift = false } = {}) {
  const s = toScreen(await camera(page), await canvasBox(page), [x, y, 0]);
  await closePanels(page, tap);
  const on = await page.evaluate(([sx, sy]) => {
    const e = document.elementFromPoint(sx, sy);
    return e?.tagName === "CANVAS" && e.closest("#viewport") ? "canvas" : e ? e.id || e.className || e.tagName : "nothing";
  }, [s.x, s.y]);
  if (on !== "canvas") throw new Error(`[${x}, ${y}] is under ${on} on screen, not the canvas`);
  if (tap) return page.touchscreen.tap(s.x, s.y);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(s.x, s.y);
  if (shift) await page.keyboard.up("Shift");
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

/** An empty design's sketch on XY, looked at from above. */
async function sketchOnXY(page, tap) {
  await press(page, "#create-sketch", tap);
  await pickPlane(page, "XY", tap);
  await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching on XY");
  await settle(page);
  if (tap) await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
  await halfMillimetreGrid(page, tap);
}

/**
 * Grid snap on a 0.5 mm grid, so a click lands exactly on the point it aims at in every engine: WebKit and Firefox send
 * the pointer on whole pixels, which put the hole's edge 0.2 mm off without it (WebKit CI: the plate 11285.70 mm³, not
 * 11214.60). Every point these checks draw is on the 0.5 mm grid; the clicks that pick a region are not snapped.
 */
async function halfMillimetreGrid(page, tap) {
  await openPanel(page, "properties", tap);
  await page.fill("#sketch-grid", "0.5");
  await page.press("#sketch-grid", "Enter");
  await page.check("#sketch-grid-snap");
  await closePanels(page, tap);
  if (tap) await page.evaluate(() => (window.scrollTo(0, 0), (document.getElementById("workspace").scrollTop = 0)));
}


const points = (page) => data(page, "sketchPoints");

/** A line from `a` to `b`, the line tool's chain ended with Escape. */
async function line(page, a, b, tap) {
  const before = Number(await data(page, "sketchLines"));
  await press(page, "#sketch-tool-line", tap);
  await at(page, a, { tap });
  await at(page, b, { tap });
  await shown(page, "sketchLines", String(before + 1));
  if (!tap) await page.keyboard.press("Escape");
}

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
const panel = (page, key) => page.evaluate((k) => document.querySelector("#extrude-panel")?.dataset[k] ?? "", key);
const extrudeStatus = (page) => page.evaluate(() => document.querySelector("#extrude-status")?.textContent ?? "");
const statusSays = (page, re, what) => until(page, (r) => new RegExp(r).test(document.querySelector("#extrude-status")?.textContent ?? ""), re.source, what).catch(async (e) => assert.fail(`${e.message} (status: "${await extrudeStatus(page)}")`));
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
/** Waits for the preview's volume (as the kernel worked it out) to be `want` mm³, to a millionth. */
const previewIs = (page, want, what) =>
  until(page, ([w]) => Math.abs(Number(document.querySelector("#extrude-panel")?.dataset.previewVolume || "NaN") - w) <= 1e-6 * Math.max(1, w), [want], what).catch(async (e) => assert.fail(`${e.message} (preview: ${await panel(page, "previewVolume")})`));

/** The rectangle and the circle, drawn in the sketch on XY. */
async function plateAndHole(page, tap) {
  await press(page, "#sketch-tool-rectangle", tap);
  await at(page, [0, 0], { tap });
  await at(page, [40, 30], { tap });
  await shown(page, "sketchLines", "4");
  await press(page, "#sketch-tool-circle", tap);
  await at(page, [20, 15], { tap });
  await at(page, [25, 15], { tap });
  await until(page, () => /4 lines and 1 circle/.test(document.querySelector("#sketch-status")?.textContent ?? ""), null, "the circle drawn");
}

/** Extrude opened from the sketch panel on the sketch drawn, the distance typed as 10 mm. */
async function extrudeIt(page, tap) {
  await press(page, "#sketch-extrude", tap);
  await until(page, () => !document.querySelector("#extrude-panel")?.hidden, null, "the Extrude panel");
  await statusSays(page, /^Sketch 1 has 2 regions: click or tap the one to extrude\.$/, "asks which region");
  assert.equal(await page.isDisabled("#extrude-ok"), true, "OK waits for a region");
  const offered = (await data(page, "extrudeProfiles")).split(" ");
  const sketch = await panel(page, "chosen");
  assert.deepEqual(offered, [`${sketch}#0`, `${sketch}#1`], "both regions shaded");
  await page.fill("#extrude-distance", "10");
  return sketch;
}

/**
 * A file with a 10 mm box at the origin and Sketch 1 on XY off to its left: a 40 × 30 rectangle from (−60, 0) and a
 * circle of radius 14.9995 round (−40, 15), which comes 0.0005 mm from the rectangle's top and bottom without touching
 * them, under the 0.001 mm the kernel holds every feature to. Its two regions: the plate round the circle, which can't
 * be extruded (a gap too thin), and the disc, which can.
 */
const CLOSE = { r: 14.9995, centre: [-40, 15] };
const corners = [[-60, 0], [-20, 0], [-20, 30], [-60, 30]];
const closeFile = {
  formatVersion: 2,
  name: "Too close",
  units: { length: "mm" },
  materials: [],
  links: [],
  workspaces: {
    design: {
      version: 3,
      nextId: 20,
      profiles: [],
      sketches: [
        {
          id: "sketch-2",
          points: [...corners.map(([x, y], i) => ({ id: `point-${3 + i}`, x, y })), { id: "point-12", x: CLOSE.centre[0], y: CLOSE.centre[1] }],
          curves: [...corners.map((_, i) => ({ id: `line-${7 + i}`, kind: "line", start: `point-${3 + i}`, end: `point-${3 + ((i + 1) % 4)}` })), { id: "circle-13", kind: "circle", centre: "point-12", radius: CLOSE.r }],
          constraints: [],
        },
      ],
      timeline: {
        features: [
          { id: "feature-1", intent: { type: "box", parameters: { width: 10, depth: 10, height: 10 }, summary: "Box: 10 × 10 × 10 mm" }, provenance: { self: { workspace: "design", id: "feature-1", label: "Feature 1 (box)" }, from: [] }, dependsOn: [], suppressed: false },
          { id: "sketch-2", intent: { type: "sketch", parameters: { plane: "XY" }, summary: "Sketch 1 on the XY plane" }, provenance: { self: { workspace: "design", id: "sketch-2", label: "Sketch 1" }, from: [] }, dependsOn: [], suppressed: false },
        ],
      },
    },
  },
};

/** `closeFile` opened in a fresh page, its box built and the view settled. */
async function openClose(width, touch, height) {
  const page = await fresh(width, touch, height);
  await page.setInputFiles("#open-file", { name: "close.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(closeFile)) });
  await until(page, () => Number(document.querySelector("#viewport").dataset.fits ?? 0) >= 1 && document.querySelector("#viewport").dataset.rebuilding !== "true" && /Box/.test(document.querySelector("#timeline")?.textContent ?? ""), null, "the file opened");
  await settle(page);
  return page;
}

const PLATE = (1200 - 25 * Math.PI) * 10;
const DISC = 25 * Math.PI * 10;

try {
  await check("1280 px: Extrude shades both regions; a click picks the plate (11214.60 mm³ at 10 mm), one in the hole the disc (785.40 mm³); OK makes it", async () => {
    const page = await fresh();
    await sketchOnXY(page, false);
    await plateAndHole(page, false);
    await extrudeIt(page, false);
    await shot(page, "regions-offered-1280");
    // (5, 5): inside the rectangle, 15.8 mm from the circle's centre, so outside the hole: the plate.
    await at(page, [5, 5]);
    await statusSays(page, /^Sketch 1: region chosen\.$/, "the plate chosen");
    await previewIs(page, PLATE, "the plate's preview");
    const plate = await panel(page, "region");
    assert.equal(await data(page, "extrudeChosen"), plate, "the plate drawn chosen");
    await shot(page, "regions-plate-1280");
    // (20, 15): the hole's centre, inside both outlines: the smaller, the disc.
    await at(page, [21, 16]);
    await until(page, (p) => document.querySelector("#extrude-panel").dataset.region !== p, plate, "another region chosen").catch(async (e) => assert.fail(`${e.message} (status "${await extrudeStatus(page)}", error "${await page.textContent("#extrude-error")}", chosen ${await data(page, "extrudeChosen")}, hover ${await data(page, "extrudeHover")})`));
    await previewIs(page, DISC, "the disc's preview");
    await page.click("#extrude-ok");
    await until(page, () => document.querySelector("#extrude-panel").hidden, null, "the panel closed");
    // The panel shows the body once built: 785.40 mm³ to the panel's rounding.
    const v = () => page.evaluate(() => Number((document.querySelector("#volume")?.textContent ?? "").replace(/[^0-9.]/g, "")));
    await until(page, ([w]) => Math.abs(Number((document.querySelector("#volume")?.textContent ?? "").replace(/[^0-9.]/g, "")) - w) < 0.06, [DISC], "the disc built").catch(async (e) => assert.fail(`${e.message} (shown ${await v()} mm³)`));
    await page.context().close();
  });

  await check("375 px with taps: a tap picks the plate, its preview right, the panel clear of the regions; OK makes it", async () => {
    const page = await fresh(375, true);
    await sketchOnXY(page, true);
    await plateAndHole(page, true);
    await extrudeIt(page, true);
    await shot(page, "regions-offered-375");
    await at(page, [5, 5], { tap: true });
    await statusSays(page, /^Sketch 1: region chosen\.$/, "the plate chosen");
    await previewIs(page, PLATE, "the plate's preview");
    await shot(page, "regions-plate-375");
    await press(page, "#extrude-ok", true);
    await until(page, () => document.querySelector("#extrude-panel").hidden, null, "the panel closed");
    await page.context().close();
  });
  await check("1280 px: the plate made, then Extrude again: its top, a face with a hole, is offered and picked, previewing (1200 − 25π) × 5 = 5607.30 mm³ at 5 mm", async () => {
    const page = await fresh();
    await sketchOnXY(page, false);
    await plateAndHole(page, false);
    await extrudeIt(page, false);
    await at(page, [5, 5]);
    await previewIs(page, PLATE, "the plate's preview");
    await page.click("#extrude-ok");
    await until(page, () => document.querySelector("#extrude-panel").hidden, null, "the panel closed");
    await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true" && document.querySelector("#viewport").dataset.rebuilding !== "true", null, "the plate built, the sketch closed");
    await page.click("#extrude");
    await until(page, () => /face:/.test(document.querySelector("#viewport").dataset.extrudeProfiles ?? ""), null, "the plate's faces offered");
    // The sketch's two regions, then the plate's flat faces: both caps and its four flat sides; the hole's round side is never offered.
    const offered = (await data(page, "extrudeProfiles")).split(" ");
    const plate = offered.find((o) => o.startsWith("face:"))?.split("/")[0];
    const faces = offered.filter((o) => o.startsWith("face:")).map((o) => o.split("/")[1]);
    assert.deepEqual([faces.filter((f) => f === "start" || f === "end").length, faces.filter((f) => /^side:line-\d+$/.test(f)).length, faces.length], [2, 4, 6], offered.join(" "));
    // (5, 5, 10): on the plate's top, outside the hole: its end cap.
    const s = toScreen(await camera(page), await canvasBox(page), [5, 5, 10]);
    await page.mouse.click(s.x, s.y);
    await until(page, (want) => document.querySelector("#viewport").dataset.extrudeChosen === want, `${plate}/end`, "the plate's top chosen").catch(async (e) => assert.fail(`${e.message} (chosen ${await data(page, "extrudeChosen")}, status "${await extrudeStatus(page)}")`));
    await page.fill("#extrude-distance", "5");
    // The top keeps its hole: (1200 − 25π) × 5 = 5607.30 mm³, not the 6000 of a top without one.
    await previewIs(page, (1200 - 25 * Math.PI) * 5, "the top's preview, with its hole");
    await shot(page, "face-with-hole-1280");
    await page.context().close();
  });
  for (const { width, height, tap } of [{ width: 1280, height: 800, tap: false }, { width: 393, height: 852, tap: true }]) {
    await check(`${width} × ${height}${tap ? " with taps" : ""}: Edit feature on the plate's extrude shades both regions, the plate chosen; picking the disc and OK makes the disc (785.40 mm³), one undo step (48d4)`, async () => {
      const page = await fresh(width, tap, height);
      await sketchOnXY(page, tap);
      await plateAndHole(page, tap);
      await extrudeIt(page, tap);
      await at(page, [5, 5], { tap });
      await previewIs(page, PLATE, "the plate's preview");
      await press(page, "#extrude-ok", tap);
      await until(page, () => document.querySelector("#extrude-panel").hidden && document.querySelector("#viewport").dataset.rebuilding !== "true", null, "the plate built");
      // Edit feature from the extrude's timeline item: a double click, or two taps.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const id = await page.evaluate(() => [...document.querySelectorAll("#timeline [data-item]")].at(-1).dataset.item);
      const item = page.locator(`#timeline [data-item="${id}"]`);
      await item.scrollIntoViewIfNeeded();
      if (tap) {
        const b = await item.boundingBox();
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      } else await item.dblclick();
      await until(page, () => document.getElementById("feature-edit")?.hidden === false && (document.getElementById("feature-edit").dataset.regions ?? "").split(" ").length === 2, null, "Edit feature with both regions shaded").catch(async (e) => assert.fail(`${e.message} (regions "${await page.evaluate(() => document.getElementById("feature-edit")?.dataset.regions)}")`));
      const chosen = await page.evaluate(() => document.getElementById("feature-edit").dataset.regionChosen);
      assert.equal(await data(page, "extrudeChosen"), chosen, "the plate drawn chosen");
      assert.equal(await page.textContent("#edit-region"), "Sketch 1 has 2 regions: the one extruded is chosen; click or tap another to extrude it instead.");
      await shot(page, `edit-region-${width}`);
      // (21, 16): in the hole, the disc. On a phone the sheet shuts first, so the view is clear to tap (closePanels in `at`).
      await at(page, [21, 16], { tap });
      await until(page, (was) => (document.getElementById("feature-edit").dataset.regionChosen ?? was) !== was, chosen, "the disc chosen");
      assert.equal(await page.textContent("#edit-region"), "Another region of Sketch 1 chosen: OK extrudes it.");
      if (tap) await openPanel(page, "properties", true);
      await press(page, "#feature-edit-ok", tap);
      await until(page, () => document.getElementById("feature-edit").hidden && document.querySelector("#viewport").dataset.rebuilding !== "true", null, "the edit made");
      assert.match(await page.evaluate(() => document.getElementById("undo").title), /^Undo Edit Extrude 1\b/);
      assert.equal(await data(page, "extrudeProfiles"), "", "the shading gone with the panel");
      // The part is now the disc: 25π × 10 = 785.40 mm³, to the panel's rounding.
      await until(page, ([w]) => Math.abs(Number((document.querySelector("#volume")?.textContent ?? "").replace(/[^0-9.]/g, "")) - w) < 0.06, [DISC], "the disc built").catch(async (e) => assert.fail(`${e.message} (shown "${await page.textContent("#volume")}")`));
      await shot(page, `edit-region-done-${width}`);
      await page.context().close();
    });
    await check(`${width} × ${height}${tap ? " with taps" : ""}: a region whose hole comes 0.0005 mm from its sides is shaded red and says why in the sketch's words; picking it makes nothing; the disc in it still extrudes (π × 14.9995² × 10 = 7068.11 mm³)`, async () => {
      const page = await openClose(width, tap, height);
      await press(page, "#extrude", tap);
      if (tap) await closePanels(page, true);
      await until(page, () => /^sketch-2#0 sketch-2#1 face:feature-1\//.test(document.querySelector("#viewport").dataset.extrudeProfiles ?? ""), null, "both regions offered, then the box's faces").catch(async (e) => assert.fail(`${e.message} (offered "${await data(page, "extrudeProfiles")}")`));
      await statusSays(page, /^Sketch 1 has 2 regions: click or tap the one to extrude\.$/, "asks which region");
      const words = /^This region of Sketch 1 can't be extruded: line 1 and circle 1 come closer than 0\.001 mm without meeting; move them apart or join them$/;
      // (−58, 2): inside the rectangle, 22.4 mm from the circle's centre: the plate, the refused one.
      const corner = toScreen(await camera(page), await canvasBox(page), [-58, 2, 0]);
      if (!tap) {
        // The pointer over it says why (the view's title), before any click.
        await page.mouse.move(corner.x, corner.y);
        await until(page, () => document.querySelector("#viewport").dataset.extrudeHover === "sketch-2#0", null, "the plate lit under the pointer");
        assert.match(await page.evaluate(() => document.querySelector("#viewport").title), /^this region can't be extruded: line 1 and circle 1 come closer than 0\.001 mm/);
      }
      // Drawn red (the refused colour, 0xff6b6b, see-through over the dark view), where the disc is drawn blue (0x6cc4ff).
      const pixel = (q) =>
        page.evaluate(([x, y]) => {
          const src = document.querySelector("#viewport canvas");
          const box = src.getBoundingClientRect();
          const dpr = src.width / box.width;
          const c = document.createElement("canvas");
          [c.width, c.height] = [src.width, src.height];
          const ctx = c.getContext("2d");
          ctx.drawImage(src, 0, 0);
          return Array.from(ctx.getImageData(Math.round((x - box.x) * dpr), Math.round((y - box.y) * dpr), 1, 1).data.slice(0, 3));
        }, [q.x, q.y]);
      const [r, g, b] = await pixel(corner);
      const [dr, , db] = await pixel(toScreen(await camera(page), await canvasBox(page), [-40, 15, 0]));
      assert.ok(r > g + 15 && r > b + 5 && db > dr + 30, `the plate drawn red and the disc blue, read ${[r, g, b]} and ${[dr, , db]}`);
      await shot(page, `refused-offered-${width}`);
      await at(page, [-58, 2], { tap });
      await until(page, (re) => new RegExp(re).test(document.querySelector("#extrude-error")?.textContent ?? ""), words.source, "the panel says why").catch(async (e) => assert.fail(`${e.message} (error "${await page.textContent("#extrude-error")}")`));
      assert.equal(await page.isDisabled("#extrude-ok"), true, "OK stays off");
      assert.equal(await panel(page, "previewVolume"), "", "nothing previewed");
      await shot(page, `refused-${width}`);
      // The disc round (−40, 15) still extrudes: π × 14.9995² × 10 = 7068.11 mm³.
      await at(page, [-40, 15], { tap });
      await statusSays(page, /^Sketch 1: region chosen\.$/, "the disc chosen");
      await page.fill("#extrude-distance", "10");
      await previewIs(page, Math.PI * CLOSE.r ** 2 * 10, "the disc's preview");
      // On the phone the panel leaves the regions in view: the plate's corner and the disc's centre are still on the canvas.
      if (tap)
        for (const p of [[-58, 2], [-40, 15]]) {
          const q = toScreen(await camera(page), await canvasBox(page), [...p, 0]);
          assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [q.x, q.y]), "CANVAS", `(${p}) in view beside the panel`);
        }
      await shot(page, `refused-disc-${width}`);
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
