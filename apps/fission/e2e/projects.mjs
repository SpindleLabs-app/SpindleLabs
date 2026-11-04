// Browser check of File > Projects in this browser… (U6a; round 2 hunt A2, A3), in a real Chromium:
//   A2  after File > Open, the project you had (never saved as a file) is listed and opens again, and a reload then
//       opens it (it was the one listed first);
//   A3  a stale tab's change kept "(from another tab)" is listed and opens;
//   Delete asks first, Keep it keeps it, Delete takes it out of the list for good (a reload doesn't bring it back), and
//       the open project offers no Delete;
//   a stored project that can't be read is refused in the dialog with why, and the open project stays as it was;
//   at 375 px with touch the dialog fills the screen, Close and every button are 44 px tall, nothing runs off the side.
// Screenshots (SHOTS=<dir>) at 1280 and 375 px. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { chooseFile, openPanel, startWithBox } from "./start.mjs";

const PORT = 4614;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
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
const volume = async (page, want) => {
  try {
    await page.waitForFunction((w) => document.querySelector("#volume")?.textContent === w, want, { timeout: 15000 });
  } catch {
    const now = await page.evaluate(() => [document.querySelector("#volume")?.textContent, document.querySelector("#file-status")?.textContent, document.querySelector("#projects-status")?.textContent].join(" | "));
    assert.fail(`the volume ${want}: timed out, showing ${now}`);
  }
};
const saved = (page) => until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");

async function fresh(width = 1280, touch = false) {
  const context = await browser.newContext({ viewport: { width, height: width > 700 ? 800 : 667 }, hasTouch: touch, isMobile: touch, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "#design");
  await startWithBox(page, touch); // 40 · 30 · 20 = 24,000 mm³
  await pinProperties(page);
  await saved(page);
  return { context, page };
}
async function typeWidth(page, value, tap = false) {
  await openPanel(page, "properties", tap);
  await page.click("#width");
  await page.fill("#width", value);
}
async function saveFile(page, tap = false) {
  const [download] = await Promise.all([page.waitForEvent("download"), tap ? chooseFile(page, "file-save", true) : page.click("#save")]);
  return JSON.parse(readFileSync(await download.path(), "utf8"));
}
const openFile = (page, name, file) => page.setInputFiles("#open-file", { name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
const showList = async (page, tap = false) => {
  await chooseFile(page, "file-projects", tap);
  await until(page, () => document.querySelector("#projects")?.open && document.querySelectorAll("#projects-items .project-row").length > 0, null, "the list");
};
/** The list as [name, when, buttons] rows. */
const listed = (page) =>
  page.$$eval("#projects-items .project-row", (rows) => rows.map((r) => [r.querySelector(".project-row-name").textContent, r.querySelector(".project-row-when").textContent, [...r.querySelectorAll("button")].map((b) => b.textContent)]));
const rowButton = (page, name, cls) => page.locator("#projects-items .project-row", { has: page.locator(".project-row-name", { hasText: name }) }).locator(`.${cls}`);
const shot = (page, name) => (shots ? page.screenshot({ path: `${shots}/${name}.png` }) : null);

/** A2's start: a 50-wide box kept only in this browser (30,000 mm³), then File > Open of a 60-wide file (36,000 mm³). */
async function openedOver(width = 1280, touch = false) {
  const { context, page } = await fresh(width, touch);
  const file = await saveFile(page, touch);
  file.name = "Sixty";
  file.workspaces.design.timeline.features[0].intent.parameters.width = 60; // 60 · 30 · 20 = 36,000 mm³
  await typeWidth(page, "50", touch);
  await volume(page, "30,000 mm³"); // 50 · 30 · 20: the user's own work, never saved as a file
  await saved(page);
  await openFile(page, "sixty.spindle", file);
  await volume(page, "36,000 mm³");
  await saved(page);
  return { context, page };
}

try {
  await check("A2: after Open, the project you had is listed, opens again, and a reload then opens it", async () => {
    const { context, page } = await openedOver();
    await showList(page);
    const rows = await listed(page);
    assert.deepEqual(
      rows.map(([name, when, buttons]) => [name, /open now$/.test(when), buttons]),
      [
        ["Sixty", true, []], // the opened file, first and open: nothing to open, no Delete
        ["Untitled", false, ["Open", "Delete"]], // the 50-wide box
      ],
    );
    assert.match(rows[1][1], /^Saved just now$/);
    await shot(page, "projects-list-1280");
    await rowButton(page, "Untitled", "project-open").click();
    await volume(page, "30,000 mm³");
    assert.equal(await page.$eval("#projects", (d) => d.open), false, "Open closed the dialog");
    await saved(page);
    // Undo has nothing of the file: it opened as a fresh start, as Open does.
    await page.reload();
    await volume(page, "30,000 mm³"); // brought forward: the project a reload opens
    await showList(page);
    assert.deepEqual((await listed(page)).map(([n, w]) => [n, /open now$/.test(w)]), [["Untitled", true], ["Sixty", false]]);
    // And back to the file's project, edits and all.
    await rowButton(page, "Sixty", "project-open").click();
    await volume(page, "36,000 mm³");
    await typeWidth(page, "70");
    await volume(page, "42,000 mm³"); // 70 · 30 · 20
    await saved(page);
    await page.reload();
    await volume(page, "42,000 mm³");
    await context.close();
  });

  await check("A3: a stale tab's change kept '(from another tab)' is listed and opens; the message says where", async () => {
    const { context, page } = await fresh();
    const id = await page.evaluate(() => document.body.dataset.projectId);
    const file = await saveFile(page);
    file.workspaces.design.timeline.features[0].intent.parameters.width = 77; // 77 · 30 · 20 = 46,200 mm³
    // A journal entry from a tab that went before storing it, made from an older stored state (base 1000 ms).
    await page.evaluate(({ id, text }) => localStorage.setItem(`panoshape.unsaved/${id}`, `@${Date.now()}~1000\n${text}`), { id, text: JSON.stringify(file) });
    await page.reload();
    await until(page, () => /from another tab/.test(document.querySelector("#file-status")?.textContent ?? ""), null, "the message");
    assert.match(await page.textContent("#file-status"), /"Untitled \(from another tab\)" \(File > Projects in this browser opens it\)/);
    await volume(page, "24,000 mm³"); // the newer work opens, as before
    await showList(page);
    assert.deepEqual((await listed(page)).map(([n]) => n), ["Untitled", "Untitled (from another tab)"]);
    await rowButton(page, "Untitled (from another tab)", "project-open").click();
    await volume(page, "46,200 mm³");
    await saved(page);
    await page.reload();
    await volume(page, "46,200 mm³");
    await context.close();
  });

  await check("Delete asks first, Keep it keeps it, Delete takes it out for good; the open project has no Delete", async () => {
    const { context, page } = await openedOver();
    await showList(page);
    await rowButton(page, "Untitled", "project-delete").click();
    assert.equal(await page.textContent("#projects-items .project-row-question"), "Delete “Untitled” from this browser? This can't be undone.");
    await shot(page, "projects-delete-ask-1280");
    await rowButton(page, "Untitled", "project-keep").click();
    assert.equal((await listed(page)).length, 2, "Keep it deleted nothing");
    await rowButton(page, "Untitled", "project-delete").click();
    await rowButton(page, "Untitled", "project-delete-sure").click();
    await until(page, () => document.querySelectorAll("#projects-items .project-row").length === 1, null, "one left");
    assert.deepEqual((await listed(page)).map(([n, , b]) => [n, b]), [["Sixty", []]]);
    await volume(page, "36,000 mm³"); // the open project untouched
    await page.keyboard.press("Escape");
    assert.equal(await page.$eval("#projects", (d) => d.open), false);
    await page.reload();
    await volume(page, "36,000 mm³");
    await showList(page);
    assert.deepEqual((await listed(page)).map(([n]) => n), ["Sixty"], "a reload doesn't bring it back");
    await context.close();
  });

  await check("a stored project that can't be read is refused in the dialog with why; the open project stays", async () => {
    const { context, page } = await openedOver();
    // Break the 50-wide box's stored text in IndexedDB (database "fission", store "kv"), as a damaged disk might.
    await page.evaluate(
      () =>
        new Promise((done, fail) => {
          const r = indexedDB.open("fission", 1);
          r.onsuccess = () => {
            const tx = r.result.transaction("kv", "readwrite");
            const kv = tx.objectStore("kv");
            const all = kv.getAllKeys();
            all.onsuccess = () => {
              const open = document.body.dataset.projectId;
              const other = all.result.find((k) => k.startsWith("project/") && k !== `project/${open}`);
              kv.put("{ not a project", other);
            };
            tx.oncomplete = () => (r.result.close(), done());
            tx.onerror = () => fail(tx.error);
          };
        }),
    );
    await showList(page);
    await rowButton(page, "Untitled", "project-open").click();
    await until(page, () => /^Can't open the stored project/.test(document.querySelector("#projects-status")?.textContent ?? ""), null, "the refusal");
    assert.equal(await page.$eval("#projects", (d) => d.open), true, "the dialog stays to say why");
    await volume(page, "36,000 mm³");
    assert.equal(await page.$eval("#save-status", (s) => s.dataset.state), "saved");
    await context.close();
  });

  await check("375 px with touch: the list fills the screen, every button 44 px tall, nothing off the side; opens by tap", async () => {
    const { context, page } = await openedOver(375, true);
    await showList(page, true);
    const fit = await page.evaluate(() => {
      const d = document.querySelector("#projects").getBoundingClientRect();
      const buttons = [...document.querySelectorAll("#projects button")].map((b) => b.getBoundingClientRect());
      return { left: d.left, right: d.right, width: innerWidth, short: buttons.filter((b) => b.height < 44).length, off: buttons.filter((b) => b.left < 0 || b.right > innerWidth).length, scrolls: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(fit, { left: 0, right: 375, width: 375, short: 0, off: 0, scrolls: false });
    await shot(page, "projects-list-375");
    await rowButton(page, "Untitled", "project-delete").tap();
    await shot(page, "projects-delete-ask-375");
    await rowButton(page, "Untitled", "project-keep").tap();
    await rowButton(page, "Untitled", "project-open").tap();
    await volume(page, "30,000 mm³");
    await page.reload();
    await volume(page, "30,000 mm³");
    await showList(page, true);
    await page.tap("#projects-close");
    assert.equal(await page.$eval("#projects", (d) => d.open), false, "Close shuts it");
    await context.close();
  });

  assert.deepEqual(errors, [], "no page errors");
} catch (e) {
  failed++;
  console.log(`not ok - ${e.message}`);
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("projects: all ok");
