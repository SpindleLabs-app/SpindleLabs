// Load and save of a big project in the browser (load/save speed pass, 2026-11-11): the seeded 200-item project of
// big-project.mjs (100 sketches of 32 lines, each extruded: 100 bodies, about 1 MB of file) opened with Open, built,
// stored exactly as its file (byte for byte), and back after a reload; then edits, each saved, read no stored project
// text back (versions.ts reads the state a save replaces only when it could become a version: before, every save read
// the whole 1 MB back and wrote it out again to compare). Generous limits on time and the JavaScript heap, so a slow
// machine passes and a leak or a quadratic step fails. Chromium only (the heap is DevTools'). Run after a build.
import assert from "node:assert/strict";
import { launch, untilBodies } from "./browser.mjs";
import { pinProperties } from "./properties.mjs";
import { bigProject } from "./big-project.mjs";
import { preview } from "vite";

const ITEMS = 200;
const EDITS = 5;
const server = await preview({ ...(process.env.E2E_DIST ? { build: { outDir: process.env.E2E_DIST } } : {}), preview: { port: 4292, strictPort: true }, logLevel: "error" });
const browser = await launch();
const errors = [];
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
const saved = (page, timeout) => page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved", null, { timeout });
/** The stored projects' texts, read straight from IndexedDB (indexeddb.ts: database "fission", store "kv"). */
const storedTexts = (page) =>
  page.evaluate(
    () =>
      new Promise((done, fail) => {
        const r = indexedDB.open("fission");
        r.onerror = () => fail(r.error);
        r.onsuccess = () => {
          const out = {};
          const store = r.result.transaction("kv").objectStore("kv");
          const c = store.openCursor();
          c.onsuccess = () => {
            const at = c.result;
            if (!at) return (r.result.close(), done(out));
            if (String(at.key).startsWith("project/")) out[at.key] = at.value;
            at.continue();
          };
        };
      }),
  );

/** The store's key of the big project once stored. */
let key = null;
try {
  const text = bigProject({ seed: 1, items: ITEMS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("big-saveload")) indexedDB.deleteDatabase("fission");
    sessionStorage.setItem("big-saveload", "1");
    // Reads of a stored project's text through the store (IDBObjectStore.get of a project/ key).
    window.__projectReads = 0;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (typeof key === "string" && key.startsWith("project/")) window.__projectReads++;
      return get.call(this, key);
    };
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  await page.goto("http://localhost:4292/?test-hooks#design");
  await page.locator("#start-hint").waitFor();
  const blank = await heap();

  await check(`a ${ITEMS}-item project of ${(text.length / 1e6).toFixed(2)} MB opens, builds its ${ITEMS / 2} bodies and is stored byte for byte as its file`, async () => {
    const start = Date.now();
    await page.setInputFiles("#open-file", { name: "big.spindle", mimeType: "application/json", buffer: Buffer.from(text) });
    await untilBodies(page, ITEMS / 2, `${ITEMS / 2} bodies built`, 120_000);
    await saved(page, 120_000);
    const took = Date.now() - start;
    const kept = Object.entries(await storedTexts(page)).filter(([, v]) => v.includes('"name": "Big project"'));
    assert.equal(kept.length, 1, "the file stored once (beside the empty project the page started with)");
    assert.ok(kept[0][1] === text, "the stored text is the file's, byte for byte");
    key = kept[0][0];
    const grew = (await heap()) - blank;
    console.log(`  opened, built and stored in ${took} ms; heap +${(grew / 1e6).toFixed(1)} MB`);
    assert.ok(took < 180_000, `open took ${took} ms`);
    assert.ok(grew < 150e6, `the heap grew ${grew} bytes on open (a 1 MB file)`);
  });

  await check(`${EDITS} edits, each saved, read the stored project text back once (for the first version), and the heap grows by about an undo snapshot each, not more`, async () => {
    await pinProperties(page);
    const before = await heap();
    await page.evaluate(() => (window.__projectReads = 0));
    for (let i = 0; i < EDITS; i++) {
      await page.fill("#height", String(11 + i));
      await page.press("#height", "Enter");
      await saved(page, 120_000);
    }
    const reads = await page.evaluate(() => window.__projectReads);
    const grew = (await heap()) - before;
    console.log(`  ${reads} stored project reads; heap +${(grew / 1e6).toFixed(1)} MB over ${EDITS} edits`);
    // The first edit's save replaces the state Open stored, with no version yet: read, and kept as the first version.
    // Every later one lands within VERSION_GAP_MS (10 min) of it, so none can be kept and none is read (before: 5).
    assert.equal(reads, 1, "a save read the stored project back though no version could be kept");
    assert.ok(grew < EDITS * 8e6, `the heap grew ${grew} bytes over ${EDITS} edits (an undo snapshot is about ${(text.length / 1e6).toFixed(1)} MB)`);
  });

  await check("after a reload the project comes back with every body, stored as it was", async () => {
    const stored = (await storedTexts(page))[key];
    const bodies = await page.evaluate(() => window.fissionTest.bodyCount());
    await page.reload();
    await untilBodies(page, bodies, `${bodies} bodies after the reload`, 120_000);
    await saved(page, 120_000);
    assert.ok((await storedTexts(page))[key] === stored, "the reload brought it back and stored nothing new");
  });
  assert.deepEqual(errors, [], "no page errors");
} catch (e) {
  failed++;
  console.log(`not ok - ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
