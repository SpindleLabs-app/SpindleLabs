// Browser check of the design tabs (their own switch, tabs.config.mjs; a build with the home screen has them too), in a
// real Chromium. On the normal build (tabs off until released) there is no strip; `npm run e2e:tabs` builds one with the
// switch on (dist-tabs/; E2E_DIST names another, such as the home screen's dist-home/) and checks:
// - A first visit shows one tab, "Untitled" with a DESIGNLAB chip; "+" opens a second tab with a new empty design while the first
//   keeps its box (24,000 mm³) and comes back when chosen.
// - A tab says what it is for: after Slice is chosen in the second tab its chip reads SLICELAB and the first still reads DESIGNLAB;
//   choosing a tab shows the workspace that tab was in.
// - × on a tab that is not on screen only takes it off the strip; × on the one on screen brings up its neighbour; × on the
//   last tab leaves one new empty design.
// - A reload brings the tabs back, in order, with the same one on screen.
// - At 393 px (taps) nothing runs off the side and every strip button is at least 44 px tall; screenshots (SHOTS=<dir>) at
//   1280 and 393 px in both themes.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { chooseFile, insertPreset, startWithBox } from "./start.mjs";

const DIST = process.env.E2E_DIST ? process.env.E2E_DIST.replace(/\/?$/, "/") : fileURLToPath(new URL("../dist/", import.meta.url));
if (!existsSync(DIST + "index.html")) throw new Error("build the app first (npm run build, or npm run e2e:tabs)");
const WITH_TABS = Boolean(process.env.E2E_DIST);
const PORT = 4618;
const server = await preview({ build: { outDir: DIST }, preview: { port: PORT, strictPort: true }, logLevel: "error" });
const url = `http://localhost:${PORT}/`;
const browser = await launch();
const shots = process.env.SHOTS;
const errors = [];
let failed = 0;
async function check(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").join("\n  ")}`);
  }
}
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const saved = (page) => until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
const volume = (page, want) => until(page, (w) => document.querySelector("#volume")?.textContent === w, want, `the volume ${want}`);
const tabsOf = (page) => page.$$eval(".design-tabs-tab", (t) => t.map((x) => ({ name: x.querySelector(".design-tabs-name").textContent, kind: x.querySelector(".design-tabs-kind").textContent, on: x.dataset.active === "true" })));
const tabsAre = (page, want, what) =>
  until(
    page,
    (w) => JSON.stringify([...document.querySelectorAll(".design-tabs-tab")].map((x) => `${x.querySelector(".design-tabs-name").textContent}|${x.querySelector(".design-tabs-kind").textContent}|${x.dataset.active === "true" ? "on" : ""}`)) === JSON.stringify(w),
    want,
    what,
  );
/** Chooses the nth tab (from 0) as a person does: on a phone by the switcher's list, else on the strip. */
async function tapTab(page, n) {
  await page.tap("#design-tabs-switch");
  await page.tap(`#design-tabs-menu .design-tabs-tab:nth-child(${n + 1}) .design-tabs-main`);
}
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));

async function newPage(width = 1280, touch = false, scheme = "dark", init = null) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch, isMobile: touch, colorScheme: scheme });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "?test-hooks#design");
  return { context, page };
}
/** Past the home screen, when the build has it (dist-home/); a build with only the tabs opens straight on the design. */
async function pastHome(page) {
  await page.locator("#design-tabs").waitFor({ state: "attached" }); // made in the same run of the shell's code as the home screen
  if ((await page.$("#home")) === null) return;
  await page.locator("#home-close").waitFor({ state: "visible" });
  await page.click("#home-close");
  await page.locator("#home").waitFor({ state: "hidden" });
}

if (!WITH_TABS) {
  await check("the shipped build has no design tabs yet (off until released)", async () => {
    const { context, page } = await newPage();
    await page.locator("#start-hint").waitFor();
    assert.equal(await page.$("#design-tabs"), null);
    await context.close();
  });
} else {
  /** Two tabs: the first holds the box, the second is a new empty design. */
  async function two(width = 1280, touch = false, scheme = "dark") {
    const { context, page } = await newPage(width, touch, scheme);
    await pastHome(page);
    await startWithBox(page, touch);
    await saved(page);
    await press(page, "#design-tabs-add", touch);
    await tabsAre(page, ["Untitled|DESIGNLAB|", "Untitled|DESIGNLAB|on"], "two tabs, the new one on screen");
    await page.locator("#start-hint").waitFor();
    return { context, page };
  }

  await check("a first visit has one DESIGNLAB tab; + opens a new design in a second tab and the first keeps its box", async () => {
    const { context, page } = await newPage();
    await pastHome(page);
    await page.locator("#start-hint").waitFor();
    assert.deepEqual(await tabsOf(page), [{ name: "Untitled", kind: "DESIGNLAB", on: true }]);
    await context.close();
    const t = await two();
    await t.page.click(".design-tabs-tab:first-child .design-tabs-main");
    await tabsAre(t.page, ["Untitled|DESIGNLAB|on", "Untitled|DESIGNLAB|"], "the first tab on screen");
    await volume(t.page, "24,000 mm³");
    await t.page.click(".design-tabs-tab:last-child .design-tabs-main");
    await t.page.locator("#start-hint").waitFor();
    await t.context.close();
  });

  await check("a tab says what it is for: SLICELAB after Slice is chosen in the tab with the box, and choosing a tab shows the workspace it was in", async () => {
    const { context, page } = await two();
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await volume(page, "24,000 mm³");
    // In the public app DESIGN ▾'s Slice opens a dialog over Design; the Slice page itself is reached by its link (#slice).
    await page.evaluate(() => (location.hash = "#slice"));
    await until(page, () => document.body.dataset.activeWorkspace === "slice", null, "Slice shown");
    await tabsAre(page, ["Untitled|SLICELAB|on", "Untitled|DESIGNLAB|"], "the first tab reads SLICELAB, the second still DESIGNLAB");
    await page.click(".design-tabs-tab:last-child .design-tabs-main");
    await page.locator("#start-hint").waitFor();
    assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design");
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await until(page, () => document.body.dataset.activeWorkspace === "slice", null, "Slice shown again for the first tab");
    await tabsAre(page, ["Untitled|SLICELAB|on", "Untitled|DESIGNLAB|"], "chips unchanged after switching");
    await context.close();
  });

  await check("× takes a tab off the strip; the last one leaves a new empty design", async () => {
    const { context, page } = await two();
    await page.click(".design-tabs-tab:first-child .design-tabs-close"); // not on screen: just leaves the strip
    await tabsAre(page, ["Untitled|DESIGNLAB|on"], "one tab left");
    await page.locator("#start-hint").waitFor();
    await saved(page);
    await page.click(".design-tabs-tab .design-tabs-close"); // the last one
    await tabsAre(page, ["Untitled|DESIGNLAB|on"], "one new tab");
    await page.locator("#start-hint").waitFor();
    await context.close();
  });

  await check("closing the tab on screen brings up its neighbour (the box comes back)", async () => {
    const { context, page } = await two();
    await saved(page);
    await page.click(".design-tabs-tab:last-child .design-tabs-close");
    await tabsAre(page, ["Untitled|DESIGNLAB|on"], "the first tab, on screen");
    await volume(page, "24,000 mm³");
    await context.close();
  });

  const undoOn = (page) => page.$eval("#undo", (b) => !b.disabled);
  const camera = (page) => page.evaluate(() => window.fissionTest.camera());

  await check("each tab keeps its own undo steps: undoing in one tab never touches the other", async () => {
    const { context, page } = await two();
    assert.equal(await undoOn(page), false, "the new tab starts with nothing to undo");
    await insertPreset(page, "cylinder");
    await saved(page);
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await volume(page, "24,000 mm³");
    await until(page, () => !document.querySelector("#undo").disabled, null, "Undo in the first tab (its box was inserted there)");
    await page.click("#undo"); // takes the box back out of the first tab
    await page.locator("#start-hint").waitFor();
    await page.click(".design-tabs-tab:last-child .design-tabs-main");
    await until(page, () => document.querySelector("#volume")?.textContent !== "—" && document.querySelector("#volume")?.textContent !== "24,000 mm³", null, "the cylinder still in the second tab");
    assert.equal(await undoOn(page), true, "the second tab still has its own step to undo");
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await page.locator("#start-hint").waitFor(); // the first tab stayed as it was undone
    assert.equal(await undoOn(page), false, "the undone box has no steps left to undo");
    await until(page, () => !document.querySelector("#redo").disabled, null, "Redo kept in the first tab");
    await context.close();
  });

  await check("each tab keeps its camera: Top in one tab, then back, shows Top again", async () => {
    const { context, page } = await two();
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await volume(page, "24,000 mm³");
    await page.click('.view-controls [aria-label="Top"]');
    await page.waitForTimeout(800);
    const top = await camera(page);
    await page.click(".design-tabs-tab:last-child .design-tabs-main");
    await page.locator("#start-hint").waitFor();
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await volume(page, "24,000 mm³");
    await page.waitForTimeout(1500);
    const back = await camera(page);
    const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-6 * Math.max(1, Math.abs(x)));
    assert.ok(near(back.position, top.position) && near(back.target, top.target), `camera ${JSON.stringify(back.position)} is the Top view ${JSON.stringify(top.position)}`);
    await context.close();
  });

  await check("a reload brings the tabs back in order, the same one on screen", async () => {
    const { context, page } = await two();
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await volume(page, "24,000 mm³");
    await saved(page);
    await page.waitForTimeout(500);
    await page.reload();
    await pastHome(page);
    await volume(page, "24,000 mm³");
    await tabsAre(page, ["Untitled|DESIGNLAB|on", "Untitled|DESIGNLAB|"], "both tabs back");
    await context.close();
  });

  for (const [scheme, width, touch] of [["dark", 1280, false], ["light", 1280, false], ["dark", 393, true], ["light", 393, true]]) {
    await check(`${width} px ${scheme}: the strip fits, targets are big enough${touch ? " (taps)" : ""}`, async () => {
      const { context, page } = await two(width, touch, scheme);
      if (touch) await tapTab(page, 0);
      else await page.click(".design-tabs-tab:first-child .design-tabs-main");
      await volume(page, "24,000 mm³");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "nothing runs off the side");
      const small = await page.$$eval(".design-tabs button", (b) => b.filter((x) => x.offsetParent !== null).map((x) => x.getBoundingClientRect().height).filter((h) => h < (innerWidth <= 640 ? 44 : 30)));
      assert.deepEqual(small, [], "every shown strip button is tall enough");
      if (shots) await page.screenshot({ path: `${shots}/tabs-${width}-${scheme}.png` });
      await context.close();
    });
  }

  await check("a phone shows one button for the design on screen and a short list; nothing covers most of the view", async () => {
    const { context, page } = await two(393, true);
    // The strip is the switcher and +, not the wide row of tabs.
    assert.equal(await page.isVisible(".design-tabs-list"), false);
    assert.match(await page.textContent("#design-tabs-switch"), /Untitled\s*DESIGNLAB\s*2/);
    assert.equal(await page.isHidden("#design-tabs-menu"), true);
    await page.tap("#design-tabs-switch");
    await page.locator("#design-tabs-menu").waitFor({ state: "visible" });
    const rows = await page.$$eval("#design-tabs-menu .design-tabs-tab", (r) => r.map((x) => ({ h: x.getBoundingClientRect().height, on: x.dataset.active })));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.h >= 44), "every row is 44 px or taller");
    assert.equal(await page.getAttribute("#design-tabs-switch", "aria-expanded"), "true");
    const menu = await page.$eval("#design-tabs-menu", (m) => m.getBoundingClientRect().height / innerHeight);
    assert.ok(menu <= 0.5, `the list takes at most half the screen (${menu})`);
    if (shots) await page.screenshot({ path: `${shots}/tabs-393-list.png` });
    // Escape puts it away; choosing a row switches (the box comes back) and puts it away.
    await page.keyboard.press("Escape");
    assert.equal(await page.isHidden("#design-tabs-menu"), true);
    await tapTab(page, 0);
    await volume(page, "24,000 mm³");
    assert.equal(await page.isHidden("#design-tabs-menu"), true);
    await tabsAre(page, ["Untitled|DESIGNLAB|on", "Untitled|DESIGNLAB|"], "the first tab on screen");
    // × in the list closes that tab.
    await page.tap("#design-tabs-switch");
    await page.tap("#design-tabs-menu .design-tabs-tab:nth-child(2) .design-tabs-close");
    await tabsAre(page, ["Untitled|DESIGNLAB|on"], "one tab left");
    // Many tabs: the list scrolls inside half the screen.
    for (let i = 0; i < 9; i++) {
      await page.tap("#design-tabs-add");
      await until(page, (n) => document.querySelectorAll(".design-tabs-tab").length === n, i + 2, "another tab");
    }
    await page.tap("#design-tabs-switch");
    const big = await page.$eval("#design-tabs-menu", (m) => ({ h: m.getBoundingClientRect().height / innerHeight, scrolls: m.scrollHeight > m.clientHeight }));
    assert.ok(big.h <= 0.5 && big.scrolls, `ten tabs: the list stays within half the screen and scrolls (${JSON.stringify(big)})`);
    await context.close();
  });
  // The tabs bug hunt of 2026-11-14 (findings A1-E6, docs/progress/tabs.md T2): each check below failed before its fix.
  /** Read-only IndexedDB answers held back window.__idbDelay ms (a phone's storage under load), so a switch lasts long enough to act in. */
  const slowStorage = () => {
    window.__idbDelay = 0;
    const d = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess");
    Object.defineProperty(IDBRequest.prototype, "onsuccess", {
      configurable: true,
      get() {
        return d.get.call(this);
      },
      set(fn) {
        const ms = window.__idbDelay;
        const slow = typeof fn === "function" && ms > 0 && this.transaction?.mode === "readonly";
        d.set.call(this, slow ? (e) => setTimeout(() => fn.call(this, e), ms) : fn);
      },
    });
  };
  /** Every kernel answer held back window.__kernelDelay ms (a slow phone or a big part). */
  const slowKernel = () => {
    window.__kernelDelay = 0;
    const Real = window.Worker;
    window.Worker = class extends Real {
      addEventListener(type, fn, o) {
        if (type !== "message") return super.addEventListener(type, fn, o);
        let last = Promise.resolve();
        return super.addEventListener(type, (e) => void (last = last.then(() => new Promise((r) => setTimeout(r, window.__kernelDelay))).then(() => fn.call(this, e))), o);
      }
      set onmessage(fn) {
        this.addEventListener("message", fn);
      }
    };
  };
  const keyOf = (page) => page.evaluate(() => document.body.dataset.projectId ?? null);
  const vol = (page) => page.evaluate(() => document.querySelector("#volume")?.textContent ?? null);
  const items = (page) => page.evaluate(() => document.querySelectorAll("#timeline li.timeline-bar-item").length);
  /** The strip as keys, the one on screen marked with *. */
  const strip = (page) => page.$$eval(".design-tabs-tab", (t) => t.map((x) => x.dataset.key + (x.dataset.active === "true" ? "*" : "")));
  /** No rebuild running, no held work, and a volume shown unless the design is empty. */
  const settled = (page) =>
    until(page, () => document.querySelector("#viewport").dataset.rebuilding !== "true" && !window.fissionTest.historyBusy() && (document.querySelector("#volume")?.textContent !== "—" || !document.querySelector("#start-hint")?.hidden), null, "settled", 30000);
  /** After a reload: the strip back and the design built. */
  async function reloaded(page) {
    await pastHome(page);
    await until(page, () => document.querySelectorAll(".design-tabs-tab").length > 0, null, "the strip after the reload");
    await settled(page);
    await page.waitForTimeout(1000);
  }
  const tabByKey = (key) => `.design-tabs-tab[data-key="${key}"]`;
  /** Chooses the tab holding `key` and waits until its project is on screen and built. */
  async function goTo(page, key) {
    await page.click(`${tabByKey(key)} .design-tabs-main`);
    await until(page, (k) => document.body.dataset.projectId === k && document.querySelector(".design-tabs-tab[data-active=true]")?.dataset.key === k, key, "the tab's project on screen", 30000);
    await settled(page);
  }
  /** Deletes kept project `id` in File > Projects in this browser. */
  async function projectsDelete(page, id) {
    await chooseFile(page, "file-projects");
    await page.locator(`.project-row[data-id="${id}"] .project-delete`).click();
    await page.locator(`.project-row[data-id="${id}"] .project-delete-sure`).click();
    await until(page, (i) => !document.querySelector(`.project-row[data-id="${i}"]`), id, "the row gone");
    await page.keyboard.press("Escape");
  }
  /** Another window of the same browser (one store, one localStorage), past the home screen. */
  async function window2(context) {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?test-hooks#design");
    await pastHome(page);
    await until(page, () => document.querySelectorAll(".design-tabs-tab").length > 0, null, "window 2's strip");
    await settled(page);
    return page;
  }
  /** Tab a: the box; tab b: a new design with a cylinder, on screen. */
  async function boxAndCylinder(init = null) {
    const { context, page } = await newPage(1280, false, "dark", init);
    await pastHome(page);
    await startWithBox(page);
    await saved(page);
    const a = await keyOf(page);
    await page.click("#design-tabs-add");
    await until(page, () => document.querySelectorAll(".design-tabs-tab").length === 2, null, "two tabs");
    await page.locator("#start-hint").waitFor();
    await insertPreset(page, "cylinder");
    await until(page, () => !["—", "24,000 mm³", ""].includes(document.querySelector("#volume")?.textContent ?? ""), null, "the cylinder built");
    await settled(page);
    await saved(page);
    return { context, page, a, b: await keyOf(page), cyl: await vol(page) };
  }

  await check("tabs hunt A1: Ctrl+Z pressed just after another tab is chosen never undoes the tab being left", async () => {
    const { context, page, a, b, cyl } = await boxAndCylinder(slowStorage);
    await page.evaluate(() => (window.__idbDelay = 600));
    await page.click(`${tabByKey(a)} .design-tabs-main`);
    await page.waitForTimeout(80);
    await page.keyboard.press("Control+z"); // for the cylinder's tab, being left: ignored
    await page.evaluate(() => (window.__idbDelay = 0));
    await until(page, (k) => document.body.dataset.projectId === k, a, "the box tab on screen", 30000);
    await settled(page);
    assert.equal(await vol(page), "24,000 mm³", "the box tab is as it was");
    await saved(page);
    await goTo(page, b);
    assert.equal(await vol(page), cyl, "the tab left keeps its cylinder");
    await context.close();
  });

  /** The box tab on screen with a sphere inserted and its Move open at X 10, the kernel then made slow; resolves to the timeline's length. */
  async function moveWaiting(page, a) {
    await goTo(page, a);
    await insertPreset(page, "sphere", false, true); // Move opens on it
    await page.locator("#move-x").waitFor({ state: "visible" });
    await settled(page);
    await saved(page);
    const n = await items(page);
    await page.fill("#move-x", "10");
    await page.evaluate(() => (window.__kernelDelay = 800));
    return n;
  }

  await check("tabs hunt A4: a Move's OK still with the kernel when another tab is chosen lands in its own design", async () => {
    const { context, page, a, b, cyl } = await boxAndCylinder(slowKernel);
    const n = await moveWaiting(page, a);
    await page.click("#move-ok");
    await page.waitForTimeout(50);
    await page.click(`${tabByKey(b)} .design-tabs-main`);
    await until(page, (k) => document.body.dataset.projectId === k, b, "the cylinder tab on screen", 30000);
    await page.evaluate(() => (window.__kernelDelay = 0));
    await settled(page);
    assert.equal(await vol(page), cyl, "the cylinder tab shows its cylinder");
    assert.equal(await items(page), 1, "nothing of the Move in the cylinder tab");
    await saved(page);
    await goTo(page, a);
    assert.equal(await items(page), n + 1, "the Move pressed OK is in the box tab");
    await context.close();
  });

  await check("tabs hunt A2: an Undo waiting for an OK when another tab is chosen never takes a step out of that tab", async () => {
    const { context, page, a, b, cyl } = await boxAndCylinder(slowKernel);
    await moveWaiting(page, a);
    await page.click("#move-ok");
    await page.waitForTimeout(30);
    await page.click("#undo"); // waits for the OK, in the box tab
    await page.click(`${tabByKey(b)} .design-tabs-main`);
    await until(page, (k) => document.body.dataset.projectId === k, b, "the cylinder tab on screen", 30000);
    await page.evaluate(() => (window.__kernelDelay = 0));
    await page.waitForTimeout(5000); // anything still waiting has run by now
    await settled(page);
    assert.equal(await vol(page), cyl, "the cylinder tab still shows its cylinder");
    assert.equal(await items(page), 1);
    await context.close();
  });

  await check("tabs hunt C3: × on the tab on screen never hands its undo steps or camera to the tab that comes up", async () => {
    // The camera: the box tab turned to Top, a new tab with a cylinder closed, the box tab comes up still at Top.
    let { context, page } = await newPage();
    await pastHome(page);
    await startWithBox(page);
    await saved(page);
    await page.click('.view-controls [aria-label="Top"]');
    await page.waitForTimeout(800);
    const top = await camera(page);
    await page.click("#design-tabs-add");
    await page.locator("#start-hint").waitFor();
    await insertPreset(page, "cylinder");
    await settled(page);
    await saved(page);
    await page.click(".design-tabs-tab:last-child .design-tabs-close");
    await volume(page, "24,000 mm³");
    await page.waitForTimeout(1500);
    const back = await camera(page);
    const near = (p, q) => p.every((x, i) => Math.abs(x - q[i]) < 1e-6 * Math.max(1, Math.abs(x)));
    assert.ok(near(back.position, top.position) && near(back.target, top.target), `camera ${JSON.stringify(back.position)} is still the Top view ${JSON.stringify(top.position)}`);
    await context.close();
    // The steps: two new designs (the same text); a box put in the second and undone; × on it: the first has nothing to redo.
    ({ context, page } = await newPage());
    await pastHome(page);
    await page.locator("#start-hint").waitFor();
    await page.click("#design-tabs-add");
    await page.locator("#start-hint").waitFor();
    await saved(page);
    const first = await keyOf(page);
    await page.click("#design-tabs-add");
    await until(page, (k) => document.body.dataset.projectId !== k, first, "the second new design");
    await page.locator("#start-hint").waitFor();
    await saved(page);
    await insertPreset(page, "box");
    await volume(page, "24,000 mm³");
    await saved(page);
    await page.click("#undo");
    await page.locator("#start-hint").waitFor();
    await saved(page);
    await page.click(".design-tabs-tab[data-active=true] .design-tabs-close");
    await until(page, (k) => document.body.dataset.projectId === k, first, "the first new design on screen");
    await page.waitForTimeout(1500);
    assert.equal(await page.$eval("#redo", (x) => x.disabled), true, `the first design did nothing, so it has nothing to redo (Redo says ${await page.getAttribute("#redo", "title")})`);
    await context.close();
  });

  await check("tabs hunt A3: an edit while the tab after a closed one opens never brings the closed tab back; the strip names the design on screen", async () => {
    const { context, page, a } = await boxAndCylinder(slowStorage);
    await page.evaluate(() => (window.__idbDelay = 600));
    await page.click(".design-tabs-tab[data-active=true] .design-tabs-close"); // the cylinder, saved: no question
    await insertPreset(page, "sphere"); // a person goes on working meanwhile
    await page.evaluate(() => (window.__idbDelay = 0));
    await until(page, (k) => document.body.dataset.projectId === k, a, "the box tab's project on screen", 30000);
    await settled(page);
    await page.waitForTimeout(1500);
    assert.deepEqual(await strip(page), [`${a}*`], "one tab, the box, on screen");
    await context.close();
  });

  await check("tabs hunt B3/C2/B5: a deleted project's tab closes (with words when it was deleted in another window), and × goes past it", async () => {
    const { context, page, a, b } = await boxAndCylinder();
    await page.click("#design-tabs-add");
    await page.locator("#start-hint").waitFor();
    await saved(page);
    const c = await keyOf(page);
    // B deleted in another window: choosing its tab here says so and closes it, C stays on screen.
    let w2 = await window2(context);
    await projectsDelete(w2, b);
    await w2.close();
    await page.click(`${tabByKey(b)} .design-tabs-main`);
    await until(page, () => /is no longer in this browser/.test(document.querySelector("#file-status")?.textContent ?? ""), null, "the words for a deleted project");
    assert.match(await page.textContent("#file-status"), /^Untitled is no longer in this browser \(deleted here or in another window\), so its tab is closed\.$/);
    assert.deepEqual(await strip(page), [a, `${c}*`], "B's tab closed, C on screen");
    assert.equal(await keyOf(page), c);
    // A deleted in another window too: × on C goes past A (gone) to a new design.
    w2 = await window2(context);
    await projectsDelete(w2, a);
    await w2.close();
    await page.click(`${tabByKey(c)} .design-tabs-close`);
    await until(page, (k) => document.body.dataset.projectId !== k && document.querySelectorAll(".design-tabs-tab").length === 1, c, "one new tab on screen");
    await page.locator("#start-hint").waitFor();
    // Deleted here in File > Projects: its tab leaves the strip at once.
    await saved(page);
    const d = await keyOf(page);
    await page.click("#design-tabs-add");
    await until(page, (k) => document.body.dataset.projectId !== k, d, "another new design");
    await saved(page);
    const e = await keyOf(page);
    await projectsDelete(page, d);
    assert.deepEqual(await strip(page), [`${e}*`], "the deleted project's tab is gone");
    await context.close();
  });

  await check("tabs hunt B1: a tab that fails to open leaves the workspace on screen as it was (Undo stays in Design)", async () => {
    const { context, page, a, b } = await boxAndCylinder();
    await goTo(page, a);
    await page.evaluate(() => (location.hash = "#slice"));
    await until(page, () => document.body.dataset.activeWorkspace === "slice", null, "Slice shown");
    await saved(page);
    await goTo(page, b);
    assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design");
    const w2 = await window2(context);
    await projectsDelete(w2, a);
    await w2.close();
    await page.click(`${tabByKey(a)} .design-tabs-main`); // fails: deleted
    await page.waitForTimeout(1500);
    await insertPreset(page, "sphere");
    await saved(page);
    await page.click("#undo");
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => document.body.dataset.activeWorkspace), "design", "Undo keeps Design on screen");
    assert.match(await page.textContent("#file-status"), /is no longer in this browser/);
    assert.deepEqual(await page.$$eval(".design-tabs-list .design-tabs-kind", (k) => k.map((x) => x.textContent)), ["DESIGNLAB"], "the tab on screen still reads DESIGNLAB");
    await context.close();
  });

  await check("tabs hunt B2: with storage full, a new tab's work kept only in the journal is still a tab after a reload", async () => {
    const { context, page } = await two();
    const origin = new URL(url).origin;
    const cdp = await context.newCDPSession(page);
    const { usage } = await cdp.send("Storage.getUsageAndQuota", { origin });
    await cdp.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: usage + 300_000 });
    await page.evaluate(async () => {
      const db = await new Promise((ok) => {
        const r = indexedDB.open("filler", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("f");
        r.onsuccess = () => ok(r.result);
      });
      let n = 0;
      for (const size of [50_000, 5_000, 500, 50])
        for (;;) {
          const s = Array.from({ length: size }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join("");
          const ok = await new Promise((done) => {
            const tx = db.transaction("f", "readwrite");
            tx.objectStore("f").put(s, "k" + n++);
            tx.oncomplete = () => done(true);
            tx.onabort = () => done(false);
          });
          if (!ok) break;
        }
      db.close();
    });
    await page.click("#design-tabs-add");
    await until(page, () => document.querySelectorAll(".design-tabs-tab").length === 3, null, "a third tab");
    await page.locator("#start-hint").waitFor();
    const c = await keyOf(page);
    await startWithBox(page);
    await page.waitForTimeout(1500);
    page.on("dialog", (d) => void d.accept());
    await page.reload();
    await reloaded(page);
    const keys = (await strip(page)).map((k) => k.replace("*", ""));
    assert.equal(keys.length, 3, `three tabs after the reload (${JSON.stringify(keys)})`);
    assert.ok(keys.includes(c), "the new tab, kept only in the journal, is one of them");
    await context.close();
  });

  await check("tabs hunt C4: each browser window keeps its own tabs through a reload", async () => {
    const { context, page: w1, a, b } = await boxAndCylinder();
    const w2 = await window2(context);
    await w2.click("#design-tabs-add");
    await w2.locator("#start-hint").waitFor();
    await saved(w2);
    const c = await keyOf(w2);
    await goTo(w1, a); // window 1 changes its own list after window 2
    await saved(w1);
    await w1.waitForTimeout(500);
    await w2.reload();
    await reloaded(w2);
    const two2 = (await strip(w2)).map((k) => k.replace("*", ""));
    assert.ok(two2.includes(c), `window 2's own tab is still on its strip after its reload (${JSON.stringify(two2)})`);
    await w2.click(`${tabByKey(c)} .design-tabs-close`); // closed in window 2 only
    await w2.waitForTimeout(500);
    await w1.reload();
    await reloaded(w1);
    const one = (await strip(w1)).map((k) => k.replace("*", ""));
    assert.deepEqual(one, [a, b], "window 1 keeps its own two tabs");
    await context.close();
  });

  await check("tabs hunt C6/D1: a tab pushed off the strip keeps nothing in memory (its camera is not put back)", async () => {
    const { context, page } = await newPage();
    await pastHome(page);
    await startWithBox(page);
    await saved(page);
    const a = await keyOf(page);
    await page.click('.view-controls [aria-label="Top"]');
    await page.waitForTimeout(800);
    const top = await camera(page);
    for (let i = 0; i < 11; i++) {
      await page.click("#design-tabs-add");
      await until(page, (n) => document.querySelectorAll(".design-tabs-tab").length === n, i + 2, "another tab");
      await page.locator("#start-hint").waitFor();
      await saved(page);
    }
    // A thirteenth design (+ is off at twelve, a file still opens): the tab left longest ago, the box's, leaves the strip.
    await page.setInputFiles("#open-file", { name: "Column.spindle", mimeType: "application/json", buffer: readFileSync(new URL("./plate-on-column.spindle", import.meta.url)) });
    await volume(page, "1,800 mm³");
    await saved(page);
    assert.equal((await strip(page)).includes(a), false, "the box's tab was pushed off");
    await chooseFile(page, "file-projects");
    await page.locator(`.project-row[data-id="${a}"] .project-open`).click();
    await volume(page, "24,000 mm³");
    await page.waitForTimeout(1500);
    const back = await camera(page);
    const near = (p, q) => p.every((x, i) => Math.abs(x - q[i]) < 1e-6 * Math.max(1, Math.abs(x)));
    assert.equal(near(back.position, top.position), false, "the box opens framed afresh, not at the Top view its dropped tab held");
    await context.close();
  });

  await check("tabs hunt B4: a store that never answers fails the switch in words, and the strip works again", async () => {
    const { context, page } = await two();
    const before = await strip(page);
    await page.evaluate(() => {
      // Every read of the store from now on never answers (writes still do).
      const silent = () => ({ onerror: null, onsuccess: null, onupgradeneeded: null, onblocked: null, readyState: "pending" });
      for (const m of ["get", "getAll", "getAllKeys", "openCursor", "openKeyCursor", "count"]) {
        IDBObjectStore.prototype[m] = silent;
        IDBIndex.prototype[m] = silent;
      }
    });
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await until(page, () => /browser storage didn't answer/.test(document.querySelector("#file-status")?.textContent ?? ""), null, "the words for a store that never answers", 25000);
    assert.deepEqual(await strip(page), before, "the strip as it was");
    await page.click("#design-tabs-add");
    await until(page, () => document.querySelectorAll(".design-tabs-tab").length === 3, null, "+ works again");
    await context.close();
  });

  // T2b: the hunt's smaller leftovers (E1, E2, E3, E6, C5, A5), each failed before its fix.
  /** A browser that answers like Ollama, holding the AI's answer until window.allowLines says (as e2e/assistant.mjs does). */
  const heldOllama = () => {
    delete globalThis.LanguageModel;
    Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true });
    const realFetch = globalThis.fetch;
    Object.assign(globalThis, { heldLines: [], allowLines: 0 });
    globalThis.fetch = async (input, init) => {
      if (!String(input).endsWith("/api/chat")) return realFetch(input, init);
      let sent = 0;
      const body = new ReadableStream({
        async pull(c) {
          while (sent >= globalThis.allowLines && sent < globalThis.heldLines.length) await new Promise((r) => setTimeout(r, 20));
          if (sent >= globalThis.heldLines.length) return c.close();
          c.enqueue(new TextEncoder().encode(globalThis.heldLines[sent++]));
        },
      });
      return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
    };
  };
  /** Two tabs that each hold the default box (textually the same project), the first on screen, the AI set to the fake Ollama. */
  async function twoBoxesWithAI() {
    const { context, page } = await newPage(1280, false, "dark", heldOllama);
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-type": "application/json" };
    for (const host of ["http://localhost:11434/**", "http://127.0.0.1:11434/**"])
      await context.route(host, (route) => (route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ headers: cors, body: JSON.stringify({ models: [{ name: "qwen2.5:1.5b" }] }) })));
    await pastHome(page);
    await startWithBox(page);
    await saved(page);
    await page.click("#design-tabs-add");
    await until(page, () => document.querySelectorAll(".design-tabs-tab").length === 2, null, "two tabs");
    await startWithBox(page); // the second tab: the same default box
    await saved(page);
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await volume(page, "24,000 mm³");
    await settled(page);
    await page.click("#assistant-toggle");
    await until(page, () => !/Looking/.test(document.querySelector("#ai-found").textContent) && document.querySelector("#ai-found").textContent !== "", null, "the AI looked around");
    await page.click("#ai-detect");
    await until(page, () => document.querySelector("#assistant-toggle").textContent === "AI Ollama", null, "Ollama chosen");
    const answer = JSON.stringify({ commands: [{ op: "set_part", shape: "box", width: 50, depth: 30, height: 20 }], explanation: "Box 50 wide." });
    await page.evaluate((a) => (globalThis.heldLines = [JSON.stringify({ message: { role: "assistant", content: a }, done: false }) + "\n", '{"message":{"role":"assistant","content":""},"done":true}\n']), answer);
    return { context, page };
  }
  async function toSecondTab(page) {
    await page.click(".design-tabs-tab:last-child .design-tabs-main");
    await until(page, () => document.querySelector(".design-tabs-tab:last-child").dataset.active === "true", null, "the second tab on screen");
    await volume(page, "24,000 mm³");
    await settled(page);
  }

  await check("tabs hunt E1: an AI answer asked in one tab is never previewed or applied in another tab with the same design", async () => {
    const { context, page } = await twoBoxesWithAI();
    await page.fill("#ai-prompt", "Make it 50 mm wide.");
    await page.click("#ai-ask-button");
    await page.waitForTimeout(300);
    await toSecondTab(page); // switched while the AI answers
    await page.evaluate(() => (globalThis.allowLines = 2));
    await until(page, () => /changed while the AI was answering/.test(document.querySelector("#ai-result").textContent), null, "the answer refused: it was for the other tab's design", 20000);
    assert.equal((await page.$("#ai-accept")) === null, true, "no Accept in the tab that never asked");
    assert.equal(await vol(page), "24,000 mm³", "the second tab's box unchanged");
    await context.close();
  });

  await check("tabs hunt E1: an AI preview shown in one tab is dropped when another tab is chosen (its Accept never reaches that tab)", async () => {
    const { context, page } = await twoBoxesWithAI();
    await page.evaluate(() => (globalThis.allowLines = 2));
    await page.fill("#ai-prompt", "Make it 50 mm wide.");
    await page.click("#ai-ask-button");
    await page.locator("#ai-accept").waitFor({ timeout: 20000 });
    await toSecondTab(page);
    assert.equal((await page.$("#ai-accept")) === null, true, "the preview went with the tab it was for");
    assert.match(await page.textContent("#ai-result"), /another design/i, "and that is said");
    assert.equal(await vol(page), "24,000 mm³");
    await context.close();
  });

  /** A phone-sized page of `w` × `h` with taps, past the home screen, holding the box and `more` new tabs. */
  async function phone(w, h, more, scheme = "dark") {
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, colorScheme: scheme });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?test-hooks#design");
    await pastHome(page);
    await startWithBox(page, true);
    await saved(page);
    for (let i = 0; i < more; i++) {
      await page.tap("#design-tabs-add");
      await until(page, (n) => document.querySelectorAll("#design-tabs .design-tabs-tab").length === n, i + 2, "another tab");
      await page.waitForTimeout(200);
    }
    return { context, page };
  }
  for (const [w, h] of [[667, 375], [852, 393]]) {
    await check(`tabs hunt E2: a phone held sideways (${w}x${h}) gets the switcher, every strip target 44 px`, async () => {
      const { context, page } = await phone(w, h, 2);
      assert.equal(await page.isVisible("#design-tabs-switch"), true, "the switcher shows");
      assert.equal(await page.isVisible(".design-tabs-list"), false, "not the wide row of tabs, × beside each");
      const small = await page.$$eval(".design-tabs button", (b) => b.filter((x) => x.offsetParent !== null).map((x) => { const r = x.getBoundingClientRect(); return `${x.className}:${Math.round(r.width)}x${Math.round(r.height)}`; }).filter((s) => s.split(":")[1].split("x").some((n) => Number(n) < 44)));
      assert.deepEqual(small, [], "every shown strip button is 44 px or more both ways");
      if (shots) await page.screenshot({ path: `${shots}/tabs-${w}x${h}.png` });
      await context.close();
    });
  }

  for (const [w, h] of [[320, 568], [375, 667], [667, 375]]) {
    await check(`tabs hunt E3: at ${w}x${h} the open phone list never covers more than half the 3D view`, async () => {
      const { context, page } = await phone(w, h, 6, "light");
      await page.tap("#design-tabs-switch");
      await page.locator("#design-tabs-menu").waitFor({ state: "visible" });
      const cover = await page.evaluate(() => {
        const m = document.querySelector("#design-tabs-menu").getBoundingClientRect();
        const v = document.querySelector("#viewport").getBoundingClientRect();
        return { part: (Math.min(m.bottom, v.bottom) - Math.max(m.top, v.top)) / v.height, scrolls: document.querySelector("#design-tabs-menu").scrollHeight > document.querySelector("#design-tabs-menu").clientHeight };
      });
      assert.ok(cover.part <= 0.5, `the list covers ${cover.part.toFixed(2)} of the view's height`);
      assert.ok(cover.scrolls, "seven tabs: the list scrolls");
      // Undo, Redo, the timeline and the bottom bar stay clear.
      const clear = await page.evaluate(() => {
        const m = document.querySelector("#design-tabs-menu").getBoundingClientRect();
        return ["#undo", "#redo", "#timeline"].filter((s) => {
          const e = document.querySelector(s);
          if (!e || e.offsetParent === null) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && !(r.right <= m.left || m.right <= r.left || r.bottom <= m.top || m.bottom <= r.top);
        });
      });
      assert.deepEqual(clear, [], "nothing it must never cover");
      if (shots) await page.screenshot({ path: `${shots}/tabs-${w}x${h}-list.png` });
      await context.close();
    });
  }

  await check("tabs hunt E6: a tab chosen by keyboard keeps the focus; tabs read as name and Lab; only tabs in the tablist", async () => {
    const { context, page } = await two();
    const focused = () => page.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY" : `${a.getAttribute("role")}|${a.getAttribute("aria-selected")}|${a.closest(".design-tabs-tab")?.dataset.key ?? ""}`; });
    await page.focus(".design-tabs-tab[data-active=true] .design-tabs-main");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await volume(page, "24,000 mm³");
    await page.waitForTimeout(500);
    const first = await page.$eval(".design-tabs-tab:first-child", (t) => t.dataset.key);
    assert.equal(await focused(), `tab|true|${first}`, "Enter: focus on the chosen tab");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press(" ");
    await page.locator("#start-hint").waitFor();
    await page.waitForTimeout(500);
    const second = await page.$eval(".design-tabs-tab:last-child", (t) => t.dataset.key);
    assert.equal(await focused(), `tab|true|${second}`, "Space: focus on the chosen tab");
    const aria = await page.evaluate(() => {
      const list = document.querySelector("[role=tablist]");
      return {
        names: [...list.querySelectorAll("[role=tab]")].map((t) => t.getAttribute("aria-label")),
        others: [...list.querySelectorAll("button, [tabindex]")].filter((b) => b.getAttribute("role") !== "tab" && !b.closest("[aria-hidden=true]")).map((b) => b.className),
      };
    });
    assert.deepEqual(aria.names, ["Untitled, DesignLab", "Untitled, DesignLab"]);
    assert.deepEqual(aria.others, [], "nothing but tabs in the tablist for a screen reader");
    // Delete on a tab closes it (× beside it is for the mouse and taps): the one not on screen just leaves.
    await page.focus(".design-tabs-tab[data-active=true] .design-tabs-main");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Delete");
    await tabsAre(page, ["Untitled|DESIGNLAB|on"], "Delete closed the tab with the box");
    await context.close();
  });

  await check("tabs hunt A5: × right after choosing an unchanged tab asks nothing (only real unsaved changes ask)", async () => {
    const { context, page } = await newPage(1280, false, "dark", slowStorage);
    await pastHome(page);
    await startWithBox(page);
    await saved(page);
    await page.click("#design-tabs-add");
    await tabsAre(page, ["Untitled|DESIGNLAB|", "Untitled|DESIGNLAB|on"], "two tabs");
    await page.locator("#start-hint").waitFor();
    await saved(page);
    await page.evaluate(() => (window.__idbDelay = 600)); // the store's reads slow, so the opened project is still being brought forward
    await page.click(".design-tabs-tab:first-child .design-tabs-main");
    await until(page, () => document.querySelector(".design-tabs-tab:first-child").dataset.active === "true", null, "the box's tab on screen", 30000);
    await until(page, () => document.querySelector("#save-status").dataset.state === "saving", null, "the box's project being stored again (the moment the hunt found)");
    await page.click(".design-tabs-tab[data-active=true] .design-tabs-close");
    await page.waitForTimeout(150);
    assert.equal(await page.isVisible("#design-tabs-keep"), false, "nothing changed in it: no question");
    await tabsAre(page, ["Untitled|DESIGNLAB|on"], "closed");
    // A change of the person's not stored yet still asks, in words that say closing keeps it.
    await page.locator("#start-hint").waitFor();
    await saved(page);
    await page.evaluate(() => {
      // × pressed the moment the change's save starts, before it can land.
      const mark = document.querySelector("#save-status");
      const watch = new MutationObserver(() => {
        if (mark.dataset.state !== "saving") return;
        watch.disconnect();
        document.querySelector(".design-tabs-tab[data-active=true] .design-tabs-close")?.click();
      });
      watch.observe(mark, { attributes: true, attributeFilter: ["data-state"] });
    });
    await insertPreset(page, "cylinder");
    await page.locator("#design-tabs-keep").waitFor({ timeout: 10000 });
    assert.match(await page.textContent(".design-tabs-ask p"), /doesn't lose them/);
    await page.click("#design-tabs-keep");
    await tabsAre(page, ["Untitled|DESIGNLAB|on"], "kept open");
    await context.close();
  });

  await check("tabs hunt C5: Home > Rename of a tab not on screen renames its tab, also after a reload", async () => {
    const { context, page } = await newPage();
    await pastHome(page);
    if ((await page.$("#home")) === null) return void (await context.close()); // only the home screen has Rename for another project
    await startWithBox(page);
    await saved(page);
    const a = await keyOf(page);
    await page.click("#design-tabs-add");
    await page.locator("#start-hint").waitFor();
    await insertPreset(page, "cylinder");
    await saved(page);
    const b = await keyOf(page);
    await chooseFile(page, "file-home");
    await until(page, () => !document.getElementById("home").hidden && document.querySelectorAll("#home-items .home-row").length > 1, null, "the home screen");
    await page.locator(`#home-items .home-row[data-id="${a}"] .home-rename`).click();
    await page.fill(".home-rename-box", "Gear");
    await page.click(".home-rename-ok");
    await until(page, () => [...document.querySelectorAll(".home-row-name")].some((n) => n.textContent === "Gear"), null, "Gear on Home");
    await page.click("#home-close");
    await until(page, (k) => document.querySelector(`.design-tabs-tab[data-key="${k}"] .design-tabs-name`)?.textContent === "Gear", a, "the tab says Gear");
    await page.waitForTimeout(500);
    await page.reload();
    await reloaded(page);
    await until(page, (k) => document.querySelector(`.design-tabs-tab[data-key="${k}"] .design-tabs-name`)?.textContent === "Gear", a, "the tab says Gear after a reload");
    // Renamed on another window's home screen: this window's tab takes the kept name at its next reload.
    const w2 = await window2(context);
    if ((await keyOf(w2)) !== b) await goTo(w2, b); // Home renames only a project not open in its window
    await chooseFile(w2, "file-home");
    await until(w2, () => !document.getElementById("home").hidden && document.querySelectorAll("#home-items .home-row").length > 1, null, "window 2's home screen");
    await w2.locator(`#home-items .home-row[data-id="${a}"] .home-rename`).click();
    await w2.fill(".home-rename-box", "Cog");
    await w2.click(".home-rename-ok");
    await until(w2, () => [...document.querySelectorAll(".home-row-name")].some((n) => n.textContent === "Cog"), null, "Cog on window 2's Home");
    await w2.click("#home-close");
    await insertPreset(w2, "sphere"); // the cylinder's project changed last, so a reload opens it and Cog's tab is not on screen
    await saved(w2);
    await w2.waitForTimeout(500);
    await page.reload();
    await reloaded(page);
    assert.equal(await keyOf(page), b, "the cylinder's project on screen");
    await until(page, (k) => document.querySelector(`.design-tabs-tab[data-key="${k}"] .design-tabs-name`)?.textContent === "Cog", a, "the tab says Cog, renamed in another window, after a reload");
    await context.close();
  });

}

await browser.close();
await server.close();
if (errors.length) {
  console.log(`page errors:\n${errors.join("\n")}`);
  failed++;
}
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
