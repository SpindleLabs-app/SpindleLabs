// Browser check of one project open in two browser tabs (export hunt 2026-11-12, SL #642), in a real browser:
// A  a tab whose saves are refused (the other tab stored the project since) and that then crashes while on screen
//    loses nothing: each change since the refusal is in the unsaved-changes journal, and the next visit keeps it as
//    "(kept copy)" beside the other tab's work (item 2: only a tab that was hidden or closed kept anything).
// B  a tab left open while another tab changed the design is told as soon as it is shown again, before anything is
//    edited or exported (item 3: it went on saying "Saved"); a tab nobody overtook is told nothing.
// C  Undo in a refused tab, back to what it opened, does not put the mark back to "Saved" (item 3).
// Run with `npm run e2e` (after `npm run build`). ONLY=<letters> picks checks.
import assert from "node:assert/strict";
import { boot, check, fails, savedMark, storedProjects, volumeIs } from "./save-picker-lib.mjs";
import { startWithBox } from "./start.mjs";
import { pinProperties } from "./properties.mjs";
import { browserName } from "./browser.mjs";

const b = await boot(4798);
const only = process.env.ONLY;
const want = (k) => !only || only.includes(k);
const mark = (page) => page.textContent("#save-status");
const show = (page, state) => page.evaluate((s) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s }); document.dispatchEvent(new Event("visibilitychange")); }, state);
const REFUSED = /^Not saved: This project was changed in another tab/;
async function twoTabs() {
  const context = await b.browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const first = await context.newPage();
  await first.goto(b.url + "#design");
  await startWithBox(first);
  await pinProperties(first);
  await first.waitForTimeout(800);
  await savedMark(first);
  const second = await context.newPage();
  await second.goto(b.url + "#design");
  await volumeIs(second, "24,000 mm³");
  await pinProperties(second);
  return { context, first, second };
}
try {
  // Chromium only: the crash is its debugging protocol's (the storage package's unit tests hold the rule everywhere).
  if (want("A") && browserName === "chromium") await check("A  a refused tab that crashes on screen: its changes since the refusal are kept as a copy on the next visit", async () => {
    const { context, first, second } = await twoTabs();
    await second.fill("#width", "60");
    await volumeIs(second, "36,000 mm³");
    await second.waitForTimeout(1200);
    await savedMark(second);
    await first.fill("#height", "10");
    await volumeIs(first, "12,000 mm³");
    await first.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "error");
    assert.match(await mark(first), REFUSED);
    await first.fill("#depth", "33");
    await first.waitForTimeout(2500);
    const cdp = await context.newCDPSession(first);
    cdp.send("Page.crash").catch(() => {});
    await second.waitForTimeout(1500);
    const next = await context.newPage();
    await next.goto(b.url + "#design");
    await volumeIs(next, "36,000 mm³"); // the other tab's work is still the project a visit opens
    await next.waitForTimeout(1500);
    const held = await storedProjects(next);
    console.log(`  after the crash the store holds: ${held.map((p) => `${p.name} ${p.sizes}`).join("; ")}`);
    assert.ok(held.some((p) => /\(kept copy\)/.test(p.name) && /"depth":33/.test(p.sizes) && /"height":10/.test(p.sizes)), "the crashed tab's height 10 and depth 33 are kept nowhere");
    await context.close();
  });

  if (want("B")) await check("B  a tab left open while another tab changed the design is told when it is shown again; one nobody overtook is not", async () => {
    const { context, first, second } = await twoTabs();
    await show(first, "hidden"); // the person goes to the second tab
    await show(second, "hidden");
    await show(second, "visible"); // nothing changed anywhere: nothing to say
    await second.waitForTimeout(800);
    assert.equal(await mark(second), "Saved");
    await second.fill("#height", "21");
    await volumeIs(second, "25,200 mm³");
    await second.waitForTimeout(1200);
    await savedMark(second);
    await second.close();
    await show(first, "visible"); // and comes back to the first
    await first.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "error", null, { timeout: 8000 }).catch(() => {});
    console.log(`  the first tab, shown again: ${await mark(first)} (it shows ${await first.textContent("#volume")}, the store holds 25,200 mm³)`);
    assert.match(await mark(first), /^Not saved: this project was changed in another tab, so this tab shows an older version\. Reload to see the newer one\./);
    await first.reload();
    await volumeIs(first, "25,200 mm³");
    assert.equal(await mark(first), "Saved");
    assert.equal((await storedProjects(first)).length, 1, "a tab that changed nothing leaves no kept copy");
    await context.close();
  });

  if (want("C")) await check("C  Undo in a refused tab does not put the mark back to Saved", async () => {
    const { context, first, second } = await twoTabs();
    await second.fill("#width", "60");
    await volumeIs(second, "36,000 mm³");
    await second.waitForTimeout(1200);
    await savedMark(second);
    await first.fill("#height", "10");
    await volumeIs(first, "12,000 mm³");
    await first.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "error");
    await first.click("#viewport");
    await first.keyboard.press("Control+z");
    await volumeIs(first, "24,000 mm³");
    await first.waitForTimeout(2500);
    console.log(`  after Undo: ${await mark(first)}`);
    assert.match(await mark(first), REFUSED);
    await context.close();
  });
} finally {
  await b.close();
}
console.log(fails() ? `${fails()} check(s) failed` : "all browser-tabs checks passed");
process.exit(fails() ? 1 : 0);
