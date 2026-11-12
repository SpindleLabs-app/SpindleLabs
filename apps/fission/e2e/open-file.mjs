// Browser check of Open (a project file) in a real browser (export hunt 2026-11-12, SL #642 item 1 and #644 items 2, 3):
// A  a file that is exactly a project already kept here, opened in a second browser tab, is not stored again with a
//    new save time: the first tab, still on that project, goes on saving its edits (it said "Not saved: changed in
//    another tab" for every later edit, though no one changed anything).
// B  when the browser can't keep projects (site data blocked), Open asks before it replaces a design that is saved
//    nowhere; Cancel keeps the design, OK opens the file. With nothing to lose it does not ask.
// C  a project that was never named takes the opened file's name, so two files can be told apart in Projects in this
//    browser (both said "Untitled"); a project with a name of its own keeps it whatever the file is called.
// Run with `npm run e2e` (after `npm run build`). ONLY=<letters> picks checks.
import assert from "node:assert/strict";
import { boot, check, fails, savedMark, status, storedProjects, volumeIs } from "./save-picker-lib.mjs";
import { startWithBox } from "./start.mjs";
import { pinProperties } from "./properties.mjs";

const b = await boot(4797);
const only = process.env.ONLY;
const want = (k) => !only || only.includes(k);
const mark = (page) => page.textContent("#save-status");
async function saveFile(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
  const chunks = [];
  for await (const c of await download.createReadStream()) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const openFile = (page, name, file) => page.setInputFiles("#open-file", { name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
/** `base` (a file the app saved: one 40 x 30 x 20 box) named `name` inside, `width` wide. */
function boxFile(base, name, width) {
  const f = structuredClone(base);
  f.name = name;
  f.workspaces.design.timeline.features[0].intent.parameters.width = width;
  return f;
}
async function fresh(context) {
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  PAGE ERROR", e.message));
  await page.goto(b.url + "#design");
  return page;
}
const newContext = () => b.browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
let base;
try {
  {
    const context = await newContext();
    const page = await fresh(context);
    await startWithBox(page);
    await savedMark(page);
    base = await saveFile(page);
    await context.close();
  }

  if (want("A")) await check("A  tab B opens the file tab A just saved: nothing is stored again, and tab A's next edit is still saved", async () => {
    const context = await newContext();
    const a = await fresh(context);
    await startWithBox(a);
    await pinProperties(a);
    await savedMark(a);
    const id = await a.evaluate(() => document.body.dataset.projectId);
    const file = await saveFile(a);
    await a.waitForTimeout(1500);
    const before = (await storedProjects(a)).find((p) => p.id === id).modified;
    const bTab = await fresh(context);
    await volumeIs(bTab, "24,000 mm³");
    await openFile(bTab, "Untitled.spindle", file);
    await bTab.waitForTimeout(3000);
    await savedMark(bTab);
    assert.equal(await bTab.evaluate(() => document.body.dataset.projectId), id, "tab B carries on under the kept project's id");
    const after = await storedProjects(a);
    console.log(`  stored save time before ${before}, after tab B's Open ${after.find((p) => p.id === id).modified}; projects kept: ${after.length}`);
    assert.equal(after.length, 1, "no second copy");
    assert.equal(after.find((p) => p.id === id).modified, before, "the file was stored again with a new save time though nothing changed");
    await a.fill("#height", "10");
    await volumeIs(a, "12,000 mm³");
    await a.waitForTimeout(2500);
    console.log(`  tab A after its edit: ${await mark(a)}`);
    assert.equal(await mark(a), "Saved");
    assert.match((await storedProjects(a))[0].sizes, /"height":10/);
    // and tab B's project is the one a reload opens, with an edit of its own still stored
    await context.close();
  });

  if (want("B")) await check("B  the browser can't keep projects: Open asks before it replaces a design that is saved nowhere", async () => {
    const context = await newContext();
    await context.addInitScript(() => { indexedDB.open = () => { throw new DOMException("The operation is insecure.", "SecurityError"); }; });
    const page = await fresh(context);
    await startWithBox(page);
    await pinProperties(page);
    await page.fill("#width", "55");
    await volumeIs(page, "33,000 mm³");
    const asked = [];
    let answer = "dismiss";
    page.on("dialog", (d) => (asked.push(d.message()), d[answer]()));
    await openFile(page, "other.spindle", boxFile(base, "Other", 77));
    await page.waitForTimeout(2000);
    console.log(`  Cancel: asked ${JSON.stringify(asked)}, volume ${await page.textContent("#volume")}`);
    assert.equal(asked.length, 1, "Open replaced the design without a question");
    assert.match(asked[0], /can't keep projects/);
    assert.equal(await page.textContent("#volume"), "33,000 mm³", "Cancel keeps the design");
    answer = "accept";
    await openFile(page, "other.spindle", boxFile(base, "Other", 77));
    await volumeIs(page, "46,200 mm³");
    assert.equal(asked.length, 2);
    // the opened file itself is unchanged: nothing to lose, so the next Open does not ask
    await openFile(page, "third.spindle", boxFile(base, "Third", 50));
    await volumeIs(page, "30,000 mm³");
    assert.equal(asked.length, 2, "asked though nothing had changed since the file was opened");
    // a file that can't be read is refused in words, without a question first
    await page.fill("#width", "51");
    await volumeIs(page, "30,600 mm³");
    await page.setInputFiles("#open-file", { name: "bad.spindle", mimeType: "application/json", buffer: Buffer.from("{") });
    await page.waitForFunction(() => /bad\.spindle/.test(document.querySelector("#file-status")?.textContent ?? ""));
    console.log(`  a broken file: ${await status(page)}`);
    assert.equal(asked.length, 2, "asked about a file that can't be opened");
    assert.equal(await page.textContent("#volume"), "30,600 mm³");
    await context.close();
  });

  if (want("C")) await check("C  a project never named takes the opened file's name; one with a name keeps it", async () => {
    const context = await newContext();
    const page = await fresh(context);
    await startWithBox(page);
    await pinProperties(page);
    await savedMark(page);
    for (const [name, file, width] of [["Bracket.spindle", boxFile(base, "Untitled", 41), "41"], ["Gear (2).spindlelabs.json", boxFile(base, "", 42), "42"], ["download.spindle", boxFile(base, "Clamp", 43), "43"], ["Untitled.spindle", boxFile(base, "Untitled", 44), "44"]]) {
      await openFile(page, name, file);
      await page.waitForFunction((w) => document.querySelector("#width")?.value === w, width);
      await page.waitForTimeout(600);
      await savedMark(page);
    }
    const names = (await storedProjects(page)).map((p) => p.name).sort();
    console.log(`  projects kept: ${JSON.stringify(names)}`);
    assert.deepEqual(names, ["Bracket", "Clamp", "Gear (2)", "Untitled", "Untitled"]); // the first is the box the visit began with
    await context.close();
  });
} finally {
  await b.close();
}
console.log(fails() ? `${fails()} check(s) failed` : "all open-file checks passed");
process.exit(fails() ? 1 : 0);
