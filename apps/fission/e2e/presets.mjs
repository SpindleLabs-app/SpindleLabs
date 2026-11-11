// Browser checks of every Insert ▾ preset on the real kernel: what the Body
// panel says (volume, area, topology), how the timeline and the browser name
// it, the one undo step it makes, and where its exported STL lies, each worked
// out by hand from the preset's outline (workspaces/design/src/profiles.ts:
// a 40 × 30 mm outline with a corner on the origin, extruded 20 mm; the
// cylinder and sphere ⌀40 round the origin). Then the width typed 60: the new
// values, again worked by hand, and Undo bringing the old ones back. Before
// this only the box, the cylinder's volume and the L-bracket's volume were
// checked in a browser; the plate, the slot and the star were inserted only
// for other reasons, with no value of theirs checked.
// At 1280 px with the mouse and 375 px with taps. Run with `npm run e2e`
// (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { closePanels, insertPreset, openPanel } from "./start.mjs";
import { pinProperties } from "./properties.mjs";

const server = await preview({ preview: { port: 4355, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4355/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 15000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

// The panel shows ten significant figures (@fission/ui formatQuantity); every value below is written out by hand
// from the working beside it, never read from the app. π = 3.14159265358979…, sin 36° = 0.587785252…, cos 36° = 0.809016994….
//
// Each preset at 40 × 30 × 20 (`at40`) and with its width typed 60 (`at60`), its depth 30 and height 20 kept:
// volume = outline area × 20; area = 2 × outline area + perimeter × 20.
const PRESETS = [
  {
    kind: "cylinder",
    name: "Cylinder 1",
    summary: "Cylinder: ⌀40 × 20 mm",
    // r 20: V = π · 20² · 20 = 25,132.74123; A = 2π · 20² + 2π · 20 · 20 = 2513.274 + 2513.274 = 5,026.548246.
    // Its two circles, each with one corner, and three faces: 2 V · 2 E · 3 F.
    at40: { volume: "25,132.74123 mm³", area: "5,026.548246 mm²", topology: "2 V · 2 E · 3 F" },
    // r 30: V = π · 900 · 20 = 56,548.66776; A = 2π · 900 + 2π · 30 · 20 = 5654.867 + 3769.911 = 9,424.777961.
    at60: { volume: "56,548.66776 mm³", area: "9,424.777961 mm²", topology: "2 V · 2 E · 3 F" },
    // On the floor: z 0..20 either width. x and y are left out: the mesh's corners lie on the circle but need not
    // fall on the axes (at ⌀60 none is on the y axis: y runs ±29.99), and insert.mjs checks the cylinder's place.
    bounds40: [null, null, [0, 20]],
    bounds60: [null, null, [0, 20]],
    // The STL's facets are chords inside the circle, so it holds less than the exact solid.
    mesh: "less",
  },
  {
    kind: "sphere",
    name: "Sphere 1",
    summary: "Sphere: ⌀40 mm",
    // r 20: V = 4/3 · π · 20³ = 33,510.32164; A = 4π · 20² = 5,026.548246.
    at40: { volume: "33,510.32164 mm³", area: "5,026.548246 mm²", topology: "1 V · 1 E · 2 F" },
    // r 30: V = 4/3 · π · 27,000 = 113,097.3355; A = 4π · 900 = 11,309.73355.
    at60: { volume: "113,097.3355 mm³", area: "11,309.73355 mm²", topology: "1 V · 1 E · 2 F" },
    // Resting on the floor: z 0..40. Made 60 wide it grows about its centre, 20 up (insert.mjs): z −10..50. x and y
    // are left to insert.mjs (the mesh's sides fall a chord short of the radius).
    bounds40: [null, null, [0, 40]],
    bounds60: [null, null, [-10, 50]],
    mesh: "less",
  },
  {
    kind: "l-bracket",
    name: "L-bracket 1",
    summary: "Extrude: L-bracket profile 40 × 30 mm, by 20 mm",
    // Arms 0.3 of the width and depth thick: the 40 × 30 rectangle less the 28 × 21 corner cut away,
    // 1200 − 588 = 612 mm²; perimeter 40 + 9 + 28 + 21 + 12 + 30 = 140. V = 612 · 20 = 12,240; A = 1224 + 2800 = 4,024.
    // Six corners prismed: 12 V, 6 + 6 + 6 = 18 E, 6 sides + 2 ends = 8 F.
    at40: { volume: "12,240 mm³", area: "4,024 mm²", topology: "12 V · 18 E · 8 F" },
    // 60 wide: 1800 − 42 · 21 = 918 mm²; perimeter 60 + 9 + 42 + 21 + 18 + 30 = 180. V = 18,360; A = 1836 + 3600 = 5,436.
    at60: { volume: "18,360 mm³", area: "5,436 mm²", topology: "12 V · 18 E · 8 F" },
    bounds40: [[0, 40], [0, 30], [0, 20]],
    bounds60: [[0, 60], [0, 30], [0, 20]],
    // All flat: the STL is the solid itself, to float precision.
    mesh: "same",
  },
  {
    kind: "plate",
    name: "Plate 1",
    summary: "Extrude: Plate with two round holes profile 40 × 30 mm, by 20 mm",
    // Two holes of radius 0.15 · min(40, 30) = 4.5: 1200 − 2π · 4.5² = 1200 − 127.2345 = 1072.7655 mm²;
    // perimeter 140 + 2 · 2π · 4.5 = 196.5487. V = 21,455.30995; A = 2145.531 + 3930.973 = 6,076.50435.
    // The box's 8 V, 12 E, 6 F; each hole adds a corner on each of its two circles, those two circles and its wall.
    at40: { volume: "21,455.30995 mm³", area: "6,076.50435 mm²", topology: "12 V · 16 E · 8 F" },
    // 60 wide: the holes keep radius 0.15 · min(60, 30) = 4.5: 1800 − 127.2345 = 1672.7655 mm²; perimeter 180 + 56.5487.
    // V = 33,455.30995; A = 3345.531 + 4730.973 = 8,076.50435.
    at60: { volume: "33,455.30995 mm³", area: "8,076.50435 mm²", topology: "12 V · 16 E · 8 F" },
    bounds40: [[0, 40], [0, 30], [0, 20]],
    bounds60: [[0, 60], [0, 30], [0, 20]],
    // The holes' facets are chords inside their circles: the holes are smaller, so the STL holds more.
    mesh: "more",
  },
  {
    kind: "slot",
    name: "Slot 1",
    summary: "Extrude: Slot with round ends profile 40 × 30 mm, by 20 mm",
    // Half-circle ends of radius 15 on a 10 × 30 middle: 300 + π · 15² = 1006.8583 mm²; perimeter 2 · 10 + 2π · 15 =
    // 114.2478. V = 20,137.16694; A = 2013.717 + 2284.956 = 4,298.672286. Four corners prismed: 8 V, 12 E, 6 F.
    at40: { volume: "20,137.16694 mm³", area: "4,298.672286 mm²", topology: "8 V · 12 E · 6 F" },
    // 60 wide: a 30 × 30 middle, 900 + 706.8583 = 1606.8583 mm²; perimeter 60 + 94.2478. V = 32,137.16694;
    // A = 3213.717 + 3084.956 = 6,298.672286.
    at60: { volume: "32,137.16694 mm³", area: "6,298.672286 mm²", topology: "8 V · 12 E · 6 F" },
    bounds40: [[0, 40], [0, 30], [0, 20]],
    bounds60: [[0, 60], [0, 30], [0, 20]],
    mesh: "less",
  },
  {
    kind: "star",
    name: "Star 1",
    summary: "Extrude: Star profile 40 × 30 mm, by 20 mm",
    // Five points of radius R = 0.5 · min(40, 30) = 15 about (20, 15), inner corners at 0.4 R = 6: ten triangles
    // ½ · 15 · 6 · sin 36° = 26.45034 each, 264.5034 mm²; each side √(15² + 6² − 2 · 15 · 6 · cos 36°) = 10.74135, ten
    // of them 107.4135. V = 5,290.067271; A = 529.0067 + 2148.273 = 2,677.279903. Ten corners: 20 V, 30 E, 12 F.
    at40: { volume: "5,290.067271 mm³", area: "2,677.279903 mm²", topology: "20 V · 30 E · 12 F" },
    // 60 wide: R = 0.5 · min(60, 30) is still 15, so the same star, its centre moved to (30, 15).
    at60: { volume: "5,290.067271 mm³", area: "2,677.279903 mm²", topology: "20 V · 30 E · 12 F" },
    // The first point on +x at (20 + 15, 15); x least at the points 144° and 216° round, 20 + 15 cos 144° = 7.864745;
    // y least at 288°, 15 + 15 sin 288° = 0.734152, most at 72°, 15 + 15 sin 72° = 29.265848.
    bounds40: [[7.864745, 35], [0.734152, 29.265848], [0, 20]],
    bounds60: [[17.864745, 45], [0.734152, 29.265848], [0, 20]],
    mesh: "same",
  },
];

async function fresh(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: width > 640 ? 800 : 667 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await page.waitForSelector("#start-hint", { state: "visible" });
  return page;
}

/** The toolbar's STL: its triangles, each three corners in mm. */
async function stl(page, tap) {
  await closePanels(page, tap);
  const [dl] = await Promise.all([page.waitForEvent("download"), press(page, "#toolbar [data-op=export_stl]", tap)]);
  const bytes = readFileSync(await dl.path());
  const tris = [];
  for (let t = 0; t < bytes.readUInt32LE(80); t++) tris.push([0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i))));
  return tris;
}
/** [min, max] of the corners in x, y and z. */
const bounds = (tris) => [0, 1, 2].map((i) => [Math.min(...tris.flat().map((p) => p[i])), Math.max(...tris.flat().map((p) => p[i]))]);
/** The volume a closed mesh holds: the sum of each facet's signed tetrahedron with the origin, a · (b × c) / 6. */
const meshVolume = (tris) =>
  tris.reduce((v, [a, b, c]) => v + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6, 0);
const number = (text) => Number(text.replace(/[^0-9.]/g, ""));

/** The Body panel's three facts. */
const facts = (page) => page.evaluate(() => ({ volume: document.querySelector("#volume")?.textContent, area: document.querySelector("#area")?.textContent, topology: document.querySelector("#topology")?.textContent }));
const factsAre = (page, want, what) =>
  until(page, (w) => document.querySelector("#volume")?.textContent === w.volume && document.querySelector("#area")?.textContent === w.area && document.querySelector("#topology")?.textContent === w.topology, want, what).catch(async (e) =>
    assert.fail(`${e.message}: the panel says ${JSON.stringify(await facts(page))}, want ${JSON.stringify(want)}`),
  );

/** The STL's bounds where given (corners stored as 32-bit floats: 1e-4 mm), and its volume against the exact one. */
function meshAgrees(tris, p, want, wantBounds, what) {
  const got = bounds(tris);
  wantBounds.forEach((w, i) => {
    if (w) for (const k of [0, 1]) assert.ok(Math.abs(got[i][k] - w[k]) <= 1e-4, `${what}: ${"xyz"[i]} runs ${got[i]}, want ${w}`);
  });
  const v = meshVolume(tris);
  const exact = number(want.volume);
  // Float corners: 1 part in a million of the volume, far under any one facet's share.
  if (p.mesh === "same") assert.ok(Math.abs(v - exact) <= 1e-6 * exact, `${what}: the all-flat STL holds ${v} mm³, the solid ${exact}`);
  else if (p.mesh === "less") assert.ok(v < exact && v > 0, `${what}: the STL's chords hold ${v} mm³, less than the solid's ${exact}`);
  else assert.ok(v > exact, `${what}: the STL's smaller holes leave ${v} mm³, more than the solid's ${exact}`);
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

try {
  for (const [width, tap] of [[1280, false], [375, true]]) {
    const at = `${width} px${tap ? ", taps" : ""}`;
    for (const p of PRESETS) {
      await check(`${at}: Insert ▾ ${p.name.replace(/ 1$/, "")}: the panel's volume, area and topology worked by hand, its name and one undo step, the STL where it should be; 60 wide and undone`, async () => {
        const page = await fresh(width, tap);
        try {
          await insertPreset(page, p.kind, tap);
          await factsAre(page, p.at40, `${p.kind} inserted`);
          assert.equal(await page.evaluate(() => document.querySelector("#viewport").dataset.shape), p.kind);
          assert.deepEqual(
            await page.$$eval("#timeline [data-item]", (els) => els.map((e) => [e.dataset.item, e.title])),
            [["feature-1", `1. ${p.name}\n${p.summary}`]],
            "one timeline item, named for its shape",
          );
          assert.deepEqual(await page.$eval('#browser .tree-row[data-node="feature-1"]', (r) => [r.textContent, r.title]), [p.name, `${p.name}\n${p.summary}`]);
          assert.deepEqual(await page.$$eval('#browser .tree-row[data-node^="body-"]', (rs) => rs.map((r) => r.textContent)), ["Body 1"]);
          assert.equal(await page.getAttribute("#undo", "title"), `Undo Insert ${p.name.replace(/ 1$/, "")} (Ctrl+Z)`);
          meshAgrees(await stl(page, tap), p, p.at40, p.bounds40, `${p.kind} 40 wide`);
          if (shots) await page.screenshot({ path: `${shots}/presets-${p.kind}-${width}.png` });

          // The width typed 60: one more undo step, and the values for 60.
          await pinProperties(page);
          await openPanel(page, "properties", tap);
          await page.fill("#width", "60");
          await until(page, () => document.querySelector("#undo").title.startsWith("Undo Change"), null, "the width changed");
          await factsAre(page, p.at60, `${p.kind} 60 wide`);
          assert.deepEqual(await page.$$eval("#timeline [data-item]", (els) => els.map((e) => e.dataset.item)), ["feature-1"], "changed in place, not added");
          meshAgrees(await stl(page, tap), p, p.at60, p.bounds60, `${p.kind} 60 wide`);

          // One Undo: back to 40 wide, the Insert the next step to undo.
          await press(page, "#undo", tap);
          await until(page, (n) => document.querySelector("#undo").title === `Undo Insert ${n} (Ctrl+Z)`, p.name.replace(/ 1$/, ""), "the width change undone");
          await factsAre(page, p.at40, `${p.kind} undone to 40 wide`);
          assert.equal(await page.inputValue("#width"), "40");
          meshAgrees(await stl(page, tap), p, p.at40, p.bounds40, `${p.kind} undone`);
        } finally {
          await page.context().close();
        }
      });
    }
  }

  await check("deliberate breaks fail: a plate worked out with the holes sized by the longer side, and a star by its width, never match what the app shows", async () => {
    const page = await fresh(1280, false);
    try {
      await insertPreset(page, "plate");
      await factsAre(page, PRESETS.find((p) => p.kind === "plate").at40, "the plate");
      // Holes of radius 0.15 · 40 = 6: (1200 − 2π · 36) · 20 = 19,476.10783 mm³, which the panel must not say.
      const wrong = { ...PRESETS.find((p) => p.kind === "plate").at40, volume: "19,476.10783 mm³" };
      await assert.rejects(
        page.waitForFunction((w) => document.querySelector("#volume")?.textContent === w.volume, wrong, { timeout: 1500 }),
        /Timeout/,
        "the wrong plate volume is never shown",
      );
      // A star sized by its width, R 20, would reach x 0..40: the bounds check must catch it.
      await page.close();
      const star = await fresh(1280, false);
      await insertPreset(star, "star");
      const p = PRESETS.find((q) => q.kind === "star");
      await factsAre(star, p.at40, "the star");
      const tris = await stl(star, false);
      assert.throws(() => meshAgrees(tris, p, p.at40, [[0, 40], [0, 30], [0, 20]], "the star by its width"), /x runs/);
      assert.throws(() => meshAgrees(tris, { ...p, mesh: "more" }, p.at40, p.bounds40, "an all-flat STL said to hold more"), /more than the solid/);
      await star.context().close();
    } finally {
      if (!page.isClosed()) await page.context().close();
    }
  });

  await check("no errors in the console", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failed) {
  console.log(`${failed} preset check(s) failed`);
  process.exit(1);
}
