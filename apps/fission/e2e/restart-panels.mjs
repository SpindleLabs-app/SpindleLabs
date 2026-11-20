// Browser check of a panel whose own question to the kernel is cut off by a
// kernel restart (weak-spot hunt C3, 2026-10-29). The kernel worker is
// wrapped so a chosen request's answer comes back as a trap, which starts a
// fresh kernel exactly as a real one does (kernel-client.ts restart).
// - Extrude: a trap as the panel asks whether the sketch makes a closed
//   outline left it saying "can't be extruded ... started again" with OK off,
//   though the sketch was fine; only Cancel and Extrude again re-asked. Now
//   it asks the fresh kernel once more by itself.
// - Move: a trap on OK said "Box 1 is not built, so Move 1 can't move it"
//   though the box was drawn again; a second OK worked. Now OK carries on
//   on the fresh kernel and records the Move.
// - Issue #627 item 13 (lost-work hunt F, 2026-11-12, L1 to L3): a restart on
//   Insert's first build left the box built but never opened the Move Insert
//   starts; one on Extrude's own check as OK was pressed recorded nothing and
//   said nothing, so OK had to be pressed twice; one on a sketch click's
//   rounding placed no point. Each now carries on on the fresh kernel.
// 1280 px; run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { HOME, screenPoint, TOP } from "./sketch-screen.mjs";
import { pinProperties } from "./properties.mjs";
import { closePanels, gridSnapOn, openPanel, pickPlane, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4247, strictPort: true }, logLevel: "error" });
const browser = await launch();
const errors = [];
let failed = false;

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}

/** A page whose kernel answers the next request of `window.trapNext(op)`'s op with a trap, once. */
async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    const Real = window.Worker;
    const ops = [];
    window.trapNext = (op) => ops.push(op);
    window.restarts = 0;
    window.Worker = class extends Real {
      constructor(...a) {
        super(...a);
        const trapped = new Set();
        const post = this.postMessage.bind(this);
        this.postMessage = (m, ...rest) => {
          const i = m?.op ? ops.indexOf(m.op) : -1;
          if (i >= 0) (ops.splice(i, 1), trapped.add(m.id));
          return post(m, ...rest);
        };
        const real = Object.getOwnPropertyDescriptor(Real.prototype, "onmessage");
        Object.defineProperty(this, "onmessage", {
          configurable: true,
          get: () => real.get.call(this),
          set: (f) =>
            real.set.call(this, (event) => {
              if (!trapped.delete(event.data?.id)) return f(event);
              window.restarts++;
              f({ data: { id: event.data.id, ok: false, error: { kind: "internal", inputs: [], message: "RuntimeError: memory access out of bounds (planted)" }, stopped: true } });
            }),
        });
      }
    };
  });
  await context.addInitScript(() => indexedDB.deleteDatabase("fission"));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("http://localhost:4247/?test-hooks#design");
  await startWithBox(page);
  return page;
}
const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => assert.fail(`${what}: timed out`));

try {
  await check("Extrude: a restart as the panel asks about the outline asks the fresh kernel again; OK comes on with no retyping", async () => {
    const page = await fresh();
    try {
      await pinProperties(page);
      await page.click("#create-sketch");
      await openPanel(page, "properties", false);
      await pickPlane(page, "XY", false);
      await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
      await openPanel(page, "properties", false);
      await gridSnapOn(page);
      await closePanels(page, false);
      const box = await page.locator("#viewport canvas").boundingBox();
      for (const [x, y] of [[0, 0], [40, 0], [40, 30], [0, 30], [0, 0]]) {
        const p = screenPoint(box, [x, y, 0], TOP);
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(250);
      }
      await page.evaluate(() => window.trapNext("sketch_outline"));
      await page.click("#sketch-extrude");
      await until(page, () => window.restarts === 1, null, "the planted trap");
      await until(page, () => /makes a closed outline/.test(document.querySelector("#extrude-status")?.textContent ?? ""), null, "the outline asked again");
      assert.equal(await page.$eval("#extrude-ok", (b) => b.disabled), false, "OK on");
    } finally {
      await page.context().close();
    }
  });

  await check("Move: a restart on OK carries on on the fresh kernel and records the Move, never saying the box is not built", async () => {
    const page = await fresh();
    try {
      await page.click("#move");
      await page.waitForSelector("#move-panel:not([hidden])");
      await closePanels(page, false);
      const box = await page.locator("#viewport canvas").boundingBox();
      const s = screenPoint(box, [20, 15, 20], HOME); // the box's top, as Move picks a body
      await page.mouse.click(s.x, s.y);
      await until(page, () => document.body.dataset.selection === "body:feature-1", null, "the box picked");
      await page.fill("#move-x", "15");
      await page.evaluate(() => window.trapNext("body_build"));
      await page.click("#move-ok");
      await until(page, () => window.restarts === 1, null, "the planted trap");
      await until(page, () => document.getElementById("move-panel").hidden, null, "the panel closed").catch(async (e) => {
        throw new Error(`${e.message} (it says: ${await page.$eval("#move-panel", (p) => p.innerText.replace(/\n+/g, " | "))})`);
      });
      assert.deepEqual(await page.$$eval("#timeline li[data-item]", (l) => l.map((li) => [li.dataset.item, li.dataset.failed === "true"])), [["feature-1", false], ["feature-2", false]]);
    } finally {
      await page.context().close();
    }
  });

  await check("Insert (#627 item 13, L1): a restart on the inserted box's first build still opens the Move Insert starts", async () => {
    const page = await fresh();
    try {
      await page.evaluate(() => window.trapNext("body_build"));
      await page.click("#insert");
      await page.click("#insert-cylinder");
      await until(page, () => window.restarts === 1, null, "the planted trap");
      await until(page, () => !document.getElementById("move-panel").hidden, null, "the Move opened");
      await until(page, () => document.body.dataset.selection === "body:feature-2", null, "the cylinder picked for the Move");
      assert.deepEqual(await page.$$eval("#timeline li[data-item]", (l) => l.map((li) => [li.dataset.item, li.dataset.failed === "true"])), [["feature-1", false], ["feature-2", false]]);
    } finally {
      await page.context().close();
    }
  });

  await check("Extrude (#627 item 13, L2): a restart on OK's own check records the extrude on the first OK", async () => {
    const page = await fresh();
    try {
      await pinProperties(page);
      await page.click("#create-sketch");
      await openPanel(page, "properties", false);
      await pickPlane(page, "XY", false);
      await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
      await openPanel(page, "properties", false);
      await gridSnapOn(page);
      await closePanels(page, false);
      const box = await page.locator("#viewport canvas").boundingBox();
      for (const [x, y] of [[0, 0], [40, 0], [40, 30], [0, 30], [0, 0]]) {
        const p = screenPoint(box, [x, y, 0], TOP);
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(250);
      }
      await until(page, () => /^4 lines, a closed outline/.test(document.getElementById("sketch-status")?.textContent ?? ""), null, "the rectangle").catch(async (e) => {
        throw new Error(`${e.message} (status: ${await page.$eval("#sketch-status", (el) => el.textContent)})`);
      });
      await page.click("#sketch-extrude");
      await until(page, () => /makes a closed outline/.test(document.querySelector("#extrude-status")?.textContent ?? ""), null, "the outline checked");
      await page.fill("#extrude-distance", "5");
      await page.waitForTimeout(500); // the preview settles before the trap is set, so the trap meets OK's own build
      await page.evaluate(() => window.trapNext("make_extrude"));
      await page.click("#extrude-ok");
      await until(page, () => window.restarts === 1, null, "the planted trap");
      await until(page, () => document.querySelectorAll("#timeline li[data-item]").length === 3, null, "the extrude recorded").catch(async (e) => {
        throw new Error(`${e.message} (the panel says: ${await page.$eval("#extrude-panel", (p) => p.innerText.replace(/\n+/g, " | ")).catch(() => "nothing")})`);
      });
      await until(page, () => [...document.querySelectorAll("#timeline li[data-item]")].every((li) => li.dataset.failed !== "true"), null, "nothing red");
    } finally {
      await page.context().close();
    }
  });

  await check("Sketch (#627 item 13, L3): a restart on a click's rounding still places the point", async () => {
    const page = await fresh();
    try {
      await pinProperties(page);
      await page.click("#create-sketch");
      await openPanel(page, "properties", false);
      await pickPlane(page, "XY", false);
      await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
      await openPanel(page, "properties", false);
      await gridSnapOn(page);
      await closePanels(page, false);
      const box = await page.locator("#viewport canvas").boundingBox();
      const a = screenPoint(box, [0, 0, 0], TOP);
      await page.mouse.click(a.x, a.y);
      const b = screenPoint(box, [40, 0, 0], TOP);
      await page.mouse.move(b.x, b.y);
      await page.waitForTimeout(500); // the hover's own rounding answered, so the trap meets the click's
      await page.evaluate(() => window.trapNext("snap_to_grid"));
      await page.mouse.down();
      await page.mouse.up();
      await until(page, () => window.restarts === 1, null, "the planted trap").catch(async (e) => {
        throw new Error(`${e.message} (status: ${await page.$eval("#sketch-status", (el) => el.textContent)})`);
      });
      await until(page, () => /^1 line/.test(document.getElementById("sketch-status")?.textContent ?? ""), null, "the line drawn by the trapped click").catch(async (e) => {
        throw new Error(`${e.message} (status: ${await page.$eval("#sketch-status", (el) => el.textContent)})`);
      });
    } finally {
      await page.context().close();
    }
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);
console.log("restart panels passed");
