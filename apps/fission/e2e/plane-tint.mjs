// Browser check of the sketch plane's tint (UI plan U7a): while a sketch is edited its plane is drawn as a tinted sheet under the grid,
// so it stays clearly there when the view is orbited to look at it from the other side (Ben, 2026-10-18).
// The canvas is read before and after Finish sketch with the camera still: the plane's far left strip (clear of the body) must be
// tinted while sketching and not after, from straight above and from below.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { preview } from "vite";
import { launch } from "./browser.mjs";
import { decodePng } from "./png.mjs";
import { pickPlane, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4203, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4203/?test-hooks";
const browser = await launch();
const errors = [];
let failed = false;

const canvasImage = async (page) => {
  const u = await page.evaluate(() => document.querySelector("#viewport canvas").toDataURL("image/png"));
  return decodePng(Buffer.from(u.slice(u.indexOf(",") + 1), "base64"));
};
/** The share of the left strip's pixels (the first 8 % of the width, all rows, where no body is) whose blue differs by 3 or more between two images of the same camera. */
function stripTinted(a, b) {
  const w = Math.floor(a.width * 0.08);
  let n = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < w; x++) if (Math.abs(a.data[4 * (y * a.width + x) + 2] - b.data[4 * (y * a.width + x) + 2]) >= 3) n++;
  return n / (w * a.height);
}
async function settled(page) {
  let last = null;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    const now = JSON.stringify(await page.evaluate(() => window.fissionTest.camera()));
    if (now === last) return;
    last = now;
  }
}
async function check(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed = true;
    console.log(`not ok - ${name}\n  ${e.message}`);
  }
}

await check("a sketch's plane is a tinted sheet, from above and from below; Finish takes it away", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  await page.goto(url + "#design");
  await startWithBox(page);
  await page.click("#create-sketch");
  await pickPlane(page, "XY", false);
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
  const box = await page.locator("#viewport canvas").boundingBox();
  const seen = {};
  for (const where of ["above", "below"]) {
    if (where === "below") {
      // Orbit from straight above to underneath: Shift+middle-drag up, twice 300 px (a pixel turns 0.36 degrees: 216 in all).
      for (let i = 0; i < 2; i++) {
        await page.keyboard.down("Shift");
        await page.mouse.move(box.x + box.width / 2, box.y + 450);
        await page.mouse.down({ button: "middle" });
        await page.mouse.move(box.x + box.width / 2, box.y + 150, { steps: 15 });
        await page.mouse.up({ button: "middle" });
        await page.keyboard.up("Shift");
      }
      await settled(page);
      const cam = await page.evaluate(() => window.fissionTest.camera());
      assert.ok(cam.position[2] < 0, `the camera is under the plane: z ${cam.position[2]}`);
    }
    await settled(page);
    seen[where] = await canvasImage(page);
  }
  await page.click("#sketch-finish");
  await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching !== "true");
  // Back to the two views with the sketch finished: the same cameras, no plane.
  for (const where of ["below", "above"]) {
    if (where === "above") {
      await page.click("#view-controls [data-view=top]").catch(() => {});
      await settled(page);
    }
    await settled(page);
    const after = await canvasImage(page);
    const share = stripTinted(seen[where], after);
    assert.ok(share > 0.5, `${where}: the plane tints the strip while sketching (${(share * 100).toFixed(0)} % of it differs from after Finish)`);
  }
  await context.close();
});

await browser.close();
await server.close();
if (errors.length) {
  failed = true;
  console.log("page errors:\n" + errors.join("\n"));
}
process.exit(failed ? 1 : 0);
