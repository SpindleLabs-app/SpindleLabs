// Browser check of a phone held sideways and of a window just over phone
// width (U5a, styles/phone-short.css). At 667 × 375 and 844 × 390 the
// toolbar is one row (45 px, not three) so the view keeps over 250 px of the
// 375, the top bar is one row with nothing overlapping another (before, "Saved"
// ran into DESIGN ▾ at 667 px and Community wrapped onto a second row at 641), and nothing is wider than the screen.
// Each check is also run with the new rules switched off (the body's class
// removed) and must fail there: the phone's own toolbar is taller than 48 px
// and the top bar wraps to two rows. At 1280 × 720 the toolbar is untouched.
// Screenshots at 1280, 667 × 375 and 844 × 390 go to E2E_SHOTS when set.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4204, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4204/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

async function open(width, height, rules = true) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900 });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await startWithBox(page);
  if (!rules) await page.evaluate(() => document.body.classList.remove("phone-short"));
  return { page, context };
}

/** The top bar's visible buttons and words, as boxes, and the first two that overlap by more than 1 px. */
async function topBarOverlap(page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll("#topbar > *:not([hidden]), #topbar #topbar-actions > *, #topbar .app-bar > *, #topbar button")]
      .filter((e) => e.children.length === 0 || e.tagName === "BUTTON" || e.tagName === "H1")
      .map((e) => ({ id: e.id || e.textContent.trim().slice(0, 12), e, r: e.getBoundingClientRect() }))
      .filter((b) => b.r.width > 2 && b.r.height > 2);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const nested = boxes[i].e.contains(boxes[j].e) || boxes[j].e.contains(boxes[i].e); // a word inside its own button is not an overlap
        if (w > 1 && h > 1 && !nested) return `${boxes[i].id} overlaps ${boxes[j].id}`;
      }
    return null;
  });
}
const topBarHeight = (page) => page.$eval("#topbar", (e) => e.getBoundingClientRect().height);
const toolbarHeight = (page) => page.$eval("#toolbar", (e) => e.getBoundingClientRect().height);
const viewHeight = (page) => page.$eval("#viewport", (e) => e.getBoundingClientRect().height);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [width, height] of [[667, 375], [844, 390]]) {
  const { page, context } = await open(width, height);
  assert.equal(await topBarOverlap(page), null, `${width}: top bar overlap`);
  // Hand-worked: toolbar buttons 32 px + 2 × 6 padding + 1 border = 45 px.
  assert.ok((await toolbarHeight(page)) <= 48, `${width}: toolbar ${await toolbarHeight(page)} px`);
  // The bar is 44, the toolbar 45, the timeline 32 + 1: the view keeps what is left of the height (over 250 at 375).
  assert.ok((await viewHeight(page)) >= height - 44 - 48 - 34 - 2, `${width}: view ${await viewHeight(page)} px`);
  assert.equal(await sideways(page), 0, `${width}: sideways scroll`);
  if (shots) await page.screenshot({ path: `${shots}/phone-short-${width}x${height}.png` });
  await context.close();
}

// Just over phone width: 641, 700 and 760 px, no overlap, and AI, Guide and Community keep their names for screen readers.
for (const width of [641, 700, 760]) {
  const { page, context } = await open(width, 700);
  assert.equal(await topBarOverlap(page), null, `${width}: top bar overlap`);
  assert.ok((await topBarHeight(page)) <= 48, `${width}: top bar wraps (${await topBarHeight(page)} px)`);
  // Room to spare (U7b, CI 2026-11-05: the History button took the last of it at 641 and a wider font ran the workspace button into AI):
  // the gap between them is at least 40 px, for CI's fonts that run up to 45 px wider across the bar's left side than this sandbox's.
  const gap = await page.evaluate(() => document.getElementById("assistant-toggle").getBoundingClientRect().left - document.getElementById("workspace-menu").getBoundingClientRect().right);
  assert.ok(gap >= 40, `${width}: the workspace button is ${gap.toFixed(1)} px from AI, under 40`);
  assert.equal(await sideways(page), 0, `${width}: sideways scroll`);
  assert.equal(await page.$eval("#guide-open", (e) => e.textContent.includes("Guide")), true);
  await context.close();
}

// Switched off, the same pages fail: the toolbar is taller and the bar overlaps.
{
  const { page, context } = await open(641, 375, false);
  assert.ok((await toolbarHeight(page)) > 48, "off: the old toolbar is taller than 48 px");
  // Before, Community wrapped onto a second row here (and at 667 "Saved" and "AI off" ran into DESIGN ▾).
  assert.ok((await topBarHeight(page)) > 48, "off: the old top bar wraps to two rows at 641");
  await context.close();
}

// A failed save is on screen (export hunt 2026-11-12, SL #643 item 1): at 641 to 760 px the save status is clipped
// away with "Saved", and "Not saved: …" went with it, so a sideways phone showed nothing at all. Every write is
// refused as a full store refuses it (QuotaExceededError on the transaction); the words then take a row of their
// own under the bar, in view and overlapping nothing, while "Saved" before the failure stays out of the row.
for (const [width, height] of [[641, 375], [667, 375], [740, 360], [760, 400]]) {
  const { page, context } = await open(width, height);
  await page.waitForFunction(() => document.querySelector("#save-status").dataset.state === "saved");
  const size = () => page.$eval("#save-status", (e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]);
  assert.deepEqual(await size(), [1, 1], `${width}: "Saved" takes no room (the tick beside the name shows it)`);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      const tx = this.transaction;
      const r = { onerror: null, onsuccess: null, error: new DOMException("", "QuotaExceededError") };
      setTimeout(() => {
        r.onerror?.({ target: r, preventDefault() {} });
        try { tx.abort(); } catch {}
      });
      return r;
    };
  });
  await page.tap("#insert");
  await page.tap("#insert-cylinder");
  await page.waitForFunction(() => document.querySelector("#save-status").dataset.state === "error", null, { timeout: 30000 });
  const seen = await page.$eval("#save-status", (e) => {
    const r = e.getBoundingClientRect();
    const under = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
    return { words: e.textContent, width: r.width, height: r.height, top: r.top, bottom: r.bottom, clip: getComputedStyle(e).clipPath, onTop: under === e };
  });
  assert.match(seen.words, /^Not saved: browser storage is full/, `${width}: the words`);
  assert.ok(seen.width > 200 && seen.height >= 12 && seen.clip === "none" && seen.onTop, `${width}: the failed save's words are not on screen: ${JSON.stringify(seen)}`);
  assert.ok(seen.top >= 0 && seen.bottom <= height, `${width}: the words are outside the screen: ${JSON.stringify(seen)}`);
  assert.equal(await topBarOverlap(page), null, `${width}: top bar overlap with a failed save showing`);
  assert.equal(await sideways(page), 0, `${width}: sideways scroll with a failed save showing`);
  if (shots) await page.screenshot({ path: `${shots}/phone-short-failed-save-${width}x${height}.png` });
  await context.close();
}

// A desktop window keeps the roomy toolbar and the words.
{
  const { page, context } = await open(1280, 720);
  assert.ok((await toolbarHeight(page)) > 60, `1280: toolbar ${await toolbarHeight(page)} px`);
  assert.equal(await page.$eval("#community", (e) => e.getBoundingClientRect().width > 80), true);
  if (shots) await page.screenshot({ path: `${shots}/phone-short-1280.png` });
  await context.close();
}

await browser.close();
server.close?.();
assert.deepEqual(errors, []);
console.log("phone-short: ok");
process.exit(0);
