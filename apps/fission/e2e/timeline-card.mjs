// Browser check of the timeline item's card (Ben, 2026-11-05: the bar's hover said "11. Box 4 box"). A design
// of Box 1, Sketch 1 (a 30 × 20 mm slot), Extrude 1 of it by 8 mm, Cylinder 1 and Move 1 of the cylinder
// (timeline-card.spindle). At 1280 px with the mouse and at 375 px with a finger, in the dark and the light
// theme: each item's card shows its name, number, kind and key values, inside the window, above the bar and
// small (never most of the view); a sketch's card draws its outline; a solid's card shows the bodies with its
// own in the accent colour (the picture's blue pixels counted, and different for each item); the app's own
// hover box and the browser's stay away; the keyboard's focus shows it too; an item after the rollback marker
// says so and shows no picture; nothing is fetched to draw it (offline). SHOTS=dir saves screenshots.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4237, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4237/#design";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let failed = false;
const design = readFileSync(new URL("./timeline-card.spindle", import.meta.url));

/** Each item: its card's name, kind, first detail and picture. */
const ITEMS = [
  ["feature-1", "Box 1", "Box", "40 × 30 × 20 mm", "bodies"],
  ["sketch-2", "Sketch 1", "Sketch", "On the XY plane", "outline"],
  ["feature-13", "Extrude 1", "Extrude", "8 mm from Sketch 1", "bodies"],
  ["feature-14", "Cylinder 1", "Cylinder", "⌀16 mm, 30 mm high", "bodies"],
  ["feature-15", "Move 1", "Move", "Move Cylinder 1 by (-35, 0, 0) mm", "bodies"],
];

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

async function open(width, scheme, touch) {
  const height = touch ? 812 : 800;
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: touch, isMobile: touch, tooltips: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.setInputFiles("#open-file", { name: "timeline-card.spindle", mimeType: "application/octet-stream", buffer: design });
  await page.waitForFunction((n) => document.querySelectorAll("#timeline li[data-item]").length === n, ITEMS.length, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, { timeout: 15000 });
  return { page, context, height };
}

/** The card as the page shows it: its words, its box, its picture's kind and the picture's blue (accent) pixels and their middle. */
const cardNow = (page) =>
  page.evaluate(async () => {
    const c = document.getElementById("timeline-card");
    if (!c || c.hidden) return null;
    const img = c.querySelector(".timeline-card-picture img");
    let blue = 0;
    let mx = 0;
    if (img) {
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const g = cv.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 200 && d[i + 2] > d[i] + 40 && d[i + 2] > d[i + 1] + 15) {
          blue++;
          mx += (i / 4) % cv.width;
        }
      }
      mx = blue ? mx / blue / cv.width : 0;
    }
    const bar = document.querySelector("#timeline").getBoundingClientRect();
    const tip = document.getElementById("tooltip");
    return {
      item: c.dataset.item,
      name: c.querySelector(".timeline-card-name")?.textContent,
      number: c.querySelector(".timeline-card-number")?.textContent,
      kind: c.querySelector(".timeline-card-kind")?.textContent,
      detail: c.querySelector(".timeline-card-detail")?.textContent,
      status: c.querySelector(".timeline-card-status")?.textContent ?? null,
      picture: c.querySelector(".timeline-card-picture")?.dataset.picture ?? null,
      path: c.querySelector(".timeline-card-picture path")?.getAttribute("d") ?? null,
      blue,
      mx,
      box: c.getBoundingClientRect().toJSON(),
      barTop: bar.top,
      background: getComputedStyle(c).backgroundColor,
      tipShown: tip ? !tip.hidden : false,
    };
  });

const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/[\d.]+/g).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

for (const [width, touch] of [[1280, false], [375, true]]) {
  for (const scheme of ["dark", "light"]) {
    const at = `${width} px ${scheme}${touch ? ", taps" : ""}`;
    await check(`${at}: every item's card names it, says what it is and its key values, and pictures it`, async () => {
      const { page, context, height } = await open(width, scheme, touch);
      const fetched = [];
      page.on("request", (r) => fetched.push(r.url()));
      try {
        const middles = new Map();
        for (const [id, name, kind, detail, picture] of ITEMS) {
          const item = `#timeline li[data-item="${id}"]`;
          if (touch) await page.tap(item);
          else await page.hover(item);
          // A finger's pick shows its card once a second tap could no longer come (500 ms).
          await page.waitForFunction((want) => document.getElementById("timeline-card")?.dataset.item === want && !document.getElementById("timeline-card").hidden, id, { timeout: 3000 });
          const c = await cardNow(page);
          assert.deepEqual([c.name, c.number, c.kind, c.detail, c.picture, c.status], [name, `#${ITEMS.findIndex((i) => i[0] === id) + 1}`, kind, detail, picture, null], `${id}'s card`);
          assert.equal(c.tipShown, false, "the app's own hover box stays away");
          if (!touch) assert.equal(await page.$eval(item, (li) => li.matches("[title]")), false, "the title is held back from the browser's own box");
          // Inside the window, above the bar, and small: a phone's view is never mostly covered.
          assert.ok(c.box.left >= 0 && c.box.right <= width && c.box.top >= 0, `inside the window: ${JSON.stringify(c.box)}`);
          assert.ok(c.box.bottom <= c.barTop, `above the bar: ${c.box.bottom} vs ${c.barTop}`);
          assert.ok((c.box.width * c.box.height) / (width * height) < (touch ? 0.25 : 0.06), `small: ${Math.round(c.box.width)} × ${Math.round(c.box.height)}`);
          // The theme's own surface: dark in the dark theme, light in the light one.
          const lum = luminance(c.background);
          assert.ok(scheme === "dark" ? lum < 0.3 : lum > 0.7, `${scheme} card background ${c.background}`);
          if (picture === "outline") {
            // The slot: lines (30, ±10) to (60, ±10) and two half circles, y turned down.
            assert.equal(c.path, "M30 10L60 10M60 10A10 10 0 0 0 60 -10M60 -10L30 -10M30 -10A10 10 0 0 0 30 10");
          } else {
            assert.ok(c.blue > 150, `${id}: its own body in the accent colour (${c.blue} blue pixels)`);
            middles.set(id, c.mx);
          }
          if (shots) await page.screenshot({ path: `${shots}/timeline-card-${width}-${scheme}-${id}.png` });
          if (touch) {
            await page.tap(item); // the pick ends, and the card with it
            await page.waitForFunction(() => document.getElementById("timeline-card").hidden, null, { timeout: 3000 });
          } else {
            await page.mouse.move(width / 2, 200);
            await page.waitForFunction(() => document.getElementById("timeline-card").hidden, null, { timeout: 3000 });
            if (await page.$eval(item, (li) => li.getAttribute("title")) === null) assert.fail("the title came back on leaving");
          }
        }
        // The pictures pick out different bodies: the cylinder (moved to x −35) is left of the box, the extrude
        // (x 30..60) right of it; the Move picks out the cylinder, as Cylinder 1's own picture does.
        assert.ok(middles.get("feature-14") < middles.get("feature-1") && middles.get("feature-1") < middles.get("feature-13"), `blue middles ${JSON.stringify([...middles])}`);
        assert.ok(Math.abs(middles.get("feature-15") - middles.get("feature-14")) < 0.02, "the Move's picture is the cylinder's");
        assert.deepEqual(fetched.filter((u) => !u.startsWith("data:")), [], "nothing fetched to draw the cards");
      } finally {
        await context.close();
      }
    });
  }
}

await check("1280 px: the keyboard's focus shows the card; an item after the rollback marker says so, with no picture", async () => {
  const { page, context } = await open(1280, "dark", false);
  try {
    await page.focus('#timeline li[data-item="feature-13"]');
    await page.waitForFunction(() => document.getElementById("timeline-card")?.dataset.item === "feature-13");
    await page.click('[data-button="start"]');
    await page.waitForFunction(() => document.querySelector('#timeline li[data-item="feature-1"]')?.dataset.rolledBack === "true");
    await page.waitForFunction(() => document.querySelector("#viewport")?.dataset.rebuilding === "false");
    await page.hover('#timeline li[data-item="feature-13"]');
    await page.waitForFunction(() => document.getElementById("timeline-card")?.dataset.item === "feature-13" && !document.getElementById("timeline-card").hidden);
    const c = await cardNow(page);
    assert.equal(c.status, "After the rollback marker: not built yet");
    assert.equal(c.picture, null);
    if (shots) await page.screenshot({ path: `${shots}/timeline-card-1280-rolled-back.png` });
  } finally {
    await context.close();
  }
});

await browser.close();
server.httpServer.close();
if (errors.length) {
  console.log(`FAIL page errors:\n  ${errors.join("\n  ")}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
