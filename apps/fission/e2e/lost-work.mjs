// Lost-work hunt 2026-11-12 (issue #627): work that was never kept, or undo steps that went, with nothing said.
//   - a kept project opened from File > Projects, and a size typed before it has shown (item 2);
//   - a file opened and changed before the engine is ready (item 3);
//   - browser storage failing at the start, then a change and the tab closed (item 4);
//   - the store's text differing from today's only in layout, as an older SpindleLabs' text differs in its data
//     version: the kept History must still go back (item 6; the reader brings both to the same text);
//   - a change, then a reload 200 ms later (item 7).
// Run from apps/fission after `npm run build`: node e2e/lost-work.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { pinProperties } from "./properties.mjs";
import { chooseFile, sheetsClearFor, startWithBox } from "./start.mjs";

const PORT = 4477;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await launch();
const url = `http://localhost:${PORT}/?test-hooks#design`;
let failed = 0;
async function check(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  try {
    await fn(context);
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${(e.stack ?? String(e)).split("\n").slice(0, 8).join("\n  ")}`);
  } finally {
    await context.close();
  }
}
const until = (page, fn, arg, what, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const saved = (page) => until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
const volume = (page, want) => until(page, (w) => document.querySelector("#volume")?.textContent === w, want, `the volume ${want}`);
const asks = (page) => page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
/** Every entry of the app's store, read straight from IndexedDB. */
const stored = (page) =>
  page.evaluate(() => new Promise((done, fail) => {
    const r = indexedDB.open("fission");
    r.onerror = () => fail(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction("kv", "readonly");
      const kv = tx.objectStore("kv");
      const out = {};
      const keys = kv.getAllKeys();
      keys.onsuccess = () => { for (const k of keys.result) { const g = kv.get(k); g.onsuccess = () => (out[k] = g.result); } };
      tx.oncomplete = () => (r.result.close(), done(out));
      tx.onerror = () => fail(tx.error);
    };
  }));
const widthStored = async (page, id) => JSON.parse((await stored(page))[`project/${id}`]).workspaces.design.timeline.features[0].intent.parameters.width;
const projectId = (page) => page.evaluate(() => document.body.dataset.projectId);
/** Holds every kernel answer back `window.__kernelDelay` ms, in order: a phone, a big part, or a kernel still busy. */
const slowKernel = `(() => {
  window.__kernelDelay = 0;
  const Real = window.Worker;
  window.Worker = class extends Real {
    addEventListener(type, fn, o) {
      if (type !== "message") return super.addEventListener(type, fn, o);
      let last = Promise.resolve();
      return super.addEventListener(type, (e) => { const d = window.__kernelDelay; last = last.then(() => new Promise((r) => setTimeout(r, d))).then(() => fn.call(this, e)); }, o);
    }
    set onmessage(fn) { this.addEventListener("message", fn); }
  };
})()`;

await check("a width typed before a project opened from File > Projects has shown is stored", async (context) => {
  const page = await context.newPage();
  await page.addInitScript(slowKernel);
  await page.goto(url);
  await startWithBox(page);
  await pinProperties(page);
  await page.fill("#width", "50");
  await volume(page, "30,000 mm³"); // 50 × 30 × 20
  await saved(page);
  const first = await projectId(page);
  // A second project, so the first is one to open from the list: the first's file with width 60.
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
  const file = JSON.parse(readFileSync(await download.path(), "utf8"));
  file.name = "Sixty";
  file.workspaces.design.timeline.features[0].intent.parameters.width = 60;
  await page.setInputFiles("#open-file", { name: "sixty.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await volume(page, "36,000 mm³");
  await saved(page);
  await chooseFile(page, "file-projects");
  const open = page.locator("#projects-items .project-row", { has: page.locator(".project-row-name", { hasText: "Untitled" }) }).locator(".project-open").first();
  await open.waitFor();
  await page.evaluate(() => (window.__kernelDelay = 1500));
  await open.click();
  await until(page, () => document.querySelector("#width")?.value === "50", null, "the opened project's width box");
  await page.fill("#width", "70");
  await page.evaluate(() => (window.__kernelDelay = 0));
  await volume(page, "42,000 mm³"); // 70 × 30 × 20
  await saved(page);
  await page.waitForTimeout(1500); // past the quiet moment, so a save that was coming has come
  await saved(page);
  assert.equal(await projectId(page), first);
  assert.equal(await widthStored(page, first), 70, "the store holds the 70 typed, not the 50 it opened with");
  await page.reload();
  await volume(page, "42,000 mm³");
});

await check("a file opened and changed before the engine is ready is kept for the next visit", async (context) => {
  let release;
  const gate = new Promise((r) => (release = r));
  await context.route("**/*.wasm", async (route) => { await gate; await route.continue(); });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(1500); // the app is up, the engine still downloading
  const items = () => page.$$eval("#timeline li[data-item]", (l) => l.length);
  await page.setInputFiles("#open-file", { name: "phone.spindle", mimeType: "application/octet-stream", buffer: readFileSync(new URL("./regressions/phone-project-all-red.spindle", import.meta.url)) });
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 8, null, "the file's 8 items");
  assert.equal(await asks(page), true, "an opened file not kept yet: leaving asks first");
  await page.click("#insert");
  await page.click("#insert-box");
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 9, null, "the box inserted");
  // Kept at its first change, and stored a quiet moment later, engine or no engine.
  await until(page, () => document.body.dataset.projectId !== undefined && document.querySelector("#save-status").dataset.state === "saved", null, "the opened file stored with its change", 10000);
  assert.equal(await asks(page), false, "stored: nothing to ask");
  await page.reload();
  await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 9, null, "the file and the box after a reload");
  release();
  assert.equal(await items(), 9);
});

await check("browser storage failing at the start: a change, then leaving asks first, and the mark says nothing is kept", async (context) => {
  await context.addInitScript(() => {
    indexedDB.open = () => {
      const request = { error: new DOMException("planted open failure", "UnknownError"), onerror: null, onsuccess: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => request.onerror?.({ target: request, preventDefault() {} }));
      return request;
    };
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.locator("#start-hint").waitFor();
  await until(page, () => /can't be kept/.test(document.querySelector("#file-status").textContent), null, "the storage message");
  assert.match(await page.textContent("#save-status"), /^Not saved: nothing is kept in this browser/);
  assert.equal(await asks(page), false, "nothing made yet: nothing to ask");
  await startWithBox(page);
  await pinProperties(page);
  await page.fill("#width", "50");
  await volume(page, "30,000 mm³");
  await page.waitForTimeout(1500);
  assert.match(await page.textContent("#save-status"), /^Not saved: nothing is kept in this browser/, "the mark stays while it is so");
  assert.equal(await asks(page), true, "work nothing keeps: the page asks before going");
});

const CLEAR = ["#timeline", "#undo", "#redo", "#history", "#view-controls", "[data-view"];
async function historyRows(page) {
  if (!(await page.isVisible("#history")) || (await page.isDisabled("#history"))) return [];
  if (await page.isHidden("#history-panel")) await page.click("#history");
  await page.waitForSelector("#history-panel:not([hidden])");
  const rows = await page.$$eval("#history-panel .history-list li", (li) => li.map((l) => `${l.dataset.state}: ${l.querySelector(".history-name").textContent}`));
  await page.keyboard.press("Escape");
  return rows;
}

await check("the kept History goes back over a store whose text differs from today's only as written (an update)", async (context) => {
  const page = await context.newPage();
  await page.goto(url);
  await startWithBox(page, false);
  await sheetsClearFor(page, CLEAR);
  await pinProperties(page);
  await page.fill("#width", "60");
  await volume(page, "36,000 mm³");
  await page.waitForTimeout(1100);
  await page.fill("#height", "10");
  await volume(page, "18,000 mm³"); // 60 × 30 × 10
  await page.click("#undo");
  await volume(page, "36,000 mm³");
  const before = await historyRows(page);
  assert.ok(before.length >= 3, `the History before: ${JSON.stringify(before)}`);
  await saved(page);
  await page.waitForTimeout(800);
  // The stored project and every kept snapshot written again without their line breaks: the same projects as read,
  // other text, which is all an older build's "version" number is to the kept steps.
  const rewritten = await page.evaluate(() => new Promise((done, fail) => {
    const r = indexedDB.open("fission");
    r.onerror = () => fail(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction("kv", "readwrite");
      const kv = tx.objectStore("kv");
      const did = [];
      const keys = kv.getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result) {
          if (!/^(project|steps)\//.test(key)) continue;
          const got = kv.get(key);
          got.onsuccess = () => {
            const data = JSON.parse(got.result);
            if (key.startsWith("steps/")) for (const e of data.kept) e.snapshot = JSON.stringify(JSON.parse(e.snapshot));
            const text = JSON.stringify(data);
            if (text !== got.result) (kv.put(text, key), did.push(key.split("/")[0]));
          };
        }
      };
      tx.oncomplete = () => (r.result.close(), done(did.sort()));
      tx.onerror = () => fail(tx.error);
    };
  }));
  assert.deepEqual(rewritten, ["project", "steps"]);
  await page.reload();
  await volume(page, "36,000 mm³");
  await sheetsClearFor(page, CLEAR);
  await page.waitForTimeout(800);
  assert.deepEqual(await historyRows(page), before, "the History after the reload is the History before it");
  await page.click("#redo");
  await volume(page, "18,000 mm³"); // the height that was a Redo away
});

await check("a change, then a reload 200 ms later: the change is kept, and so are the undo steps", async (context) => {
  const page = await context.newPage();
  // The page gone, the browser may or may not finish the steps' write: here it never does (the case that lost them).
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (window.__leaving && typeof key === "string" && /^steps/.test(key)) return put.call(this, value, "dropped/" + key);
      return put.call(this, value, key);
    };
    window.addEventListener("beforeunload", () => (window.__leaving = true), true);
    window.addEventListener("pagehide", () => (window.__leaving = true), true);
  });
  await page.goto(url);
  await startWithBox(page, false);
  await sheetsClearFor(page, CLEAR);
  await pinProperties(page);
  await page.fill("#width", "50");
  await volume(page, "30,000 mm³");
  await saved(page);
  await page.waitForTimeout(800);
  await page.fill("#height", "33");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(200);
  assert.equal(await page.$eval("#save-status", (s) => s.dataset.state), "saving", "left while the mark still says Saving…");
  await page.reload();
  await volume(page, "49,500 mm³"); // 50 × 30 × 33: the change is kept
  await sheetsClearFor(page, CLEAR);
  await page.waitForTimeout(800);
  assert.equal(await page.isDisabled("#undo"), false, "Undo is still on");
  await page.click("#undo");
  await volume(page, "30,000 mm³"); // exactly the change made before leaving
  await page.click("#undo");
  await volume(page, "24,000 mm³"); // and the width before it: 40 × 30 × 20
});

await browser.close();
await new Promise((r) => server.httpServer.close(r));
process.exit(failed ? 1 : 0);
