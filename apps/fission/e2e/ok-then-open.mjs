// Browser check: OK, then another project opened (Open… of a file, File > Projects in this browser > Open) while the
// kernel still checks the OK (app-wide hunt 2026-11-14, S-1). The step was dropped from the project left behind with
// no question and no word; a reload or close asks in this state (SL #708 item 1) and the design tabs wait for it.
// Rule: Open waits for the OK, so the step is in the project left behind.
// The design is combine.mjs's: Box 1 40 × 30 × 20, Box 2 the same moved (20, 15, 10), Box 3 moved 100 along x; the step
// is Combine: Box 2 cut from Box 1 (a sixth timeline item, feature-6). The kernel's answers are held `window.kernelDelay`.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { chooseFile } from "./start.mjs";
import { preview } from "vite";

const PORT = 4871;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: "error" });
const browser = await launch();
const box = (n, label, [w, d, h]) => ({ dependsOn: [], id: `feature-${n}`, intent: { parameters: { width: w, depth: d, height: h }, summary: `Box: ${w} × ${d} × ${h} mm`, type: "box" }, provenance: { from: [], self: { id: `feature-${n}`, label, workspace: "design" } }, suppressed: false });
const move = (n, of, label, moveLabel, [x, y, z]) => ({ dependsOn: [of], id: `feature-${n}`, intent: { parameters: { pivotX: 0, pivotY: 0, pivotZ: 0, turnX: 0, turnY: 0, turnZ: 0, x, y, z }, summary: `Move ${label} by (${x}, ${y}, ${z}) mm`, type: "move" }, provenance: { from: [{ id: of, label, workspace: "design" }], self: { id: `feature-${n}`, label: moveLabel, workspace: "design" } }, suppressed: false });
const FILE = (name) => ({ formatVersion: 2, links: [], materials: [], name, units: { length: "mm" }, workspaces: { design: { nextId: 6, profiles: [], sketches: [], version: 4, timeline: { features: [box(1, "Box 1", [40, 30, 20]), box(2, "Box 2", [40, 30, 20]), move(3, "feature-2", "Box 2", "Move 1", [20, 15, 10]), box(4, "Box 3", [10, 10, 10]), move(5, "feature-4", "Box 3", "Move 2", [100, 0, 0])] } } } });
const OTHER = { formatVersion: 2, links: [], materials: [], name: "Other", units: { length: "mm" }, workspaces: { design: { nextId: 2, profiles: [], sketches: [], version: 4, timeline: { features: [box(1, "Box 1", [50, 30, 20])] } } } };

const until = (page, fn, arg, what, timeout = 40000) => page.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const rebuilt = (page) => until(page, () => document.querySelector("#viewport")?.dataset.rebuilding === "false" && !window.fissionTest.historyBusy(), null, "the rebuild landed");
const saved = (page) => until(page, () => document.querySelector("#save-status")?.dataset.state === "saved", null, "Saved");
const calm = async (page) => { await rebuilt(page); await saved(page); await page.waitForTimeout(900); await rebuilt(page); await saved(page); };
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
const itemsStored = async (page, id) => { const t = (await stored(page))[`project/${id}`]; return typeof t === "string" ? JSON.parse(t).workspaces.design.timeline.features.map((f) => f.id).join(" ") : `no project/${id}`; };
const items = (page) => page.$$eval("#timeline li[data-item]", (l) => l.map((li) => li.dataset.item).join(" "));
const projectId = (page) => page.evaluate(() => document.body.dataset.projectId);
const bodyRow = (page, name) => page.locator('#browser [data-node="bodies"] .tree-row', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();
const said = (page) => page.evaluate(() => ({ file: document.querySelector("#file-status")?.textContent ?? "", notes: [...document.querySelectorAll("#change-notes li, .change-note, #app-notice, #action-note")].map((e) => e.textContent.trim()).filter(Boolean), combineError: document.getElementById("combine-error")?.textContent ?? "", dialogs: [...document.querySelectorAll("dialog[open]")].map((d) => d.id) }));
const ALL = "feature-1 feature-2 feature-3 feature-4 feature-5";

async function openFile(page, file, n) {
  await page.setInputFiles("#open-file", { name: `${file.name}.spindle`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await until(page, (n) => document.querySelectorAll("#timeline li[data-item]").length === n, n, `${file.name} open`);
}
async function opened() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("ok-then-open-kept")) {
      indexedDB.deleteDatabase("fission");
      sessionStorage.setItem("ok-then-open-kept", "1");
    }
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      const wait = window.kernelDelay ?? 0;
      if (wait > 0 && message?.op !== undefined) return void setTimeout(() => send.call(this, message, ...rest), wait);
      return send.call(this, message, ...rest);
    };
  });
  const errors = [];
  const asked = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => (asked.push(`${d.type()}: ${d.message().slice(0, 80)}`), d.accept().catch(() => {})));
  await page.goto(`http://localhost:${PORT}/?test-hooks&combine#design`);
  await page.locator("#start-hint").waitFor();
  return { context, page, errors, asked };
}
async function combineReady(page) {
  await page.click("#modify-menu");
  await page.click("#modify-menu-combine");
  await until(page, () => document.getElementById("combine-panel")?.hidden === false, null, "the Combine panel open");
  await page.evaluate(() => document.querySelector('#browser details[data-node="bodies"]')?.setAttribute("open", ""));
  if ((await page.textContent("#combine-target-names")) !== "Body 1") await bodyRow(page, "Body 1").click();
  await bodyRow(page, "Body 2").click();
  await until(page, () => document.getElementById("combine-tools-names")?.textContent === "Body 2", null, "Body 2 the tool");
  await page.selectOption("#combine-operation", "cut");
}
let failed = 0;
async function check(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  const o = await opened();
  try {
    await fn(o);
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`NOT OK - ${name}\n  ${(e.stack ?? String(e)).split("\n").slice(0, 5).join("\n  ")}\n  page errors ${JSON.stringify(o.errors)}, dialogs ${JSON.stringify(o.asked)}`);
  } finally {
    await o.context.close();
  }
}

try {
  for (const held of [0, 1500]) {
    await check(`R1 (${held ? `kernel held ${held} ms` : "control: the OK landed first"}): Combine's OK, then Open… of another file: the Combine is in the project left behind`, async ({ page, asked }) => {
      await openFile(page, FILE("Left behind"), 5);
      await calm(page);
      const first = await projectId(page);
      await combineReady(page);
      await page.evaluate((d) => (window.kernelDelay = d), held);
      await page.click("#combine-ok");
      if (held) await until(page, () => document.getElementById("combine-ok")?.dataset.busy === "1", null, "OK busy while the kernel checks", 5000);
      else {
        await until(page, () => document.getElementById("combine-panel")?.hidden === true, null, "the Combine recorded");
      }
      const busy = await page.evaluate(() => ({ okBusy: document.getElementById("combine-ok")?.dataset.busy ?? null, held: window.fissionTest.historyBusy(), mark: document.querySelector("#save-status")?.dataset.state }));
      await openFile(page, OTHER, 1);
      const told = await said(page);
      await page.evaluate(() => (window.kernelDelay = 0));
      await page.waitForTimeout(held ? 4000 : 300);
      await calm(page);
      const left = await itemsStored(page, first);
      console.log(`  R1 held ${held}: at Open ${JSON.stringify(busy)}; said ${JSON.stringify(told)}; browser dialogs ${JSON.stringify(asked)}; the project left behind holds [${left}]; on screen [${await items(page)}]`);
      // Open it again from Projects in this browser: what the person finds.
      await chooseFile(page, "file-projects");
      const open = page.locator("#projects-items .project-row", { has: page.locator(".project-row-name", { hasText: "Left behind" }) }).locator(".project-open").first();
      await open.waitFor();
      await open.click();
      await until(page, () => document.querySelectorAll("#timeline li[data-item]").length >= 5, null, "the first project open again");
      await calm(page);
      const again = await items(page);
      const undo = await page.evaluate(() => document.getElementById("undo").title);
      console.log(`  R1 held ${held}: opened again it shows [${again}], Undo says "${undo}"`);
      assert.equal(left, `${ALL} feature-6`, "the Combine is in the project left behind, as stored");
      assert.equal(again, `${ALL} feature-6`, "and opened again");
      assert.match(undo, /^Undo Combine bodies/, "its Undo takes the Combine back");
    });
  }
  await check("R2 (kernel held 1500 ms): Combine's OK, then File > Projects in this browser > Open of another project: the Combine is kept", async ({ page, asked }) => {
    await openFile(page, OTHER, 1);
    await calm(page);
    await openFile(page, FILE("Left behind"), 5);
    await calm(page);
    const first = await projectId(page);
    await combineReady(page);
    // The list opened first costs the person two presses; the OK is pressed by Enter with the Combine panel's OK focused.
    await page.evaluate(() => (window.kernelDelay = 1500));
    await page.click("#combine-ok");
    await until(page, () => document.getElementById("combine-ok")?.dataset.busy === "1", null, "OK busy while the kernel checks", 5000);
    await chooseFile(page, "file-projects");
    const open = page.locator("#projects-items .project-row", { has: page.locator(".project-row-name", { hasText: "Other" }) }).locator(".project-open").first();
    await open.waitFor();
    const busy = await page.evaluate(() => ({ okBusy: document.getElementById("combine-ok")?.dataset.busy ?? null, held: window.fissionTest.historyBusy() }));
    await open.click();
    await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 1, null, "Other open");
    const told = await said(page);
    await page.evaluate(() => (window.kernelDelay = 0));
    await page.waitForTimeout(4000);
    await calm(page);
    const left = await itemsStored(page, first);
    console.log(`  R2: at Open ${JSON.stringify(busy)}; said ${JSON.stringify(told)}; browser dialogs ${JSON.stringify(asked)}; the project left behind holds [${left}]`);
    assert.equal(left, `${ALL} feature-6`, "the Combine is in the project left behind, as stored");
  });
} finally {
  await browser.close();
  await server.close?.();
  server.httpServer?.close();
}
console.log(failed ? `${failed} FAILED` : "all ok");
process.exit(failed ? 1 : 0);
